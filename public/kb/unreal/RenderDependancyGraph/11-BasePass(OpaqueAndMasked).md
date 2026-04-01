---
tags:
  - rendering-pipeline
  - basepass
  - gbuffer
  - nanite
  - materials
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – BasePass (Opaque & Masked)

> Stage: **BasePass (Opaque & Masked)**  
> Phase: Main Geometry Shading  
> Purpose: Evaluate all opaque and masked material shaders and write the results into the GBuffer for deferred lighting  
> Pipeline Position: After `CompositionBeforeBasePass`, before deferred lighting passes

---

## What This Stage Does

BasePass is the primary material evaluation pass in deferred rendering. It is where every visible surface gets its material computed and the results stored for lighting to use. It is consistently one of the most expensive passes in any frame — material complexity, overdraw, geometry count, and texture bandwidth all converge here.

**Two fundamentally different execution paths run in parallel:**

### Traditional BasePass (non-Nanite geometry)
For all non-Nanite opaque and masked geometry:
1. Draw commands (from `BuildRenderingCommandsDeferred`) are submitted in parallel command lists across worker threads
2. The GPU rasterizes geometry and runs the pixel shader for each covered fragment
3. Fragments that pass the depth test (early-Z from PrePass) have their material evaluated
4. Material results are written into GBuffer render targets

### Nanite BasePass (Nanite geometry)
Nanite BasePass does **not rasterize geometry**. The geometry was already rasterized in `NaniteVisibilityBuffer`. Instead:
1. The Visibility Buffer is read — each pixel contains a packed ID identifying which Nanite triangle covers it
2. Pixels are classified by material ID — unique material/pixel combinations are sorted and binned
3. A screen-space material evaluation dispatch runs for each unique material present in the Visibility Buffer
4. Material results are written into the same GBuffer targets

The critical distinction: **Nanite BasePass is a screen-space compute operation, not a geometry rasterization operation.** Its cost scales with unique visible material count and screen coverage, not triangle count.

---

## Why This Stage Exists

Deferred rendering separates two independent problems:
1. **Material evaluation** — what does each surface look like? (BasePass, this stage)
2. **Lighting evaluation** — how is each surface illuminated? (deferred lighting passes, later)

By separating them, lighting cost becomes independent of material complexity, and material cost becomes independent of light count. A scene with 50 lights and 1 material pays material cost once per pixel; a forward renderer would pay it 50 times.

All material cost — texture sampling, shader math, normal maps, detail layers, WPO — is paid in this stage. Deferred lighting sees only the GBuffer, not the materials.

---

## Threading Model

Like `PrePass` and `VelocityPass`, BasePass runs as **BasePassParallel** — draw commands distributed across parallel render command lists on worker threads.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Distributes draw commands into parallel lists; owns submission |
| **Task Graph (Workers)** | Each worker builds a subset of BasePass draw commands — geometry batched by material/PSO |
| **RHI Thread** | Receives merged command lists and submits to GPU |
| **GPU** | Rasterizes traditional geometry; executes Nanite material classify + shade compute |

> [!NOTE]
> Draw commands are sorted by **Pipeline State Object (PSO)** — changing PSO (switching between materials with different blend modes, shading models, or vertex factory configurations) is one of the most expensive GPU state changes. The parallel command list build attempts to batch draws by PSO to minimize switches. More unique materials = more PSO switches = higher CPU submission cost and GPU state change overhead.

---

## The GBuffer Layout

BasePass writes into multiple simultaneous render targets. Understanding what each stores matters for material authoring, debugging, and understanding downstream pass dependencies.

| Target | Content | Format | Key Consumers |
|--------|---------|--------|--------------|
| GBufferA | World-space normal (XYZ) + per-object data | RGB10A2 | Deferred lighting, SSAO, SSR, Lumen |
| GBufferB | Metallic, Specular, Roughness, Shading Model ID | RGBA8 | Deferred lighting, reflections |
| GBufferC | Base Color (albedo) + ambient occlusion | RGBA8 | Deferred lighting, Lumen diffuse |
| GBufferD | Custom data (subsurface color, hair tangent, cloth fuzz, etc.) | RGBA8 | Shading model-specific lighting |
| GBufferE | Pre-shadowed factor (stationary lights) | RGBA8 | Stationary light deferred lighting |
| SceneDepth | Depth (from PrePass; not re-written for opaque meshes) | R32F | All subsequent passes |
| Velocity (optional) | Per-pixel motion vectors if not in separate pass | RG16F | TSR, motion blur |

> [!NOTE]
> **Static and stationary light contributions from baked lightmaps are applied in BasePass, not in the deferred lighting pass.** Indirect lighting baked by Lightmass (or GPU Lightmass) is stored in lightmap textures and sampled here during material evaluation. The deferred lighting pass handles only dynamic and stationary direct light contributions. This means the cost of lightmap sampling is a BasePass cost, and scenes with many unique lightmap UVs and high lightmap resolutions pay that cost here.

> [!WARNING]
> **GBuffer bandwidth is a real constraint on memory-limited platforms.** Writing 5–6 render targets simultaneously at full resolution is expensive in memory bandwidth. On consoles and mobile targets, GBuffer format reduction (using a more compact layout) is an important optimization. `r.GBufferFormat` controls the global GBuffer precision — lower values reduce bandwidth but lose precision in roughness, specular, and normal encoding.

---

## Geometry Included

| Geometry Type | Path | Notes |
|--------------|------|-------|
| Opaque meshes | Traditional raster | Standard path; early-Z from PrePass reduces pixel cost |
| Masked materials | Traditional raster | No early-Z hardware optimization; evaluates `clip()` per pixel |
| Nanite geometry (opaque) | Visibility Buffer classify + shade | Material evaluation only; no rasterization |
| Nanite geometry (masked) | Visibility Buffer classify + shade | Same path as opaque Nanite, but masked shading model |
| Skinned/skeletal meshes | Traditional raster | Dynamic path; no static draw command cache |
| Translucent meshes | ❌ Not included | Separate forward-shaded translucency pass |
| Sky | ❌ Not included | Dedicated sky pass |
| Single Layer Water | ❌ Not included | Dedicated water pass |

---

## Why This Can Be Expensive — Detailed Breakdown

Understanding which bottleneck type you're hitting determines the correct fix. These are not equivalent problems.

### Pixel-Bound (most common)
Material shader is too complex — too many texture samples, too many math operations, expensive shading models.
- **Symptoms:** GPU time high, shader complexity view red/white, cost scales with screen coverage
- **Fix:** Reduce texture samples, simplify material graphs, prefer cheaper shading models

### Bandwidth-Bound
Too many texture reads exceed memory bandwidth — common with many detail/normal/mask layers.
- **Symptoms:** GPU time high but shader instruction count low; scales with texture resolution and sample count
- **Fix:** Reduce texture resolution, compress textures, combine channels into packed textures, reduce sample count

### Vertex-Bound (less common, specific causes)
WPO or high-poly non-Nanite geometry with expensive vertex shaders.
- **Symptoms:** Cost on high-poly geometry even at small screen size
- **Fix:** Enable Nanite (eliminates traditional vertex cost); reduce WPO complexity; apply aggressive LODs

### Overdraw
Pixels shaded multiple times due to geometry layering without PrePass protection.
- **Symptoms:** `viewmode quadoverdraw` shows red/white regions; cost higher than geometry complexity suggests
- **Fix:** Ensure PrePass is enabled and covering relevant geometry; reduce transparent/masked geometry layers

### PSO / Draw Call Overhead
Too many unique materials causing frequent PSO switches and high CPU command submission cost.
- **Symptoms:** High `stat RHI` draw call count; CPU render thread approaching GPU time
- **Fix:** Reduce unique materials; share master materials with parameters; convert to Nanite (eliminates per-draw CPU cost)

---

## Nanite BasePass — Material Cost Scaling

This is the most important concept to understand for Nanite-heavy scenes.

In traditional rendering, cost scales with: `pixels × material complexity`

In Nanite BasePass, cost scales with: `unique visible materials × (their pixel coverage × material complexity)`

> [!WARNING]
> **Nanite BasePass cost is driven by unique visible material count, not triangle count.** A Nanite mesh with 50 million triangles using one material dispatches one material evaluation pass. A Nanite mesh with 1,000 triangles using 8 material slots dispatches 8 material evaluation passes. Reducing material slot count on Nanite assets is the primary optimization for Nanite BasePass cost — not reducing polygon count.

Each unique visible material in the Visibility Buffer triggers a separate screen-space classify and shade dispatch. Materials that cover very few pixels still pay the dispatch overhead. In a scene with many unique Nanite materials — even simple ones — the classify + dispatch overhead accumulates. Monitor unique material counts with `r.Nanite.Visualize material`.

---

## Shader Permutations and PSO Implications

Every unique combination of material features (shading model, blend mode, static switches, vertex factory type, lighting mode) generates a distinct shader variant — a **PSO (Pipeline State Object)**. UE5 must compile a PSO before it can be used for the first time.

> [!WARNING]
> **Complex material graphs generate large numbers of PSO permutations that increase compile time and can cause hitching on first encounter.** A material with multiple static switches, an unusual shading model, and a custom vertex factory may generate hundreds of unique PSO variants. These are compiled asynchronously in the background, but if a new variant is needed before its compilation completes, the renderer stalls. This is the source of the "first-time-seeing-this-material hitch" common in open-world games. Use PSO precaching (`r.PSOPrecaching`) and `r.ShaderPipelineCache` to mitigate.

---

## Quad Occupancy and Overdraw

GPUs evaluate pixel shaders in **2×2 pixel quads**. If a triangle covers fewer than 4 pixels, the GPU still invokes a full quad — unused pixels in the quad consume shader execution time without contributing output. This is **quad inefficiency** (also called quad overdraw or helper pixel cost).

`viewmode quadoverdraw` reveals this waste:
- **Green** — good quad utilization (most pixels in each quad are active)
- **Yellow/Orange** — moderate waste
- **Red/White** — severe waste — many helper pixels executing unused

> [!NOTE]
> **Dense foliage with many small leaf cards at distance is the worst-case quad inefficiency scenario.** Each small card triangle at distance may cover only 1–2 pixels, meaning 50–75% of each quad evaluation is wasted. This is one of the primary reasons dense foliage is expensive even when individual triangles are tiny — the GPU is paying full quad cost for every sliver of geometry. Nanite addresses this at the rasterization stage; LODs with simplified merged cards address it for traditional geometry.

---

## Key Systems and Components

### PSO (Pipeline State Object)
The GPU state descriptor for a draw call — encodes shaders, blend mode, rasterizer state, vertex format, and render target format. Switching PSO between draw calls is expensive. BasePass draw commands are sorted by PSO to minimize switches. Every unique material combination that generates a unique PSO adds potential switching cost and compile overhead.

### GBuffer MRT (Multiple Render Target) Write
BasePass simultaneously writes to 5–6 render targets every pixel. All writes happen in a single pass — the GPU writes to all targets in parallel. The bandwidth cost of this is one of the primary reasons GBuffer format matters on memory-constrained platforms.

### Early-Z Depth Test
Opaque non-Nanite geometry uses the depth written in PrePass to reject fragments before the pixel shader runs. This is the mechanism that makes PrePass worthwhile — the pixel shader for occluded pixels never executes. For Nanite pixels, the stencil bit written in `NaniteEmitDepthTargets` tells BasePass to skip traditional rasterization entirely for those pixels.

### Lightmap Sampling
For static and stationary lights with baked indirect contributions, lightmap textures are sampled during BasePass material evaluation. This is a BasePass cost, not a deferred lighting cost. High lightmap resolution and many unique lightmap UVs increase BasePass texture bandwidth directly.

---

## 📋 Reader Notes

> [!NOTE]
> **BasePass is almost always in the top 3 most expensive passes in any frame.** Unlike earlier passes in the pipeline which can be near-zero with good content, BasePass pays cost proportional to scene complexity, material quality, and visible surface area — which are always non-zero in a real game scene. Setting realistic expectations: 3–5ms is common in complex scenes on mid-range hardware; anything above 6–8ms warrants investigation.

> [!NOTE]
> **The BasePass for Nanite and traditional geometry are separate GPU events in Unreal Insights.** `BasePass` covers traditional raster geometry; `NaniteBasePass` covers Nanite material evaluation. Profile them independently — a scene that's expensive in `NaniteBasePass` needs material consolidation on Nanite assets, while a scene expensive in `BasePass` needs material simplification or geometry reduction on traditional meshes. The fixes are different.

> [!NOTE]
> **Masked geometry is significantly more expensive than opaque — for two compounding reasons.** First, the `clip()` instruction in masked materials prevents the GPU's early-Z hardware from culling fragments before the pixel shader (the shader must run to know whether to discard). Second, if masked materials are not included in PrePass, they provide no occlusion for geometry behind them, increasing overdraw. Always profile masked vs opaque cost specifically with `viewmode shadercomplexity` filtering to masked objects.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for:

| Event | What It Tells You |
|-------|------------------|
| `BasePass` | Traditional raster geometry material evaluation — total time |
| `NaniteBasePass` | Nanite Visibility Buffer classify + material shade — total time |
| `BasePassParallel` | Parallel command list submission cost on render thread |

> [!TIP]
> Check `BasePass` vs `NaniteBasePass` separately first to determine which path is the bottleneck. If `BasePass` is dominant, use `viewmode shadercomplexity` to identify expensive materials, and `viewmode quadoverdraw` to identify geometry with poor quad utilization. If `NaniteBasePass` is dominant, use `r.Nanite.Visualize material` to count unique visible materials and identify consolidation opportunities.

### Debug Viewport Modes

```
viewmode shadercomplexity   // Heatmap of shader instruction cost per pixel.
                            // Green = cheap, Yellow = moderate, Red/White = expensive.
                            // White means the pixel is well above the maximum threshold (~300 instructions).
                            // Use to identify specific materials or regions that are outliers.

viewmode quadoverdraw       // Heatmap of 2×2 quad utilization waste.
                            // Green = efficient, Red/White = severe helper pixel waste.
                            // Worst on thin foliage cards, fine wires, small meshes at distance.

viewmode lightmapsampler    // Shows which surfaces are sampling lightmaps during BasePass.
                            // Identifies unexpected lightmap reads or missing lightmap UVs.
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — BasePass appears as a block; NaniteBasePass separately
stat RHI    // Draw call count and PSO switch frequency — high values indicate batching problems
```

### Useful Console Variables

```
r.EarlyZPass [1]                    // Ensure PrePass is covering opaque geometry to enable early-Z rejection
r.GBufferFormat [0-5]               // GBuffer precision/bandwidth tradeoff — lower on constrained platforms
r.AllowStaticLighting [0/1]         // Toggle static lightmap sampling in BasePass to isolate its cost
r.Nanite.Visualize material         // Shows unique material IDs in Nanite Visibility Buffer
r.BasePassOutputsVelocity [0/1]     // Toggle velocity output in BasePass vs separate velocity pass
r.PSOPrecaching [0/1]               // Enable PSO precaching to reduce first-encounter hitches
```

---

## Optimization Levers

### Materials (Highest Impact)
- Reduce texture sample count per material — each sample adds bandwidth and instruction cost
- Combine channel-packed textures (ORM maps: Occlusion/Roughness/Metallic in one texture) to reduce sample count
- Prefer simpler shading models — `Default Lit` < `Subsurface` < `Hair` < `Eye` in increasing cost
- Remove unused material inputs — disconnected nodes in the material graph still affect compile time even if zero at runtime
- Replace dynamic material parameter reads with static switches where values don't change per-instance

> [!WARNING]
> **Material complexity affects PSO compile time, not just runtime cost.** A complex material with many static switches generates many permutations. Even if the runtime cost is acceptable, the compile permutation count can cause multi-second stalls when PSOs are first encountered in the game. Use `r.PSOPrecaching` and build PSO caches in CI pipelines for shipped builds.

### Geometry and Overdraw
- Ensure `r.EarlyZPass` is set to 1 (opaque only) minimum — this is the primary overdraw protection
- Reduce masked foliage density; convert to opaque imposter cards at distance where alpha detail is imperceptible
- Disable two-sided on any mesh where it isn't a hard visual requirement
- Use Nanite on all dense static geometry to eliminate traditional vertex and raster cost

> [!WARNING]
> **WPO is evaluated independently in the BasePass vertex shader from its PrePass evaluation.** WPO results are not cached between passes — the vertex shader runs again in BasePass. A large WPO foliage field pays the WPO vertex cost in PrePass (if included) and again in BasePass. This is separate from the velocity pass cost also paid for WPO geometry. Dense WPO scenes pay vertex shader cost in up to three separate passes per frame.

### Nanite-Specific
- Keep material slot count low on Nanite assets — each unique visible material dispatches a separate Nanite shading pass
- Share master materials across Nanite geometry — parameter variation is free; unique material graphs are not
- Use `r.Nanite.Visualize material` to audit unique material count in complex scenes

### Rendering Configuration
- Reduce screen percentage on lower-end platforms — BasePass pixel cost scales exactly with rendered pixel count
- Verify lightmap resolutions are appropriate per mesh — high lightmap resolution on small props adds BasePass bandwidth for minimal quality gain

---

## Mental Model

Think of BasePass as:

> *"For every visible pixel in the scene — evaluate its material completely, and store the result. Lighting will deal with it later."*

BasePass is the most direct translation of artistic content into GPU cost. Complex materials cost more. More visible pixels cost more. More unique materials cost more. There is no indirection here — every feature added to a material, every additional texture layer, every masked edge, has a direct and proportional cost in this pass every frame.

The key insight is the **deferred/Nanite split**: traditional meshes pay geometry and material cost together (rasterize → shade → write GBuffer). Nanite meshes pay geometry cost separately (Visibility Buffer) and material cost here as a screen-space operation. This means the same frame can have two very different cost profiles for the same visual result, and they need to be debugged with different tools and fixed with different strategies.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| PrePass | Provides early-Z depth; prevents BasePass from shading occluded pixels |
| NaniteVisibilityBuffer | Provides Nanite Visibility Buffer that NaniteBasePass reads for material evaluation |
| GBuffer | Primary output — all deferred lighting reads from GBuffer written here |
| Deferred Lighting | Reads every GBuffer target to compute final lighting; entirely dependent on BasePass |
| Lumen | Uses GBuffer normals, base color, roughness for surface cache and screen-space tracing |
| Lightmaps | Sampled here during BasePass material evaluation for static/stationary light contribution |
| PSO Cache | Pre-compiled pipeline state objects; quality determines whether first-encounter hitches occur |

---

## Red Flags to Watch For

- **`BasePass` > 4ms on mid-range GPU** → run `viewmode shadercomplexity`; identify and simplify outlier materials
- **`NaniteBasePass` > 2ms** → run `r.Nanite.Visualize material`; too many unique visible Nanite materials; consolidate
- **`viewmode shadercomplexity` showing widespread white** → many materials above the expensive threshold; material audit needed across the visible scene
- **`viewmode quadoverdraw` showing red regions on foliage or thin geometry** → severe quad inefficiency; merge or LOD aggressive small geometry
- **`stat RHI` draw calls > 5k in non-Nanite scene** → material/PSO batching breaking down; reduce unique materials
- **First-visit hitches when entering new areas** → PSO compile stalls; enable `r.PSOPrecaching` and build PSO cache in pipeline
- **BasePass cost high but `viewmode shadercomplexity` shows moderate material cost** → likely bandwidth-bound from high texture sample count or large GBuffer; audit texture counts per material
- **WPO on large static geometry visible in scene** → vertex cost paid in up to three passes (PrePass, BasePass, VelocityPass); restrict WPO to hero assets only
- **Masked foliage across large scene areas** → compounding cost: no early-Z, double raster (two-sided), quad inefficiency at distance

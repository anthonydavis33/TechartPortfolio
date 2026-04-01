---
tags:
  - nanite
  - visibility-buffer
---

# Unreal Engine 5 Rendering Pipeline – Nanite Visibility Buffer (Draw Geometry)

> Stage: **Nanite Visibility Buffer (Draw Geometry)**  
> Phase: Visibility Determination / Geometry Rasterization  
> Purpose: GPU-driven cluster culling and rasterization of all Nanite geometry into a packed visibility buffer before any shading occurs  
> Pipeline Position: After `PrePass`, runs in parallel with or before `BasePass`

---

## What This Stage Does

Nanite does not use traditional CPU-issued draw calls. This entire stage is **GPU-driven compute** — the CPU sets up the initial scene data, then the GPU autonomously culls, selects LODs, and rasterizes all Nanite geometry without further CPU involvement per object.

The stage performs two major phases:

**Phase 1 — Culling:**
- Instance-level culling (frustum, HZB occlusion) eliminates entire meshes
- Cluster-level culling refines surviving instances down to visible 128-triangle clusters
- Screen-space error evaluation selects the appropriate LOD cluster per screen region
- HZB feedback from the previous frame drives occlusion decisions

**Phase 2 — Rasterization (two paths run in parallel):**
- **Hardware raster** — large triangles (covering multiple pixels) rasterized via the GPU's fixed-function raster pipeline
- **Software raster** — small triangles (sub-pixel or near sub-pixel) rasterized via a compute shader that handles them more efficiently than hardware

Both paths write into the Visibility Buffer — a packed integer buffer, not a traditional color render target. No shading happens here.

---

## Why This Stage Exists

Traditional rendering ties visibility and shading together — every draw call both determines geometry and evaluates its material. Nanite **decouples** these completely:

- **Visibility** — which exact triangles cover which pixels (this stage)
- **Shading** — what those pixels look like (Nanite BasePass, downstream)

This decoupling enables:
- Triangle counts in the hundreds of millions — culled to only screen-relevant clusters before any shading
- Per-pixel LOD selection driven by screen-space geometric error, not per-mesh screen size
- Fully GPU-driven pipeline with no CPU bottleneck per object
- Fine-grained occlusion culling at the cluster level (128 triangles), not the mesh level

This replaces all CPU-side LOD selection, draw call submission, and occlusion culling for Nanite meshes.

---

## The Two-Pass Rasterizer

This is one of the most important technical details in Nanite and is rarely explained in documentation.

**Hardware Raster Path**
Used for triangles large enough for the GPU's fixed-function rasterizer to handle efficiently (triangles covering at least a few pixels). This is the fast path — hardware raster is highly optimized and runs at full GPU throughput.

**Software Raster Path**
Used for very small triangles (sub-pixel or covering only 1–2 pixels). At this scale, hardware rasterizer efficiency degrades significantly — a single triangle can span fewer pixels than a GPU wavefront. Nanite's software rasterizer is a compute shader that bins and processes these tiny triangles more efficiently.

> [!NOTE]
> In a typical Nanite scene, the **majority of triangles go through the software raster path** because high-LOD Nanite geometry produces enormous quantities of tiny triangles at normal viewing distances. This is by design. If you see heavy `NaniteSoftwareRaster` cost in Unreal Insights, it means Nanite is doing exactly what it's meant to do — it's not a problem unless the sheer cluster count is excessive.

---

## The Visibility Buffer Format

The output of this stage is not a G-buffer or a color texture. It is a **64-bit packed integer per pixel** containing:
- A **Visibility ID** — encodes the primitive ID and triangle ID that won the depth test for that pixel
- **Depth** — the depth value for that pixel

This is the entire output of rasterization. No normals, no albedo, no material data — just "which triangle is here." All material evaluation is deferred entirely to the Nanite BasePass, which reads the Visibility Buffer and evaluates only the materials for pixels that passed visibility.

> [!NOTE]
> This deferred shading architecture is why material count matters more than triangle count for Nanite shading cost. Many triangles sharing one material is cheap. Few triangles using many unique materials is expensive — each unique material in the Visibility Buffer requires a separate shading dispatch in the BasePass.

---

## Threading / Execution Model

This is fundamentally different from every previous pass in the pipeline.

| Stage | Who Drives It |
|-------|--------------|
| Previous passes (PrePass, Velocity, etc.) | CPU render thread builds command lists; GPU executes |
| **Nanite Visibility Buffer** | CPU sets up scene data once; **GPU drives the entire culling, LOD, and raster pipeline autonomously** |

There are no per-object CPU draw calls. The GPU reads instance data, runs culling compute shaders, dispatches its own rasterization work, and writes results — all without returning to the CPU between objects. This is what "GPU-driven rendering" means in practice.

> [!NOTE]
> Because Nanite is GPU-driven, its cost does **not** appear as CPU render thread work in Unreal Insights the way traditional passes do. Look for Nanite cost in the **GPU track** exclusively. High Nanite cost is a GPU problem, not a CPU problem — and the fixes are entirely different from CPU-bound passes.

---

## What Data It Produces

**Visibility Buffer (64-bit packed per pixel):**
- Visibility ID (primitive ID + triangle ID)
- Depth value

**Additional Outputs:**
- Per-pixel material ID (derived from Visibility ID — identifies which material to shade)
- Primitive and cluster IDs for downstream passes
- Depth contribution to Scene Depth buffer

**Consumed downstream by:**

| Pass | How It Uses Nanite Output |
|------|--------------------------|
| Nanite BasePass | Reads Visibility Buffer to evaluate materials only for visible pixels |
| Deferred Lighting | Uses depth and material IDs from Nanite for lighting |
| Virtual Shadow Maps | Separate Nanite VSM pass renders Nanite geometry into shadow maps |
| Lumen | Nanite surface data feeds Lumen's surface cache |
| Reflections | Depth and material data used for screen-space and Lumen reflections |

---

## Geometry Included

| Geometry Type | Included | Notes |
|--------------|----------|-------|
| Nanite static meshes | ✅ Yes | Primary target; full hardware + software raster |
| Nanite foliage | ✅ Yes | UE5.1+ — enables high-density foliage at scale |
| Nanite skeletal meshes | ✅ UE5.4+ | Supported in UE5.4; no longer experimental |
| Non-Nanite meshes | ❌ No | Rendered via traditional BasePass raster |
| Translucent | ❌ No | Translucency has no Nanite path |
| Masked Nanite | ⚠️ Yes, expensive | Uses programmable raster — significantly slower than opaque |

> [!WARNING]
> **Masked materials on Nanite geometry use the programmable (software) raster path even for large triangles.** Unlike opaque Nanite which uses fast hardware raster for large triangles, masked materials cannot use hardware raster due to the `clip()` discard requirement. All masked Nanite geometry pays software raster cost regardless of triangle size. Use masked Nanite materials intentionally and sparingly.

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large on-screen coverage with dense clusters | High raster cost scales with visible cluster count | Improve scene occlusion; add foreground occluders |
| Many unique materials across Nanite geometry | Each unique material = separate shading dispatch in BasePass | Share materials across Nanite assets; reduce material slot count |
| Poor HZB occlusion | More clusters survive culling; raster and shading cost increases | Ensure PrePass quality; add natural occluders in level design |
| WPO on Nanite meshes | Forces programmable raster for all triangles on that mesh | Avoid WPO on Nanite geometry; use separate non-Nanite hero meshes for WPO |
| Masked materials on Nanite | Forces programmable raster regardless of triangle size | Limit masked Nanite; consider opaque with alpha-based techniques |
| Large flat surfaces (floors, walls) | Few clusters culled; full raster cost on simple geometry | Nanite is most efficient on complex occluded geometry; flat surfaces may not benefit much |
| Non-Nanite heavy static meshes | Falls back to CPU draw call path; loses all Nanite efficiency | Enable Nanite on large static props, rocks, buildings, cliffs |

> [!WARNING]
> **WPO on Nanite forces the programmable (software) raster path for the entire mesh — this is not a minor efficiency loss.** Software raster is a compute shader fallback significantly slower than hardware raster for large triangles. A large Nanite building with WPO material will rasterize every visible triangle through the slow path. This is the same hard cutoff described in PrePass and VelocityParallel — WPO is incompatible with Nanite's fast paths.

> [!WARNING]
> **Large flat surfaces are a poor fit for Nanite.** Nanite's efficiency comes from culling enormous numbers of clusters on complex occluded geometry. A flat floor or wall produces very few clusters, almost none of which get culled, and the software raster overhead for sub-pixel triangles at distance still applies. Consider whether large simple surfaces genuinely benefit from Nanite or whether a traditional low-poly mesh with a tiling material is more appropriate.

---

## Key Systems and Components

### Nanite Cluster
The fundamental culling and LOD unit — a fixed group of 128 triangles. Every Nanite mesh is decomposed into a hierarchy of clusters at different LOD levels. Culling and LOD selection operate at the cluster level, not the mesh level. This is what enables per-pixel LOD — different regions of the same mesh can use different cluster LOD levels simultaneously.

### Screen-Space Error Metric
Nanite selects which LOD cluster to use based on **projected geometric error** — the maximum world-space deviation between the simplified cluster and the original geometry, projected into screen space. If the error is below a threshold (a fraction of a pixel), the simplified cluster is used. This is fundamentally different from traditional LOD which uses mesh-level screen size thresholds. The result is continuous, per-cluster LOD with no discrete pop.

### Hardware vs Software Rasterizer
Two parallel raster paths that handle different triangle sizes. Hardware raster handles large triangles via the GPU's fixed-function pipeline. Software raster handles small triangles via a compute shader. Both write to the same Visibility Buffer. The software rasterizer is what makes Nanite viable for cinema-quality meshes at game distances — without it, the GPU hardware rasterizer becomes catastrophically inefficient at sub-pixel triangle densities.

### HZB Feedback Loop
Nanite culling uses the HZB built from the previous frame's PrePass depth. This creates a feedback relationship: better PrePass coverage → better HZB → more Nanite clusters culled → cheaper Nanite pass. Scenes with poor PrePass depth coverage (many WPO meshes, disabled PrePass) will have worse Nanite culling efficiency as a downstream consequence.

### Virtual Shadow Maps (VSM) — Separate Pass
Nanite geometry also rasterizes into Virtual Shadow Maps, but this is a **separate and distinct pass** from the main Visibility Buffer stage. VSM Nanite rendering can be a significant additional GPU cost that does not appear in `NaniteVisibility` timings. Always check VSM Nanite cost separately when profiling.

---

## 📋 Reader Notes

> [!NOTE]
> **Nanite does not solve material cost.** The Visibility Buffer decouples geometry from shading, but shading still runs for every unique material present in the visible buffer. A scene with 50 unique Nanite materials pays 50 separate shading dispatches per frame regardless of triangle count. Reducing material variety on Nanite assets is the primary shading optimization, not reducing polygon count.

> [!NOTE]
> **Nanite and traditional meshes coexist in every frame.** Non-Nanite geometry (skeletal meshes, translucency, WPO fallbacks, low-poly meshes) still goes through the traditional raster path in parallel. A real scene always has both paths running simultaneously — profile them separately.

> [!NOTE]
> **`r.Nanite.MaxPixelsPerEdge` controls the screen-space error threshold.** Lowering this value forces Nanite to use higher-detail clusters at a given distance (more triangles, more cost). Raising it allows more aggressive simplification (fewer triangles, potential quality loss on close surfaces). This is the primary quality/performance trade-off lever for Nanite LOD.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track** (Nanite has minimal render thread footprint — look at GPU exclusively):

| Event | What It Tells You |
|-------|------------------|
| `NaniteCull` | GPU culling pass cost — instance + cluster culling time |
| `NaniteRaster` | Combined hardware + software raster cost |
| `NaniteHardwareRaster` | Cost of large-triangle hardware raster path |
| `NaniteSoftwareRaster` | Cost of small-triangle compute shader raster path |
| `NaniteEmitTargets` | Writing final visibility results to output buffers |

> [!TIP]
> If `NaniteSoftwareRaster` dominates over `NaniteHardwareRaster`, this is expected and normal — most Nanite triangles at gameplay distances are sub-pixel. If `NaniteCull` is expensive relative to `NaniteRaster`, your scene has excessive cluster count surviving culling — improve occlusion or reduce scene density. If total Nanite GPU time is high but `stat nanite` shows low cluster counts, suspect masked or WPO materials forcing the slow raster path.

### Debug Commands

```
stat nanite              // Cluster counts, triangle counts, hardware vs software raster split
                         // Key stats: clusters drawn, triangles rasterized, visible instances

r.Nanite.Visualize <mode>  // In-viewport visualization modes:
                           //   overdraw    — cluster overdraw heatmap
                           //   cluster     — cluster boundaries
                           //   material    — material ID per pixel
                           //   lod         — LOD level per cluster (color = LOD)
                           //   triangles   — triangle density
```

### Stat Commands

```
stat nanite   // Primary Nanite stats — cluster counts, raster split, draw counts
stat GPU      // Overall GPU frame breakdown — Nanite will appear as a block here
```

### Useful Console Variables

```
r.Nanite.MaxPixelsPerEdge [default 1.0]   // Screen-space error threshold — lower = higher detail, more cost
r.Nanite.AllowMasked 0/1                  // Toggle masked Nanite support to isolate its cost
r.Nanite.AllowWPO 0/1                     // Toggle WPO Nanite support to isolate its cost
r.Nanite.Culling 0/1                      // Disable culling for debugging — never ship with 0
```

---

## Optimization Levers

### Content
- Enable Nanite on all large static meshes — rocks, buildings, cliffs, large props
- Keep material slot count low on Nanite assets — each slot is a potential unique material dispatch in the BasePass
- Avoid WPO on Nanite meshes; use separate non-Nanite hero versions for animated surfaces
- Avoid masked materials on Nanite geometry unless the visual requirement is unavoidable

### Level Design
- Ensure natural occlusion exists in dense scenes — indoor environments and urban canyons occlude efficiently; open flat terrains do not
- Avoid camera positions that reveal the entire scene simultaneously with no foreground occluders
- Consider whether large simple surfaces (floors, flat walls) need Nanite at all

### Rendering Settings
- Tune `r.Nanite.MaxPixelsPerEdge` per platform — console targets may tolerate a higher value than PC
- Profile VSM Nanite cost separately from main Visibility Buffer cost — they are independent optimization targets

---

## Mental Model

Think of the Nanite Visibility Buffer as:

> *"The GPU autonomously figures out exactly which triangle covers each pixel — at any scale, any triangle count — before a single material is evaluated."*

The entire efficiency of Nanite rests on one idea: **defer everything until you know exactly what's visible.** Don't evaluate a material until you know its pixel won. Don't rasterize a cluster until you know it's on screen. Don't process a triangle until you know it's large enough to matter.

The key architectural insight is that **Nanite moves the bottleneck from geometry to materials**. Triangle count becomes nearly unlimited. Material count, material complexity, and occlusion quality become the real cost drivers. If you're optimizing Nanite performance, you're optimizing materials and scene layout — not polygon budgets.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| HZB (Hierarchical Z Buffer) | Built from PrePass depth; drives Nanite cluster culling this frame |
| Nanite BasePass | Reads Visibility Buffer; evaluates materials for visible pixels |
| Virtual Shadow Maps | Separate Nanite raster pass for shadow coverage — distinct cost |
| Lumen | Nanite surface data feeds Lumen's surface cache update |
| PrePass | Quality of PrePass depth directly affects Nanite culling efficiency via HZB |
| Software Rasterizer | GPU compute shader handling sub-pixel triangles — core Nanite mechanism |

---

## Red Flags to Watch For

- **`NaniteRaster` > 2ms** on mid-range GPU → check `stat nanite` for hardware vs software raster split; high software raster alone is normal, but check cluster count
- **`NaniteCull` expensive relative to `NaniteRaster`** → too many clusters surviving culling; improve scene occlusion or reduce geometry density
- **Many unique material IDs visible in `r.Nanite.Visualize material`** → high material dispatch count in BasePass; consolidate Nanite materials
- **WPO or masked materials on large Nanite meshes** → forces full software raster path; toggle `r.Nanite.AllowWPO 0` or `r.Nanite.AllowMasked 0` to isolate the cost
- **VSM Nanite cost unexpectedly high** → shadow-casting Nanite geometry is expensive; reduce shadow distance or cull shadow casters aggressively
- **Large flat surfaces (floors, terrain) in Nanite** → minimal culling benefit, full raster cost; evaluate whether traditional meshes are more appropriate
- **`stat nanite` showing high triangle counts but low cluster culling rate** → scene has poor occlusion; camera sees most of the geometry simultaneously

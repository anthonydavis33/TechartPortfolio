---
tags:
  - rendering-pipeline
  - deferred-decals
  - ssao
  - pre-lighting
  - gbuffer
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – LightCompositionTasksPreLighting

> Stage: **LightCompositionTasksPreLighting**  
> Phase: Pre-Lighting GBuffer Finalization  
> Purpose: Apply all GBuffer modifications — deferred decals, ambient occlusion, and subsurface data preparation — before the lighting pass reads the GBuffer  
> Pipeline Position: After `BasePass` and `CopyStencilToLightingChannels`, before deferred lighting evaluation

---

## What This Stage Does

The deferred rendering pipeline reads the GBuffer exactly once during lighting. Every piece of data the lighting pass needs — normals, roughness, base color, AO, subsurface color — must be in its final state before that read begins. **LightCompositionTasksPreLighting is the last opportunity to modify GBuffer contents.**

This stage is a container for several distinct operations that share one requirement: they must complete before lighting runs.

**Primary operations:**

**1. Deferred Decal Rendering (GBuffer Decals)**
Decals that modify GBuffer data — normals, roughness, metallic, base color, ambient occlusion — are rendered here. These are projected onto existing GBuffer data using SceneDepth, not rasterized as world geometry.

**2. Screen Space Ambient Occlusion (SSAO)**
When Lumen is disabled (or Lumen AO specifically is inactive), SSAO is computed and composited into the GBuffer's AO channel here. When Lumen AO is active, this sub-task is skipped.

**3. Subsurface Data Preparation**
Materials using the Subsurface, Subsurface Profile, or Preintegrated Skin shading models store subsurface color and scattering data in GBuffer slots. This pass extracts and prepares that data in the form the lighting pass requires for subsurface evaluation.

---

## Why This Stage Exists

Lighting shaders in the deferred pass read GBuffer data to evaluate surface appearance. If a decal needs to change a surface's normal, or AO needs to darken a crevice, those modifications cannot happen during lighting — the GBuffer would be in an inconsistent state mid-evaluation.

This stage is the explicit synchronization point: **everything the lighting pass needs is finalized here before the lighting pass begins.** Any system that modifies GBuffer data after BasePass is grouped into this stage precisely because it shares that dependency.

The name "composition tasks" reflects that this isn't a single monolithic operation — it's a collection of distinct pre-lighting tasks that are grouped together because they share the same deadline: before lighting reads the GBuffer.

---

## Deferred Decals — How They Actually Work

This is the most technically misunderstood part of this stage. Deferred decals do **not** rasterize their own world-space geometry against the scene. Instead:

1. The decal actor defines a **projection box** (an oriented bounding box in world space)
2. During rendering, the GPU rasterizes the decal's box as a screen-space volume
3. For each pixel the box covers on screen, the GPU reads **SceneDepth** to reconstruct the world position of that pixel
4. It tests whether that world position falls inside the decal projection box
5. If yes, the decal material is evaluated and the result is **blended into the GBuffer**

The decal never touches geometry directly — it projects onto whatever geometry happens to be at that screen position. This is what enables decals to appear on any surface without modifying it.

**GBuffer channels a decal can modify:**

| GBuffer Channel | Decal Blend Mode | Visual Effect |
|----------------|-----------------|---------------|
| Base Color | Translucent | Paint, stains, dirt |
| Normal | Normal | Surface detail, cracks, embossing |
| Roughness + Metallic | Stain | Wet patches, rust, wear |
| AO | (various) | Contact shadows, paint chips |
| Emissive | Emissive (SceneColor) | Glowing marks (applied post-lighting) |

> [!NOTE]
> **Emissive decals are not composited here — they write to SceneColor after lighting.** Only decals with GBuffer blend modes (Translucent, Normal, Stain) modify GBuffer data in this stage. Emissive decals are a separate pass that runs after deferred lighting. If you're debugging a decal that isn't affecting lighting, check whether its blend mode is writing to GBuffer or SceneColor.

---

## DBuffer Decals vs GBuffer Decals — A Critical Distinction

These are two entirely separate decal systems that are often confused.

**DBuffer Decals** (Translucency: `DBuffer Translucent Color/Normal/Roughness`)
- Write into the DBuffer — a set of pre-BasePass render targets
- Applied to surfaces **during BasePass material evaluation** — before lighting
- Correctly affect lightmaps and Lumen surface cache
- Require `r.DBuffer 1`
- More accurate integration with the lighting model

**GBuffer Decals** (Translucency: `Translucent`, `Normal`, `Stain`)
- Rendered in this stage — **after BasePass, before lighting**
- Modify existing GBuffer data in place
- Do not affect baked lightmap contributions or Lumen surface cache — they bypass that data
- Cheaper per decal but less physically accurate

> [!WARNING]
> **GBuffer decals do not affect baked lighting or Lumen's surface cache.** A decal that changes a surface's base color with a GBuffer blend mode will look correct under dynamic lighting, but the baked lightmap contribution for that surface will not change — creating a visible inconsistency in lightmap-lit areas. For decals that need to integrate correctly with baked lighting (large environmental decals, permanent surface detail), use DBuffer decals instead. For dynamic decals that only appear under dynamic lighting (blood splatter, impact marks), GBuffer decals are appropriate.

---

## SSAO — When Lumen Is Disabled

When Lumen is not active, **Screen Space Ambient Occlusion (SSAO)** computes and composites ambient occlusion in this stage. SSAO works by sampling the depth buffer in a hemisphere around each pixel and estimating how much of that hemisphere is occluded by nearby geometry.

SSAO is entirely screen-space — it only knows about geometry visible in the current frame. Geometry off-screen, behind the camera, or outside the view frustum does not contribute to occlusion regardless of how close it physically is.

**SSAO vs GTAO:**
UE5 supports two algorithms selectable via `r.AmbientOcclusion.Method`:
- **SSAO** (0) — standard screen-space AO; faster, lower quality, visible haloing at edges
- **GTAO (Ground Truth AO)** (1) — higher quality with more accurate horizon angle integration; more expensive but better results at screen edges

> [!NOTE]
> **When Lumen is active, this entire SSAO sub-task is skipped.** Lumen AO is computed as part of the screen probe gather in the `DiffuseIndirect & AO` stage and provides more accurate, non-screen-space occlusion. If you see SSAO artifacts (halos, incorrect darkening) in a project with Lumen enabled, something has re-enabled SSAO independently — check `r.AmbientOcclusionLevels` and `r.LumenScene.SurfaceCache` settings.

---

## Subsurface Data Preparation

Materials using SSS shading models — **Subsurface, Subsurface Profile, Preintegrated Skin, Two Sided Foliage** — store scattering data in GBuffer channels alongside the usual material properties. Before the lighting pass can evaluate subsurface scattering correctly, this data must be extracted and converted into the form the SSS lighting evaluation expects.

This includes:
- Separating the subsurface color contribution from base color
- Preparing scattering radius and profile data
- Setting up the separable SSS pass inputs for skin shading

> [!NOTE]
> **Subsurface Profile is the highest-quality and most expensive SSS shading model.** It uses a pre-integrated scattering profile (authored in a dedicated Subsurface Profile asset) for accurate skin and translucent material rendering. Cheaper alternatives — `Subsurface` and `Preintegrated Skin` — are appropriate for secondary characters and background figures. Two Sided Foliage is the cheapest SSS option and is appropriate for leaves and thin plant material where simple back-scattering is sufficient.

---

## Threading Model

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Builds and submits decal draw commands; schedules SSAO and SSS dispatches |
| **Task Graph (Workers)** | Parallel command list build for decal draw calls (if many decals) |
| **GPU** | Rasterizes decal projection volumes; executes SSAO compute; extracts SSS data |

Decal rendering is **fill-rate bound** — the GPU cost scales with the screen-space area each decal's projection box covers, not with decal mesh complexity or decal count directly. SSAO is **compute bound** — scales with screen resolution and sample count.

---

## What Data It Produces

**GBuffer Modifications:**
- Normals updated by Normal blend mode decals
- Base color modified by Translucent blend mode decals
- Roughness / Metallic modified by Stain blend mode decals
- AO channel updated by decals and/or SSAO result

**New Buffers:**
- AO mask texture (SSAO result when Lumen AO inactive)
- Subsurface color / profile data prepared for lighting

**Consumed downstream by:**

| Pass | How It Uses This Stage's Output |
|------|--------------------------------|
| Deferred Lighting | Reads finalized GBuffer — normals, roughness, AO all from this stage's output |
| Subsurface Scattering Pass | Uses prepared SSS data for skin/translucent scattering evaluation |
| Lighting Combine | AO mask modulates ambient and indirect lighting terms |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Decals with large screen coverage | Fill-rate scales with screen area covered by projection box | Tighten decal projection boxes; use `r.Decal.StencilSizeThreshold` to auto-cull small decals |
| Many unique decal materials | Each unique material = separate draw call, possible PSO switch | Share decal master materials with parameters; minimize unique material graphs |
| Complex decal materials | Expensive pixel shader evaluated per covered pixel | Simplify decal material graphs; avoid multi-texture reads in decal shaders |
| SSAO with high sample count | More depth samples per pixel = more memory bandwidth | Reduce `r.AmbientOcclusionLevels`; switch to Lumen AO for better quality at similar cost |
| Many SSS materials on screen | More subsurface data to extract and prepare | Reserve high-quality SSS (Subsurface Profile) for hero characters only |
| High render resolution | All fullscreen operations scale with pixel count | Tune screen percentage per platform |

> [!WARNING]
> **Decals that use normal modification are more expensive than color-only decals.** Normal blend mode decals modify the GBuffer normal, which cascades into lighting — a changed normal alters specular highlights and diffuse shading. The material evaluation for normal decals typically samples at least one additional normal map texture. In a scene with many overlapping normal decals (cracked paint, surface details, impact marks), the fill-rate and texture bandwidth can accumulate significantly. Consider baking complex surface detail into base mesh normals for static surfaces rather than relying on runtime decals.

> [!WARNING]
> **Decals placed on Nanite geometry require correct blend mode configuration.** Nanite geometry writes to GBuffer through the Visibility Buffer path, not traditional rasterization. GBuffer-modifying decals can still apply to Nanite surfaces correctly — they project onto GBuffer data regardless of how the underlying geometry was rendered. However, DBuffer decals on Nanite geometry require the Nanite material to explicitly support DBuffer reads. Verify decal behavior on Nanite surfaces during integration; don't assume parity with non-Nanite geometry.

---

## Key Systems and Components

### Decal Projection Volume
The core mechanism of deferred decal rendering. A decal's placement defines an oriented bounding box. During rendering, the box is rasterized as a screen-space proxy. Each covered pixel reconstructs its world position from SceneDepth and tests against the box. Pixels that pass the inside-test have the decal material evaluated and blended into GBuffer. The decal "sees" the surface from outside it — it has no direct knowledge of the underlying geometry's triangles, only its projected depth.

### Decal Sort Order
GBuffer decals render in a defined sort order (the `Sort Order` property on the Decal actor). Lower sort orders render first; higher sort orders render last and on top. This is how overlapping decals are resolved — a puddle decal (low sort) can be overridden by a blood splatter (high sort) in the same area. Sort order affects rendering cost indirectly — many overlapping decals in the same screen region compound fill-rate cost regardless of sort.

### SSAO Sample Kernel
SSAO operates by sampling depth values in a hemisphere around each pixel, using a randomized sample kernel to estimate occlusion. The sample count (`r.AmbientOcclusionLevels`), sampling radius (`r.AmbientOcclusionRadiusScale`), and blur quality all affect the trade-off between accuracy and performance. The randomized kernel produces noise that is typically removed by a spatial blur pass run immediately after the AO computation.

### Subsurface Profile Asset
The authored profile that drives Subsurface Profile shading. Contains the scattering radius curve, scattering color, and transmission parameters. The profile data is uploaded to the GPU and referenced during the SSS lighting evaluation. A scene with many characters using different Subsurface Profile assets pays per-profile lookup cost during the SSS pass. Sharing profiles between similar characters reduces this overhead.

---

## 📋 Reader Notes

> [!NOTE]
> **This stage's cost is dominated by whatever is largest in your scene — decals, SSAO, or SSS — and rarely all three simultaneously.** In most projects, one of these dominates: heavy outdoor scenes are likely decal-dominated; interior character scenes may be SSS-dominated; scenes without Lumen pay SSAO cost others don't. Profile sub-events within this stage to identify which component needs attention before optimizing.

> [!NOTE]
> **Decal actors are cheap to place but not free to render.** A common misuse pattern is covering large surfaces with many small decals for surface detail variation. Each decal's projection box must be rasterized and tested each frame regardless of whether anything moved. Baking surface variation into lightmaps or textures is better for static detail; decals are best reserved for dynamic, runtime-spawned, or world-state-reflecting content (damage, footprints, environmental storytelling).

> [!NOTE]
> **The decal draw call ordering in Unreal Insights appears as individual sub-events within LightCompositionTasksPreLighting.** Each unique decal material is typically a separate event. If you count the events and they number in the hundreds, you have a batching problem — too many unique decal materials. If individual events are short but there are many, the issue is draw call overhead. If individual events are long, the issue is material complexity or fill-rate.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `LightCompositionTasksPreLighting` | Total stage cost — expand for sub-events |
| `DeferredDecals` or `CompositeDecals` | All GBuffer decal rendering — dominant sub-event in decal-heavy scenes |
| `AmbientOcclusion` | SSAO computation and compositing (absent when Lumen AO active) |
| `SubsurfaceScattering` | SSS data extraction and preparation cost |

> [!TIP]
> Expand `LightCompositionTasksPreLighting` in Unreal Insights and look at sub-event proportions first. If `DeferredDecals` dominates, check decal screen coverage with `viewmode decalmask` and audit decal material complexity. If `AmbientOcclusion` is present and expensive, consider enabling Lumen (which replaces SSAO with higher quality at comparable cost) or reducing `r.AmbientOcclusionLevels`. If `SubsurfaceScattering` is high, too many SSS characters are visible simultaneously.

### Debug Visualizations

```
viewmode decalmask      // Shows which pixels are affected by deferred decals.
                        // Bright areas = decal coverage. Useful to identify unexpectedly
                        // large projection boxes or excessive decal overlap.

viewmode ambientocclusion  // Shows AO contribution in isolation.
                            // Use to assess SSAO quality and identify over-darkening.
                            // Only useful when SSAO is active (Lumen disabled or Lumen AO off).
```

### Stat Commands

```
stat GPU          // Overall GPU breakdown — LightCompositionTasksPreLighting as a block
stat SceneRendering  // Scene-level rendering stats including decal counts
```

### Useful Console Variables

```
// Decal controls
r.Decal.StencilSizeThreshold [0.1]     // Auto-disable decals whose bounding sphere projects
                                        // below this screen-space radius. Increase to cull
                                        // more aggressively. 0 = never cull; 1 = always cull.
r.DBuffer 0/1                          // Toggle DBuffer decal system (separate from GBuffer decals)

// SSAO controls (when Lumen AO inactive)
r.AmbientOcclusion.Method 0/1          // 0 = SSAO, 1 = GTAO (higher quality, higher cost)
r.AmbientOcclusionLevels [2]           // Sample quality (0-3). 0 = disabled, 3 = highest quality
r.AmbientOcclusionRadiusScale [1.0]    // AO sampling radius — larger = more global occlusion,
                                        // smaller = tighter contact shadows only
r.AmbientOcclusionStaticFraction [1.0] // How much AO affects statically-lit areas

// SSS controls
r.SubsurfaceScattering 0/1             // Toggle SSS rendering entirely
r.SSS.Quality [1]                      // Subsurface Profile scattering quality (0=low, 1=high)
```

---

## Optimization Levers

### Decals (Most Variable Cost)
- Tighten decal projection boxes — oversized boxes are the most common cause of excessive decal fill-rate; a decal's projection box should closely bound the visible decal area
- Increase `r.Decal.StencilSizeThreshold` to automatically disable distant decals below a screen-size threshold
- Share decal master materials with scalar/vector parameters for color and roughness variation — avoid unique material graphs per decal
- Simplify decal material graphs — a decal that samples two textures is twice the bandwidth of a one-texture decal for the same screen coverage

> [!WARNING]
> **Decals spawned at runtime (impact marks, footprints, blood) that are never cleaned up accumulate indefinitely.** Each spawned decal actor persists in the scene graph until explicitly destroyed or until its lifetime expires. A game that spawns impact decals throughout a session without cleanup can end up with hundreds of decal actors in the scene, all rasterizing their projection boxes every frame. Implement decal pooling with lifetime limits and a maximum simultaneous active count.

### SSAO
- Enable Lumen — Lumen AO is more accurate than SSAO and replaces it entirely at comparable GPU cost on capable hardware
- If Lumen is not an option, reduce `r.AmbientOcclusionLevels` to 1 for lower-end targets — the quality difference vs level 2 is subtle in motion
- Reduce `r.AmbientOcclusionRadiusScale` to focus AO on contact shadows rather than large-radius environmental occlusion

### Subsurface Scattering
- Reserve `Subsurface Profile` for hero characters only — it is the most expensive SSS shading model
- Use `Preintegrated Skin` for secondary characters — similar appearance at lower cost
- Use `Two Sided Foliage` for all vegetation requiring light transmission — it is the cheapest SSS option
- Limit the number of unique Subsurface Profile assets — each profile adds a distinct evaluation path in the SSS pass

---

## Mental Model

Think of LightCompositionTasksPreLighting as:

> *"The final edit pass on the GBuffer — apply decals, compute occlusion, and prepare scattering data — so that when the lighting pass reads the scene, everything is exactly where it needs to be."*

The deferred renderer's GBuffer is like a shared document that many systems write to (BasePass, this stage) and one system reads from (lighting). This stage is the last writer. Its job is to make sure the document is complete and correct before the reader starts — because once the lighting pass begins, no further edits are possible.

The key insight is that **this stage exists because of the deferred architecture's fundamental design**. Forward rendering evaluates everything per-fragment at once; deferred rendering separates the write phase (GBuffer population) from the read phase (lighting). LightCompositionTasksPreLighting is the bridge between those two phases — it handles every task that doesn't fit cleanly into either BasePass (geometry) or deferred lighting (illumination).

---

## Related Systems

| System | Relationship |
|--------|-------------|
| BasePass | Writes initial GBuffer data that decals modify here |
| DBuffer Decals | Separate system — applies before BasePass, not here; compare to understand when to use each |
| SSAO | Computed and composited here when Lumen AO inactive |
| Lumen DiffuseIndirect & AO | Replaces SSAO with superior screen-space + world-space AO |
| Deferred Lighting | Primary consumer of all GBuffer data finalized in this stage |
| Subsurface Scattering Pass | Downstream consumer of SSS data prepared here |
| SceneDepth | Read by decal projection to determine world position per pixel |

---

## Red Flags to Watch For

- **`LightCompositionTasksPreLighting` > 1ms** → expand sub-events; identify whether decals, SSAO, or SSS is the bottleneck before applying any fix
- **`DeferredDecals` dominant with many short sub-events** → too many unique decal materials breaking batching; consolidate to shared master materials
- **`DeferredDecals` dominant with few but long sub-events** → decals with large screen coverage or complex materials; tighten projection boxes and simplify decal graphs
- **Runtime-spawned decals accumulating over session length** → no lifetime or pool limit on impact/dynamic decals; implement decal pooling with a max count
- **`AmbientOcclusion` present despite Lumen being enabled** → SSAO re-enabled independently; check `r.AmbientOcclusionLevels` — set to 0 to disable SSAO fully under Lumen
- **GBuffer decal not affecting lighting correctly** → check blend mode; if Emissive blend mode, the decal writes to SceneColor post-lighting and is not in this stage
- **Decal on Nanite surface showing incorrect or missing result** → verify decal blend mode compatibility with Nanite GBuffer path; test on non-Nanite geometry to isolate
- **SSS characters causing high subsurface cost** → too many Subsurface Profile characters visible simultaneously; reduce profile quality tier for background characters

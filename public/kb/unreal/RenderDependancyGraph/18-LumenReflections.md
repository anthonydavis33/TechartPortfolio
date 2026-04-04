---
tags:
  - reflections
  - specular
---

# Unreal Engine 5 Rendering Pipeline – Lumen Reflections

> Stage: **Lumen Reflections** *(appears as DiffuseIndirect & AO container sub-pass in some engine versions)*  
> Phase: Global Illumination — Specular / Reflection  
> Purpose: Compute view-dependent specular reflections for all reflective surfaces using Lumen's surface cache and radiance cache, composited with SSR for screen-space accuracy  
> Pipeline Position: After `DiffuseIndirect & AO`, before final lighting combine

---

## What This Stage Does

Lumen Reflections computes **view-dependent specular reflections** — the mirror-like highlights and glossy surface appearances that change as the camera angle changes. This is the specular counterpart to `DiffuseIndirect & AO`, which handles omnidirectional bounced light.

Where diffuse GI samples a full hemisphere of incoming radiance and averages it (view-independent), reflections trace rays along a **constrained reflection vector** derived from the surface normal and camera direction. The result is a view-dependent radiance sample — the same surface looks different as the camera moves, because the reflection vector changes.

This stage:
- Reads GBuffer normals and roughness to determine reflection vectors and cone widths per pixel
- Filters pixels by roughness — surfaces above a roughness threshold skip reflection tracing entirely
- Traces reflection rays against the Lumen surface cache, screen-space data, and radiance cache
- Composites with SSR (Screen Space Reflections) — SSR provides a high-quality screen-space layer; Lumen fills in where SSR misses
- Temporally accumulates and denoises the result

---

## The Roughness Threshold — What Gets Traced

Not every surface participates in Lumen reflection tracing. Roughness determines both whether a surface traces and how wide its reflection cone is.

| Roughness | Behavior |
|-----------|----------|
| 0.0 (mirror) | Tight single-ray trace — highest quality, most expensive per pixel |
| 0.0–0.4 | Cone-traced reflection — ray count and spread scale with roughness |
| ~0.4–0.6 | Transition zone — increasingly blurry, temporal accumulation dominant |
| Above threshold | No reflection trace — diffuse GI handles the blurry approximation |

The cutoff is controlled by `r.Lumen.Reflections.MaxRoughnessToTrace`. Above this value, Lumen stops tracing reflection rays for that pixel. The diffuse GI contribution at those pixels provides enough of an approximation for surfaces that are rough enough that reflection directionality is imperceptible.

> [!NOTE]
> **Lowering `r.Lumen.Reflections.MaxRoughnessToTrace` is one of the most effective ways to reduce Lumen Reflections cost.** Reducing from 0.6 to 0.4 eliminates reflection tracing for all semi-rough surfaces (rough concrete, worn metal, dry stone) while keeping sharp reflections on polished and smooth surfaces where the directionality matters visually. Profile the roughness distribution in your scene before choosing a cutoff.

---

## SSR and Lumen Reflections — How They Composite

SSR (Screen Space Reflections) and Lumen Reflections are not alternatives — they work **in layers** in the same frame:

**SSR** traces rays through the HZB in screen space. It is fast, accurate for on-screen geometry, and produces high-quality reflections for nearby surfaces visible in the current frame.

**Lumen Reflections** handles everything SSR cannot:
- Geometry off-screen or behind the camera
- Geometry occluded from the reflection ray's perspective
- Distant reflected content beyond SSR's trace distance

The composite rule is:
1. If SSR finds a hit → use the SSR result (high quality, screen-accurate)
2. If SSR misses (off-screen, occluded, too distant) → fall back to the Lumen result

> [!NOTE]
> **SSR quality directly affects how much Lumen Reflections work is visible.** High SSR quality settings handle more reflections in screen space, leaving only off-screen content for Lumen to resolve. Low SSR quality settings cause SSR to miss more hits and fall back to Lumen more frequently — increasing Lumen Reflections' contribution (and its quality requirements) while reducing SSR cost. Tune both together rather than independently.

---

## Software vs Hardware Lumen Reflections

Like diffuse GI, Lumen Reflections supports both a software SDF path and a hardware RT path — and they can be **configured independently**.

### Software Path (`r.Lumen.Reflections.HardwareRayTracing 0`)
- Uses SDF scene representation for ray traversal
- Surface cache consulted at ray endpoints for lighting
- SDF approximation errors visible on mirror or near-mirror surfaces (reflected geometry slightly displaced, thin features missed, gaps in complex meshes)
- Suitable for rough-to-semi-rough surfaces where approximation error is imperceptible

### Hardware RT Path (`r.Lumen.Reflections.HardwareRayTracing 1`)
- Uses RT cores for triangle-accurate ray intersection
- Eliminates SDF approximation error — reflections show correct geometry at all roughness levels
- Significantly more expensive, especially on surfaces with large reflection screen coverage
- The quality difference is most visible and most justified on smooth surfaces — polished floors, glass, mirrors, wet surfaces

> [!WARNING]
> **Hardware RT for reflections is independently configurable from hardware RT for diffuse GI.** You can enable hardware RT only for reflections (`r.Lumen.Reflections.HardwareRayTracing 1`) while keeping diffuse on software (`r.Lumen.HardwareRayTracing 0`). This is a valid production configuration — reflections benefit from hardware RT far more visibly than diffuse GI, so the quality/cost trade-off often favors enabling it for reflections only. Profile this configuration in your specific scene before committing to full hardware RT on both.

---

## Temporal Stability — Why Reflections Are Harder Than Diffuse

Diffuse GI is view-independent — the same surface receives similar indirect light regardless of camera angle, making temporal accumulation highly stable. Reflections are fundamentally view-dependent — the reflection vector changes every time the camera moves, which means previously accumulated history is frequently invalid.

**Consequences:**
- More temporal noise during camera movement than diffuse GI
- Faster history invalidation on reflective surfaces as the camera rotates
- Shimmer and instability on smooth surfaces during movement is expected to some degree
- The denoiser works harder and produces lower quality during fast camera motion

> [!WARNING]
> **Temporal instability on reflections during camera movement is expected behavior, not a bug.** The history buffer accumulated while the camera was static becomes partially invalid with every camera move. The denoiser blends old and new samples; on fast-moving cameras, new samples dominate and per-frame noise increases. Reducing `r.Lumen.Reflections.MaxRoughnessToTrace` (fewer surfaces traced) and increasing SSR quality (more screen-space coverage) both reduce the area where temporal instability is visible.

---

## Why This Stage Exists as Separate from Diffuse GI

Diffuse and specular indirect lighting have different ray strategies, different roughness dependencies, different temporal characteristics, and different quality/cost trade-offs. Keeping them separate allows:
- Independent quality control — hardware RT for reflections, software for diffuse
- Independent roughness culling — only trace reflections where directionality matters
- Separate denoising passes tuned for specular vs diffuse noise characteristics
- SSR compositing layer that only applies to specular, not diffuse

Combining them would force every quality decision to apply to both simultaneously, removing most of the optimization flexibility the system provides.

---

## What Data It Produces

| Output | Format | Consumers |
|--------|--------|-----------|
| Specular reflection radiance buffer | RGB16F | Final lighting combine |
| SSR hit mask | R8 | Compositing — marks which pixels used SSR vs Lumen |

**Consumed downstream by:**
- **Final Lighting Combine** — specular reflection radiance added to the direct specular term
- **Translucency Lighting** — reflections on translucent surfaces can receive Lumen reflection data

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large screen coverage of low-roughness surfaces | More pixels traced; mirror surfaces pay maximum per-pixel ray cost | Limit large reflective floor/water surfaces; ensure `MaxRoughnessToTrace` is calibrated |
| Hardware RT enabled | Triangle-accurate traces significantly more expensive than SDF | Enable only where quality difference is justified; profile software vs hardware in scene |
| Low `MaxRoughnessToTrace` threshold | More surface roughness range participates in tracing | Raise threshold — rough surfaces don't need directional reflection tracing |
| Fast camera movement | Temporal history invalidated; more fresh traces needed per frame | Unavoidable; reduce traced roughness range to limit affected pixel count |
| Complex reflected scene geometry | Ray endpoints hit dense geometry requiring many surface cache lookups | Simplify geometry visible in reflections; reduce surface cache update frequency |
| High SSR miss rate | SSR missing frequently forces Lumen to handle more reflection pixels | Increase `r.SSR.Quality` to reduce miss rate in screen space |
| Many unique reflective materials | Each unique roughness + normal combination traces differently | Not directly controllable; manifests as varied trace cost across the screen |

> [!WARNING]
> **Large, low-roughness surfaces (polished marble floors, glass facades, mirror walls) are the worst-case Lumen Reflections scenario.** A shiny floor that fills the lower half of the screen traces reflection rays for every one of those pixels every frame. If the reflected content is also complex (a large interior scene), the surface cache lookup at each ray endpoint adds further cost. Consider whether full-resolution Lumen reflection tracing is necessary for every large reflective surface — `r.Lumen.Reflections.DownsampleFactor` can reduce trace resolution for scenes where close inspection of reflections is unlikely.

---

## Key Systems and Components

### Reflection Vector Computation
Before any tracing, the GBuffer normal is read per pixel and combined with the camera direction to compute the reflection vector. Roughness widens this into a cone. Pixels above `MaxRoughnessToTrace` are masked out and skipped entirely. The remaining pixels are the working set for this frame's reflection traces.

### Surface Cache Lookups at Ray Endpoints
Reflection rays hit surfaces represented by Lumen's mesh cards (same surface cache as diffuse GI). The lighting stored in those cards at the time of the hit is the radiance returned to the reflecting surface. This is why the surface cache update frequency and quality affects reflection accuracy — a surface cache that's one or two frames stale produces slightly incorrect reflected lighting, most visible as reflected lights that lag slightly behind their actual positions.

### Radiance Cache for Off-Screen Reflections
When a reflection ray travels off-screen or too far for SSR to handle, the Lumen radiance cache provides a world-space radiance estimate at the ray's endpoint. The radiance cache is coarser than a direct surface cache hit — it's a spatial interpolation of previously gathered world radiance. This is why off-screen reflections in Lumen are correct in direction and general color but may lack fine detail visible in SSR on-screen reflections.

### SSR Compositing Layer
SSR runs its own screen-space ray march against the HZB and produces a hit mask alongside its radiance result. This mask tells the Lumen compositing step which pixels were successfully resolved in screen space (use SSR) vs which need Lumen (miss). The compositing is a blended transition — near the SSR trace distance limit, the blend shifts gradually from SSR to Lumen to avoid a hard seam.

### Temporal Accumulation and Denoising
Specular reflection denoising uses a separate filter from diffuse — specular noise has different spatial and temporal characteristics (sharper, more directional, faster to change with camera movement). The denoiser for reflections is tuned to preserve sharp reflected highlights while suppressing sampling noise. On smooth surfaces, this can produce a slightly soft or laggy appearance in reflections during camera motion — the denoiser protecting temporal stability at the cost of some instantaneous sharpness.

---

## 📋 Reader Notes

> [!NOTE]
> **Lumen Reflections does not replace Planar Reflections or Screen Space Reflections — it works alongside them.** Planar Reflections (a separate actor-based system) provide the highest possible reflection quality for a single plane but at very high cost. SSR provides fast screen-space accuracy for on-screen geometry. Lumen provides world-space coverage for everything else. Choosing which combination to use depends on scene type: interiors with complex geometry benefit most from Lumen; simple water surfaces may prefer SSR-only; hero reflective surfaces (a key story mirror, a character's visor) may justify Planar Reflections.

> [!NOTE]
> **Reflection quality on Nanite geometry follows the same hardware/software distinction as diffuse GI.** Software Lumen uses SDF representations of Nanite meshes — the SDF is generated from the mesh's bounding representation, not from individual Nanite clusters. Hardware RT uses the actual Nanite geometry for triangle-accurate reflection hits. The quality difference is most visible when reflecting a Nanite mesh with fine surface detail (ornate stonework, complex machinery) at close range on a smooth surface.

> [!NOTE]
> **`r.Lumen.Reflections.Allow 0` disables Lumen Reflections entirely without disabling Lumen diffuse GI.** When disabled, surfaces fall back to SSR for on-screen reflections and the sky reflection capture for off-screen. This is a valid lower-end configuration for platforms where reflection tracing cost is prohibitive. Verify visual quality carefully in reflection-critical areas before shipping with this disabled.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `LumenReflections` | Total Lumen reflection tracing and compositing cost |
| `LumenReflectionTracing` | Ray trace dispatches — hardware or software path |
| `LumenReflectionDenoising` | Temporal accumulation and spatial denoising cost |
| `ScreenSpaceReflections` | SSR trace cost — runs before Lumen compositing |
| `LumenReflectionComposite` | SSR + Lumen compositing step |

> [!TIP]
> Compare `ScreenSpaceReflections` vs `LumenReflectionTracing` to understand the balance between the two systems. If `LumenReflectionTracing` is dominant, SSR is missing frequently — increase `r.SSR.Quality` to push more resolution into screen space. If `LumenReflectionDenoising` is dominant relative to tracing, the denoiser is working hard due to high noise — improve trace quality (lower `r.Lumen.Reflections.DownsampleFactor`) rather than tuning the denoiser. If the total stage cost is high but the scene has few obviously reflective surfaces, check `r.Lumen.Reflections.MaxRoughnessToTrace` — it may be set too high, tracing reflections on surfaces that don't visibly benefit.

### Debug Visualizations

```
r.Lumen.Visualize.Mode 2            // Lumen reflections only — shows specular GI contribution
                                     // in isolation without direct lighting or diffuse GI.
                                     // Use to assess reflection quality and identify missing content.

r.SSR.Quality 0                     // Disable SSR temporarily to see Lumen-only reflections —
                                     // reveals which content Lumen is providing vs screen space.

viewmode reflectionoverride         // Forces all surfaces to mirror roughness (0.0).
                                     // Reveals the full reflection content available in the scene
                                     // and identifies areas where Lumen has missing or incorrect data.
```

### Stat Commands

```
stat GPU     // Overall GPU breakdown — LumenReflections appears as a block
stat Lumen   // Lumen-specific counters including reflection trace counts and cache hit rates
```

### Useful Console Variables

```
// Core reflection toggles
r.Lumen.Reflections.Allow 0/1                    // Master toggle for Lumen reflections
r.Lumen.Reflections.HardwareRayTracing 0/1       // Software SDF (0) vs hardware RT (1) for reflections
                                                  // Independent from r.Lumen.HardwareRayTracing

// Quality / performance levers
r.Lumen.Reflections.MaxRoughnessToTrace [0.4]    // Roughness cutoff — surfaces above skip tracing
                                                  // Raise to reduce traced pixel count significantly
r.Lumen.Reflections.DownsampleFactor [1]         // Trace at reduced resolution — 2 = half res traces
                                                  // Reduces cost at expense of reflection sharpness
r.Lumen.Reflections.ScreenSpaceReconstruction 1  // Upscale from downsampled traces — keep enabled

// SSR interaction
r.SSR.Quality [4]                                // SSR quality — higher = fewer Lumen fallback pixels
r.SSR.MaxRoughness [0.4]                         // Roughness limit for SSR — above this, Lumen only
```

---

## Optimization Levers

### Roughness Threshold (Highest Impact)
- Calibrate `r.Lumen.Reflections.MaxRoughnessToTrace` to your scene's visual requirements — this single lever controls the size of the traced pixel set
- Audit your material roughness values; if most reflective surfaces are above 0.4, the default threshold may be tracing reflections that contribute very little perceptible directionality

### Hardware RT Configuration
- Enable hardware RT only for reflections (`r.Lumen.Reflections.HardwareRayTracing 1`) while keeping diffuse on software — often the best quality/cost ratio for mid-tier hardware
- Disable hardware RT on platforms where the cost increase isn't justified — software Lumen reflections with good SSR coverage are acceptable for most roughness levels above 0.1

### Trace Resolution
- Use `r.Lumen.Reflections.DownsampleFactor 2` on lower-end targets — half-resolution tracing with reconstruction is acceptable for all but the sharpest mirror surfaces
- Combine with `r.Lumen.Reflections.ScreenSpaceReconstruction 1` to upscale cleanly

> [!WARNING]
> **Avoid placing large low-roughness surfaces (metallic floors, still water, polished marble) in areas where the camera will always be close and looking directly at them.** These are the maximum-cost scenario for reflection tracing — large screen coverage, low roughness, complex reflected content. If such surfaces are a design requirement, offset the cost with aggressive `DownsampleFactor`, strong SSR coverage, and reduced surface cache complexity in the reflected scene geometry.

### SSR Configuration
- Keep SSR quality high enough to handle the majority of on-screen reflection content — this reduces Lumen's per-frame trace burden in screen-space-rich scenes
- Tune `r.SSR.MaxRoughness` to align with `r.Lumen.Reflections.MaxRoughnessToTrace` — the two systems should share a roughness handoff point rather than overlapping or creating a gap

---

## Mental Model

Think of Lumen Reflections as:

> *"For every pixel that's shiny enough to show directional reflections, trace where the camera would see if it were the surface — and look up what's there in the scene's accumulated lighting knowledge."*

The efficiency comes from the same source as diffuse GI: the surface cache and radiance cache hold pre-accumulated lighting that reflection rays can query without re-evaluating the full scene. The challenge unique to reflections is that they're view-dependent — the cache answers change as the camera moves — making temporal accumulation less stable than it is for diffuse.

The key insight is the **roughness-based participation threshold**. Not all surfaces need directional reflections — rough surfaces scatter incoming light so broadly that directionality doesn't matter. The threshold is the mechanism that focuses expensive reflection tracing only on the surfaces where it produces a visible, meaningful result. Getting the threshold right for your scene is the most impactful single optimization decision for this pass.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| DiffuseIndirect & AO (doc 14) | Diffuse counterpart — shares surface cache, radiance cache infrastructure |
| Screen Space Reflections (SSR) | Layers on top of Lumen reflections; handles on-screen geometry hits |
| Lumen Surface Cache | Primary radiance source at reflection ray endpoints |
| Lumen Radiance Cache | Off-screen radiance source for distant or occluded reflection hits |
| HZB | SSR uses HZB for screen-space ray marching |
| GBuffer (Normal, Roughness) | Read to compute reflection vectors and determine roughness threshold participation |
| Final Lighting Combine | Composites Lumen reflection radiance with direct specular term |

---

## Red Flags to Watch For

- **`LumenReflections` > 2ms** → check `r.Lumen.Reflections.MaxRoughnessToTrace`; may be tracing too many rough surfaces; also check for large low-roughness geometry filling the screen
- **`LumenReflectionDenoising` > `LumenReflectionTracing`** → denoiser working harder than tracing; increase trace quality (`DownsampleFactor 1`) rather than tuning denoiser settings
- **Reflection shimmer or instability during camera movement** → expected behavior; reduce traced roughness range to limit affected pixel area; ensure temporal accumulation CVars aren't accidentally disabled
- **Reflections missing off-screen content** → Lumen radiance cache coverage may be insufficient for the scene extent; check radiance cache quality settings in DiffuseIndirect (doc 14)
- **Mirror or near-mirror surfaces showing incorrect reflected geometry** → software Lumen SDF approximation error; consider enabling `r.Lumen.Reflections.HardwareRayTracing 1` for affected surface types
- **Large metallic or polished floor dominating reflection cost** → worst-case fill scenario; apply `r.Lumen.Reflections.DownsampleFactor 2` and verify SSR is handling nearby reflected content
- **SSR and Lumen reflections showing a visible seam at the handoff boundary** → `r.SSR.MaxRoughness` and `r.Lumen.Reflections.MaxRoughnessToTrace` misaligned; ensure they share a coherent transition point

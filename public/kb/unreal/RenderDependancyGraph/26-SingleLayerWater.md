---
tags:
  - rendering-pipeline
  - water
  - forward-shading
  - refraction
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – Single Layer Water

> Stage: **Single Layer Water (Shading Pass)**  
> Phase: Forward Shading / Water Surface Rendering  
> Purpose: Evaluate the full Single Layer Water material — computing refraction, underwater extinction, surface reflections, direct lighting, and wave detail — and composite the result into SceneColor  
> Pipeline Position: After `BasePass`, `SingleLayerWaterDepthPrepass`, and shadow passes; before translucency

---

## Relationship to the Depth Prepass (Doc 13)

This is the second of two SLW passes per frame. The first — `SingleLayerWaterDepthPrepass` (doc 13) — wrote water surface depth into a dedicated buffer. This pass consumes that depth data to perform the actual water shading and compositing.

**Doc 13 answered:** Where is the water surface in depth?  
**This pass answers:** What does the water look like, and how does it interact with everything beneath it?

The two passes must be understood together — the depth prepass exists entirely to enable the per-pixel calculations performed here. Profiling or debugging them separately without understanding their relationship leads to incomplete conclusions about water rendering cost and correctness.

---

## What This Stage Does

The SLW shading pass evaluates the full water material for every pixel covered by a water surface actor. It is a **forward shading pass** — unlike opaque geometry which writes to the GBuffer for deferred lighting, SLW reads the already-rendered opaque scene beneath it and composites directly into SceneColor in a single forward evaluation.

Per covered pixel, the pass:

1. **Computes underwater depth** — subtracts water surface depth (prepass) from background SceneDepth to derive the depth of the water column at each pixel
2. **Applies refraction** — offsets the SceneColor sample UV proportional to underwater depth and surface normal, creating the visual bending of light through water
3. **Applies Beer-Lambert extinction** — attenuates sampled scene color per-channel exponentially with depth, producing the characteristic color shift from shallow clear water to deep blue water
4. **Evaluates wave normal detail** — blends normal map layers or procedural wave expressions for surface micro-detail and ripple appearance
5. **Evaluates direct lighting** — computes sun and sky contribution to the water surface using the water's shading normal and roughness
6. **Samples surface reflections** — SSR and/or Lumen reflection data read specifically for the water surface specular term
7. **Samples shadows** — VSM shadow data applied to direct lighting on the water surface
8. **Evaluates foam** — depth-based and flow-based foam at shoreline edges and wave crests
9. **Composites into SceneColor** — blends the complete water shading result over the refracted background

---

## Why Single Layer Water Is Its Own Rendering Path

SLW is neither rendered as opaque (GBuffer/BasePass) nor as standard translucency. It occupies a dedicated path because it requires capabilities that neither provides.

**Why not opaque (BasePass)?**
Opaque rendering writes to the GBuffer — it does not have access to SceneColor during evaluation. Water needs to read what's already rendered beneath it for refraction. This requires the scene to be fully rendered before the water material evaluates, which BasePass cannot do.

**Why not standard translucency?**
Standard translucency can blend against SceneColor but doesn't support the depth-dependent Beer-Lambert extinction, per-channel color absorption, or the physically-accurate refraction that makes SLW water look convincing. It also doesn't provide a separate depth capture for underwater depth calculation.

**SLW's fundamental requirement:** Water must read from a populated opaque SceneColor (for refraction) while simultaneously writing back into SceneColor above it (water surface). This read-then-write relationship at the same depth mandates a dedicated pass that runs after BasePass and before translucency.

---

## Refraction — The Core Mechanism

Refraction is the defining visual feature of SLW and the primary reason the depth prepass exists.

**Step by step:**
1. Water surface depth (prepass buffer) and background SceneDepth are compared per pixel
2. Their difference gives **underwater depth** — how far below the surface the seafloor sits at that pixel
3. The water surface normal at that pixel determines the refraction direction
4. Underwater depth and normal together produce a screen-space UV offset
5. SceneColor is sampled at the offset UV rather than the straight-through position
6. The result is the visual bending of light that makes underwater geometry appear displaced

Shallow water (small depth difference) = minimal UV offset, near-straight view through to seafloor. Deep water (large depth difference) = strong offset, distant geometry visibly bent and shifted.

> [!WARNING]
> **SLW refraction only samples from opaque SceneColor — translucent objects beneath the water surface are not correctly refracted.** At the moment this pass runs, SceneColor contains only BasePass geometry (opaque meshes, Nanite surfaces). Translucent objects have not yet been rendered into SceneColor — they are drawn in the translucency pass which runs *after* SLW. A translucent object beneath the water surface will appear either at its unrefracted position or completely unaffected by the water's optical bending. This is a fundamental architectural limitation of SLW, not a configurable behavior.

---

## Beer-Lambert Extinction — How Water Gets Its Color

The characteristic color of deep water — blue-green even with a white water base color — comes from exponential light attenuation per wavelength.

Beer-Lambert law states that light intensity decreases exponentially with the distance it travels through an absorbing medium. Water absorbs different wavelengths at different rates:
- **Red** attenuates rapidly — absorbed within meters of the surface
- **Green** penetrates further but still attenuates at depth
- **Blue** penetrates deepest — giving deep ocean water its characteristic appearance

In SLW, this is implemented per RGB channel via configurable extinction coefficients in the water material. The sampled SceneColor beneath the water is multiplied by per-channel transmittance values that decrease exponentially with underwater depth. Near the surface, the scene is seen clearly. At depth, only blue-weighted light reaches the camera.

> [!NOTE]
> **Water color is the result of extinction coefficients interacting with depth — not a single color parameter.** Clear tropical water with low extinction across all channels looks blue at depth because the ambient light is blue-shifted. Murky river water with high extinction across all channels cuts light quickly and appears dark even at shallow depth. Tuning realistic water appearance requires understanding which extinction coefficient drives which visual characteristic, not just picking a water color.

---

## The "Single Layer" Constraint — Full Implications

The naming is literal. The SLW system maintains **exactly one water surface depth value per screen pixel**. The depth prepass writes one value per pixel; this shading pass reads one value per pixel.

| Scenario | Result |
|----------|--------|
| One water body visible | ✅ Correct |
| Two water bodies at different depths with no screen overlap | ✅ Correct |
| Two SLW bodies overlapping on screen at different heights | ❌ Corrupt — one depth overwrites the other |
| Waterfall pool above a river, both visible simultaneously | ❌ Corrupt — undefined which depth wins |
| Water surface seen through another water surface | ❌ Corrupt — stacked SLW not supported |

> [!WARNING]
> **Overlapping SLW surfaces at different depths visible simultaneously produce visual corruption with no workaround within the SLW system.** The depth prepass writes the last-rendered surface's depth for any conflicting pixel. This passes the wrong underwater depth into every calculation in the shading pass — refraction, extinction, foam, and compositing all produce incorrect results simultaneously. This constraint must be respected during level design. Plan water body placement and elevation to prevent simultaneous screen-space overlap at different heights.

---

## Surface Reflections

The SLW pass explicitly samples reflection data for the water surface. Depending on project configuration:

**SSR** — Water's low roughness makes it an ideal SSR surface. Near-specular reflection direction means SSR ray marches efficiently and hits on-screen geometry accurately. A dedicated SSR pass runs for water surface pixels.

**Lumen Reflections** — Off-screen content (sky, distant environment) comes from Lumen. The water roughness threshold check applies — very smooth water typically participates fully in Lumen reflection tracing (doc 19).

**Reflection Captures** — Sky light and placed captures contribute to specular as fallback beyond SSR and Lumen range.

> [!NOTE]
> **Water SSR is evaluated as a specific pass for SLW, not reused from the main scene SSR pass.** If water reflections appear incorrect independently of the rest of the scene (or the rest of the scene's reflections appear correct while water is wrong), check the water-specific reflection configuration rather than global SSR settings.

---

## Underwater Camera Mode

When the camera moves below the water surface plane, SLW switches to an **underwater evaluation mode** — the material evaluates from the opposite side of the surface.

Underwater rendering includes:
- Extinction fog applied to all visible scene content — geometry fades with distance
- Color tinting matching the water's extinction coefficients — deep underwater appears blue/green
- Analytical caustic light shafts projected down from the surface
- Total internal reflection beyond the critical angle when looking up at the surface

> [!WARNING]
> **The above-water to underwater camera transition produces a visible seam when the camera crosses the water surface plane.** At the exact transition point, neither above nor below evaluation mode is fully correct. This seam is inherent to the planar SLW architecture. In gameplay where players swim at the surface frequently, the transition needs careful material tuning — adjusting the transition depth threshold and adding transition blending in the water material. There is no automatic smooth transition built into SLW's default evaluation.

---

## Execution Model

SLW shading is a **forward raster pass** — draw commands submitted from the render thread, evaluated in a complex pixel shader per fragment on GPU.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Submits SLW draw commands; binds SceneColor, SceneDepth, water depth, shadow, and reflection inputs |
| **GPU** | Rasterizes water mesh geometry; executes the SLW pixel shader for every covered pixel |

The SLW pixel shader is among the most complex in the engine — it evaluates refraction sampling, extinction, wave normals, direct lighting, reflection sampling, shadow sampling, and foam in a single forward pass. Every covered pixel runs this full evaluation. On water covering a large screen area, shader complexity multiplies by every pixel.

---

## What Data It Reads

| Input | Source | Used For |
|-------|--------|---------|
| SceneColor (opaque) | BasePass output | Refraction source — sampled at offset UV |
| SceneDepth (background) | PrePass + Nanite emit + BasePass | Underwater depth calculation |
| Water surface depth | SingleLayerWaterDepthPrepass (doc 13) | Underwater depth calculation |
| VSM shadow data | ShadowDepths (doc 16) | Direct lighting shadow on water surface |
| SSR data | Water-specific SSR pass | Surface specular reflections — screen space |
| Lumen reflection data | Lumen Reflections (doc 19) | Surface specular reflections — off-screen |
| Sky Atmosphere LUTs | SkyAtmosphereLUTs (doc 09) | Sky color contribution to water surface |
| Wave normal textures | Material assets | Surface micro-detail normals |

---

## What Data It Produces

| Output | Consumers |
|--------|-----------|
| Composited SceneColor with water | All subsequent passes — translucency, TSR, post-processing |
| Depth contribution (water surface merged) | Screen-space effects reading depth over water area |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large water screen coverage | Forward pixel shader executes per covered pixel — scales linearly with screen area | Limit water body extent and camera positions that expose large water coverage |
| SSR on water surface | Near-specular SSR ray march specifically for water — dedicated pass | Reduce `r.SSR.Quality` or disable for water on lower tiers; use captures as fallback |
| Lumen reflections on water | Low-roughness water participates fully in Lumen reflection tracing | Increase roughness slightly on non-hero water; disable Lumen reflections on background water |
| Complex wave material | Many normal map layers, procedural noise expressions, foam evaluation | LOD water material complexity with distance; reduce texture sample count |
| Multiple water bodies | Each SLW actor is a separate draw call and full forward pass | Merge water bodies sharing the same material into single meshes |
| Multiple active views | Each view runs an independent full SLW shading pass | Disable SLW in scene captures where water accuracy is not needed |
| Underwater rendering active | Additional extinction fog and caustic evaluation per pixel | Inherent when camera is below surface; simplify underwater material parameters |

> [!WARNING]
> **SLW water that fills most of the screen (player swimming, flooded interiors, ocean plane) is among the most expensive single surfaces in the pipeline.** The forward pixel shader's full evaluation cost — refraction sample, Beer-Lambert calculation, reflection sampling, shadow evaluation, wave normal blending — runs for every pixel. A SLW ocean plane at an angle filling 60% of a 4K screen is evaluating this complete shader for millions of pixels every frame. Design large water scenes with occlusion and camera management to prevent maximum-coverage scenarios from being the norm.

---

## Key Systems and Components

### Underwater Depth — The Central Computed Value
The per-pixel difference between water surface depth and background SceneDepth is the single most important derived value in the entire SLW shading pipeline. It drives: refraction magnitude, extinction accumulation, foam intensity at shoreline edges, caustic depth distribution, and underwater fade distance. Any error in either input depth — incorrect water prepass depth or incorrect background SceneDepth — corrupts every one of these calculations simultaneously. When SLW looks wrong, check both depth inputs before investigating the material.

### Refraction Dependent Texture Sample
The SceneColor sample at the refracted UV is a **dependent texture read** — the sample UV is computed per-pixel in the shader rather than known at dispatch time. Modern GPU architectures handle this more efficiently than older ones, but it remains a meaningful cost when the refraction offset is large (deep water with steep surface normals) because the GPU cannot prefetch or cache the sample position in advance.

### Forward Lighting Evaluation
Unlike deferred passes that read precomputed GBuffer lighting, SLW evaluates direct lighting (sun, sky, local lights) in the pixel shader for every covered pixel. Local lights affecting SLW use a forward lighting path similar to translucency. This is why lights configured to not affect translucency may also not affect SLW surface appearance.

### Stencil Integration with Depth Prepass
The SLW system uses stencil to track water-covered pixels across its two passes. The stencil state written in the depth prepass is expected to remain intact when the shading pass runs. Custom stencil operations or passes inserted between doc 13 and this pass that clear or overwrite SLW's stencil data will cause the shading pass to either miss pixels or incorrectly shade non-water pixels.

---

## 📋 Reader Notes

> [!NOTE]
> **SLW is specifically designed for large, hero water bodies — lakes, rivers, oceans, flooded terrain.** For small decorative water (fountains, puddles, contained pools), a simpler translucent material is usually more appropriate and cheaper. SLW's two-pass overhead and complex forward pixel shader are justified when physically-based large-scale water rendering is the goal; they are disproportionate for water the player can see in full detail from 2 meters away without swimming.

> [!NOTE]
> **The Epic Water Plugin (Water Body Lake, River, Ocean actors) uses SLW internally.** Placing an Epic Water actor generates an SLW-using mesh as its visual surface. All constraints, limitations, and optimization approaches documented here apply directly to those actors. Understanding SLW is prerequisite to effectively debugging or optimizing Epic Water Plugin behavior.

> [!NOTE]
> **SLW at reduced screen percentage produces blurrier-than-expected underwater refraction.** Refraction samples opaque SceneColor at the input render resolution — not the output resolution. At 66% screen percentage with TSR, the refracted underwater content is sampled at 66% resolution. TSR's reconstruction improves the water surface appearance but does not improve the resolution of refracted content beneath the surface, which was already sampled at lower resolution. At very aggressive screen percentages (50% and below), this difference becomes visible as underwater content appearing noticeably softer than surface content.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `SingleLayerWater` | Total SLW shading pass cost |
| `SingleLayerWaterSSR` | SSR cost specifically for water surface — can be significant on smooth water |
| `WaterPass` | Variant event name in some engine versions |

> [!TIP]
> If `SingleLayerWater` is expensive, first determine the driver: screen coverage, SSR, or material complexity. Profile in order: (1) toggle `r.SSR.Quality 0` to isolate SSR cost — if cost drops significantly, SSR on water is the culprit. (2) If cost remains high, temporarily use a flat unlit water material to isolate shader complexity from coverage. (3) If a flat material is still expensive, pure coverage (screen area) is the bottleneck — address through level design.

### Debug Commands

```
r.Water.SingleLayer.Debug 1     // Water debug visualization:
                                 // Shows underwater depth per pixel, extinction accumulation,
                                 // and surface normals. Essential for diagnosing incorrect
                                 // water appearance — confirms whether the depth inputs
                                 // feeding refraction and extinction are correct.

r.Water.SingleLayer.Refraction 0  // Disable refraction — geometry beneath water appears
                                   // at literal screen positions without bending.
                                   // Use to isolate refraction's visual and performance contribution.
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — SingleLayerWater appears as a forward pass block
```

### Useful Console Variables

```
r.Water.SingleLayer.Refraction 0/1      // Toggle refraction for debugging/optimization
r.Water.SingleLayer.ShadowQuality [1]   // Shadow quality on SLW surface (0=lower, 1=default)
r.SSR.Quality [0-4]                     // Affects water SSR; set to 0 to disable for water
```

---

## Optimization Levers

### Coverage Reduction (Highest Impact)
- Design water body mesh extents to match what's actually visible — oversized water planes that extend far off-screen still cost vertex evaluation even if pixels are culled
- Use height fog, terrain, and camera angle management to keep maximum water screen coverage below 30–40% in typical gameplay scenarios
- Consider whether distant water requires SLW quality — a LOD transition from SLW to a simpler visual representation at large distances is a meaningful saving

### Reflection Reduction
- Slightly increase water roughness (0.02–0.05) on background water bodies — removes them from Lumen reflection tracing with imperceptible quality difference on non-hero water
- On lower-end platforms, disable SSR for water and rely on reflection captures + sky — use `r.SSR.Quality 0` or per-actor SSR override where available
- Avoid Planar Reflections on large water bodies — their per-capture cost is extremely high relative to SSR + Lumen quality

### Material Simplification
- Create a simplified LOD water material with fewer normal map layers for water bodies at distance from the player
- Remove foam evaluation in lower scalability tiers — foam is primarily visible at shorelines from close range
- Cap wave expression complexity — procedural noise evaluated per-pixel scales with every water pixel

### View and Capture Management
- Disable SLW in all scene captures where water appearance is not essential — use a flat reflective surface or static sky capture as a substitute
- Avoid placing scene capture actors near large water bodies

---

## Mental Model

Think of Single Layer Water as:

> *"Read what's already painted beneath the water surface, bend it by how deep the water is at each pixel, tint it with depth-based color absorption, add reflections and direct lighting on the surface above it, and write the result back — all in one forward shader pass per pixel."*

SLW is a **compositing pass with physics built in.** It's the most physically accurate surface rendering in UE5's real-time pipeline for what it covers — the interaction of light, depth, extinction, and refraction — but it pays for that accuracy with forward complexity that scales linearly with every pixel of water visible on screen.

The key insight is that **SLW quality depends on four independent input chains being correct simultaneously:** water depth (prepass), background depth (PrePass + NaniteEmit), shadow data (VSM), and reflection data (SSR + Lumen). When water looks wrong, the diagnostic path is to verify each input in sequence using `r.Water.SingleLayer.Debug 1` before investigating the material or pass itself.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| SingleLayerWaterDepthPrepass (doc 13) | Produces water surface depth — must complete before this pass |
| BasePass (doc 11) | Produces opaque SceneColor this pass samples for refraction |
| NaniteEmitDepthTargets (doc 06) | Nanite depth must be in SceneDepth before underwater depth is computed here |
| ShadowDepths / VSM (doc 16) | Shadow data read for direct lighting on water surface |
| Lumen Reflections (doc 19) | Off-screen specular reflection sampled here for water surface |
| Sky Atmosphere LUTs (doc 09) | Sky contribution to water surface color evaluation |
| Translucency Pass | Runs after SLW; translucent objects not available in SLW refraction |
| Epic Water Plugin | Uses SLW internally — all constraints documented here apply |
| DownsampleDepth (doc 21) | Half-res depth may be used for some SLW depth queries |

---

## Red Flags to Watch For

- **`SingleLayerWater` > 1.5ms** → identify driver: toggle SSR off (`r.SSR.Quality 0`) to isolate; check screen coverage; use simplified material to isolate shader complexity
- **Refraction visually incorrect** → verify both depth inputs with `r.Water.SingleLayer.Debug 1`; incorrect underwater depth corrupts all subsequent calculations simultaneously
- **Translucent objects not refracting through water** → expected and architectural; SLW refraction samples opaque SceneColor only; translucency renders after SLW
- **Two water bodies showing corruption where they overlap** → single layer constraint violated; redesign level to prevent simultaneous screen-space depth conflict
- **Water surface reflections incorrect while rest of scene is fine** → water-specific SSR or Lumen configuration issue; check reflection settings specifically for water materials
- **Local lights not illuminating water surface** → check `Affects Translucency` flag on light; SLW uses forward lighting similar to translucency
- **Underwater camera transition produces hard seam** → inherent SLW transition edge case; tune transition depth threshold in material; add manual transition blending
- **Water appears unusually soft/blurry at reduced screen percentage** → refraction samples at input resolution; effect inherent at aggressive screen percentage reduction; not correctable by TSR reconstruction
- **SLW cost increasing with scene captures** → each capture runs independent full SLW pass; disable or substitute on non-essential captures

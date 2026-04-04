---
tags:
  - translucency
  - overdraw
---

# Unreal Engine 5 Rendering Pipeline – Translucency

> Stage: **Translucency**  
> Phase: Forward Transparent Rendering  
> Purpose: Render all translucent and transparent geometry — particles, glass, smoke, fire, water spray, volumetric effects — using forward shading with back-to-front sorting and correct alpha compositing  
> Pipeline Position: After all deferred passes, lighting, GI, and atmospheric effects; before post-processing

---

## What This Stage Does

Translucency renders everything that cannot use the deferred GBuffer path — every object that needs to blend with what's behind it rather than simply replace it. Glass, smoke, fire, dust, water spray, emissive particles, volumetric decals, hair, and any material with any form of transparency goes through this pass.

Where opaque rendering defers lighting to a separate pass and uses early-Z to eliminate redundant work, translucency:
- **Must render forward-shaded** — each surface evaluates its own lighting in the same pass as its geometry
- **Must sort back-to-front** — correct blending requires drawing the furthest object first, the nearest last
- **Has no early-Z protection** — every pixel a translucent surface covers is fully shaded regardless of what's in front of it
- **Accumulates every layer** — stacked translucent surfaces each pay full shader cost for every pixel they cover

These constraints make translucency fundamentally different from opaque rendering and one of the most performance-sensitive areas of any real-time renderer.

---

## The Translucency Sub-Passes

The translucency stage is not a single pass — it contains several sequential operations:

**1. Distortion Accumulation**
Materials that use distortion (glass, heat haze, water surfaces not using SLW) write distortion vectors into a separate accumulation buffer. Each distorting surface's normal contributes a 2D screen-space offset representing how it bends the background image.

**2. Distortion Apply**
The accumulated distortion vectors are applied to SceneColor — each pixel's background sample is offset according to the distortion buffer, producing the refraction/distortion effect. This is a separate fullscreen blend after distortion accumulation completes.

**3. Separate Translucency Rendering**
Materials with `Render in Separate Translucency` enabled render into a dedicated render target at configurable resolution. This is the primary path for most particles and effects.

**4. Standard Translucency Rendering**
Materials using the standard translucency path (which participates in depth of field blurring) render here.

**5. Translucency Compositing**
Separate translucency results are composited back onto SceneColor. The separate path renders after depth of field is applied to the main scene, so separate translucency objects remain sharp against a blurred background.

---

## Separate Translucency — The Key Architectural Choice

`r.SeparateTranslucency` controls one of the most important translucency configuration decisions. When enabled (default), translucent materials that opt in render into a dedicated render target:

**Benefits of Separate Translucency:**
- Renders **after** depth of field is applied to the main scene — particles and glass stay sharp even when the scene is DoF-blurred (correct behavior for objects in focus range)
- Has its own half-resolution option (`r.SeparateTranslucencyScreenPercentage`) for cheaper particle rendering
- Failures in separate translucency don't directly corrupt the main SceneColor

**Drawbacks:**
- One additional render target and composite pass per frame
- Additional bandwidth for the separate buffer

**Materials opt in/out** via the `Render in Separate Translucency` property in material settings. Materials that should blur with the background (a heat haze effect tied to the background's DoF blur) should opt out. Materials that should stay sharp regardless (foreground particles, UI-adjacent effects) should opt in.

> [!NOTE]
> **The default behavior of most particle materials is to render in Separate Translucency.** This means particle effects stay sharp when depth of field blurs the background — usually the correct visual result. If particles appear to not be affected by DoF blur when they should be (particles in the blurred distance remaining sharp), check whether their materials have `Render in Separate Translucency` disabled.

---

## Forward Shading and Lighting Modes

Because translucency cannot access the deferred GBuffer, it must evaluate its own lighting. UE5 provides several modes of increasing quality and cost:

### Volumetric PerVertex (Cheapest)
Samples the translucent lighting volume (built in FilterTranslucentVolume, doc 29) at each vertex. Interpolates values across triangles during rasterization. Lighting changes are smooth and cheap — appropriate for large particle meshes where per-vertex interpolation is acceptable.

**Best for:** Background atmospheric particles, large smoke volumes, distant fog sheets.

### Volumetric PerPixel
Samples the translucent lighting volume per pixel rather than per vertex. More accurate for geometry with significant size variation — prevents blocky lighting on large particle sheets.

**Best for:** Medium-quality particles, glass where lighting variation per vertex would be visible.

### Surface TranslucencyVolume
Uses the translucent volume but with surface normal awareness — the lighting accounts for the surface orientation rather than treating the particle as a volume.

**Best for:** Particles representing physical surfaces (debris, leaves, water droplets).

### Surface Forward Shading (Most Expensive)
Evaluates direct lighting from all lights in the scene using the clustered light grid (doc 07) per pixel. Provides physically accurate lighting including specular highlights on transparent surfaces. Reads from the Lumen reflection buffer for reflections.

**Best for:** Hero glass, hero water, foreground transparent objects where accurate lighting is a visual requirement.

> [!WARNING]
> **Surface Forward Shading evaluates every local light in the clustered light list per pixel, per translucent fragment.** In a scene with 50 local lights, every pixel of every forward-shaded translucent surface evaluates contributions from all 50 lights (filtered by the light grid). Stacked layers of forward-shaded translucency multiply this cost by layer count. Reserve Surface Forward Shading for hero transparent surfaces only — a single prominent piece of glass, a hero character's visor, a key interactive water surface. Never use it as the default for particle systems.

---

## Sorting — The CPU Cost

Every frame, all visible translucent primitives must be sorted back-to-front by depth before rendering begins. Incorrect sort order produces visible z-fighting and incorrect blending — objects appearing on top of things they should be behind.

The sort runs on the **render thread** — not the GPU. Sort cost scales with:
- Number of unique translucent primitives (not particles — primitive actors)
- Number of active views (each view sorts independently)
- Camera movement (large camera movements change sort order for many objects simultaneously)

> [!NOTE]
> **Individual particles within a Niagara system are NOT sorted per-particle by default on CPU.** Niagara handles particle sorting separately — GPU particle sorting dispatches a GPU sort based on view depth. The CPU sort applies to translucent *primitives* (actors, components). A single Niagara component with 50,000 particles is one primitive for CPU sort purposes, but those 50,000 particles may be GPU-sorted internally.

**Sort policies** (`r.TranslucentSortPolicy`):
- `0` — Sort by primitive origin (center point) — cheapest, least accurate for large objects
- `1` — Sort by projected bounding box bounds — more accurate, slightly more expensive
- `2` — Sort by distance from camera — most accurate, most expensive

---

## Overdraw — The GPU Cost

Overdraw is the dominant performance concern for translucency in virtually every production game. When multiple translucent layers stack on the same screen pixels, every layer's pixel shader executes in full. Unlike opaque rendering where early-Z prevents redundant shader execution, translucency has no such protection.

**A particle effect with:**
- 500 particles each covering 50×50 pixels
- 10 layers of overlap in the center of the effect
- Total shader invocations ≈ 500 × 2500 × average_overlap = millions of pixel shader calls

Every one of those calls evaluates the full material — texture samples, lighting volume lookup, math operations. The pixel that the player ultimately sees represents only one of those layers; all others were computed and discarded in the blend.

> [!WARNING]
> **Dense particle effects with high overlap are frequently the most expensive single element in a scene's GPU budget — more expensive than all Nanite geometry, all lighting, and all post-processing combined.** A "hero VFX moment" with multiple overlapping particle systems (explosion + smoke + debris + sparks + fire) can push a frame from 8ms to 40ms in a single effect. Always profile VFX at their maximum visual intensity, not at average state.

**Overdraw compounds with material complexity.** A simple additive particle with one texture costs very little per pixel even at high overdraw. A complex particle with multiple texture reads, dynamic lighting, refraction, and normal mapping at the same overdraw level costs proportionally more per pixel — and that multiplier applies to every stacked layer.

---

## Additive vs Alpha Blending — The Most Important Material Decision

This distinction has major implications for both visual correctness and performance:

### Alpha Blending (SrcAlpha, OneMinusSrcAlpha)
The standard transparency blend. The correct appearance depends on draw order — a red glass in front of a blue glass looks different from the reverse.

**Requires back-to-front sorting.** Visual artifacts appear when sort order is incorrect (at geometry that spans multiple depth ranges, at the intersection of two transparent surfaces).

**Use for:** Smoke, glass, water, fog, any effect where opacity and color matter relative to what's behind it.

### Additive Blending (One, One)
Adds the material's color directly to whatever is already in the buffer. The mathematical result is identical regardless of draw order — red + blue = blue + red.

**Does NOT require sorting.** Two additive surfaces can render in any order and produce the identical final result.

**Additional efficiency:** Additive blending naturally fades out as the background approaches white — additive particles become invisible against bright backgrounds without any additional shader logic.

**Use for:** Fire, sparks, magic effects, electrical arcs, lens flares, emissive light contributions, any effect that "adds light" to the scene rather than "blocks" it.

> [!NOTE]
> **Switching smoke or fog from alpha blend to additive is wrong and looks wrong — don't do it.** Additive blending cannot represent opacity — a solid object cannot be represented additively. The correct use of additive blending is for effects that represent light emission or energy, not physical matter obstructing the view. The optimization value of additive blending comes from using it correctly, not universally.

---

## OIT — Order Independent Transparency (UE5.4+)

UE5.4 introduced experimental **Order Independent Transparency (OIT)** using sorted pixel layers. Rather than CPU-sorting translucent primitives and rendering back-to-front, OIT stores multiple per-pixel transparency layers and resolves them in correct order during compositing.

**How it works:**
- Each pixel can store up to N independent transparency layers (default 3)
- All translucent geometry renders without sorting
- A resolve pass combines the stored layers in correct depth order

**Benefits:**
- Eliminates CPU sort cost for supported geometry
- Handles geometry that intersects other translucent geometry correctly (traditional sort fails at intersections)
- No visual artifacts from incorrect primitive sort order

**Limitations:**
- Limited layer count (3 layers by default) — fragments beyond layer count use traditional blending
- Additional memory for per-pixel layer storage
- Resolve pass adds GPU cost
- Still experimental — not suitable for all translucent content

> [!NOTE]
> **OIT does not eliminate overdraw cost — it changes how correct blending is achieved, not how expensive blending is.** Each stored layer still pays full pixel shader cost. OIT trades CPU sort cost for GPU memory and resolve cost, and improves correctness at geometry intersections. It is not a general performance optimization for particle overdraw.

```
r.OIT.SortedPixels.Enable 0/1          // Toggle OIT system (experimental)
r.OIT.SortedPixels.Layers [3]          // Per-pixel layer count — more layers = more memory
```

---

## What Data This Pass Reads

| Input | Source | Purpose |
|-------|--------|---------|
| SceneColor | All preceding passes | Background to blend translucency over |
| SceneDepth | PrePass / BasePass | Depth test (translucency depth-tests against opaque geometry) |
| Translucent Lighting Volume | FilterTranslucentVolume (doc 29) | Lighting for Volumetric lighting modes |
| Clustered Light Grid | ComputeLightGrid (doc 07) | Per-pixel lighting for Surface Forward Shading mode |
| Lumen Reflection Buffer | Lumen Reflections (doc 19) | Reflections on transparent surfaces |
| VSM Shadow Pages | ShadowDepths (doc 16) | Shadow reception on forward-shaded translucency |
| Velocity Buffer | VelocityParallel (doc 04) | Translucent velocity for TSR (if Responsive AA active) |

---

## What Data This Pass Produces

| Output | Consumers |
|--------|-----------|
| SceneColor with translucency composited | Post-processing, TSR |
| Separate translucency buffer (if enabled) | Translucency composite pass → SceneColor |
| Custom depth from translucent objects | Post-process effects using custom depth |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High overdraw | Full shader per layer per pixel — no early-Z culling | Reduce layer count; reduce particle density; fade opacity; use MaxDrawDistance |
| Complex translucent materials | Every overdraw layer pays full material cost | Simplify particle materials; reduce texture reads; remove unnecessary features |
| Surface Forward Shading on many materials | Full per-light evaluation per pixel per layer | Restrict to hero objects; use Volumetric modes for background particles |
| Many unique translucent primitives | CPU sort cost scales with primitive count | Reduce primitive count; merge particle systems; use instancing |
| Refraction on many surfaces | SceneColor read at offset per refracting pixel per layer | Limit refraction to hero surfaces; avoid stacked refracting surfaces |
| Translucent shadow casting | Shadow depth renders for translucent casters | Disable shadow casting on particles; only enable for hero surfaces |
| Large particle screen coverage | Fill rate scales with covered pixels | Use MaxDrawDistance; clip low-opacity edges early in shader |

---

## Debugging and Optimization — Thorough Guide

### Step 1: Isolate Translucency Cost

Before any other investigation, establish the total translucency budget and compare it to the rest of the frame:

```
showflag.Translucency 0         // Disable all translucency — compare GPU time with and without.
                                 // The difference is your total translucency budget.
                                 // If this saves > 20% of frame time, translucency is your primary concern.

showflag.Particles 0            // Disable particle system rendering specifically.
                                 // Separates particle cost from glass/water/mesh transparency.
```

If disabling `showflag.Translucency 0` saves significant frame time, proceed to isolate which component is responsible:

```
r.SeparateTranslucency 0        // Forces all separate translucency into the standard path.
                                 // Useful for understanding the separate vs standard translucency split.

r.Translucency.ExclusiveTranslucency 1  // Shows only the translucency pass result — 
                                          // hides all opaque geometry. Lets you see exactly
                                          // what translucency is contributing visually.
```

---

### Step 2: Identify Overdraw

Overdraw is the most common root cause of expensive translucency. Three viewport modes reveal it:

```
viewmode TranslucencyOverdraw   // PRIMARY OVERDRAW TOOL.
                                 // Heatmap specifically for translucent overdraw.
                                 // Color scale: Black=0, Green=1-2 layers, 
                                 //   Yellow=3-4, Orange=5-6, Red=7+, White=extreme.
                                 // White regions indicate critically excessive overdraw.
                                 // This is the first visualization to use when translucency is expensive.

viewmode QuadOverdraw            // Shows 2×2 quad utilization waste.
                                 // Reveals thin-edge particle cards with high quad inefficiency.
                                 // Red/white = many helper pixels wasted on near-empty quads.
                                 // Common with small distant particles.

viewmode ShaderComplexity        // Heatmap of shader instruction count per pixel.
                                 // For translucency this is CUMULATIVE — all layers summed.
                                 // White over a particle effect = extremely complex combined evaluation.
                                 // Use AFTER TranslucencyOverdraw to understand whether overdraw
                                 // or per-layer material complexity is the primary driver.
```

**Reading the TranslucencyOverdraw heatmap:**
- **Green / Yellow regions** — acceptable for hero VFX
- **Orange regions** — review necessity; may be acceptable for brief peak moments
- **Red regions** — optimize; sustained red is a performance risk
- **White regions** — critical; white sustained over a large screen area will cause frame budget failures

> [!TIP]
> Use `viewmode TranslucencyOverdraw` while stepping through the effect lifecycle with `slomo 0.1` (slow motion at 10% speed). This reveals whether high overdraw is sustained or peaks briefly. Brief white overdraw during an explosion is acceptable; white overdraw from background smoke that's always on screen is not.

---

### Step 3: Profile Individual Effects

To identify which specific effects are expensive:

**In Unreal Insights:**

| Event | What It Tells You |
|-------|------------------|
| `Translucency` | Total translucency cost — container for all sub-passes |
| `SeparateTranslucency` | Separate translucency render target pass |
| `TranslucencyComposite` | Separate translucency → SceneColor composite |
| `DistortionAccumulation` | Distorting material accumulation pass |
| `DistortionApply` | Distortion vector application to SceneColor |
| `StandardTranslucency` | Non-separate translucency rendering |
| `ParticleSimulation` | GPU particle rendering within translucency |

**Per-effect isolation using show flags:**
```
// Disable specific FX categories to narrow down which system is expensive:
showflag.Particles 0             // All particle systems
showflag.Decals 0                // Decal actors (some use translucency)
showflag.StaticMeshes 0          // Static translucent meshes (glass, etc.)
showflag.SkeletalMeshes 0        // Character-related translucency (hair, cloth, skin)
```

**Using Niagara system statistics:**
```
stat NiagaraVerbose              // Per-Niagara-system render cost breakdown.
                                 // Shows which specific particle systems are the most expensive.
                                 // Cross-reference with TranslucencyOverdraw heatmap positions.
```

---

### Step 4: Material-Level Investigation

Once expensive effects are identified, investigate their materials:

```
viewmode ShaderComplexity        // Assess per-material instruction complexity.
                                 // Apply while looking at only the suspect effect
                                 // (disable others with show flags).

// In the material editor:
// - Check Stats panel for instruction count
// - Use "Stats" button for platform-specific estimates
// - Look for: unnecessary texture samples, expensive math nodes,
//   unused feature flags (Refraction, Subsurface, etc.)
```

**Material features that add cost per layer:**
- **Refraction** — reads SceneColor at an offset per pixel. Every stacked refracting layer reads SceneColor again.
- **Normal mapping** — additional texture sample + normal transform
- **Dynamic lighting (Surface Forward Shading)** — full light evaluation
- **Multiple texture reads** — each sample adds bandwidth per layer
- **Complex procedural math** — Sine, Noise nodes, etc. evaluated per pixel per layer

---

### Step 5: Sort and Primitive Count

Check whether CPU sort cost is contributing:

```
stat initviews                   // Shows translucent primitive sort time.
                                 // Look for "SortedPrimitives" or similar entries.
                                 // High sort time = too many unique translucent actors.

r.TranslucentSortPolicy 0       // Switch to cheapest sort policy for comparison.
                                 // If this significantly reduces render thread time,
                                 // the sort is a bottleneck.
```

---

### Step 6: Separate Translucency Resolution

For effects that use separate translucency, the resolution is independently controllable:

```
r.SeparateTranslucencyScreenPercentage [100]   // Separate translucency resolution as % of main render.
                                                // 50 = render separate translucency at half resolution.
                                                // Significant savings for particle-heavy scenes.
                                                // Artifacts: slight blurriness at particle edges when
                                                // composited back to full resolution. Usually acceptable
                                                // for smoke/cloud particles; less so for sharp effects.
```

---

## Optimization Strategies — Complete Reference

### Strategy 1: Reduce Overdraw (Highest Impact)

**Opacity fadeout at distance:**
In the material, multiply opacity by a distance-based fade mask. Particles with near-zero opacity beyond a certain distance contribute almost nothing visually but pay full shader cost. Fading them out early eliminates their overdraw contribution:
```
// In material graph:
// CameraDepthFade node → multiply with Opacity
// Set FadeDistance and FadeRadius to match the effect's visual significance range
```

**Alpha clip instead of alpha blend for edges:**
For particles with hard-edge silhouettes (debris, leaves, splashes), using the Masked shading model with a clip threshold eliminates transparent edge pixels entirely — they never become fragments. This also enables early-Z for those pixels.

**Reduce particle density:**
Fewer particles at the same visual density is achievable by:
- Increasing particle size (fewer larger particles vs many small ones)
- Increasing spawn intervals while reducing lifetime to maintain visual density
- Using fewer but more detailed texture sheets

**MaxDrawDistance on particle components:**
```cpp
// In Niagara component settings or Blueprint:
UNiagaraComponent->SetMaxDrawDistance(3000.0f);
// Particles beyond 3000 units are not rendered.
// Combine with DistanceFade in material for soft disappearance.
```

**Particle LOD (Niagara Significance):**
Niagara's scalability system reduces particle count and effect complexity at distance. Configure `Significance` handlers on Niagara systems to automatically spawn fewer particles when off-camera or distant.

---

### Strategy 2: Simplify Materials

**Reduce texture reads:**
Every additional texture sample in a translucent material multiplies cost by overdraw factor. A particle with 3 texture reads at 8× overdraw = 24 effective texture reads per output pixel.

- Combine channels: Pack opacity in alpha, roughness in blue, etc.
- Use smaller textures at lower mip for particles that never appear close to camera
- Remove unused inputs: If `Refraction` is enabled but set to 0, disable the feature — it still costs shader complexity

**Remove features not visibly needed:**
- `Two Sided` — doubles raster work per layer
- `Refraction` — adds SceneColor read per pixel per layer
- `Pixel Depth Offset` — additional depth computation
- `Subsurface` shading model — adds scattering evaluation
- `Tessellation` (legacy) — multiplies vertex count

**Use simpler lighting modes for background effects:**
```
// In material settings, Translucency Lighting Mode:
// Background/atmospheric particles:      Volumetric PerVertex
// Medium distance/quality particles:     Volumetric PerPixel  
// Hero interactive surfaces only:        Surface Forward Shading
```

---

### Strategy 3: Use Additive Blending Strategically

Identify all effects in the project that represent light emission or energy and convert them to additive:
- Fire and flame → Additive
- Sparks and embers → Additive
- Magical energy effects → Additive
- Electrical discharges → Additive
- Muzzle flash → Additive
- Neon glow halos → Additive
- Lens flares → Additive

Benefits compound:
- No sort required — rendering order is irrelevant
- Naturally disappears against bright backgrounds
- Often needs fewer particles because the additive glow is more visually impressive per particle

---

### Strategy 4: Separate Translucency Resolution Scaling

For projects with particle-heavy scenes, rendering separate translucency at reduced resolution is one of the highest-leverage optimizations available:

```
r.SeparateTranslucencyScreenPercentage 50   // Render particles at half resolution.
```

At 50%, separate translucency costs 25% of its full-resolution cost (half width × half height = quarter pixels). The visual quality reduction is often imperceptible for:
- Soft volumetric particles (smoke, fog)
- Small distant particles
- Additive glow effects

It is more visible for:
- Large near-camera particles with hard edges
- Particles with fine detail texture sheets
- Effects where individual particle clarity matters

> [!WARNING]
> **`r.SeparateTranslucencyScreenPercentage` reduces resolution for ALL separate translucency — you cannot selectively apply it per material or effect.** Test with representative hero and background effects simultaneously before committing to a reduced value. A setting acceptable for background smoke may produce unacceptable artifacts on a foreground hero particle effect.

---

### Strategy 5: Translucency Sorting Optimization

```
r.TranslucentSortPolicy 0       // Cheapest: sort by bounding box origin.
                                 // Acceptable for most particle systems where primitives
                                 // don't significantly intersect or contain the camera.

r.TranslucentSortAxis           // If sorting by axis distance (policy 2), this defines
                                 // the sort axis vector.
```

Reduce sort cost by reducing unique primitive count:
- Merge multiple Niagara components into one where they logically belong together
- Use instanced static meshes for repeated translucent objects
- Avoid spawning/destroying translucent actors constantly — pool them

---

### Strategy 6: Shadow Casting on Translucency

Translucent shadow casting is expensive — it adds depth renders and shadow lookups for transparent surfaces.

```
// Per material or component:
// Uncheck "Cast Shadow" on Niagara components for background particles
// Enable shadow casting only on hero effects where shadows are clearly visible
```

For soft translucent shadows (smoke casting soft shadows on the ground), evaluate whether the visual benefit justifies the cost. Most smoke and fog effects look correct without shadow casting because their own translucency creates inherent depth.

---

### Strategy 7: Responsive AA and Translucency Ghosting

Fast-moving particles frequently show TSR ghosting trails — the temporal history cannot correctly track fast translucent movement.

```
// In material settings: enable "Responsive AA"
// This tells TSR to use aggressive history rejection for this material's pixels.
// Result: eliminates ghost trails but adds per-frame noise on those pixels.
// Best for: fast sparks, muzzle flash, fast-moving debris
// Avoid for: slow smoke, large background atmospheric particles
```

Combined with `r.TSR.Translucency.EnableResponiveAA 1` (from doc 23) for global control.

---

### Strategy 8: Platform-Specific Scaling

Build scalability tiers for translucency quality:

```ini
// BaseScalability.ini — Effects quality tiers
[EffectsQuality@0]  // Low
r.SeparateTranslucencyScreenPercentage=50
r.TranslucencyLightingVolume=0
r.ParticleSimulationSpeedScale=0.5

[EffectsQuality@1]  // Medium
r.SeparateTranslucencyScreenPercentage=75
r.TranslucencyLightingVolume=1
r.TranslucencyLightingVolumeDim=32

[EffectsQuality@2]  // High
r.SeparateTranslucencyScreenPercentage=100
r.TranslucencyLightingVolume=1
r.TranslucencyLightingVolumeDim=64

[EffectsQuality@3]  // Epic
r.SeparateTranslucencyScreenPercentage=100
r.TranslucencyLightingVolume=1
r.OIT.SortedPixels.Enable=1
```

---

## Useful Console Variables — Complete Reference

```
// Core translucency controls
showflag.Translucency 0/1                       // Toggle all translucency (debug/isolation)
r.SeparateTranslucency 0/1                      // Toggle separate translucency path

// Separate translucency resolution
r.SeparateTranslucencyScreenPercentage [100]    // Separate translucency resolution % of main render.
                                                 // 50-100 is typical range. 50 = quarter pixel count.

// Sort policy
r.TranslucentSortPolicy [0-2]                   // 0=origin, 1=bounds, 2=distance axis

// Lighting volume
r.TranslucentLightingVolume 0/1                 // Toggle translucent lighting volume
r.TranslucencyLightingVolumeDim [64]            // Volume resolution (32-128 typical range)

// Debug isolation
r.Translucency.ExclusiveTranslucency 0/1        // Show only translucency result in viewport

// Distortion
r.Distortion 0/1                                // Toggle distortion pass entirely

// OIT (UE5.4+, experimental)
r.OIT.SortedPixels.Enable 0/1                   // Toggle Order Independent Transparency
r.OIT.SortedPixels.Layers [3]                   // Per-pixel layer count for OIT

// Shadow quality on translucency
r.Shadow.TranslucentShadowStartFade             // Distance at which translucent shadows fade
r.Shadow.TranslucentShadowEndFade               // Distance at which fade completes

// Particle-specific
r.ParticleSimulationSpeedScale [1.0]            // Scale particle simulation speed (not rendering cost)
```

---

## Stat Commands for Translucency Investigation

```
stat GPU                // Overall GPU breakdown — Translucency appears as a block.
                         // Check its proportion vs total frame time.

stat NiagaraVerbose     // Per-system particle rendering cost breakdown.
                         // Most important stat for identifying which specific VFX are expensive.

stat initviews          // Translucent primitive sort time on render thread.
                         // Look for SortedTranslucentPrimitives count and associated time.

stat SceneRendering     // Translucency-related rendering stats including draw call counts.

stat RHI                // Draw call count — translucency often has high draw call counts
                         // from many unique particle materials.
```

---

## Key Systems and Components

### Translucency Sort
The per-frame CPU operation that orders all translucent primitives by depth before rendering. Runs on the render thread. Cost scales with the number of unique translucent scene primitives (not particle count — individual particles are handled by GPU sort). The primary CPU-side cost of the translucency pipeline.

### GPU Particle Sort
Separate from the primitive sort — Niagara GPU particles are depth-sorted on the GPU within each emitter. `fx.Niagara.GPUSorting` controls this. GPU sorting is required for correct alpha-blended particle rendering; it can be disabled for additive particles (where sort order is irrelevant) to save GPU sort cost.

### Separate Translucency Buffer
The intermediate render target that separate-path translucency renders into before compositing. Has its own depth buffer for depth testing. Renders after the main scene's depth of field pass, keeping its contents sharp against a blurred background.

### Distortion Buffer
A separate screen-resolution texture that accumulates distortion vectors from all materials using the distortion blend mode. Applied in a single fullscreen pass to SceneColor after all distorting surfaces have rendered. The distortion apply step reads SceneColor at the offset positions — expensive at high distortion magnitudes as it samples many unique SceneColor locations.

### Translucent Lighting Volume
The pre-filtered 3D lighting volume from FilterTranslucentVolume (doc 29). Sampled during translucency rendering for Volumetric lighting modes. A small texture sample compared to the full per-pixel forward shading alternative.

---

## 📋 Reader Notes

> [!NOTE]
> **Translucency performance is almost always an art and design problem, not a rendering configuration problem.** The rendering system is doing exactly what it's designed to do — every layer, every pixel, every shader evaluation is intentional. The question is whether that work is producing visual results proportional to the cost. The most impactful translucency optimizations happen in Niagara system authoring, material design, and VFX density decisions — not in CVars. CVars enable the optimization; content authoring is where the work happens.

> [!NOTE]
> **Always profile translucency at worst-case moments, not average state.** A smoke effect that's acceptable at 3-layer overdraw during calm gameplay may spike to 15-layer overdraw during an explosion. A single scene that's within budget at average play may fail budget at a cinematic moment with multiple simultaneous effects. Establish budget limits for worst-case frames, not average frames, and author effects to stay within those limits at peak intensity.

> [!NOTE]
> **Translucency and TSR interact significantly.** Fast translucent objects (particles, projectile trails) frequently produce TSR ghosting. The Responsive AA flag in materials is the per-effect control for this. Dense particle effects with Responsive AA enabled will show per-frame noise on those pixels — a tradeoff that's usually preferable to ghost trails but should be evaluated per effect type. Slow-moving atmospheric effects (smoke, fog) should generally NOT use Responsive AA.

---

## Mental Model

Think of translucency as:

> *"Draw everything see-through in the correct order, one layer at a time, paying the full cost of every layer regardless of how much of the final pixel each layer contributes."*

There is no deferred optimization, no early culling, no batching by material complexity — just ordered, accumulating pixel shader work. Every layer is a tax on the frame budget, and the tax multiplies with overdraw. The renderer is doing exactly what physical transparency requires: evaluating each transparent surface's contribution to the final pixel in depth order.

The key insight is that **the visual impression of translucency is almost always achievable at much lower overdraw than the first implementation uses.** Dense particle clouds can be replicated with fewer, larger, more carefully textured particles. Smoke screens can use fewer wisps with better shape textures. Fire can use additive blending instead of alpha. The artistic result can be preserved or improved while the overdraw cost drops by 50–80%. That work happens in content authoring, not in the renderer.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| FilterTranslucentVolume (doc 29) | Provides the lighting volume sampled by Volumetric lighting modes |
| ComputeLightGrid (doc 07) | Provides clustered light lists for Surface Forward Shading |
| FXSystemPreRender (doc 01) | GPU particle simulation — determines what particles exist to render |
| PostRenderOpsFX (doc 31) | Closes the FX loop after translucency completes |
| TSR (doc 23) | Receives translucency in SceneColor; Responsive AA flag controls history rejection |
| Lumen Reflections (doc 19) | Reflections on translucent surfaces with appropriate lighting modes |
| VelocityParallel (doc 04) | Translucent velocity output for TSR |
| ShadowDepths (doc 16) | Shadow reception on translucent geometry |

---

## Red Flags to Watch For

- **`viewmode TranslucencyOverdraw` showing widespread white** → critical overdraw; immediate VFX authoring review needed; identify specific effects with `showflag.Particles 0` and Niagara system disable
- **`showflag.Translucency 0` saving > 25% frame time** → translucency is the primary frame budget consumer; all optimization effort should focus here before addressing other passes
- **`stat NiagaraVerbose` showing one system costing > 2ms** → single effect responsible for large fraction of translucency cost; that specific system needs particle reduction or material simplification
- **Translucency cost spiking at VFX peak moments** → expected but must be budgeted; establish maximum simultaneous VFX density limits and enforce in VFX authoring guidelines
- **`DistortionAccumulation` appearing large** → many distorting materials or large-coverage distortion; disable `r.Distortion 0` to confirm, then reduce distorting surface coverage or material count
- **High render thread time in `stat initviews` at translucency-heavy moments** → too many unique translucent primitives being sorted; reduce primitive count or switch to cheaper sort policy
- **TSR ghosting trails on specific particle effects** → enable `Responsive AA` on those materials; check `r.TSR.Translucency.EnableResponiveAA`
- **Particles appearing sharp when scene is DoF-blurred** → correct behavior for separate translucency; expected and typically desirable
- **Particles appearing blurry with DoF when they should be sharp** → check `Render in Separate Translucency` flag on the material; may need to be enabled
- **Surface Forward Shading on background particle materials** → check Translucency Lighting Mode in material settings; switch to Volumetric PerVertex for background/atmospheric effects

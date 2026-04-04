---
tags:
  - translucency
---

# Unreal Engine 5 Rendering Pipeline – FilterTranslucentVolume

> Stage: **FilterTranslucentVolume**  
> Phase: Translucency Lighting Setup  
> Purpose: Build and spatially filter the low-resolution 3D lighting volume that forward-shaded translucent objects sample for their lighting contribution  
> Pipeline Position: After deferred `Lights` pass, before translucency rendering  
> Performance Impact: **Low** — filter operation on a low-resolution 3D texture

---

## What This Stage Does

Translucent objects in UE5 use **forward shading** — they cannot use the deferred GBuffer path that opaque geometry uses. This means they don't have access to the per-pixel lighting accumulation that the `Lights` pass computed for opaque surfaces. Instead, they sample a pre-filtered **3D lighting volume** that approximates the direct and indirect lighting present in the scene at their world-space location.

This pass builds and filters that volume — a low-resolution 3D texture grid covering the scene — so it's ready for translucency to sample during the translucency rendering pass.

The two operations in this pass:

**1. Volume Injection**
Direct lighting contributions from the scene's lights are injected into the 3D volume. Each voxel in the volume receives light contributions from lights whose influence volumes overlap that voxel — directional light contribution, local light contributions, and sky light ambient. This is a simplified lighting evaluation at voxel granularity rather than per-pixel.

**2. Volume Filtering (The "Filter" Step)**
The populated volume is spatially blurred using a 3D Gaussian or box filter. This smoothing step is essential — the volume is intentionally low-resolution to be affordable, and without filtering the coarse voxel structure would be visible as blocky discontinuities in translucent object lighting. The blur averages adjacent voxels to produce smooth lighting gradients.

---

## Why Translucency Needs Its Own Lighting Volume

Opaque geometry can use the deferred lighting result because:
- It renders into the GBuffer with exact per-pixel positions and normals
- The lighting pass evaluates lights precisely for those pixels
- Results are stored in SceneColor and consumed by subsequent passes

Translucent geometry cannot use this path because:
- It renders forward-shaded with depth sorting, not into the GBuffer
- Multiple translucent layers occupy the same pixels (stacked particles, glass, water spray)
- Writing to GBuffer would overwrite underlying opaque geometry data
- The rendering order makes precise per-pixel deferred evaluation infeasible

The lighting volume solves this by providing a low-cost spatial lookup — a translucent object at any world position can sample the volume to get an approximation of the lighting at that location. The approximation is coarse but sufficient for most translucent content (particles, smoke, glass, water spray) where exact per-pixel accuracy is rarely distinguishable.

> [!NOTE]
> **The translucent volume is a lighting approximation, not an exact evaluation.** A particle system sampling this volume gets a voxel-interpolated lighting estimate — correct in general color and intensity but missing per-pixel shadow precision and specular highlights. This is why particles and smoke look correctly lit by the dominant lights in the scene but don't cast precise specular reflections or receive sharp shadow edges. For translucency that requires more precise lighting (hero transparent objects, glass surfaces), materials can opt into per-pixel forward lighting evaluation at additional cost.

---

## The Volume Structure

The translucent lighting volume is a **3D texture grid** that covers the scene around the camera:

| Property | Default | Notes |
|----------|---------|-------|
| Volume dimensions | 64×64×64 | Controlled by `r.TranslucencyLightingVolumeDim` |
| LOD levels | 2 | Near and far cascades — near is higher effective resolution |
| Cascade count | 2 | Near cascade covers close camera distance; far covers wider range |
| Update frequency | Every frame | Fully rebuilt and filtered each frame |

The two cascade structure (near + far) provides denser voxels near the camera where translucency is most detailed, and coarser voxels for distant translucency where precision matters less — similar in concept to the directional light clipmap for shadow maps.

---

## Execution Model

This is a **GPU compute pass** — the injection and filter operations run as compute shader dispatches on the 3D volume texture.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules injection and filter dispatches |
| **GPU Compute** | Injects lighting into volume voxels; applies 3D spatial filter |

**Cost profile:** Low. The volume is small (64×64×64 = 262,144 voxels), the injection evaluates simplified lighting per voxel, and the filter is a standard 3D blur. Total cost is typically well under 0.5ms in all but the most light-dense scenes.

---

## What Data This Pass Reads and Produces

**Reads:**
- Light data (position, direction, attenuation) for all lights in the scene
- Direct lighting result from the `Lights` pass (for indirect injection)
- Camera position (for cascade placement)

**Produces:**
- **Translucent lighting volume** — 3D texture with filtered lighting data
  - Consumed by: All translucent material rendering passes

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High `r.TranslucencyLightingVolumeDim` | Larger volume = more voxels to inject and filter | Reduce dimension on lower-end platforms; quality difference is usually imperceptible |
| Many lights in volume injection | Each light injects into overlapping voxels — similar to Volumetric Fog light injection | Reduce light count in translucency-heavy areas |
| Multiple active views | Each view builds its own independent volume | Disable translucent volume in scene captures if translucency lighting accuracy is not needed |

---

## Key Systems and Components

### Cascade Structure (Near + Far)
The two-cascade design balances quality against cost. The near cascade covers the region immediately around the camera at effective full volume resolution. The far cascade covers a larger radius at lower effective density. Translucent objects sample the appropriate cascade based on their distance from the camera, with a blended transition between the two.

### 3D Gaussian Filter
The spatial blur that makes the low-resolution volume usable. Without it, voxel boundaries would be visible as hard lighting discontinuities on translucent surfaces — a gradient fog that suddenly shifts in color as it passes through a voxel boundary. The blur averages 3×3×3 or similar neighborhoods to produce smooth gradients that are imperceptible at the volume's effective visual resolution.

### Simplified Light Injection
The injection pass evaluates a simplified version of the lighting BRDF at each voxel center. This is not the full Cook-Torrance GGX evaluation used in the main lighting pass — it's a cheaper directional approximation sufficient for the volume's resolution. Exact BRDF accuracy at voxel granularity is unnecessary and would make injection prohibitively expensive.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass is a setup pass — its cost and quality directly affect the translucency rendering pass that follows, not anything visible here.** If translucent objects (particles, smoke, glass) look incorrectly lit or have visible blocky lighting artifacts, this volume is the first place to investigate. Increasing `r.TranslucencyLightingVolumeDim` improves smoothness; increasing `r.TranslucentVolumeLODBias` reduces effective resolution.

> [!NOTE]
> **Materials can bypass the translucent volume entirely and use per-pixel lighting.** In the material's `Translucency Lighting Mode` setting, switching from `Volumetric PerVertex` to a per-pixel mode enables the material to evaluate lighting more precisely — at higher cost. For hero transparent objects that need accurate lighting (glass with sharp reflections, water surfaces not using SLW), per-pixel modes provide quality the volume cannot match.

---

## How to Debug / Profile

### Unreal Insights

| Event | What It Tells You |
|-------|------------------|
| `FilterTranslucentVolume` | Total volume injection and filter cost |
| `TranslucentLightingVolumeInjection` | Light injection into volume voxels |
| `TranslucentLightingVolumeFilter` | Spatial blur/filter pass |

### Stat Commands

```
stat GPU    // Overall breakdown — FilterTranslucentVolume appears as a small block
```

### Useful Console Variables

```
r.TranslucentLightingVolume 0/1         // Master toggle — disable to skip this pass entirely
                                         // Translucent objects fall back to ambient-only lighting
r.TranslucencyLightingVolumeDim [64]    // Volume resolution per axis — reduce for performance
r.TranslucentVolumeLODBias [0]          // Positive = lower resolution (cheaper, lower quality)
r.TranslucencyLightingVolumeInnerDistance  // Near cascade extent (units from camera)
r.TranslucencyLightingVolumeOuterDistance  // Far cascade extent
```

---

## Optimization Levers

- Reduce `r.TranslucencyLightingVolumeDim` on lower-end platforms — 32×32×32 is often imperceptibly different from 64×64×64 for most particle and smoke content
- Disable the volume entirely (`r.TranslucentLightingVolume 0`) for projects where translucency is purely emissive or ambient-lit and does not need directional lighting from scene lights
- Use per-pixel translucency lighting modes only for hero transparent objects where volume approximation is visually insufficient

---

## Mental Model

Think of FilterTranslucentVolume as:

> *"Bake the scene's lighting into a small 3D grid, then smooth it out — so translucent objects can quickly look up approximately how bright and what color the light is at their location, without needing their own full per-pixel lighting evaluation."*

The volume is deliberately crude. Its value is speed — providing spatially varying lighting to potentially thousands of translucent particles at voxel-lookup cost rather than per-particle per-light evaluation cost. The filter step is what hides the crudeness, blending voxel boundaries into smooth gradients that read as correct soft lighting rather than blocky approximation.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Lights (doc 28) | Direct lighting results feed volume injection |
| Translucency Rendering | Primary consumer of the filtered volume |
| ComputeLightGrid (doc 07) | Light lists used for volume injection |
| Volumetric Fog (doc 20) | Sibling low-resolution volume system — different purpose, similar spatial structure |

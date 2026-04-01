---
tags:
  - rendering-pipeline
  - water
  - depth
  - refraction
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – Single Layer Water Depth Prepass

> Stage: **Single Layer Water Depth Prepass**  
> Phase: Water Rendering Setup  
> Purpose: Write water surface depth into a dedicated buffer so the downstream water shading pass can compute refraction, underwater depth, and correct scene compositing  
> Pipeline Position: After `BasePass`, before `Single Layer Water` shading pass

---

## What This Stage Does

This stage renders the **depth of Single Layer Water surfaces only** — no color, no lighting, no material evaluation. The result is a depth buffer that represents exactly where the water surface sits relative to the camera, used by the subsequent SLW shading pass for several depth-dependent calculations.

Specifically, this pass:
- Rasterizes SLW mesh surfaces in depth-only mode
- Writes water surface depth into a dedicated depth target (separate from or alongside SceneDepth)
- Establishes the depth ordering relationship between the water surface and opaque geometry behind it

---

## What Single Layer Water Is

Single Layer Water (SLW) is a **dedicated shading model and rendering path** in UE5 — not a standard translucent material with a water texture. It requires the `Single Layer Water` shading model in the material editor and uses a sequence of dedicated render passes that don't apply to regular meshes.

The SLW system is designed for lakes, rivers, and ocean surfaces that need:
- Physically-based refraction of geometry seen through the water
- Depth-based extinction (shallow water vs deep water color)
- Correct intersection with shorelines and submerged geometry
- Real-time reflections and underwater fog

**"Single Layer" means exactly that** — the system supports one water surface layer at any screen pixel. Multiple overlapping water planes (e.g. two water bodies at different heights both visible on screen) cause visual artifacts because the shading model assumes a single depth value per pixel.

> [!WARNING]
> **Multiple overlapping SLW surfaces at different depths will cause visual artifacts.** The "single layer" constraint is not a quality setting — it is a hard architectural limit. If your level design requires two water surfaces at different elevations visible simultaneously (e.g. a waterfall pool above a lake), one of them must use a different rendering approach or they will conflict. Plan water body placement to avoid overlapping view regions.

---

## Why This Depth Pass Specifically Exists

The downstream SLW shading pass needs to answer two questions per pixel:
1. **Where is the water surface?** (from this pass)
2. **Where is the geometry behind the water?** (from SceneDepth written in PrePass/BasePass)

The difference between these two depths — `water surface depth − background depth` — gives the **underwater depth** at each pixel. This underwater depth drives:
- **Refraction offset** — shallow areas refract slightly; deep areas refract more
- **Absorption and extinction** — water color shifts as light travels through more water volume
- **Caustics depth** — how far light travels before hitting the seafloor
- **Visibility** — sediment and fog accumulate with depth

Without the water surface depth being separately recorded, the shading pass cannot distinguish "the geometry depth I can see through the water" from "the depth of the water surface itself." Both would be blended in SceneDepth and the calculation would be undefined.

---

## Execution Model

This is a standard **raster depth pass** — draw commands for SLW meshes submitted from the render thread, rasterized on GPU with depth-only shaders.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Submits draw commands for SLW meshes |
| **GPU** | Rasterizes water mesh vertices and writes depth per covered pixel |

Unlike most geometry in the scene, SLW meshes are typically large planar meshes — vertex count is usually low, making this pass vertex-cheap. The cost is primarily in **pixel fill rate** (water surface screen coverage) rather than vertex processing.

---

## What Data It Produces

| Output | Consumers |
|--------|-----------|
| Water surface depth buffer | SLW shading pass (refraction, extinction, caustics) |
| Depth ordering contribution to SceneDepth | Fog, SSR depth tests, Lumen screen traces near water |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large water screen coverage | Fill rate scales with visible water pixel count | Use fog, shorelines, and camera angles to limit maximum water visibility |
| Multiple visible water bodies | Each water body is a separate draw — more fill and raster work | Limit simultaneously visible water bodies; avoid overlapping views |
| High wave vertex displacement | Wave simulation in water materials adds per-vertex cost | Simplify displacement at LOD distance; reduce wave tessellation on distant water |
| Multiple active views | Each view runs an independent depth pass for water | Disable water in scene captures where water accuracy is not needed |
| Water visible in scene captures | Captures render water depth independently | Disable SLW in captures or use a simplified substitute |

---

## Key Systems and Components

### Single Layer Water Shading Model
The material shading model that drives the entire SLW pipeline. Materials must be explicitly set to this shading model to use the dedicated SLW rendering passes. Regular translucent materials do not go through this prepass or the downstream SLW shading pass.

### Underwater Depth Computation
The core calculation the depth prepass enables. By comparing water surface depth (this pass) against background SceneDepth (PrePass/BasePass), the SLW shading pass derives underwater depth per pixel. This single value drives refraction magnitude, water color absorption, and extinction — the primary visual characteristics that distinguish shallow from deep water.

### Wave Displacement
SLW wave simulation is driven by the material's world position offset inputs (controlled by the material's wave expressions, not traditional WPO per se). This runs in the vertex shader during this depth pass. Complex wave expressions with many octaves or expensive noise functions add per-frame vertex cost proportional to water mesh subdivision.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass is normally very cheap** — typically under 0.3ms unless water covers a large portion of the screen or multiple water bodies are active. Unlike geometry-heavy passes, the SLW mesh is usually a simple tessellated plane with low vertex count. If this pass appears expensive, the cause is almost always screen coverage (large water plane filling the view) or multiple simultaneously visible water bodies.

> [!NOTE]
> **SLW is not the only way to render water in UE5.** The Epic Water plugin (which provides rivers, lakes, and ocean bodies) uses SLW internally. Simple decorative water (small puddles, fountains) may use standard translucent or masked materials instead, which do not go through this pass. Only `Single Layer Water` shading model materials trigger this prepass.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `SingleLayerWaterDepthPrepass` | Total depth pass cost for all SLW surfaces |
| `WaterDepthPrepass` | Alternate event name depending on engine version |

> [!TIP]
> If the pass is expensive, check how much of the screen is covered by water at your worst-case camera angle. Since cost scales with fill rate, reducing the camera's view of open water — through shoreline occluders, fog distance, or redesigned camera positions — is more effective than reducing mesh quality.

### Stat Commands

```
stat GPU    // Overall GPU breakdown — SingleLayerWaterDepthPrepass appears as a block here
```

### Useful Console Variables

```
r.Water.SingleLayer.Refraction 0/1          // Toggle refraction on SLW — disabling eliminates
                                             // the underwater depth calculation that drives this pass
r.Water.SingleLayer.ShadersSupportDistanceFields 0/1  // Toggle distance field support for water
```

---

## Optimization Levers

### Water Content
- Simplify wave displacement — reduce noise octaves and expression complexity in wave materials
- Avoid subdividing water meshes beyond what wave displacement visually requires; subdivision multiplies vertex count without visual benefit at distance
- Use distance-based LOD to reduce wave complexity for water far from the camera

### Level Design
- Avoid wide-open water vistas where the water surface fills most of the screen — this is the highest-impact optimization
- Use fog distance, shoreline geometry, and island/terrain occluders to naturally cap how much water is visible simultaneously
- Avoid placing multiple water bodies at different elevations in overlapping screen regions

### Views and Captures
- Disable SLW or substitute a cheaper water representation in scene captures where water accuracy is not needed

---

## Mental Model

Think of this stage as:

> *"Stamp where the water surface is in depth, separate from everything else — so the water shader can see both the surface and what's behind it and compute what's between them."*

The depth prepass creates the reference point the water shading pass needs to do its underwater calculations. Without it, the shading pass has no way to know where "the surface" is separately from "the seafloor" — both would be mixed into SceneDepth and the refraction math breaks.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Single Layer Water Shading Pass | Primary consumer — uses water depth to compute refraction and extinction |
| SceneDepth (PrePass/BasePass) | Compared against water depth to derive underwater depth per pixel |
| SSR on Water | Uses water surface depth for reflection ray origin |
| Lumen Reflections | Can use water surface data for reflection integration |
| Height Fog | Samples depth near water for correct fog intersection |

---

## Red Flags to Watch For

- **`SingleLayerWaterDepthPrepass` > 0.5ms** → water covering large screen area; check worst-case camera angles; use fog and occlusion to limit visible water
- **Cost spikes when camera looks directly down at water** → maximum fill rate scenario; add underwater fog to limit depth visibility
- **Visual refraction artifacts at water body boundaries** → possible overlapping SLW planes; check for multiple water bodies at different depths in the same screen region
- **Water depth pass appearing in scene captures unexpectedly** → captures rendering water independently; disable SLW in captures where not needed

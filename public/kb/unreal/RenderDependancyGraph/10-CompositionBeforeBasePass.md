---
tags:
  - sky-atmosphere
---

# Unreal Engine 5 Rendering Pipeline – Composition Before BasePass

> Stage: **Composition Before BasePass**  
> Phase: Pre-Geometry Composition  
> Purpose: Initialize SceneColor, inject sky atmosphere aerial perspective, and composite volumetric cloud backgrounds before opaque geometry is shaded  
> Pipeline Position: After `HZB (BuildHZB)` and `SkyAtmosphereLUTs`, immediately before `BasePass`

---

## What This Stage Does

This stage establishes the **background layer of SceneColor** — the sky, atmosphere, and any environment content that must exist behind opaque geometry before BasePass writes over it pixel by pixel.

The specific work performed depends on which features are enabled, but the primary operations are:

**SceneColor Initialization**
SceneColor is cleared or initialized to the background sky color. This is the render target BasePass will write geometry into. If it isn't set up first, geometry will composite over undefined data.

**Sky Atmosphere Aerial Perspective Injection**
The Aerial Perspective LUT computed in the previous stage (doc 09) is injected into SceneColor and a separate aerial perspective buffer. This is the step that actually applies distance haze to the scene — the LUT was precomputed earlier, this is where its results enter the color pipeline.

**Volumetric Cloud Background Composition**
If volumetric clouds are enabled, this is where the **cloud background ray march** executes — a full-screen volumetric trace for cloud coverage visible against the sky behind all geometry. This is the most expensive operation in this stage by a significant margin.

**Pre-Exposure Setup**
Scene exposure is applied to sky contributions before geometry shading to maintain correct luminance relationships throughout the frame.

---

## Why This Stage Exists

BasePass writes geometry material data into GBuffer targets starting from whatever is already in SceneColor. Background environment content — sky, aerial perspective, clouds — must already be present in SceneColor before geometry composites over it. If these were rendered after BasePass:

- Sky would incorrectly appear on top of opaque geometry
- Aerial perspective couldn't correctly blend with geometry pixels
- Cloud coverage behind geometry would composite in the wrong order
- Depth-based blending of atmosphere with geometry would be incorrect

The ordering is a hard constraint: background must precede foreground.

---

## Relationship to SkyAtmosphereLUTs (Doc 09)

This stage is the **execution point** for the atmosphere data built in the previous stage. The LUT build pass precomputed scattering tables; this pass samples those tables and writes the results into SceneColor and atmosphere buffers that downstream passes read.

If the LUTs were rebuilt this frame (atmosphere parameters changed, camera moved), the new results are applied here. If the LUTs were cached, this stage samples the cached version — the LUT build cost was zero, but the apply cost here is always paid.

---

## Execution Model

This stage is primarily **fullscreen GPU work** — pixel shaders and compute dispatches that write to every pixel of SceneColor and atmosphere buffers. Cost scales directly with render resolution.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules fullscreen pass dispatches in order |
| **GPU** | Executes fullscreen pixel/compute shaders for each operation |

---

## What Data It Produces

| Output | Consumers |
|--------|-----------|
| Initialized SceneColor (with sky/atmosphere background) | BasePass, all subsequent color passes |
| Aerial perspective buffer | BasePass atmosphere blending, translucency, height fog |
| Cloud coverage and shadow data | Lighting passes, height fog, translucency |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Volumetric clouds enabled | Full-screen volumetric ray march runs here for cloud background region | Reduce cloud tracing quality; limit cloud layer extent; disable if not visible |
| High render resolution | All operations here are fullscreen — cost scales directly with pixel count | Tune screen percentage; clouds support separate resolution scaling |
| Sky Atmosphere aerial perspective | Aerial Perspective LUT injection is a fullscreen write | Reduce LUT depth slices via `r.SkyAtmosphere.AerialPerspectiveLUT.Depth` |
| Multiple active views | Each view runs its own full composition pass | Minimize scene captures; disable sky atmosphere on captures where not needed |
| Custom pre-BasePass passes | Any additional fullscreen effects inserted here add fill-rate cost | Audit custom passes scheduled here; defer to post-processing where possible |

> [!WARNING]
> **Volumetric cloud background composition is a full-screen volumetric ray march — it is not a lightweight blend.** When clouds are enabled, this is one of the most expensive fullscreen operations in the pre-geometry phase. The cloud trace steps through a volumetric density field for every pixel where sky is visible. Cloud quality CVars (`r.VolumetricCloud.ShadowTracingDistance`, `r.VolumetricCloud.ViewRaySampleCountScale`) directly control this cost. Do not treat clouds as a "free" background feature in performance-constrained builds.

> [!WARNING]
> **Custom pre-BasePass passes that sample SceneDepth will read incomplete depth.** At this point in the pipeline, SceneDepth contains PrePass depth for traditional meshes but Nanite geometry depth has not yet been emitted (NaniteEmitDepthTargets runs before this stage in most configurations, but ordering can vary). Any custom effect here that assumes complete scene depth will have holes where Nanite-only geometry exists. Verify depth completeness before scheduling custom passes here.

---

## Key Systems and Components

### Aerial Perspective Injection
The step that applies the Aerial Perspective LUT (built in SkyAtmosphereLUTs) to SceneColor. This is what makes distant geometry appear hazy. The injection writes to both SceneColor background pixels (sky region) and a separate aerial perspective buffer that translucency and geometry passes sample from to add per-fragment atmospheric haze.

### Volumetric Cloud Ray March (Background)
The most expensive operation in this stage when clouds are active. A full-screen compute dispatch traces rays through a procedural noise-based cloud density volume for all pixels where sky is visible behind geometry. The cloud layer's aerial perspective and self-shadowing are computed here. This is the "background" cloud pass — clouds visible in front of geometry get a separate composition pass after BasePass.

### SceneColor Initialization
The clear or initialization of the SceneColor render target to the sky background value. This sets the "starting state" of the color buffer before any geometry writes over it. An uninitialized SceneColor would result in undefined pixel values appearing wherever no geometry covers the screen.

---

## 📋 Reader Notes

> [!NOTE]
> **This stage is normally cheap unless volumetric clouds are enabled.** Without clouds, the primary work is aerial perspective injection and SceneColor initialization — typically under 0.3ms. Clouds can push this stage to 1–3ms depending on quality settings and coverage. If this stage appears unexpectedly expensive, clouds are the first thing to check.

> [!NOTE]
> **"Composition Before BasePass" is a container stage whose contents vary by project.** The operations described here are the standard UE5 features that run in this slot. Custom render passes inserted here by plugins or project code will also appear under this stage in Unreal Insights. If the cost is unexpected, check for custom passes before assuming a standard feature is the cause.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `CompositionBeforeBasePass` | Total stage time — container for all operations below |
| `RenderVolumetricCloud` | Cloud background ray march cost — usually the dominant sub-event |
| `SkyAtmosphere` | Aerial perspective injection cost |

> [!TIP]
> Expand the `CompositionBeforeBasePass` event in Unreal Insights to see which sub-operations are consuming time. If `RenderVolumetricCloud` dominates, reduce cloud quality CVars. If aerial perspective injection dominates, reduce `r.SkyAtmosphere.AerialPerspectiveLUT.Depth`. If neither is obvious, check for custom passes inserted by project code.

### Stat Commands

```
stat GPU    // Overall GPU breakdown — CompositionBeforeBasePass appears as a block here
```

### Useful Console Variables

```
r.VolumetricCloud 0/1                           // Toggle volumetric clouds entirely
r.VolumetricCloud.ViewRaySampleCountScale       // Scale cloud ray march sample count — reduce for perf
r.VolumetricCloud.ShadowTracingDistance         // Cloud self-shadow trace distance — reduce for perf
r.SkyAtmosphere.AerialPerspectiveLUT.Depth      // Depth slices in aerial perspective LUT — see doc 09
```

---

## Optimization Levers

### Volumetric Clouds (Highest Impact)
- Reduce `r.VolumetricCloud.ViewRaySampleCountScale` to lower per-pixel cloud trace cost
- Reduce cloud layer extent and density to minimize the volume that needs tracing
- Disable clouds entirely on lower-end platforms and substitute a static skybox

### Resolution
- Lower screen percentage — all fullscreen operations here scale exactly with resolution
- Clouds support separate resolution scaling via `r.VolumetricCloud.ViewRaySampleCountScale`; lower cloud quality independently of overall resolution

### Views and Captures
- Disable sky atmosphere contribution on scene captures where atmospheric accuracy is not needed
- Minimize active scene captures — each runs a full composition cycle independently

---

## Mental Model

Think of this stage as:

> *"Fill in the sky and atmosphere behind where the world will be — so when geometry is painted over it, the background is already correct."*

This stage is the handoff point from environment precompute (atmosphere LUTs, cloud setup) to geometry rendering. Everything that runs here is establishing the canvas that BasePass will draw on. The cheaper this canvas is to set up, the more frame budget remains for the geometry and lighting that the player actually sees.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| SkyAtmosphereLUTs (doc 09) | LUTs precomputed there; aerial perspective injected here |
| Volumetric Clouds | Background cloud ray march executes here |
| BasePass | Primary consumer of the initialized SceneColor produced here |
| Height Fog | Aerial perspective buffer produced here feeds fog passes |
| NaniteEmitDepthTargets | Depth must be complete before custom passes here sample SceneDepth |

---

## Red Flags to Watch For

- **`CompositionBeforeBasePass` > 1ms without clouds** → check for custom pre-BasePass passes or unexpectedly large aerial perspective injection; aerial perspective should be under 0.3ms
- **`RenderVolumetricCloud` dominant within this stage** → cloud quality too high for platform; reduce `r.VolumetricCloud.ViewRaySampleCountScale`
- **Cost spiking only in specific camera positions** → camera revealing maximum cloud coverage or open sky; cloud cost scales with visible sky area
- **SceneColor artifacts or missing atmosphere on geometry edges** → aerial perspective injection may have failed or composited in wrong order; check custom pass ordering
- **Multiple scene captures adding composition cost** → each capture runs independently; disable or throttle

---
tags:
  - rendering-pipeline
  - shadows
  - virtual-shadow-maps
  - nanite
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – Shadow Depths

> Stage: **Shadow Depths**  
> Phase: Shadow Rendering  
> Purpose: Render scene geometry into the shadow map pages identified by VSM Page Allocation — only dirty pages are rendered  
> Pipeline Position: After `VSM Page Allocation`, before deferred lighting and shadow projection

---

## What This Stage Does

Shadow Depths renders scene geometry **from each light's perspective** to populate the shadow map pages that were flagged as dirty in the previous stage (VSM Page Allocation). Only dirty pages are rendered — pages with valid cached content are skipped entirely.

This stage produces:
- **VSM page contents** — geometry depth rendered into Virtual Shadow Map pages for directional, spot, and point lights
- **Traditional shadow depth atlases** — for any lights not using VSM (legacy path)

The rendering is depth-only — no material color, no lighting evaluation. Shadow shaders are deliberately simplified: opaque geometry uses minimal vertex processing, masked materials add clip() evaluation but no color.

---

## The Critical Optimization: Static Nanite + Stationary Lights

This is the most important performance property of UE5 shadow rendering and deserves emphasis before anything else.

**Static Nanite geometry + Stationary lights = near-zero ongoing shadow depth cost.**

When a VSM page for a stationary light containing only static Nanite geometry has been rendered once:
- The page is cached in the VSM pool
- No shadow caster changed → page remains valid
- ShadowDepths skips it next frame
- And the frame after that
- And every subsequent frame until something changes

In a well-authored game scene, this means the vast majority of environment shadow rendering happens **once on first view and never again**. The ongoing ShadowDepths cost is then dominated only by:
- Pages under Movable lights (invalidated every frame)
- Pages touched by dynamic objects (characters, physics, animated props)
- New pages revealed by camera movement (directional light clipmap edges)

> [!NOTE]
> **This is why light Mobility is the most impactful shadow optimization in UE5.** It's not about visual quality trade-offs — Stationary lights produce dynamic real-time shadows just like Movable lights. The difference is that Stationary lights can cache shadow pages for static geometry. A scene that switches from all Movable to all Stationary lights can see ShadowDepths cost drop by 80–90% with no visual change in static areas.

---

## Two Rendering Systems

Shadow Depths may run two distinct rendering paths simultaneously depending on project configuration.

### VSM Shadow Depths (Primary — UE5 Default)
- Renders into the Virtual Shadow Map atlas pages identified by page allocation
- Only dirty pages are rendered — cached pages are skipped
- Nanite geometry uses Nanite's GPU-driven shadow path (see below)
- Non-Nanite geometry uses traditional raster with depth-only shaders

### Traditional Per-Object Shadow Maps (Legacy)
- Fixed-resolution shadow map atlases rendered every frame
- No page caching — entire frustum re-rendered each frame
- Still used for specific cases not covered by VSM (certain translucency shadow setups, legacy configurations)
- Significantly more expensive per light than VSM when static content is dominant

> [!NOTE]
> **In UE5 projects with VSM enabled (the default), most lights use the VSM path.** Check `r.Shadow.Virtual.Enable` to confirm VSM is active. If it's disabled, all shadow costs are traditional per-frame renders with no caching — dramatically more expensive for scenes with static content.

---

## Nanite Shadow Rendering Path

Nanite geometry does not use traditional vertex-by-vertex shadow rendering. For shadow depth passes, Nanite uses its own **GPU-driven cluster visibility and rasterization pipeline** — similar to the main NaniteVisibilityBuffer pass but optimized for the light's perspective.

This means:
- No CPU-issued draw calls per Nanite mesh
- GPU-driven cluster culling from the light's viewpoint
- Hardware + software rasterization split (same as main view)
- Significantly cheaper per triangle than traditional shadow rendering for dense geometry

> [!WARNING]
> **WPO on Nanite meshes disables the efficient Nanite shadow path for that mesh — the same hard cutoff as in every other Nanite pass.** A Nanite mesh with WPO material falls back to traditional vertex rasterization for shadow rendering. In a dense scene, a handful of large WPO Nanite meshes can produce shadow depth cost exceeding all the static Nanite content combined. Audit WPO on Nanite geometry specifically when shadow cost is high.

---

## What About Point Lights?

Point lights present the most expensive shadow configuration because they must shadow in all directions.

**Traditional point light shadows:** 6 separate cube face renders — 6× the cost of a spot light at the same resolution.

**VSM point lights:** Uses a more efficient projection that avoids 6 full-face renders, but still must cover all directions. Virtual page management limits the per-frame cost by only updating visible and dirty pages.

> [!WARNING]
> **Shadow-casting point lights are the most expensive light type in the pipeline.** Even with VSM, a point light that casts shadows in all directions requires more pages to allocate, more geometry to render, and more shadow lookups during deferred lighting than an equivalent directional or spot light. Prefer spot lights with tight cone angles wherever a point light's omnidirectional coverage isn't needed. Disable shadows on point lights used primarily for local fill or atmosphere.

---

## Threading Model

Traditional shadow depth rendering uses the same **parallel command list architecture** as BasePass and PrePass.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Distributes shadow draw commands per light view across parallel lists |
| **Task Graph (Workers)** | Each worker builds shadow draw commands for a subset of geometry |
| **RHI Thread** | Merges and submits to GPU |
| **GPU** | Rasterizes geometry for each shadow view; Nanite runs GPU-driven shadow path |

Because only dirty pages are rendered, the CPU command list build scales with dirty page count, not total visible geometry. Static scenes with stationary lights have minimal CPU work in this stage.

---

## What Data It Produces

| Output | Format | Consumers |
|--------|--------|-----------|
| VSM page depth contents | 16-bit or 32-bit depth per page | Shadow projection during deferred lighting |
| Traditional shadow depth atlases | Per-light depth maps | Shadow projection for legacy lights |

**Consumed downstream by:**
- **Deferred Lighting** — compares scene depth against shadow map depth per pixel to determine shadowing
- **Lumen** — shadow data contributes to Lumen surface cache direct lighting
- **Translucency shadowing** — translucent surfaces can receive VSM shadows with appropriate settings

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Movable shadow-casting lights | All pages invalidated every frame — no caching | Convert to Stationary wherever per-frame movement isn't needed |
| Many dynamic shadow casters | Pages under all nearby lights invalidated per caster per frame | Disable shadow casting on non-hero dynamic objects |
| Point lights with shadows | All-direction shadow coverage requires many pages | Use spot lights with tight cones; disable point light shadows for fill lights |
| Non-Nanite static geometry | Traditional raster cost per shadow render — no GPU-driven path | Enable Nanite on dense static shadow casters |
| Dense masked foliage casting shadows | `clip()` prevents hardware raster optimization; heavy per-page cost | Disable shadow casting on foliage beyond close range; use `r.Shadow.RadiusThreshold` |
| Large shadow distance | More clipmap levels for directional light; more pages overall | Reduce `r.Shadow.DistanceScale`; use fog to visually justify shorter distances |
| WPO on Nanite shadow casters | Nanite GPU shadow path disabled; falls back to traditional raster | Avoid WPO on Nanite geometry; use non-Nanite for animated hero surfaces |

---

## Key Systems and Components

### VSM Dirty Page Rendering
ShadowDepths only renders pages that Page Allocation marked as dirty. The mapping from dirty virtual pages to physical pool entries drives which draw calls are issued. A frame with zero dirty pages (impossible in practice but approached by well-authored static scenes) would see ShadowDepths cost approach zero.

### Nanite GPU-Driven Shadow Path
The shadow-specific version of Nanite's visibility + rasterize pipeline. Runs from the light's perspective instead of the camera's. Handles cluster-level culling, screen-space error LOD, and hardware/software rasterization split — all from the light viewpoint. Result: dense Nanite geometry can shadow a large area at effectively lower per-triangle cost than traditional meshes.

### Shadow Radius Threshold
An automatic optimization: lights with a projected screen radius below a configurable threshold (`r.Shadow.RadiusThreshold`) have their shadow casting disabled automatically. This culls shadow rendering for small distant lights without requiring per-light manual configuration. Increasing the threshold reduces shadow quality but eliminates shadow depth cost for many lights.

### Masked Material Shadow Cost
Masked materials in shadow rendering require the `clip()` instruction per fragment — preventing hardware early-Z optimization. A dense foliage field with masked alpha casting shadows is expensive in the shadow pass for the same reason it's expensive in PrePass and BasePass: no raster culling is possible until the shader evaluates whether to discard.

---

## 📋 Reader Notes

> [!NOTE]
> **Shadow Depths and VSM Page Allocation must be understood together.** Page Allocation decides what to render; Shadow Depths renders it. High Page Allocation cost with low Shadow Depths cost = good caching but expensive analysis. Low Page Allocation cost with high Shadow Depths cost = pages are being quickly identified but are expensive to render. Profile both stages before optimizing.

> [!NOTE]
> **`stat shadow` is the fastest way to understand shadow cost structure.** It breaks down shadow time by light type (directional, spot, point) and shows cached vs rendered page counts. Before opening Unreal Insights for shadow investigation, `stat shadow` in-editor gives a quick read on where the cost is concentrated.

> [!NOTE]
> **Shadow quality settings (`r.Shadow.Virtual.ResolutionLodBias`) are separate from shadow distance.** Resolution LOD bias controls texel density in VSM pages (positive = lower resolution = cheaper and blurrier). Shadow distance controls how far from camera shadows are computed. These are independent levers — you can have sharp nearby shadows with short distance, or blurry shadows with long distance. Tune them separately for your quality/performance target.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for:

| Event | What It Tells You |
|-------|------------------|
| `ShadowDepths` | Total shadow depth rendering cost |
| `VSMShadowDepths` | Virtual Shadow Map specific rendering |
| `ShadowDepths_Directional` | Directional light (sun) shadow cost specifically |
| `ShadowDepths_Spot` | Spot light shadow rendering |
| `ShadowDepths_Point` | Point light shadow rendering — typically highest per-light cost |
| `NaniteShadowDepths` | Nanite GPU-driven shadow path cost |

> [!TIP]
> If `ShadowDepths_Point` dominates, audit point light shadow usage — consider converting to spot lights or disabling shadows on point lights used for fill. If `NaniteShadowDepths` is absent but the scene is Nanite-heavy, WPO or masked materials may be forcing fallback to traditional raster for those meshes. Check `r.Shadow.Virtual.Visualize 1` to see page distribution and dirty rates.

### Debug Visualizations

```
r.Shadow.Virtual.Visualize 1        // Page residency: green = cached, red = dirty (being rendered)
r.Shadow.DrawPreshadowFrustums 1    // Draws shadow frustum wireframes in viewport —
                                     // useful to see which lights are casting and their extents
```

### Stat Commands

```
stat GPU      // Overall GPU breakdown — ShadowDepths appears as a block
stat shadow   // Detailed shadow breakdown by light type; cached vs rendered page counts
```

### Useful Console Variables

```
r.Shadow.Virtual.Enable 1/0              // Toggle VSM; disabling falls back to traditional CSM
r.Shadow.Virtual.ResolutionLodBias [0]   // Positive = lower res VSM pages = cheaper/blurrier
r.Shadow.RadiusThreshold [0.03]          // Auto-disable shadows for lights below this screen radius
                                          // Increase to cull more distant lights
r.Shadow.DistanceScale [1.0]             // Global shadow distance multiplier — reduce to limit clipmap
r.Shadow.MaxResolution [2048]            // Max traditional shadow map resolution per light
r.Shadow.Virtual.Cache.StaticSeparate 0/1  // Separate static/dynamic caches to prevent cross-invalidation
```

---

## Optimization Levers

### Lighting (Highest Impact)
- Convert all non-animating lights to **Stationary** — this is always the first and most impactful change
- Replace shadow-casting point lights with spot lights wherever omnidirectional coverage isn't required
- Disable shadow casting on lights below a certain size threshold; increase `r.Shadow.RadiusThreshold` to automate this

### Geometry
- Enable Nanite on all dense static shadow casters — rocks, buildings, cliffs, large props
- Disable shadow casting on small props (`Cast Shadow` unchecked in mesh component settings)
- Disable shadow casting on foliage beyond close range; use `r.Shadow.RadiusThreshold` for automatic distance-based culling

> [!WARNING]
> **Masked foliage that casts shadows is a compounding cost across three passes: PrePass, BasePass, and ShadowDepths.** Each of these passes evaluates `clip()` per fragment for masked materials, preventing hardware optimizations in all three. Dense foliage fields with shadow casting enabled and masked materials are frequently the top shadow depth cost in outdoor scenes. Disable shadow casting on foliage beyond the near distance and use simple proxy meshes for far-distance shadow representations.

### Shadow Distance
- Reduce `r.Shadow.DistanceScale` to limit the directional light clipmap extent — fewer levels, fewer pages
- Combine with fog and atmospheric effects to visually justify shorter shadow distances

### VSM Configuration
- Enable `r.Shadow.Virtual.Cache.StaticSeparate 1` to prevent dynamic object movement from invalidating static geometry's shadow pages
- Tune `r.Shadow.Virtual.MaxPhysicalPages` to match actual scene page demands (use `r.Shadow.Virtual.ShowPageUsage 1` to measure)

---

## Mental Model

Think of this stage as:

> *"Render the scene from each light's point of view — but only the parts that have changed since last frame, and only as deep as the camera can actually see shadows."*

Shadow Depths is the beneficiary of everything that came before it. Good PrePass quality → better HZB → better page visibility culling in Page Allocation → fewer dirty pages here. Static geometry with stationary lights → VSM caches everything → zero cost here for those objects. Nanite-heavy scenes → GPU-driven shadow path → efficient per-cluster shadow rasterization.

The key insight is that **shadow depth cost is almost entirely determined by authoring decisions made long before this pass runs** — light mobility, geometry type (Nanite vs traditional), shadow casting settings on individual meshes, and whether dynamic objects share space with shadow-casting lights. The renderer's job is to execute as efficiently as possible given those decisions; the artist and designer's job is to make decisions that keep dirty page counts low.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| VSM Page Allocation (doc 15) | Produces the dirty page list that drives all rendering here |
| HZB | Feeds page visibility culling in allocation — indirect input to what gets rendered here |
| Nanite | Provides GPU-driven shadow path for Nanite geometry — significantly cheaper than traditional |
| Deferred Lighting | Primary consumer — projects shadow map depth against scene depth per pixel |
| Lumen | Shadow data contributes to surface cache direct lighting |
| Light Mobility | Stationary vs Movable is the primary determinant of per-frame page dirty count |

---

## Red Flags to Watch For

- **`ShadowDepths` > 3ms** → check `stat shadow` for breakdown by light type; identify which light category dominates
- **`ShadowDepths_Point` dominant** → too many shadow-casting point lights; convert to spots or disable shadows
- **`r.Shadow.Virtual.Visualize` showing mostly red pages** → poor cache efficiency; trace to Movable lights or dynamic objects invalidating pages
- **High shadow cost despite mostly static scene** → lights may be set to Movable; audit Light Mobility settings via World Outliner filtering
- **`NaniteShadowDepths` absent in Nanite-heavy scene** → WPO or masked materials on Nanite meshes forcing traditional shadow raster; check material settings
- **Masked foliage with `Cast Shadow` enabled across large areas** → disable shadow casting on foliage beyond near range; high compounding cost across PrePass/BasePass/ShadowDepths
- **Shadow cost spiking specifically when characters move** → dynamic objects invalidating VSM pages in nearby lights; reduce shadow-casting light count in character-dense areas or enable `r.Shadow.Virtual.Cache.StaticSeparate 1`

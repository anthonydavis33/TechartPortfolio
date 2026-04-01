---
tags:
  - lighting
  - light-grid
  - deferred-rendering
---

# Unreal Engine 5 Rendering Pipeline – Compute Light Grid

> Stage: **Compute Light Grid**  
> Phase: Lighting Setup / Tiled & Clustered Light Binning  
> Purpose: Bin local lights into a screen-space structure so each pixel during lighting only evaluates lights that actually affect it  
> Pipeline Position: After `NaniteEmitDepthTargets`, before `BasePass` and deferred lighting passes

---

## What This Stage Does

This stage builds a **light grid** — a data structure that spatially organizes all local lights in the scene relative to screen space. The renderer divides the screen into tiles and, optionally, further divides each tile into depth slices. Each cell in this structure stores a list of lights whose influence volumes overlap it.

During lighting passes, each pixel looks up only the lights in its grid cell rather than iterating over every light in the scene. This is what keeps dynamic lighting scalable as light count grows.

Two grid architectures are used depending on the rendering path:

**Tiled (2D)** — Screen divided into fixed-size 2D tiles (e.g. 8×8 pixels). Each tile stores a light list. No depth information — a light near and far from the camera in the same screen tile both appear in that tile's list.

**Clustered (3D)** — Screen tiles further subdivided into depth slices, creating a 3D volume of cells (frustum clusters). Each cluster stores a light list scoped to a specific depth range. Used for **forward shading** and translucency lighting — more accurate light assignment, higher build cost.

> [!NOTE]
> UE5 uses **clustered lighting for forward-shaded translucency** and **tiled lighting for deferred opaque passes**. Most scenes use both paths simultaneously. The clustered build is more expensive than the tiled build but enables accurate lighting on translucent surfaces without a full deferred pass.

---

## What Gets Binned — and What Doesn't

Understanding what actually enters the light grid prevents over-counting lights as a performance problem.

**Enters the light grid:**
- Point lights (Movable and Stationary)
- Spot lights (Movable and Stationary)
- Rect lights (Movable and Stationary)
- Reflection capture actors (sphere and box captures)
- Some local shadow-casting lights

**Does NOT enter the light grid:**
- Directional lights — evaluated globally per-pixel, not per-tile
- Sky light — evaluated via Lumen or a separate ambient path
- Static lights with baked lighting — contribution stored in lightmaps, not evaluated at runtime

> [!NOTE]
> **Directional lights have zero cost in this stage regardless of scene complexity.** All light grid optimization is about local lights — point, spot, and rect. If your scene relies primarily on a directional sun and baked static lights, this pass will be nearly free. High cost here always traces back to local light count, radius, and overlap.

---

## Why This Stage Exists

Without a light grid, deferred lighting cost scales as:

> **pixels × total light count**

With a light grid, it scales as:

> **pixels × average lights per grid cell**

In a scene with 100 dynamic point lights where each pixel is only near 3–4 lights at any moment, the light grid reduces per-pixel lighting work by roughly 96%. The grid build cost is a fixed upfront investment that pays back many times over in the deferred lighting pass.

---

## Execution Model

This is a **GPU compute pass** — there are no CPU draw calls. The CPU submits a compute dispatch; the GPU builds the grid entirely on its own by testing each light's influence volume against each tile or cluster cell.

The cost appears in the **GPU track in Unreal Insights** only. There is minimal render thread footprint for this stage. Expensive grid builds are always a GPU problem caused by light count, radius, or overlap — not a CPU problem.

---

## What Data It Produces

**Grid Structures:**
- Per-tile light index lists (2D tiled path — deferred opaque)
- Per-cluster light index lists (3D clustered path — forward/translucency)
- Per-cell light counts
- Indices into the global light buffer

**Consumed downstream by:**

| Pass | How It Uses the Light Grid |
|------|--------------------------|
| Deferred Lighting | Looks up per-tile light lists to limit per-pixel light evaluation |
| Forward Shading (Translucency) | Uses clustered lists for accurate per-fragment lighting |
| Lumen Lighting Integration | Consults light grid for local light contributions to indirect lighting |
| Reflection / Specular Passes | Reflection captures retrieved from grid during specular evaluation |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High local light count | More lights to bin into every overlapping cell | Reduce total dynamic light count; convert to Stationary or Static where possible |
| Large light radii | A single large light can overlap hundreds of tiles | Reduce `Attenuation Radius` to match actual visual influence |
| Heavy light overlap | Dense overlapping lights create large per-tile lists | Spread lights spatially; avoid stacking multiple lights in small areas |
| High render resolution | More tiles to build and populate | Tune screen percentage per platform |
| Multiple active views | Each view requires an independent grid build | Minimize scene captures and extra views |
| Movable lights that don't animate | Grid rebuilt every frame even if light doesn't move | Set non-animating lights to Stationary or Static |
| Many reflection capture actors | Captures are binned like lights — high counts add grid work | Reduce reflection capture count; use fewer larger captures |

> [!WARNING]
> **A single light with a large radius covering most of the screen is often worse than many small lights.** Grid cost is not just about light count — it scales with how many tiles each light's projected radius overlaps. One point light with a 5000-unit radius in an open scene may overlap every tile and every depth cluster, contributing more grid build cost than a dozen small lights with appropriate radii. Always set `Attenuation Radius` to the minimum needed for the visual result.

> [!WARNING]
> **Movable lights rebuild the grid every frame even if they never move.** The light grid is a dynamic structure; any Movable light participates in every frame's rebuild regardless of whether it animated. Convert lights that are placed in the world and left static to **Stationary** (if they shadow) or **Static** (if fully baked) — this removes them from the dynamic grid entirely and has no visual cost in static scenes.

---

## Key Systems and Components

### Tiled Light Lists (2D)
The data structure for deferred opaque lighting. Screen is divided into fixed-size tiles (default 8×8 pixels, tunable via `r.LightGridPixelSize`). Each tile holds a list of local lights whose radius projects onto it. Built each frame for all Movable and Stationary local lights. Read directly by the deferred lighting compute pass.

### Clustered Light Lists (3D)
The data structure for forward-shaded surfaces (primarily translucency). Same tile grid as tiled, but each tile is further divided into depth slices creating a 3D frustum of cells. More expensive to build than tiled — each light must be tested against more cells — but provides depth-accurate light assignment that tiled cannot. Tunable via `r.Forward.LightGridSizeZ` (depth slice count).

### Reflection Capture Binning
Reflection capture actors (sphere captures, box captures) are binned into the light grid alongside local lights. This is how specular evaluation finds the closest or most relevant capture for any given pixel. High reflection capture counts add to grid build cost proportionally.

### Light Influence Volume Testing
For each light, the GPU tests its sphere (or cone, for spotlights) influence volume against each grid cell's axis-aligned bounds. The test is a simple geometric intersection. The cost scales with `light count × cell count` — which is why large radii and high resolution are both expensive.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass is almost always cheap in well-authored scenes.** A scene with 10–20 local dynamic lights, sensible radii, and minimal overlap will see this pass at well under 0.5ms. High cost here is almost always a lighting design problem — too many lights, too large radii, or too much overlap — rather than a rendering configuration problem.

> [!NOTE]
> **Stationary lights are a significant optimization over Movable for this pass.** Stationary lights still render dynamic shadows but their static contribution is baked into lightmaps. In many configurations they are fully excluded from the dynamic grid. Audit your light mobility settings before assuming all lights are expensive.

> [!NOTE]
> **The deferred and forward grid builds are separate costs.** In Unreal Insights you may see `ComputeLightGrid` appear twice or in distinct phases — once for the tiled deferred path and once for the clustered forward path. Both are GPU compute dispatches. If translucency is heavy in your scene, the clustered build may dominate over the deferred tiled build.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `ComputeLightGrid` | Total light grid build cost — tiled and/or clustered |
| `BuildLightGrid` | Variant name that may appear depending on pass ordering |

> [!TIP]
> If `ComputeLightGrid` is expensive, open `stat lights` and check total Movable light count first. Then use `r.VisualizeLightGrid 1` in the viewport to see per-tile light density. Tiles showing high counts (bright in the heatmap) are where lights are overlapping — the geometry or camera position at those tiles is where lighting design needs to change.

### Stat Commands

```
stat GPU     // Overall GPU breakdown — ComputeLightGrid appears as a block here
stat lights  // Total light counts broken down by type and mobility — start here to diagnose
```

### Visualization

```
r.VisualizeLightGrid 1   // Heatmap overlay showing lights-per-tile density.
                         // Bright tiles = many lights overlapping = high grid cost in that region.
                         // Use to identify spatial hotspots rather than guessing.
```

### Useful Console Variables

```
r.LightGridPixelSize [default 64]       // Tile size in pixels for tiled deferred grid.
                                        // Smaller = more tiles = more precise but more build cost.
                                        // Larger = fewer tiles = cheaper build, less precise culling.
r.Forward.LightGridSizeZ [default 32]   // Depth slice count for clustered forward grid.
                                        // Reduce on lower-end targets to cut clustered build cost.
r.LightMaxDrawDistanceScale [default 1] // Global scale on light draw distances — reduce to cull
                                        // distant lights from the grid more aggressively.
```

---

## Optimization Levers

### Lighting Design (Highest Impact)
- Set `Attenuation Radius` to the minimum visual requirement — this is the single most impactful lever
- Reduce total Movable light count; every Movable light rebuilds the grid every frame
- Convert non-animating lights to Stationary or Static to remove them from the dynamic grid

> [!WARNING]
> **Converting a Movable light to Static requires a lighting rebuild to take effect visually.** In projects with large levels, this can be a multi-hour lightmass bake. Plan mobility changes early in production — retrofitting lighting mobility late in a project is expensive in build time. Keep a record of which lights are intentionally Movable vs accidentally left as Movable from placeholder setup.

### Level / Art Direction
- Favor key + fill + accent lighting structures over many ambient filler lights
- Avoid placing multiple lights in the same small area — spatially spread lights reduce per-tile overlap
- Use emissive materials for visual glow effects that don't need dynamic illumination — they're free in the light grid

### Rendering Configuration
- Increase `r.LightGridPixelSize` on lower-end targets to reduce tile count and grid build cost (tradeoff: less precise light culling at tile boundaries)
- Reduce `r.Forward.LightGridSizeZ` if translucency lighting precision is not critical
- Reduce `r.LightMaxDrawDistanceScale` to cull distant lights from the grid more aggressively

---

## Mental Model

Think of this stage as:

> *"Before lighting any pixel, build a phone book — organized by screen location and depth — so each pixel can instantly look up only the lights on its page."*

The grid is an upfront cost that makes every lighting pixel cheaper. The optimization is not about making the grid build faster — it's about reducing how much content the grid has to organize. Fewer lights, smaller radii, and less overlap means fewer entries on every page, which means both the build and the lookup are faster.

The key insight is that **lighting design and rendering performance are directly coupled at this stage**. An artist placing lights with oversized radii "just to be safe" is directly adding GPU cost every frame, regardless of whether any gameplay or visual change is perceivable.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Deferred Lighting Pass | Primary consumer of tiled light lists — evaluates lights per pixel using the grid |
| Forward Shading (Translucency) | Consumes clustered light lists for per-fragment lighting |
| Reflection Captures | Binned into the grid alongside local lights for specular evaluation |
| Lumen | Uses grid data for local light integration into indirect lighting |
| `r.LightGridPixelSize` | Primary tuning lever for tiled grid resolution |
| `r.Forward.LightGridSizeZ` | Primary tuning lever for clustered grid depth resolution |

---

## Red Flags to Watch For

- **`ComputeLightGrid` > 0.5ms** → run `stat lights` to check Movable light count; use `r.VisualizeLightGrid 1` to find spatial overlap hotspots
- **`r.VisualizeLightGrid` shows bright tiles across most of the screen** → lights with oversized radii or heavy overlap; reduce `Attenuation Radius` on offending lights
- **High light count in `stat lights` but scene visually uses only a few** → leftover Movable placeholder lights in the level; audit and convert or remove
- **Grid cost spiking in specific areas** → camera position reveals a region with dense overlapping local lights; address lighting layout in that area
- **Multiple scene captures active** → each capture builds its own independent grid; same multiplication problem as Nanite emit
- **Many reflection capture actors in a dense scene** → captures binned like lights; reduce count and rely on Lumen reflections where appropriate
- **Translucency-heavy scenes with high clustered grid cost** → reduce `r.Forward.LightGridSizeZ` or reduce local light count affecting translucent surfaces

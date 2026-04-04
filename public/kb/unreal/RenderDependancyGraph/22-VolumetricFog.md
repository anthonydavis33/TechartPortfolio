---
tags:
  - volumetric-fog
  - atmosphere
---

# Unreal Engine 5 Rendering Pipeline – Volumetric Fog

> Stage: **Volumetric Fog**  
> Phase: Atmospheric Lighting / Volumetric Scattering  
> Purpose: Compute physically-based in-scattering and extinction of light through a 3D voxel grid to produce god rays, light shafts, volumetric beams, and depth-accurate atmospheric haze  
> Pipeline Position: After shadow passes and deferred lighting, before translucency and final composition

---

## What This Stage Does

Volumetric Fog computes how light **scatters through the air volume between the camera and scene geometry** — the effect that makes light beams visible in dusty rooms, shafts of sunlight through foliage, and glowing halos around street lights in foggy conditions.

The system works in three phases each frame:

**Phase 1 — Voxel Grid Construction**
A frustum-aligned 3D voxel grid is built, centered on the camera. Default dimensions are approximately 160×90 tiles in screen space with 64 depth slices — the exact size is controlled by `r.VolumetricFog.GridPixelSize` (XY) and `r.VolumetricFog.GridSizeZ` (depth). Each voxel covers a region of world space in the camera's view frustum.

**Phase 2 — Light Injection**
Lighting from all participating lights is injected into each voxel. For each voxel:
- The directional light contributes scattering based on sun direction and the voxel's position in the atmosphere
- Local participating lights inject in-scattering proportional to their intensity and falloff at that voxel's world position
- Shadow data from VSM is optionally applied to directional light injection (volumetric shadows / god rays)
- Sky atmosphere aerial perspective is integrated into the voxel grid for correct horizon behavior

**Phase 3 — Ray March and Accumulation**
The voxel grid is ray-marched front-to-back from the camera through the volume. Each voxel's in-scattering is accumulated with transmittance extinction applied — the result is a per-pixel in-scattering and transmittance value written into the final scene composition.

---

## Volumetric Fog vs Height Fog — A Critical Distinction

These are two completely different systems that are commonly confused.

| System | Architecture | Cost | Scattering | Light Interaction |
|--------|-------------|------|-----------|------------------|
| **Height Fog** | Analytical — computed per pixel from a density function | Negligible | None — depth-based extinction only | No per-light scattering |
| **Volumetric Fog** | Voxel grid — physically-based in-scattering per voxel | Significant GPU compute | Full in-scattering and extinction | Per-light volumetric contribution |

Height Fog adds a distance-based haze but produces no light beams, no god rays, and no directional scattering. Volumetric Fog is what makes light physically visible as it travels through the air.

The two systems can **coexist** — Height Fog can provide the base density distribution that Volumetric Fog works within. Enabling Height Fog's `Volumetric Fog` property causes its density settings to feed directly into the volumetric voxel grid, giving Volumetric Fog a realistic ground-hugging density gradient without requiring custom fog volumes.

> [!NOTE]
> **Enabling Volumetric Fog does not make Height Fog more expensive in isolation — but combining both multiplies the visual complexity of the fog volume.** A thick Height Fog density setting with Volumetric Fog enabled means the voxel grid is dense throughout the entire frustum depth, not just near the ground. This increases both light injection cost (more voxels at non-trivial density) and ray march cost (higher extinction at every depth slice). Tune Height Fog density conservatively when Volumetric Fog is enabled.

---

## Participating Lights — The Most Important Authoring Detail

**Enabling Volumetric Fog does not automatically make all lights produce visible beams.** Each light must explicitly opt in by setting `Volumetric Scattering Intensity > 0` on the light component. Only opted-in lights inject into the voxel grid.

| Light Type | Volumetric Behavior |
|-----------|-------------------|
| Directional (sun/moon) | Injects across the entire voxel grid; primary source of god rays |
| Spot light (opted in) | Injects within its cone frustum into all overlapping voxels |
| Point light (opted in) | Injects within its sphere influence volume into all overlapping voxels |
| Rect light (opted in) | Injects within its influence volume |
| Sky Light | No volumetric injection — contributes via aerial perspective integration |
| Emissive materials | No direct injection — use `Volumetric Fog` material domain for volume emissives |

> [!WARNING]
> **Every opted-in local light adds light injection cost proportional to its voxel coverage.** A point light whose influence sphere overlaps 500 voxels must inject into all 500 every frame. A scene with 20 opted-in local lights each covering large portions of the voxel grid can make light injection the dominant cost in this pass — far exceeding the cost of the directional light. Audit `Volumetric Scattering Intensity` on all local lights; enable it only on lights where visible beams are a deliberate visual choice.

---

## Volumetric Shadows — God Rays

For god rays — visible shafts of directional light blocked by geometry — Volumetric Fog requires shadow data to be applied during directional light voxel injection. This tells the injector which voxels are in shadow and should not receive direct scattering from the sun.

This is driven by:
- Virtual Shadow Maps providing depth data to the volumetric injection pass
- `r.VolumetricFog.InjectShadowedLightsSeparately` controlling how shadowed lights are handled
- The directional light's `Volumetric Scattering Intensity` being > 0

Without shadow integration, Volumetric Fog produces uniform scattering with no god rays — the fog is lit everywhere the directional light reaches regardless of occlusion.

> [!NOTE]
> **Volumetric shadows (god rays) add to shadow depth cost indirectly.** The VSM data used for volumetric shadow injection comes from the same shadow pass (doc 16). Ensuring high-quality VSM coverage near the camera improves god ray definition. Poor shadow resolution near the camera produces blurry or blocky god rays even at high `GridSizeZ`.

---

## Temporal Accumulation in Voxel Space

Volumetric Fog uses **temporal accumulation of the 3D voxel grid** across frames — reprojecting previous voxel data into the current frame's grid and blending with fresh samples. This allows much sparser per-frame sampling while maintaining apparent quality.

The temporal behavior is distinct from screen-space temporal accumulation (as used by TSR or diffuse GI):
- Accumulation happens in **3D world-aligned voxel space**, not screen space
- Fast camera movement causes the grid to shift — previously accumulated voxels no longer correspond to the same world positions
- Light changes (moving lights, flickering, toggling) lag behind in the fog volume for several frames while the accumulation catches up

> [!WARNING]
> **Rapid light changes, flickering lights, or sudden light toggling will produce visible ghosting in the fog volume.** The temporal accumulation blends old voxel data with new — a light that turns off suddenly may appear to linger in the fog for 3–5 frames before the accumulation fully purges it. This is particularly visible with animated spot lights or scripted lighting events. For lights that need immediate fog response, reduce `r.VolumetricFog.TemporalReprojectionAmount` — at the cost of more per-frame noise.

---

## Execution Model

Volumetric Fog is entirely **GPU compute** — no CPU draw calls. All three phases run as compute dispatches.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules voxel grid construction, injection, and ray march dispatches |
| **GPU Compute** | Builds voxel grid; injects lights per voxel; ray marches to produce final scattering |

The voxel grid dimensions are the primary scaling factor. The total voxel count is `GridX × GridY × GridSizeZ`. Doubling `GridSizeZ` doubles voxel count and roughly doubles injection and ray march cost.

---

## What Data It Produces

| Output | Consumers |
|--------|-----------|
| In-scattering texture (3D or 2D integrated) | Final scene composition — applied to geometry and translucency |
| Transmittance texture | Scene composition — determines how much background color is attenuated by fog |

**Consumed downstream by:**
- **Final scene composition** — in-scattering added; transmittance applied as multiplicative extinction
- **Translucency rendering** — translucent surfaces receive volumetric fog contribution
- **Height Fog pass** — volumetric results composite with any remaining analytical Height Fog contribution

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High `GridSizeZ` | Voxel count scales directly — more depth slices = more injection and ray march cost | Reduce from 64 to 32 on lower-end targets; banding at far distances is usually acceptable |
| Small `GridPixelSize` | More XY tiles = more voxels in screen plane | Increase from 8 to 16 — larger voxels, fewer of them |
| Many opted-in local lights | Each light injects into all voxels its influence sphere covers | Audit `Volumetric Scattering Intensity` on local lights; disable on non-hero lights |
| Large local light radii with volumetric enabled | Influence sphere covers more voxels — injection cost multiplies | Reduce `Attenuation Radius` on volumetric-enabled lights |
| Thick Height Fog density | Dense fog at all depths means no voxels have near-zero scattering | Use conservative Height Fog density with Volumetric Fog; let local volumes handle dense regions |
| Multiple active views | Each view builds its own independent voxel grid | Disable Volumetric Fog in scene captures where fog accuracy is not needed |
| High render resolution | Ray march final step scales with pixel count | Tune screen percentage; ray march is the resolution-dependent step |

---

## Key Systems and Components

### Frustum-Aligned Voxel Grid
The core data structure — a 3D texture representing the view frustum divided into tiles. The grid is camera-centered and frustum-aligned, meaning voxels near the camera are small (high spatial resolution) and voxels far from the camera are large (low spatial resolution). This matches the visual priority — close fog detail matters more than distant fog detail. The tradeoff is that distant fog has limited depth resolution and can show banding on uniform scenes.

### Light Injection Pass
The compute shader that evaluates each participating light's contribution at every voxel in the grid. For each voxel, the injector evaluates distance-based falloff, shadow testing against VSM data, and phase function evaluation (how much light scatters toward the camera from the light direction). This is the most light-count-sensitive part of the system.

### Phase Function
A mathematical function describing the angular distribution of scattered light. The default is an **isotropic scattering** approximation, but the Henyey-Greenstein phase function is used for directional bias (forward scattering, which makes god rays appear brighter when looking toward the sun). The `g` parameter in Henyey-Greenstein (`r.VolumetricFog.Anisotropy`) controls how strongly forward-biased the scattering is — higher values produce more prominent god rays.

### Height Fog Density Integration
When the Height Fog component has `Volumetric Fog` enabled, its density function is sampled per-voxel to modulate the scattering coefficient in the grid. This produces a natural ground-hugging fog density without requiring custom volume placement. The exponential height distribution of Height Fog becomes the extinction profile of the voxel grid.

### Fog Volumes (Exponential Height Fog + Volume)
Arbitrary-shape fog volumes can be placed in the world using the `ExponentialHeightFogVolume` actor. These inject custom density and scattering color into specific regions of the voxel grid, allowing localized dense fog (a foggy alley, a misty forest hollow) without making the entire scene dense.

---

## 📋 Reader Notes

> [!NOTE]
> **Volumetric Fog's visual quality is limited at long distances by voxel depth resolution.** With 64 depth slices covering a frustum that might extend to 10,000 units, each far voxel covers hundreds of units of depth. This produces visible banding on smoothly varying fog or god ray shafts at distance. Increasing `GridSizeZ` improves this but at direct cost. Atmospheric haze at long distances is often better handled by Sky Atmosphere aerial perspective, reserving Volumetric Fog for medium-range scattering where voxel resolution is sufficient.

> [!NOTE]
> **Volumetric Fog interacts with Lumen indirectly.** Lumen's surface cache and screen traces do not account for the volumetric fog medium — Lumen rays travel as though the air is clear. The fog contribution is composited in screen space after Lumen has computed indirect lighting. This means Lumen-lit bounced light does not get volumetrically scattered or attenuated by the fog volume, which can produce slight inconsistencies in very dense fog (indirect light appears unaffected by fog). This is an accepted limitation of the system architecture.

> [!NOTE]
> **The voxel grid is rebuilt from scratch each frame for the camera's current position.** Unlike Lumen's surface cache (which persists and accumulates), the voxel grid itself is re-injected every frame with fresh light data. Temporal accumulation reuses previous voxel radiance samples, but the grid's positional mapping to world space is recomputed every frame. This is why moving the camera causes temporal reprojection artifacts in the fog — the grid shifted but the accumulated history hasn't caught up yet.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `VolumetricFog` | Total stage cost — top-level container |
| `VolumetricFogLightInjection` | Cost of injecting all participating lights into voxels — scales with light count |
| `VolumetricFogRayMarch` | Cost of ray marching the voxel grid to produce final in-scattering |
| `VolumetricFogTemporalReprojection` | Cost of blending current frame voxels with reprojected history |

> [!TIP]
> If `VolumetricFogLightInjection` dominates, the problem is too many opted-in local lights or too many large-radius lights — audit `Volumetric Scattering Intensity` across the scene. If `VolumetricFogRayMarch` dominates, the problem is voxel grid resolution or render resolution — reduce `GridSizeZ` or `GridPixelSize`. If the total cost is unexpectedly high but both sub-events are moderate, check for multiple active views each building their own grid.

### Debug Visualizations

```
r.VolumetricFog.Visualize 1     // Renders a debug view of the voxel grid in-scattering values.
                                 // Reveals which voxels have high scattering (bright = dense scattering)
                                 // and which participating lights are dominating injection.
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — VolumetricFog appears as a block here
```

### Useful Console Variables

```
// Core toggles
r.VolumetricFog 0/1                         // Master toggle for the volumetric fog system

// Grid resolution (primary performance levers)
r.VolumetricFog.GridPixelSize [8]           // XY voxel size in screen pixels.
                                             // 8 = one voxel per 8×8 pixel region (default).
                                             // 16 = coarser grid, ~4× fewer XY voxels, cheaper.
r.VolumetricFog.GridSizeZ [64]              // Depth slice count.
                                             // 64 = default. 32 = cheaper, more banding at distance.
                                             // 128 = higher quality, ~2× cost.

// Light injection
r.VolumetricFog.InjectShadowedLightsSeparately 0/1  // Separate injection pass for shadowed lights.
                                                      // Enables god rays. Small additional cost.

// Temporal accumulation
r.VolumetricFog.TemporalReprojectionAmount [0.9]    // History blend weight (0=no history, 1=full history).
                                                      // Lower = more noise but faster response to changes.
                                                      // Raise for static scenes; lower for dynamic lighting.

// Scattering quality
r.VolumetricFog.Anisotropy [0.0]            // Phase function forward-scattering bias.
                                             // 0 = isotropic (uniform). 0.9 = strong forward bias
                                             // (prominent god rays when looking toward light source).
```

---

## Optimization Levers

### Voxel Grid Resolution (Highest Impact)
- Reduce `r.VolumetricFog.GridSizeZ` from 64 to 32 on lower-end targets — this halves the voxel count and roughly halves injection and ray march cost; banding at far distances is often imperceptible in motion
- Increase `r.VolumetricFog.GridPixelSize` from 8 to 16 — coarser XY grid with approximately 4× fewer voxels; suitable for scenes where fog is a background atmosphere rather than a hero visual element

### Participating Light Audit
- Disable `Volumetric Scattering Intensity` on all local lights that don't need visible beams — this is the most common source of unexpected volumetric fog cost in production scenes
- Reduce `Attenuation Radius` on opted-in local lights to the minimum needed for the beam effect — smaller radius = fewer voxels injected

> [!WARNING]
> **Enabling `Volumetric Scattering Intensity` on many ambient fill lights is a frequent unintentional cost source.** A scene lit by 15 local point lights — each with volumetric scattering enabled by default or accidentally — pays injection cost for all 15 even if none of them are intended to produce visible beams. Audit this setting explicitly during performance review. Set a team convention: volumetric scattering is opt-in for hero lights only.

### Fog Density
- Use conservative Height Fog density values — thick analytical fog feeding into the voxel grid creates high-scattering voxels throughout the frustum depth
- Use local fog volumes (`ExponentialHeightFogVolume`) to create dense fog in specific regions rather than thickening global Height Fog

### Views and Captures
- Disable Volumetric Fog on scene captures where atmospheric accuracy isn't needed — each active capture builds its own independent voxel grid at full cost

> [!WARNING]
> **Volumetric Fog in scene captures is one of the most expensive per-capture costs in the pipeline.** Unlike some passes that can be conditionally disabled, volumetric fog's voxel grid is built independently per view with no sharing. A scene capture actor that renders an environment with Volumetric Fog enabled pays the full three-phase cost — grid construction, light injection, and ray march — independently of the main view. Disable it on all captures where fog is not visible or necessary.

---

## Mental Model

Think of Volumetric Fog as:

> *"Divide the air between the camera and the scene into a 3D grid of cells, fill each cell with how much light is scattering toward you from that location, then integrate those contributions along your line of sight."*

The efficiency of the system rests on the voxel grid resolution trade-off — fewer, larger voxels are cheaper but produce more visible banding and less precise beam shaping. The grid is coarse by design because the human eye tolerates low-frequency volumetric effects well; sharp beam edges at distance are an artifact of insufficient resolution, not a fundamental limitation of the approach.

The key insight is that **volumetric fog cost is dominated by what you put inside it — not just that it exists.** The fog volume itself is a fixed voxel grid cost. The variable cost comes from how many lights inject into it and how densely those lights cover the grid. A scene with one directional light and conservative fog density pays a small, fixed cost. A scene with the directional light plus fifteen opted-in local point lights pays that same base cost multiplied by the per-light injection for each of those fifteen lights.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Height Fog | Provides optional density distribution to the voxel grid; can coexist or be replaced by fog volumes |
| Virtual Shadow Maps | Provides shadow data for directional light volumetric injection — required for god rays |
| Sky Atmosphere LUTs (doc 09) | Aerial perspective integrated into voxel grid for correct horizon behavior |
| CompositionBeforeBasePass (doc 10) | Cloud background aerial perspective also interacts with volumetric fog |
| Participating Lights | Any light with `Volumetric Scattering Intensity > 0` injects into the voxel grid |
| Translucency Pass | Receives volumetric fog contribution as part of translucency lighting |
| Final Scene Composition | In-scattering and transmittance from this pass applied to final color output |

---

## Red Flags to Watch For

- **`VolumetricFog` > 1.5ms** → expand sub-events; check injection vs ray march split to identify primary cost source
- **`VolumetricFogLightInjection` dominant** → too many opted-in local lights; audit `Volumetric Scattering Intensity` across all lights in the scene
- **`VolumetricFogRayMarch` dominant** → voxel grid resolution too high for platform; reduce `GridSizeZ` or increase `GridPixelSize`
- **God rays absent despite Volumetric Fog enabled** → directional light `Volumetric Scattering Intensity` may be 0; or VSM shadow data not reaching the injection pass — check `r.VolumetricFog.InjectShadowedLightsSeparately 1`
- **Fog ghosting or lag after light changes** → temporal accumulation blend weight too high; reduce `r.VolumetricFog.TemporalReprojectionAmount` for lighting rigs with fast changes
- **Visible depth banding in fog at distance** → `GridSizeZ` insufficient for the fog configuration; increase or accept it as a distant-fog limitation and use Sky Atmosphere for long-range haze
- **Scene captures causing unexpected volumetric fog cost** → each capture builds an independent voxel grid; disable Volumetric Fog on non-essential captures
- **Fog visually correct but high cost with few lights** → Height Fog density too high feeding uniform thick scattering into all voxels; reduce exponential fog density

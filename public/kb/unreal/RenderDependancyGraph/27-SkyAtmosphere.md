---
tags:
  - sky-atmosphere
  - environment-lighting
---

# Unreal Engine 5 Rendering Pipeline – Sky Atmosphere (Rendering Pass)

> Stage: **SkyAtmosphere (Render)**  
> Phase: Environment Rendering / Sky Compositing  
> Purpose: Render the visible sky, horizon, and sun disk into all screen pixels not covered by opaque geometry, using the precomputed LUTs from the earlier atmosphere stage  
> Pipeline Position: After `BasePass` and `NaniteEmitDepthTargets`, before translucency and final composition

---

## Relationship to SkyAtmosphereLUTs (Doc 09)

These two passes form a precompute → render pair and must be understood together:

**Doc 09 — SkyAtmosphereLUTs**
Runs early in the frame. Computes the four LUT textures (Transmittance, Multi-Scattering, Sky View, Aerial Perspective) that encode the physical behavior of the atmosphere. Runs only when atmosphere parameters change. Can be fully cached between frames.

**This pass — SkyAtmosphere Render**
Runs after BasePass. Uses the precomputed LUTs to render the actual visible sky into SceneColor. Runs every frame regardless of whether the LUTs were rebuilt. The rendering cost here is always paid; the LUT build cost from doc 09 is the variable component.

The separation exists for efficiency — evaluating full multi-scattering integrals per pixel every frame at full resolution would be completely unaffordable. The LUT precompute amortizes that work into small cached textures this pass samples from cheaply.

---

## What This Stage Does

**Sky Pixel Identification**
The depth buffer is tested per pixel. Pixels at or near the far plane depth value — pixels where no opaque geometry was rendered — are identified as sky pixels. These are the pixels this pass will write into. Geometry pixels are skipped entirely.

**Sky Background Rendering (Fast LUT Path)**
For each sky pixel, the pass computes the viewing direction from camera position toward that pixel, then samples the **Sky View LUT** (built in doc 09) at the corresponding direction. The Sky View LUT already encodes the full atmospheric scattering result for all directions as seen from the current camera altitude, so this lookup is a single texture sample returning physically correct sky color.

The result includes:
- Horizon glow and atmospheric perspective
- Sky color gradient from zenith to horizon
- Rayleigh and Mie scattering contributions
- Correct luminance at the current sun elevation angle

**Sun Disk Rendering**
The sun disk is rendered as a separate high-intensity region within the sky. It is not simply a bright point in the LUT — it is evaluated with additional detail:
- **Limb darkening** — the sun's disk appears brighter at the center and darker toward its edges due to the greater optical path length through the atmosphere at grazing angles on the disk
- **Disk size and intensity** — controlled by the directional light actor's `Atmosphere Sun Disk Scale` and `Atmosphere Sun Disk Intensity` settings, not the Sky Atmosphere component
- **Bloom contribution** — the sun disk is intense enough to drive bloom in post-processing, contributing to the characteristic sun glare

**Aerial Perspective Integration**
The Aerial Perspective LUT (from doc 09) is applied to distant geometry visible at the sky level — the haze and color shift that makes far mountains appear blue-tinted and de-saturated. This is distinct from the aerial perspective injection in CompositionBeforeBasePass (doc 10) which handled the purely-sky-background region. Here, aerial perspective is applied to geometry pixels at extreme distances that are near the sky boundary.

---

## Fast Sky vs Per-Pixel Scattering

This is the most important configuration distinction in this pass.

### Fast Sky Mode (`r.SkyAtmosphere.FastSkyLUT 1` — Default)
- Samples the precomputed Sky View LUT for sky color per direction
- Extremely fast — a single 2D texture sample per sky pixel
- Fully accurate for the camera's current altitude (LUT was built for this altitude)
- Suitable for all production scenarios

### Per-Pixel Scattering Mode (`r.SkyAtmosphere.FastSkyLUT 0`)
- Evaluates the full Bruneton atmospheric scattering integral per sky pixel
- Traces multiple scattering orders through the atmosphere analytically
- Produces marginally higher quality at very close inspection of the horizon
- **Dramatically more expensive** — multiple orders of magnitude slower than the LUT path
- No production use case justifies this cost for real-time rendering

> [!WARNING]
> **`r.SkyAtmosphere.FastSkyLUT 0` should never be used in a shipped project.** The per-pixel scattering evaluation is intended for LUT quality validation and reference rendering only. The quality difference from the LUT path is imperceptible in motion and at normal viewing conditions. If this CVar is set to 0 in your project configuration, this is almost certainly a mistake from debugging that was not reverted.

---

## Sky Pixel Identification — Depth Buffer Dependency

The pass reads the depth buffer to determine which pixels are sky. Pixels at the far plane (depth = 1.0 in NDC, or the configured far clip value) have no geometry in front of them and receive sky rendering. All other pixels are skipped.

This creates a direct dependency on PrePass and BasePass depth quality:

**Well-authored depth:** Sky pixels are correctly identified — only genuinely empty screen regions receive sky rendering. Geometry edges are sharp.

**Poorly authored depth:** If geometry doesn't write depth correctly (WPO mesh with depth mismatch, custom depth shenanigans, clipping issues), those pixels may incorrectly identify as sky and receive sky color on top of geometry — producing visible sky-colored artifacts on surfaces.

> [!NOTE]
> **Sub-pixel geometry gaps (thin wires, fine foliage, tiny mesh details) will show sky color through them even if the geometry is visually solid.** At sub-pixel scale, depth may not be written for every pixel, leaving some pixels at far-depth. Sky rendering correctly fills these pixels with sky color — which is also correct behavior. If fine geometry shows sky bleed-through, it is a geometry density issue, not a sky rendering issue.

---

## Real-Time Sky Light Capture — The Hidden Cost

If a **Sky Light actor** in the level has **Real-Time Capture** enabled, the sky atmosphere is rendered into a full cubemap every frame (or at the specified update rate). This is a **completely separate render of the sky into 6 cubemap faces** — a significant additional cost that appears in the profiler near or within this pass.

| Sky Light Configuration | Cost Implication |
|------------------------|-----------------|
| Captured (baked) sky light | Zero ongoing cost — captured once at build/load time |
| Real-time capture, every frame | Renders sky into 6 cubemap faces every frame — significant |
| Real-time capture, with update rate | Renders on interval — cost amortized across frames |

> [!WARNING]
> **Real-time Sky Light capture is one of the most commonly overlooked performance costs in UE5 sky setups.** A Sky Light with `Real Time Capture` enabled renders 6 full sky atmosphere passes per update — one per cubemap face. At typical update rates, this adds meaningful per-frame cost that doesn't appear in the main `SkyAtmosphere` event in Unreal Insights. Look for `SkyLightCapture` or cubemap render events separately. For most projects, baked sky light capture with manual invalidation on sky parameter changes is the correct choice over per-frame real-time capture.

---

## Execution Model

The sky rendering pass is a **fullscreen pixel pass restricted to sky pixels** — conceptually a fullscreen effect but with early-exit for any pixel covered by geometry.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules sky render dispatch; binds LUT textures and depth buffer |
| **GPU Pixel Shader** | Tests depth per pixel; evaluates sky LUT sample for sky pixels; renders sun disk |

Cost scales with:
- **Sky pixel count** — determined by how much of the screen is not covered by geometry. An open outdoor scene with wide sky view has more sky pixels than an interior scene with a small window.
- **Render resolution** — higher resolution = more sky pixels
- **Active views** — each view renders sky independently

---

## What Data This Pass Reads

| Input | Source | Used For |
|-------|--------|----------|
| Sky View LUT | SkyAtmosphereLUTs (doc 09) | Sky color per viewing direction |
| Aerial Perspective LUT | SkyAtmosphereLUTs (doc 09) | Distance haze on far geometry |
| Transmittance LUT | SkyAtmosphereLUTs (doc 09) | Sun disk transmittance through atmosphere |
| SceneDepth | PrePass / NaniteEmit | Sky pixel identification |
| Directional light direction | CPU-driven | Sun disk position and orientation |

---

## What Data This Pass Produces

| Output | Consumers |
|--------|-----------|
| Sky color written into SceneColor (sky pixels) | Volumetric cloud compositing, translucency, post-processing, TSR |
| Sun disk contribution to SceneColor | Bloom (sun glare), lens flare, post-processing |
| Sky light cubemap (if real-time capture) | Deferred lighting (sky ambient), Lumen sky integration |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| `r.SkyAtmosphere.FastSkyLUT 0` | Per-pixel scattering evaluation — orders of magnitude more expensive | Always use 1 in production |
| Large visible sky area | More sky pixels to shade — scales with uncovered screen area | Unavoidable in open outdoor scenes; content design consideration |
| High render resolution | More sky pixels at higher resolution | Scales with screen percentage |
| Real-time Sky Light capture enabled | 6 additional sky renders per capture update | Use baked capture or reduce update frequency |
| Multiple active views with sky | Each view renders sky independently | Disable sky in scene captures where sky accuracy not needed |
| Sun disk with extreme intensity | Drives expensive bloom pass downstream | Tune directional light's `Atmosphere Sun Disk Intensity` to minimum needed |

---

## Key Systems and Components

### Bruneton Atmospheric Scattering Model
The physical model UE5's sky atmosphere implements. Based on Eric Bruneton's 2008 paper on precomputed atmospheric scattering. The model accounts for Rayleigh scattering (responsible for the blue sky and red sunsets) and Mie scattering (responsible for the white haze near the horizon and sun glare). The LUTs from doc 09 encode the results of this model for efficient runtime sampling.

### Sky View LUT Sampling
The core operation of the fast sky path. The Sky View LUT stores a panoramic map of sky color as seen from the camera's current altitude — indexed by view direction. A single bilinear sample returns the complete scattering result for that direction, including all orders of scattering and all atmospheric layers. This is why the fast sky path is so efficient: all the expensive math was done during the LUT build.

### Sun Disk and Limb Darkening
The sun disk is rendered using the Transmittance LUT to determine how much sunlight passes through the atmosphere to the camera at the sun's position. Limb darkening approximates the physical effect where the sun's disk appears brighter at the center — the center represents the most direct optical path through the sun's photosphere, while the edges represent paths through more of the photosphere at an angle. In atmosphere rendering, limb darkening from the atmosphere also darkens the sun's apparent disk edge relative to center.

### Aerial Perspective on Geometry
Near the horizon, distant geometry appears increasingly hazy — this is aerial perspective. The Aerial Perspective LUT (3D volume texture from doc 09) is sampled at the geometry's depth and screen position to apply this haze. The sky rendering pass applies this to pixels that have geometry at extreme distances, blending the geometry color with the atmospheric haze color.

### Sky Light Real-Time Capture Pipeline
When enabled, the Sky Light captures the sky atmosphere into a 128×128 or 256×256 cubemap each update. This involves rendering the sky atmosphere shader into all 6 cube faces — each face covers a 90-degree frustum of sky. The result is used by deferred lighting as the ambient sky contribution and feeds into Lumen's sky indirect lighting. The capture update rate is a direct trade-off between sky lighting accuracy and GPU cost.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass and doc 09 (SkyAtmosphereLUTs) are frequently confused when profiling.** In Unreal Insights, `SkyAtmosphereLUTs` events cover the LUT build cost — variable, depends on whether parameters changed. `SkyAtmosphere` or `RenderSkyAtmosphere` events cover the actual sky render — fixed cost every frame. High LUT cost is a parameter-change frequency problem (doc 09). High sky render cost is a sky coverage or configuration problem (this doc).

> [!NOTE]
> **The sky atmosphere render does not interact with Lumen directly.** Lumen's sky contribution comes from the Sky Light, not from sampling the sky atmosphere render pass. The sky atmosphere defines what the sky looks like visually; the sky light (baked or real-time captured) defines how the sky illuminates the scene. They can be out of sync if the sky light is not updated when atmosphere parameters change.

> [!NOTE]
> **The SkyAtmosphere component must be present in the level for this pass to run.** Unlike some systems that have engine-level defaults, sky atmosphere rendering is entirely driven by the `SkyAtmosphere` actor. Removing it from the level disables all atmospheric sky rendering and sky light atmosphere integration. If the sky atmosphere pass appears expensive but no `SkyAtmosphere` actor seems to be in the level, check streamed sub-levels and persistent level actors.

> [!NOTE]
> **Camera altitude significantly affects sky appearance but not sky render cost.** The Sky View LUT was precomputed for the current camera altitude (it rebuilds when altitude changes significantly), but the sky rendering pass itself costs the same at any altitude. The altitude dependency is entirely in the LUT precompute stage.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `RenderSkyAtmosphere` | Main sky rendering cost — LUT sampling + sun disk |
| `SkyAtmosphere` | Variant event name in some engine versions |
| `SkyLightCapture` | Real-time sky light cubemap capture — look for this separately |
| `SkyAtmosphere_SunDisk` | Sun disk rendering sub-pass if profiled separately |

> [!TIP]
> If `RenderSkyAtmosphere` appears expensive, check `r.SkyAtmosphere.FastSkyLUT` first — it should be 1. If it is 1 and cost is still high, check whether real-time sky light capture is running simultaneously by looking for `SkyLightCapture` events nearby. If neither is the cause, the issue is simply sky coverage at your current render resolution — more open sky = more sky pixels = proportionally more cost.

### Stat Commands

```
stat GPU        // Overall GPU breakdown — sky atmosphere appears here
stat Lights     // Check if sky light real-time capture is contributing to light update cost
```

### Debug Visualizations

```
r.SkyAtmosphere.Debug 1        // Logs atmosphere parameter state and LUT dirty flags —
                                 // useful to confirm whether LUTs are being rebuilt unexpectedly
                                 // alongside this pass's per-frame render cost

showflag.atmosphere 0           // Toggles sky atmosphere rendering entirely —
                                 // useful to isolate sky render cost from total frame cost
```

### Useful Console Variables

```
// Core quality/performance
r.SkyAtmosphere.FastSkyLUT 1/0    // Fast LUT path (1, always use) vs per-pixel (0, never ship)

// Sun disk
r.SkyAtmosphere.SunDisk 1/0       // Toggle sun disk rendering
                                    // Disable if sun disk is not visible or needed

// Sky light capture
r.SkyLight.RealTimeCapture 0/1     // Toggle real-time sky light capture globally
                                    // Disable and use baked capture for most projects

// Aerial perspective (see also doc 09 for LUT resolution CVars)
r.SkyAtmosphere.AerialPerspectiveLUT.Depth   // LUT depth slices (see doc 09)

// Resolution impact
r.ScreenPercentage                  // Lower screen percentage reduces sky pixel count
                                     // proportionally — sky scales exactly with resolution
```

---

## Optimization Levers

### Verify FastSkyLUT Is Enabled
This should be the first check in any sky atmosphere performance investigation. `r.SkyAtmosphere.FastSkyLUT 1` is the default and should never be changed for production builds.

### Sky Light Capture Configuration
- Use **baked sky light capture** for levels with a static sky — captured once on load, zero ongoing cost
- If real-time sky light capture is required (time-of-day system, dynamic sky), reduce the capture resolution and update frequency
- Set a meaningful `Source Type` and `Recapture` trigger rather than capturing every frame

> [!WARNING]
> **Real-time sky light capture set to update every frame is one of the most expensive "invisible" configurations in a UE5 sky setup.** It is easy to leave `Real Time Capture` enabled from a prototype and forget to configure an appropriate update interval. A real-time sky light capturing every frame in a large outdoor scene with volumetric clouds can add 2–4ms to the frame that appears completely disconnected from the "sky atmosphere" pass in a naive profile read. Always check Sky Light settings when investigating sky-related GPU cost.

### Sun Disk
- Disable `r.SkyAtmosphere.SunDisk 0` in scenes where the sun disk is never visible (always overcast, interior-focused, dawn/dusk without direct sun in frame)
- Reduce `Atmosphere Sun Disk Intensity` on the directional light if bloom driven by the sun disk is excessive — this reduces downstream bloom pass cost as well

### Open World Considerations
- In wide-open outdoor scenes, the sky covers a large fraction of screen space — this is the maximum sky render cost scenario and is unavoidable without content changes
- Use the `SkyAtmosphere` component's `Transform Mode` correctly for planet-scale projects — incorrect transform mode increases shader evaluation complexity

### Views and Captures
- Disable sky atmosphere contribution in scene captures where atmospheric sky is not needed
- For reflection captures that primarily capture interior scenes, disabling the sky atmosphere prevents an unnecessary sky render into the capture

---

## Mental Model

Think of the SkyAtmosphere render pass as:

> *"Everything that isn't a solid object gets filled with a physically computed sky color — sampled from the pre-solved atmospheric tables that were built earlier this frame."*

The LUT precompute (doc 09) solves the hard physics. This pass does the cheap part — looking up the answers from those solutions for every pixel that needs them. The sky is expensive to define (LUT build) but cheap to render (LUT sample). That division of labor is the entire efficiency rationale of the system.

The key relationship to understand is the **sky pixel → LUT sample → SceneColor write** chain. More sky visible = more LUT samples = more SceneColor writes. The LUT textures themselves are tiny — the cost scales with pixels, not atmosphere complexity. Atmospheric parameter complexity is entirely hidden in the LUT build cost from doc 09, not here.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| SkyAtmosphereLUTs (doc 09) | Precomputes LUTs sampled here — the two passes form a pair |
| CompositionBeforeBasePass (doc 10) | Injects aerial perspective before geometry rendering; this pass renders the sky after |
| Sky Light | Captures the sky for scene illumination — real-time capture triggers additional sky renders |
| Directional Light | Provides sun position and disk parameters consumed by sun disk rendering |
| Volumetric Clouds (doc 22) | Composited over the sky background rendered here |
| Lumen | Uses sky light (from baked or real-time capture) for sky ambient — not directly from this pass |
| Bloom (Post-Processing) | Sun disk intensity drives bloom magnitude downstream |
| TSR (doc 23) | Receives sky-composited SceneColor as input |

---

## Red Flags to Watch For

- **`RenderSkyAtmosphere` expensive despite small visible sky area** → check `r.SkyAtmosphere.FastSkyLUT`; if it is 0, this is the cause — set to 1 immediately
- **Unexpected `SkyLightCapture` events in profile** → Sky Light has real-time capture enabled; check update frequency and consider switching to baked capture
- **Sky color appearing on opaque geometry surfaces** → geometry not writing depth correctly — sky pixels incorrectly identified at geometry locations; check for WPO depth mismatch or custom depth issues
- **Sky horizon or sun disk visible through thin geometry** → sub-pixel geometry gaps at the depth test level; sky correctly filling those pixels — address with geometry density, not sky settings
- **Sky atmosphere pass cost scaling unexpectedly with scene changes** → open areas revealing more sky — check camera positions that maximize sky coverage; this is a content and level design consideration
- **Sky light not updating when atmosphere parameters change** → Sky Light using baked capture that hasn't been re-captured; trigger a recapture or enable real-time capture at appropriate frequency
- **Two sky atmosphere actors active simultaneously** → duplicate or streamed-level actor conflict; each renders independently — audit World Outliner for multiple `SkyAtmosphere` actors

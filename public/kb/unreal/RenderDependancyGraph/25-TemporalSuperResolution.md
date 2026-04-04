---
tags:
  - tsr
---

# Unreal Engine 5 Rendering Pipeline – Temporal Super Resolution (TSR)

> Stage: **TemporalSuperResolution**  
> Phase: Post-Processing / Temporal Upscaling & Anti-Aliasing  
> Purpose: Reconstruct a high-quality output-resolution image from a lower-resolution input frame using temporal history accumulation, intelligent history rejection, and spatial upscaling  
> Pipeline Position: Late post-processing — after all scene rendering, before final tone mapping and UI

---

## What This Stage Does

TSR is UE5's primary temporal upscaler and anti-aliasing solution. It accepts the rendered scene at a lower internal resolution (set by `r.ScreenPercentage`) and produces a high-quality output at the target display resolution by accumulating and refining history from previous frames.

TSR performs several distinct operations each frame:

**1. Velocity Dilation**
The velocity buffer is dilated — each pixel searches its neighborhood for the closest-geometry motion vector rather than using only its own pixel's velocity. This ensures geometry edges are correctly tracked during reprojection even when the velocity buffer has sub-pixel coverage gaps.

**2. History Reprojection**
The previous frame's accumulated history buffer is reprojected into the current frame's coordinate space using the dilated velocity vectors. Each pixel of the output is mapped back to where it was in the previous frame.

**3. History Rejection**
TSR evaluates confidence in each reprojected history sample. Samples are rejected (discarded) when:
- The reprojected history color is significantly different from the current frame's color at that location (disocclusion, new geometry, lighting change)
- Temporal variance analysis indicates the history has become stale or incorrect
- Spatial neighborhood statistics suggest the history doesn't match the current frame's data

Rejected pixels fall back to fresh current-frame data and begin re-accumulating history from scratch. This is the critical decision point — aggressive rejection = less ghosting but more temporal noise; conservative rejection = more ghosting but smoother accumulation.

**4. Shading Rejection (Nanite Flickering Compensation)**
A secondary rejection system specifically designed for Nanite's sub-pixel detail. When Nanite geometry is smaller than a pixel, its coverage alternates frame-to-frame as the underlying geometry shifts relative to the pixel grid. This produces structured flickering that standard history rejection would either ghost (keep stale history) or noise-up (reject too aggressively). The Shading Rejection system performs temporal analysis to detect this pattern and handle it specifically, producing stable output without ghosting. Controlled by `r.TSR.ShadingRejection.Flickering`.

**5. History Update and Accumulation**
Valid history samples are blended with the current frame's color. The blend weight is determined by rejection confidence — high confidence in history means a strong history weight; low confidence means the current frame dominates. Accumulated samples build up over multiple frames, effectively super-sampling the scene over time.

**6. Spatial Anti-Aliasing on Rejected Regions**
Pixels where history was rejected need immediate anti-aliasing since they have no temporal history to smooth them. A spatial AA pass runs on rejection-heavy regions. Quality controlled by `r.TSR.RejectionAntiAliasingQuality`.

**7. History Resurrection (UE5.4+)**
When history is discarded (due to disocclusion, geometry leaving screen, shading changes), previously-valid history data is preserved in a "resurrection buffer" rather than being immediately discarded. When a pixel re-enters screen space or a previously-seen surface reappears, the resurrection buffer provides a better starting point for re-accumulation than cold-starting from scratch. Reduces the visible re-accumulation artifact (progressive noise → stability) when geometry moves back into view.

**8. Upscaling Output**
The accumulated history — stored at `r.TSR.History.ScreenPercentage` × output resolution — is sampled and output at the final display resolution.

---

## TSR Is More Than Just Upscaling

A common misunderstanding is that TSR is only active when `r.ScreenPercentage < 100`. This is incorrect.

TSR replaces TAA entirely as the anti-aliasing solution. At `r.ScreenPercentage 100`, TSR still runs its full rejection, accumulation, spatial AA, and history management pipeline — it simply outputs at native resolution rather than upscaling. Its temporal accumulation provides anti-aliasing that is significantly superior to TAA at equivalent or lower cost in complex Nanite-heavy scenes.

The upscaling and anti-aliasing functions are integrated into the same pipeline — TSR does both simultaneously.

> [!NOTE]
> **TSR has a base overhead cost that exists regardless of screen percentage.** Even at 100% screen percentage, TSR's rejection analysis, history management, and accumulation run every frame. This base cost is higher than TAA's equivalent. In scenes without Nanite or where Nanite's sub-pixel detail challenges are absent, TAA may have lower overhead. In UE5 scenes with Nanite at typical quality settings, TSR's overhead is justified by the quality improvement it provides — but it is not free.

---

## The Two Resolution Parameters — Critical Distinction

These two settings are commonly confused and their interaction is the most important thing to understand when optimizing TSR:

### `r.ScreenPercentage` — Input Render Resolution
Controls the resolution at which the **entire scene is rendered** before TSR processes it. This is the primary driver of rendering cost across almost every pass in the pipeline — BasePass, Lumen, shadows, reflections, and all screen-space effects.

| `r.ScreenPercentage` | Effective Input Resolution (1080p output) | Effective Input Resolution (4K output) |
|---------------------|------------------------------------------|---------------------------------------|
| 50% | 540p | 1080p |
| 66.7% (default) | 720p | 1440p |
| 75% | 810p | 1620p |
| 100% | 1080p (native) | 2160p (native) |

The default of **66.667%** is UE5's "Quality" preset equivalent — intentionally chosen to provide a significant performance gain from reduced rendering cost while TSR reconstructs image quality close to native.

### `r.TSR.History.ScreenPercentage` — History Buffer Resolution
Controls the resolution of TSR's accumulated history buffer — the texture where temporal samples are stored between frames. This is **independent of render resolution** and operates at a multiple of the **output** resolution.

| `r.TSR.History.ScreenPercentage` | History Buffer Size (1080p output) | History Buffer Size (4K output) |
|---------------------------------|-----------------------------------|--------------------------------|
| 100 (default Low/Med/High) | 1080p | 4K |
| 200 (default Epic/Cinematic) | 2160p | **8K** |

> [!WARNING]
> **At Epic or Cinematic anti-aliasing scalability, `r.TSR.History.ScreenPercentage` defaults to 200 — meaning the history buffer is stored at 2× output resolution.** At a 4K output target, this stores an 8K history buffer every frame. AMD's testing found this alone costs up to **1.2ms** on a Radeon 7900XTX at 4K compared to setting it to 100. The quality difference between 100 and 200 at typical viewing distances is subtle — this is the highest-value single CVar change for TSR performance on high-resolution targets. Epic recommends reducing the Epic scalability tier's value to 100 in `BaseScalability.ini` for shipped projects targeting 4K.

---

## Scalability Tiers and TSR Behavior

TSR quality is tied to UE5's anti-aliasing scalability group (`sg.AntiAliasingQuality`), configured in `BaseScalability.ini`. Understanding what each tier changes is essential for platform-specific tuning.

| Scalability Tier | `sg.AntiAliasingQuality` | `r.TSR.History.ScreenPercentage` | History Resurrection | Shading Rejection Flickering |
|-----------------|--------------------------|----------------------------------|---------------------|------------------------------|
| Low | 0 | 100 | Off | Off |
| Medium | 1 | 100 | Off | Off |
| High | 2 | 100 | Off | On |
| Epic | 3 | 200 | On | On |
| Cinematic | 4 | 200 | On | On |

> [!NOTE]
> **The most impactful platform optimization for TSR is customizing the Epic scalability tier in `BaseScalability.ini`.** Reducing `r.TSR.History.ScreenPercentage` from 200 to 100 in the `AntiAliasingQuality@3` section captures the majority of TSR's performance budget at 4K targets while maintaining visual quality nearly identical to the default. This is a project config file change, not a CVar override, and applies automatically to all players at that scalability setting.

---

## Velocity Dependency — The Upstream Chain

TSR is entirely dependent on the velocity buffer produced in `VelocityParallel` (doc 04). Every architectural decision in that pass directly affects TSR output quality:

| Upstream Issue | TSR Symptom |
|---------------|------------|
| Missing velocity on WPO geometry | Ghosting on WPO-animated surfaces — history not correctly reprojected |
| Missing velocity on skinned meshes | Character ghosting, especially during fast movement |
| Nanite mesh with incorrect velocity | Shimmering or instability on Nanite surfaces in motion |
| Translucent geometry without velocity | Ghost trails on transparent objects |
| Low velocity output quality | Increased history rejection rate → more temporal noise → more spatial AA |

> [!WARNING]
> **TSR ghosting on a specific object almost always indicates a missing or incorrect velocity write for that object.** Before tuning any TSR CVar, check whether the ghosting object is correctly writing to the velocity buffer. Use `vis velocity` (doc 04) to verify. Adjusting rejection thresholds to compensate for missing velocity produces worse results than fixing the velocity data itself.

---

## Nanite and TSR — A Designed Pairing

TSR was written specifically for UE5 and Nanite. The Shading Rejection Flickering system exists entirely because Nanite exposes a class of temporal instability that didn't exist before.

**The Nanite flickering problem:** Nanite preserves geometric detail finer than a pixel by choosing which triangles to display each frame based on subpixel coverage. For structured geometry (repeating architectural details, window grids, ornate facades) viewed at grazing angles, this produces deterministic alternating patterns — certain triangles appear on even frames, different ones on odd frames. The result is structured flickering across entire surface regions.

Standard temporal AA responds to this flickering in one of two bad ways:
- Aggressive rejection: treats every flickering pixel as a scene change and re-accumulates from scratch every frame — producing permanent temporal noise on those surfaces
- Conservative rejection: accepts the alternating values and ghosts them together — producing a blurry average of the two states

The `r.TSR.ShadingRejection.Flickering` system performs **temporal frequency analysis** to detect this specific pattern. When it recognizes structured alternating values with the periodicity defined by `r.TSR.ShadingRejection.Flickering.Period`, it neither rejects nor fully accepts the history — instead it filters across the detected period to produce a stable result. This is what makes dense Nanite cityscapes visually stable at a distance.

---

## Known Artifacts and Their Root Causes

Understanding what causes each common TSR artifact prevents chasing wrong solutions.

### Ghosting
**Cause:** History rejection too conservative — stale history accumulating for geometry that has moved.
**Common sources:** Missing velocity writes, underestimated velocity (small objects with fast motion), disocclusion events where new geometry appears behind moving foreground.
**Fix approach:** Verify velocity buffer coverage first. If confirmed correct, adjust rejection sensitivity via `r.TSR.ShadingRejection.SpatialFilter`.

### Temporal Noise / Shimmer
**Cause:** History rejection too aggressive — too many pixels cold-starting accumulation each frame.
**Common sources:** High-frequency geometry detail, specular highlights on rough surfaces, Nanite sub-pixel detail without ShadingRejection enabled, fast camera movement.
**Fix approach:** Ensure `r.TSR.ShadingRejection.Flickering 1` is enabled for Nanite scenes. Increase `r.TSR.RejectionAntiAliasingQuality` to improve spatial AA on rejected regions.

### Edge Fringing / Halo
**Cause:** Velocity dilation not capturing correct motion at geometry edges — history for background pixels reprojected using foreground object velocity.
**Common sources:** Very thin geometry, extreme depth discontinuities, fast-rotating objects.
**Fix approach:** Ensure good velocity buffer coverage at geometry edges; this is primarily a content and velocity authoring issue.

### Re-accumulation Artifacts (Progressive Noise)
**Cause:** Large area of history rejected simultaneously — camera cut, rapid pan, rapid disocclusion of a large area. TSR must rebuild history from scratch and appears noisy for several frames.
**Partial mitigation (UE5.4+):** History Resurrection (`r.TSR.Resurrection 1`) preserves previously-valid history and uses it as a starting point, reducing the severity and duration of re-accumulation.

### Translucency Ghosting
**Cause:** Translucent geometry typically does not write velocity and TSR cannot correctly reproject it.
**Fix approach:** Enable `r.TSR.Translucency.EnableResponiveAA 1` — this tells TSR to use aggressive rejection on translucent pixels, accepting some noise in exchange for eliminating ghosting.

> [!NOTE]
> **The "Responsive AA" material flag is TSR's per-material ghosting control.** For any material that animates in a way TSR consistently ghosts — particle systems, animated emissive textures, rain splashes — enabling the `Responsive AA` flag in the material settings tells TSR to reject history aggressively for those pixels. The tradeoff is more per-frame noise on those surfaces. Use it intentionally, not globally.

---

## Execution Model

TSR is a **GPU compute pass** — a sequence of compute dispatches running at the output resolution.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules TSR dispatches; manages history buffer ping-pong |
| **GPU Compute** | Executes all TSR phases — dilation, rejection, accumulation, upscale |

TSR operates on **output-resolution** data, not input-resolution. All compute dispatches process pixels at the final display resolution regardless of `r.ScreenPercentage`. This is why the history buffer size (`r.TSR.History.ScreenPercentage`) at high output resolutions is the primary performance concern — the GPU is always working at full output pixel count.

---

## What Data It Produces

| Output | Format | Consumers |
|--------|--------|-----------|
| Upscaled / AA'd SceneColor | RGBA16F at output resolution | Tone mapping, bloom, final post-process |
| TSR history buffer (persistent) | RGBA16F or R11G11B10F at History.ScreenPercentage × output | Next frame's reprojection |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High output resolution (4K) | All TSR dispatches process output-resolution pixels; history buffer at 200% = 8K | Reduce `r.TSR.History.ScreenPercentage` to 100 in Epic scalability tier |
| `r.TSR.History.ScreenPercentage 200` at 4K | 8K history buffer bandwidth every frame | Reduce to 100; up to 1.2ms saving on high-end GPU per AMD testing |
| High `r.TSR.RejectionAntiAliasingQuality` | Spatial AA on rejected regions more expensive | Reduce to 0 or 1 on lower-end targets |
| High `r.TSR.History.UpdateQuality` | More expensive history blend computation | Reduce on lower-end platforms |
| History Resurrection enabled | Additional resurrection buffer maintained and queried | Disable via `r.TSR.Resurrection 0` on lower tiers |
| Shading Rejection Flickering enabled | Temporal frequency analysis per pixel | Disable on lower tiers if Nanite sub-pixel flickering is not a concern |
| Frequent large-area rejection | Spatial AA patch runs on all rejected pixels | Address upstream velocity issues to reduce rejection rate |

---

## Key Systems and Components

### History Buffer (Ping-Pong)
TSR maintains two history buffers — one is read this frame (the accumulated result of all previous frames), and one is written this frame (the newly updated accumulation). These swap each frame. The resolution of these buffers is `r.TSR.History.ScreenPercentage` × output resolution. At 200% on a 4K display, each buffer is 8K — substantial VRAM and bandwidth cost.

### `r.TSR.History.R11G11B10`
When enabled, the history buffer is stored in R11G11B10F format rather than RGBA16F. This halves the history buffer size and bandwidth at the cost of reduced color precision in accumulated history. On high-quality content the precision difference is generally imperceptible; on HDR content with bright highlights it can introduce subtle banding. A worthwhile bandwidth saving for most content.

### Rejection Map
A per-pixel confidence value (0 = full history trust, 1 = full rejection) computed during the rejection phase. This map drives both the accumulation blend weight and the spatial AA coverage. Visualizing the rejection map (possible via TSR debug modes in UE5.4+) directly shows where TSR is struggling — solid areas of high rejection indicate velocity or content authoring issues.

### Shading Rejection Flickering Period
`r.TSR.ShadingRejection.Flickering.Period` defines the temporal period in frames that the flickering detection looks for. The default matches Nanite's sub-pixel alternation frequency at typical frame rates. Changing this value is rarely necessary unless your scene runs at an unusual frame rate where the flickering period differs.

### Resurrection Buffer (UE5.4+)
An additional buffer that stores history samples that have been evicted from the main accumulation. When pixels re-enter view or previously-rejected history becomes relevant again, the resurrection buffer provides better starting data than cold-starting. Adds memory and bandwidth overhead proportional to output resolution.

---

## 📋 Reader Notes

> [!NOTE]
> **TSR quality varies significantly between UE5 versions.** UE5.0 and 5.1 had a notably different (and often more stable at equivalent settings) rejection algorithm than 5.4+ in some scene types. UE5.4 introduced History Resurrection which improved some artifacts while introducing new ones in structured scenes (City Sample flickering). UE5.5 changed default behavior in ways some projects found regressive. Always profile and validate TSR behavior after upgrading engine versions — don't assume CVar values that worked in one version produce the same results in another.

> [!NOTE]
> **TSR is not DLSS, FSR, or XeSS — it does not use machine learning.** TSR is a deterministic algorithmic temporal accumulation system. DLSS (NVIDIA) and FSR 3+ (AMD) use neural network-based upscaling that can produce different characteristics. DLSS and FSR plugins are available for UE5 as third-party additions and may outperform TSR in specific scenarios, particularly at very low screen percentages. TSR's advantage is that it requires no plugins, works on all hardware, and is deeply integrated with UE5's rendering pipeline including native Nanite flickering handling.

> [!NOTE]
> **TSR interacts with every temporal system in the pipeline.** Lumen's diffuse GI, reflections, VSM shadow caching, and Niagara particle effects all produce temporally accumulated data that TSR must handle. A scene that is temporally stable in all upstream passes (stable Lumen, stable shadows, stable particles) gives TSR the most history to work with. A scene with aggressive temporal instability in multiple systems simultaneously produces TSR artifacts that are difficult to attribute to any single cause.

> [!NOTE]
> **`r.TemporalAA.Upsampling 1` must be set alongside `r.AntiAliasingMethod 4` for TSR to function as an upscaler.** Without it, TSR runs at 100% screen percentage regardless of the `r.ScreenPercentage` value. This is a common configuration mistake when setting up TSR for the first time.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `TemporalSuperResolution` | Total TSR cost — all phases combined |
| `TSR.Dilate` | Velocity dilation pass cost |
| `TSR.History.Rejection` | History rejection analysis cost |
| `TSR.History.Update` | History accumulation blend cost |
| `TSR.Output` | Final upscale output cost |
| `TSR.Resurrection` | Resurrection buffer update cost (UE5.4+ only) |

> [!TIP]
> If `TemporalSuperResolution` is expensive relative to other passes, check output resolution and `r.TSR.History.ScreenPercentage` first. If cost is high and the scene is 4K, reducing history screen percentage from 200 to 100 is the highest-leverage single change. If cost is high at 1080p or lower, check `r.TSR.RejectionAntiAliasingQuality` and `r.TSR.History.UpdateQuality` — both can be reduced on lower-end targets.

### Debug Visualizations (UE5.4+)

```
r.TSR.Visualize 1           // Overview visualization of TSR internals
r.TSR.Visualize 2           // History rejection map — shows per-pixel rejection confidence.
                             // Bright = heavily rejected (high noise risk).
                             // Dark = history trusted (stable accumulation).
                             // Use to diagnose ghosting vs noise trade-off.
r.TSR.Visualize 3           // Shading rejection flickering detection map
r.TSR.Visualize 4           // Resurrection buffer activity (UE5.4+)
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — TemporalSuperResolution appears as a block
```

### Useful Console Variables — Complete Reference

```
// Core configuration
r.AntiAliasingMethod 4                  // Enable TSR (0=None, 1=FXAA, 2=TAA, 3=TSR)
r.TemporalAA.Upsampling 1               // Required for TSR to upscale; without this TSR
                                         // runs but ignores r.ScreenPercentage

// Render resolution (affects entire pipeline, not just TSR)
r.ScreenPercentage [66.667]             // Internal render resolution as % of output.
                                         // 66.667 = default "Quality" equivalent.
                                         // 75 = "Quality+" equivalent.
                                         // 50 = "Performance" equivalent.

// History buffer resolution (most impactful TSR-specific CVar)
r.TSR.History.ScreenPercentage [100/200] // History buffer size as % of OUTPUT resolution.
                                          // 100 = history at output resolution (recommended for 4K).
                                          // 200 = history at 2× output resolution (default Epic/Cinematic).
                                          // At 4K: 200 = 8K history buffer. Reduce to 100 for up to 1.2ms saving.

// History buffer format
r.TSR.History.R11G11B10 [0/1]           // Store history in R11G11B10F instead of RGBA16F.
                                         // Halves history buffer bandwidth. Minor precision tradeoff.
                                         // Generally safe to enable for most content.

// History update quality
r.TSR.History.UpdateQuality [2]         // Quality of history blend computation.
                                         // 0 = cheapest, 3 = highest quality.
                                         // Reduce on lower-end platforms.

// Rejection anti-aliasing (spatial AA on rejected pixels)
r.TSR.RejectionAntiAliasingQuality [2]  // Spatial AA quality on rejection-heavy regions.
                                         // 0 = disabled (cheapest, noisier on rejections).
                                         // 2 = default. Reduce on lower-end targets.

// Nanite flickering compensation
r.TSR.ShadingRejection.Flickering [1]   // Enable Nanite sub-pixel flickering detection.
                                         // 1 = enabled (default High+). Essential for Nanite scenes.
                                         // 0 = disabled (cheaper, but structured Nanite flickering visible).
r.TSR.ShadingRejection.Flickering.Period [3]  // Temporal period for flickering detection (frames).
                                               // Default 3. Rarely needs changing.

// Spatial filtering
r.TSR.ShadingRejection.SpatialFilter [2] // Spatial filter quality for shading rejection.
                                          // 0 = disabled, 2 = default, higher = smoother but more expensive.

// History Resurrection (UE5.4+)
r.TSR.Resurrection [1]                  // Enable history resurrection buffer.
                                         // 1 = enabled (default Epic+). Reduces re-accumulation artifacts.
                                         // 0 = disabled. Saves resurrection buffer bandwidth.

// Translucency
r.TSR.Translucency.EnableResponiveAA [1] // Aggressive rejection on translucent pixels.
                                          // Reduces translucency ghosting at cost of noise on translucent surfaces.

// Scalability group (sets multiple TSR CVars simultaneously)
sg.AntiAliasingQuality [0-4]            // 0=Low, 1=Med, 2=High, 3=Epic, 4=Cinematic.
                                         // Configures History.ScreenPercentage, Resurrection,
                                         // and ShadingRejection.Flickering together.
```

---

## Optimization Levers

### Highest Impact — Configuration

**Reduce `r.TSR.History.ScreenPercentage` to 100 at Epic/Cinematic scalability**
This is the single most impactful TSR-specific optimization for projects targeting 4K. The default value of 200 in the Epic and Cinematic scalability tiers stores an 8K history buffer at 4K output. Reducing to 100 drops this to 4K — half the bandwidth, half the VRAM, with subtle quality difference at normal viewing distances.

Edit `Engine/Config/BaseScalability.ini` under `[AntiAliasingQuality@3]`:
```ini
[AntiAliasingQuality@3]
r.TSR.History.ScreenPercentage=100
```

**Enable `r.TSR.History.R11G11B10 1`**
Switch the history buffer format from RGBA16F to R11G11B10F. Halves history buffer bandwidth with minimal perceptible quality difference on most content. Safe to enable globally except for HDR-heavy content with extreme bright highlights.

### Screen Percentage Tuning — Platform-Specific

Screen percentage is the primary rendering cost lever across the entire pipeline — not just TSR. Choose values based on your target platform's performance budget:

| Target | Recommended `r.ScreenPercentage` | Notes |
|--------|----------------------------------|-------|
| PC high-end (4K) | 66.667–75 | TSR reconstructs quality effectively at these ratios |
| PC mid-range (1080p) | 75–100 | Lower ratios at 1080p more visible |
| Console (PS5, XSX) | 66.667 | Standard console TSR target |
| Lower-end / mobile | 50 | Aggressive; ensure `r.TSR.RejectionAntiAliasingQuality 0` |

> [!WARNING]
> **Very low screen percentages (below 50%) produce diminishing quality returns and increasing artifact visibility.** At 50% or below, TSR is reconstructing detail that doesn't exist in the input — the temporal accumulation must work much harder and artifacts become more visible. Below 50% is generally not recommended for production unless the content is specifically designed to work with very low input resolution (clean, low-frequency geometry and limited specular).

### Quality Tier Reduction

For lower-end platforms, reduce scalability through CVars in platform-specific configs:

```ini
// Lower-end platform config example
r.TSR.History.ScreenPercentage=100
r.TSR.History.UpdateQuality=1
r.TSR.RejectionAntiAliasingQuality=1
r.TSR.ShadingRejection.Flickering=0     // Disable if no problematic Nanite geometry at distance
r.TSR.Resurrection=0                    // Disable resurrection buffer
r.TSR.History.R11G11B10=1              // Reduce history buffer precision
```

### Addressing Upstream Instability

TSR quality is directly proportional to the temporal stability of its inputs. Improving upstream systems reduces TSR rejection rates, which reduces noise and spatial AA cost:

- Ensure all moving geometry writes correct velocity (doc 04)
- Ensure Lumen is stable — high Lumen noise increases the temporal variance TSR sees
- Ensure VSM shadow caching is working — shadow flickering drives TSR rejection
- Reduce Niagara particle noise where particles are a major screen element
- Enable `r.TSR.ShadingRejection.Flickering 1` for all scenes with significant Nanite geometry

### Switching Away From TSR

For specific project types where TSR is not the right choice:

```ini
// TAA with upsampling (UE4-era, lower base overhead, lower quality)
r.AntiAliasingMethod=2
r.TemporalAA.Upsampling=1
r.ScreenPercentage=75

// No AA (stylized/pixel art projects)
r.AntiAliasingMethod=0

// FXAA (very fast, no temporal, low quality)
r.AntiAliasingMethod=1
```

> [!WARNING]
> **Switching from TSR to TAA in a Nanite-heavy scene requires increasing `r.ScreenPercentage` to compensate for TAA's lower quality.** TSR at 66.667% commonly looks better than TAA at 100% in Nanite scenes due to TSR's superior sub-pixel detail handling. If switching to TAA for performance, you may need to run at 85–100% screen percentage to achieve equivalent perceived quality — potentially eliminating the performance gain.

---

## Mental Model

Think of TSR as:

> *"Every frame, TSR asks: 'What do I know about this pixel from all previous frames, and how much do I trust it? Then: blend the trusted history with this frame's new data, and use many frames of accumulated knowledge to reconstruct detail that no single frame could provide alone.'"*

TSR's efficiency is entirely temporal — it's doing less work per frame by reusing work from previous frames. Its quality is limited by how much of that previous work remains valid this frame. High scene stability (static camera, static lighting, slow-moving content) = maximum TSR quality at minimum cost. High scene instability (fast camera pans, flickering lights, complex Nanite at grazing angles) = TSR working hardest and producing its least stable output.

The key architectural insight is that **TSR is not post-processing — it is part of the rendering budget.** The choice of screen percentage doesn't just affect TSR cost; it directly reduces the cost of every resolution-dependent pass in the pipeline. TSR turns the rendering budget into a flexible system: render less, reconstruct more. Choosing the right screen percentage is the highest-leverage rendering decision in any UE5 project.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| VelocityParallel (doc 04) | Provides velocity buffer — TSR's most critical input; all ghosting traces here first |
| Lumen DiffuseIndirect (doc 14) | Temporal noise in Lumen directly increases TSR rejection rates |
| Lumen Reflections (doc 19) | Reflection temporal instability similarly drives rejection |
| Virtual Shadow Maps | Shadow flickering from poor VSM caching cascades into TSR instability |
| Nanite Visibility Buffer (doc 05) | Sub-pixel Nanite detail is the primary design driver for TSR's ShadingRejection system |
| DownsampleDepth (doc 21) | Half-res depth used for TSR's depth-based rejection assistance |
| Tone Mapping | Runs after TSR — receives the upscaled output |
| BaseScalability.ini | Scalability config that drives all TSR quality CVars simultaneously per-tier |

---

## Red Flags to Watch For

- **`TemporalSuperResolution` > 2ms at 1080p output** → check `r.TSR.RejectionAntiAliasingQuality` and `r.TSR.History.UpdateQuality`; both can be reduced
- **`TemporalSuperResolution` > 3ms at 4K output** → check `r.TSR.History.ScreenPercentage`; if 200, reduce to 100 immediately
- **Widespread ghosting on a specific mesh type** → velocity not correctly written for that geometry; check with `vis velocity` before adjusting any TSR CVar
- **Structured flickering on distant Nanite architecture** → `r.TSR.ShadingRejection.Flickering` may be disabled; verify it is 1 for scenes with detailed Nanite facades
- **History Resurrection causing new flickering artifacts (UE5.4+)** → disable with `r.TSR.Resurrection 0`; known to cause issues in some structured Nanite scenes
- **TSR quality significantly worse after engine upgrade** → TSR algorithm changed between versions; validate rejection CVars and screen percentage in new version context; do not assume previous settings carry forward
- **Translucent geometry leaving ghost trails** → enable `r.TSR.Translucency.EnableResponiveAA 1`; also add `Responsive AA` flag to the worst offending materials
- **Noisy re-accumulation after camera cuts** → expected behavior; History Resurrection reduces severity; if unacceptable, ensure camera cut events trigger a TSR history clear
- **TSR performing poorly at sub-50% screen percentage** → below this threshold TSR is reconstructing more than can be reliably recovered; increase screen percentage or accept the quality reduction as inherent to that budget

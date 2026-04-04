---
tags:
  - post-processing
---

# Unreal Engine 5 Rendering Pipeline – PostProcessing

> Stage: **PostProcessing**  
> Phase: Image Finalization / Cinematic Presentation  
> Purpose: Apply the full chain of image-space effects — depth of field, motion blur, exposure adaptation, bloom, lens flare, tone mapping, color grading, and presentation effects — to produce the final output image  
> Pipeline Position: After all scene rendering and TSR upscaling; final stage before display

---

## What This Stage Does

Post-processing is the final transformation of the rendered scene into the output image. Where all preceding passes compute the physical appearance of the scene, post-processing applies the **cinematic and perceptual layer** — simulating camera optics, film response, human vision adaptation, and artistic color interpretation.

Every post-processing pass operates on a fully rendered SceneColor — no geometry, no lighting evaluation, no GBuffer. Everything is fullscreen image-space operations.

**The post-process chain executes in this approximate order:**

```
Depth of Field (DiaphragmDOF)
→ Separate Translucency Composite (from translucency pass)
→ TSR Upscaling (doc 23)
→ Motion Blur
→ Local Exposure
→ Histogram Generation
→ Histogram Eye Adaptation
→ Bloom Setup → Bloom Downsample Pyramid → Bloom Upsample/Combine
→ Lens Flare
→ Tone Mapping + Color Grading + Vignette + Film Grain + Chromatic Aberration (combined pass)
→ Sharpening
→ UI Composite → Display
```

Each effect is described in detail below. Order matters — effects applied earlier affect the input to all subsequent effects.

---

## PostProcessVolume — The Settings System

Before covering individual effects, understanding how settings reach the renderer is essential. All post-processing parameters are controlled by **PostProcess Volumes** placed in the level.

### PostProcess Volume Properties

**Priority:** When multiple volumes overlap at the camera position, the volume with the highest priority wins. Priority 0 is the lowest. Equal-priority overlapping volumes blend.

**Blend Radius and Blend Weight:** The volume blends its settings with the global/default settings as the camera approaches. `Blend Radius` defines the falloff distance; `Blend Weight` defines the maximum influence (1.0 = full override when inside).

**Unbounded:** An unbounded PostProcess Volume applies its settings everywhere in the level regardless of camera position — it acts as the global default. Every level should have one unbounded volume as the global settings baseline.

**Priority Resolution:** Multiple overlapping volumes blend based on proximity and priority:
```
Final Setting = Lerp(lower_priority_setting, higher_priority_setting, blend_weight)
```

> [!WARNING]
> **Multiple PostProcess Volumes with conflicting settings and no clear priority hierarchy is one of the most common sources of unexpected post-process behavior in production.** If exposure, color grading, or bloom behaves differently in different level areas unexpectedly, check the PostProcess Volume coverage map. Use `showflag.PostProcessing 0` to confirm the effect is post-process-driven, then walk through the level with the Volume overlay enabled (level editor → Show → Post Process Volumes) to identify overlapping volumes.

### Default Post Process Settings

Settings not overridden by any volume use the project defaults from **Project Settings → Rendering → Default Post Processing Settings**. These apply globally with no volume required.

---

## Depth of Field (DiaphragmDOF)

### What It Does

Depth of Field simulates the optical blur produced by a real camera lens when subjects are outside the lens's focus range. UE5's **Cinematic DOF (DiaphragmDOF)** uses a physically based lens model with true Circle of Confusion (CoC) computation.

**The CoC calculation:**
For each pixel, scene depth is compared to the focus distance. The further a pixel is from the focal plane, the larger its Circle of Confusion — the radius of blur it should receive. Pixels exactly at the focus distance have CoC = 0 (perfectly sharp). Pixels increasingly far from focus have growing CoC values.

**The rendering pipeline for Cinematic DOF:**

1. **CoC Setup** — Compute per-pixel CoC from scene depth and camera parameters
2. **Downsample** — Reduce scene to half resolution; pack CoC with color
3. **Gather (Near Field)** — Blur near-field pixels (between camera and focus) using a gather kernel weighted by CoC. Near-field DOF produces the characteristic "bleed" where sharp objects bleed into blurred foreground
4. **Gather (Far Field)** — Blur far-field pixels (beyond focus) using gather kernel
5. **Scatter Occlusion** — Resolve near/far DOF compositing with correct occlusion at the focus transition boundary
6. **Recombine** — Combine sharp in-focus region with blurred near and far fields
7. **Bokeh Simulation** — For high-quality settings, simulate physically correct lens aperture shapes (circular, hexagonal, custom)

**Focus distance control:**
Set via `Focus Distance` in PostProcess Volume → Lens → Depth of Field. Can be driven by a Blueprint-managed focal actor for gameplay-driven focus.

**Physical lens simulation:**
When using the physical camera model (`r.DOF.Algorithm 1`), DOF parameters map to real camera properties:
- **Aperture (f-stop)** — lower f-stop = shallower depth of field = more blur
- **Focal Length** — longer focal lengths compress depth of field
- **Sensor width** — affects field of view and DOF range

### Why DoF Is Expensive

DoF is one of the most expensive post-process effects because:
- It operates on multiple resolution levels simultaneously
- The gather kernel radius scales with CoC — large blur = many samples per pixel
- Near and far field require separate passes with different blending logic
- High-quality bokeh shapes add per-kernel evaluation complexity

**Cost scales with:**
- `MaxBackgroundRadius` and `MaxForegroundRadius` — larger blur radius = more samples per pixel
- Screen coverage of blurred regions — more out-of-focus pixels = more work
- Bokeh quality setting — physically correct shapes cost more than approximations

### Debugging Depth of Field

```
r.DOF.TemporalAAJitter 0/1          // Toggle temporal jitter in DOF sampling.
                                     // 0 = consistent, less noisy but may show pattern.
                                     // Useful to evaluate DOF quality without temporal noise.

showflag.DepthOfField 0             // Disable DOF entirely — compare GPU time to find DOF cost.

r.DOF.Algorithm 0                   // Switch to Gaussian DOF (simpler, cheaper).
                                     // Compare quality vs Cinematic DOF (1) for your content.

// Visualize DOF regions:
// In the PostProcess Volume, enable Debug → DOF visualization
// Shows: red=near DOF, blue=far DOF, green=in-focus
```

**Unreal Insights events:**

| Event | What It Tells You |
|-------|------------------|
| `DiaphragmDOF` | Total cinematic DOF cost |
| `DOFCocSetup` | Circle of Confusion computation |
| `DOFGatherFarField` | Far-field blur gather pass |
| `DOFGatherNearField` | Near-field blur gather pass |
| `DOFRecombine` | Final sharp/blurred composition |

### DoF Optimization

```
r.DOF.Algorithm 0                   // Gaussian DOF — cheaper, less physically accurate.
                                     // Acceptable for background blur where bokeh shape
                                     // is not a visual requirement.

r.DOF.Kernel.MaxBackgroundRadius    // Max blur radius for far-field DOF (pixels at half res).
                                     // Reduce to limit maximum blur size and sample count.
                                     // Smaller = cheaper, less dramatic blur at max distance.

r.DOF.Kernel.MaxForegroundRadius    // Max blur radius for near-field DOF.
                                     // Near-field DOF is often imperceptible — consider
                                     // reducing this aggressively on lower-end platforms.

r.DepthOfFieldQuality 0/1/2/3       // Overall DOF quality level.
                                     // 0 = disabled, 1 = low (Gaussian), 2 = high, 3 = cinematic.
                                     // Most impactful single DOF CVar.

r.HalfResDOF 0/1                    // Force half-resolution DOF processing.
                                     // Reduces cost by 75%; may show edge artifacts at high resolution.
```

> [!WARNING]
> **Cinematic DOF with large blur radii and physically based bokeh is one of the most expensive single post-process effects.** A scene with the entire background out of focus at a large aperture can make DOF the most expensive post-process pass in the frame. This is usually intentional for cinematic shots but should be profiled explicitly. Consider per-camera-position quality settings that enable expensive DOF only during cinematic moments where it's visible and intentional.

---

## Motion Blur

### What It Does

Motion blur simulates the exposure smearing of a real camera sensor as subjects move during the shutter's open period. UE5's motion blur uses the velocity buffer (doc 04) to determine per-pixel motion direction and magnitude, then performs a per-pixel multi-sample trace along the velocity vector to produce blur.

**The rendering pipeline:**

1. **Velocity Flatten** — Downsample and tile velocity buffer; compute max velocity per tile
2. **Tile Classification** — Identify tiles by motion type (static, small motion, large motion)
3. **Scatter / Gather** — For each output pixel, trace backward along the velocity vector, accumulating color samples
4. **Velocity Magnitude → Sample Count** — Faster motion = more samples to cover the velocity distance = more expensive
5. **Composition** — Blend motion-blurred result with static pixels (stationary objects receive no blur)

**Camera motion blur** vs **object motion blur:**
Camera motion blur comes from the per-frame camera transform difference — all static objects blur in the direction opposite to camera movement. Object motion blur comes from the velocity buffer written by dynamic objects (doc 04). Both use the same pass and the same sample accumulation approach.

### Why Motion Blur Is Expensive

- Runs at full output resolution (post-TSR)
- Each blurred pixel traces N samples along its velocity vector
- Higher velocity = longer trace = more samples = more SceneColor reads
- Fast-moving objects with many pixels in their trail are the worst case
- The cost is not uniform — fast regions cost much more than slow regions

### Debugging Motion Blur

```
showflag.MotionBlur 0               // Disable motion blur — measures its GPU cost precisely.

r.MotionBlurQuality 0               // Disable motion blur via quality setting.

// vis velocity                      // (From VelocityParallel doc) Shows velocity buffer.
                                     // High velocity areas correspond to expensive blur regions.

r.MotionBlur.Max [0.5]              // Max velocity clamp. Set to 0 to effectively disable.
                                     // Useful to see which regions are within budget.
```

**Unreal Insights events:**

| Event | What It Tells You |
|-------|------------------|
| `MotionBlur` | Total motion blur pass cost |
| `MotionBlurVelocityFlatten` | Velocity tile preparation |
| `MotionBlurScatterAndGather` | The primary sample accumulation cost |

### Motion Blur Optimization

```
r.MotionBlurQuality [0-4]           // Quality level — primary motion blur cost lever.
                                     // 0 = disabled.
                                     // 1 = low (4 samples).
                                     // 2 = medium (6 samples) — good quality/perf balance.
                                     // 3 = high (8 samples).
                                     // 4 = cinematic (16 samples).

r.MotionBlur.Amount [0.5]           // Motion blur strength multiplier.
                                     // Reduce to produce less visible blur with fewer visible artifacts.
                                     // Does not directly reduce sample count.

r.MotionBlur.Max [0.5]              // Maximum velocity in NDC space that motion blur applies to.
                                     // Clamping max velocity limits the longest blur traces.
                                     // 0.5 = 50% of screen width max displacement.
                                     // Lower = fewer extreme-velocity traces = cheaper.

r.MotionBlur.TargetFPS [0]          // If non-zero, normalizes motion blur to a target frame rate.
                                     // Ensures consistent blur amount regardless of actual frame rate.
                                     // 0 = disabled (blur scales with actual frame time).

r.MotionBlurSeparability [0]        // Enables separable (two-pass) motion blur.
                                     // Higher quality for complex motion at higher cost.
```

> [!WARNING]
> **Motion blur at `r.MotionBlurQuality 4` (16 samples) with fast-moving content across large screen areas can make motion blur the most expensive post-process pass in the frame.** An action game with fast camera pans and many dynamic objects can see motion blur exceeding 3ms at cinematic quality. Profile motion blur explicitly at worst-case action sequences — rapid camera pans, explosion sequences, racing content. `r.MotionBlurQuality 2` (6 samples) is usually indistinguishable from higher settings in motion.

---

## Eye Adaptation (Auto Exposure)

### What It Does

Auto exposure (eye adaptation) simulates how the human eye and camera sensors adjust to scenes of different overall brightness — a tunnel exit appearing briefly very bright before adjusting, a dimly lit room appearing gradually brighter as the eye adapts.

UE5's auto exposure pipeline has three components:

### Histogram Generation

A 64-bucket luminance histogram is built from a downsampled version of the scene each frame. Each pixel's luminance is computed and placed into the appropriate histogram bucket. The histogram represents the distribution of luminance values across the frame — how many pixels are very dark, mid-toned, or very bright.

The histogram builds at reduced resolution for efficiency. It excludes pixels outside the configured luminance range (`Min EV100` and `Max EV100`).

```
r.EyeAdaptation.HistogramLog2Min    // Minimum luminance value included in histogram (log2 EV)
r.EyeAdaptation.HistogramLog2Max    // Maximum luminance value included in histogram (log2 EV)
```

### Histogram Eye Adaptation

Using the histogram, the adaptation algorithm determines the scene's "representative luminance" and computes the exposure correction needed to bring it to the target brightness.

**Method 1: Basic (average luminance)**
Computes the arithmetic mean of scene luminance. Simple and fast, but sensitive to extreme bright or dark pixels skewing the average.

**Method 2: Histogram-based (default)**
Uses histogram percentiles — the Nth percentile luminance is used as the reference. This ignores extreme outliers (a single very bright pixel doesn't ruin the exposure; a tiny dark corner doesn't crush the exposure). Controlled by `Low Percent` and `High Percent` settings.

The adaptation value updates gradually based on `Speed Up` and `Speed Down` settings:
- **Speed Up** — how fast exposure increases when the scene gets brighter (eye adjusting from dark to bright = slow in reality)
- **Speed Down** — how fast exposure decreases when the scene gets darker (eye adjusting from bright to dark = fast in reality, but usually reversed for game cameras)

The adapted exposure value persists in a small GPU buffer that is read back and updated each frame — it's a persistent single-value state.

```
r.EyeAdaptation.Method 0/1/2/3     // 0=legacy, 1=histogram (default), 2=basic, 3=manual
r.EyeAdaptation.SpeedUp [3.0]      // Exposure decrease speed (scene getting brighter)
r.EyeAdaptation.SpeedDown [1.0]    // Exposure increase speed (scene getting darker)
r.EyeAdaptation.LensAttenuation    // Simulated lens vignetting effect on exposure
```

**Manual exposure:**
Setting `r.EyeAdaptation.Method 3` and configuring fixed EV100 values in the PostProcess Volume gives full manual control — no auto adaptation, exposure is fixed. Essential for competitive multiplayer games where consistent perceived brightness is required regardless of environment.

> [!NOTE]
> **Auto exposure can be a source of inconsistent perceived gameplay fairness.** A player moving from a bright outdoor area to a dark interior will have their screen temporarily very dark as eye adaptation catches up — a disadvantage in competitive scenarios. Manual exposure or a constrained adaptation range (`Min Brightness` / `Max Brightness`) are common solutions for multiplayer games. Always profile how aggressively the adaptation range and speed affect gameplay perception.

### Debugging Eye Adaptation

```
r.EyeAdaptation.MethodOverride 2   // Force basic method — simpler, easier to understand behavior.

r.EyeAdaptation.SpeedUp 99        // Max adaptation speed — instant adaptation for debugging.
r.EyeAdaptation.SpeedDown 99      // Instant darkness adaptation.
// Use both at 99 to test exposure values without waiting for adaptation.

showflag.EyeAdaptation 0          // Disable eye adaptation — scene renders at fixed default exposure.
                                   // Essential for isolating whether exposure is causing
                                   // apparent lighting issues vs actual lighting problems.

r.EyeAdaptation.DebugKey [0]      // Debug keys for exposure adjustment in editor.
```

**Unreal Insights events:**

| Event | What It Tells You |
|-------|------------------|
| `EyeAdaptation` | Total adaptation pipeline cost |
| `EyeAdaptationHistogramBuildUp` | Histogram construction pass |
| `EyeAdaptationHistogramEyeAdaptation` | Adaptation computation from histogram |

---

## Local Exposure (UE5.1+)

### What It Does

Global auto exposure applies a single exposure correction to the entire frame. **Local Exposure** applies spatially varying exposure — independently brightening dark regions and darkening bright regions within the same frame.

The effect is similar to what photographers call "dodging and burning" — lifting shadow detail in dark areas while preserving highlight detail in bright areas simultaneously.

**How it works:**
1. The screen is divided into a grid of regions
2. A bilateral grid is constructed — a 3D structure that stores luminance per spatial region
3. Local exposure correction is computed per region by comparing local luminance to global average
4. The per-region correction is applied to SceneColor with spatial blending between regions

The bilateral grid ensures smooth transitions between regions without hard boundaries. The correction is conservative — it cannot fully compensate for extreme dynamic range but reduces the visibility of the single-exposure limitation.

**Key controls:**
- `Highlight Contrast Scale` — how aggressively bright regions are darkened
- `Shadow Contrast Scale` — how aggressively dark regions are brightened
- `Detail Strength` — preserves local micro-contrast within each region
- `Bilateral Grid Size` — resolution of the correction grid

```
r.LocalExposure.Enable 0/1                    // Master toggle for local exposure
r.LocalExposure.HighlightContrastScale [0.8]  // Highlight suppression (0-1)
r.LocalExposure.ShadowContrastScale [0.8]     // Shadow lifting (0-1)
r.LocalExposure.BilateralGridSize [16]        // Grid resolution — larger = finer regions
r.LocalExposure.DetailStrength [1.0]          // Micro-contrast preservation
```

> [!NOTE]
> **Local Exposure is particularly effective for outdoor scenes where bright sky and shadowed interiors are simultaneously visible.** Without local exposure, the scene must choose: expose for the sky (interior is crushingly dark) or expose for the interior (sky is blown out). Local exposure can reduce both problems simultaneously. It is not a substitute for good lighting — it is a recovery tool for scenes with inherently high dynamic range.

### Debugging Local Exposure

```
r.LocalExposure.Enable 0            // Toggle to see before/after comparison

// Visualize the correction map:
r.LocalExposure.VisualizeType 1     // Shows per-region exposure correction as a color map
                                     // Blue = correction brightening that region
                                     // Red = correction darkening that region
                                     // Green = no correction needed
```

---

## Bloom

### What It Does

Bloom simulates the optical spreading of intense light sources on a camera sensor or film — very bright areas appear to emit a glow that bleeds beyond their physical boundaries. Without bloom, bright light sources appear as flat bright pixels; with bloom they appear to radiate energy into the surrounding area.

### Standard Bloom (Gaussian Pyramid)

UE5's standard bloom builds a downsampling pyramid and then upsamples to combine contributions from different scales:

1. **Threshold** — Only pixels above the bloom threshold contribute (prevents the entire scene from glowing)
2. **Downsample** — Scene is progressively downsampled: full → 1/2 → 1/4 → 1/8 → 1/16 → 1/32 resolution
3. **Accumulate** — Each downsample level is blurred and accumulated with a tint color and size multiplier
4. **Upsample** — Accumulated levels are progressively upsampled and composited
5. **Add to scene** — Final bloom is additively blended over the scene

Six levels (Bloom 1-6) each contribute a different scale of bloom glow, each with independently controllable size and tint. Bloom 1 is the smallest/sharpest; Bloom 6 is the widest/softest. Each level's tint can be used for artistic chromatic bloom effects (blue-tinted large blooms, warm small blooms).

**Threshold control:**
- `Bloom Threshold` — minimum brightness to produce bloom. Values below this don't bloom.
- `Bloom Intensity` — global bloom strength multiplier
- `-1` threshold = everything blooms (no cutoff), including dark materials

### Convolution Bloom

Physically accurate bloom using FFT (Fast Fourier Transform) convolution with a kernel texture:
- The kernel texture defines the bloom shape — can represent real lens diffraction patterns, anamorphic streaks, star patterns
- Convolution bloom produces exact physical results but is significantly more expensive than Gaussian
- `r.Bloom.Convolution` — master toggle
- Cost is approximately 3-5× more expensive than standard bloom

```
r.BloomQuality [5]                  // Standard bloom quality (1-5).
                                     // Higher = more accurate Gaussian approximation.
                                     // 5 = high quality; 1 = cheapest.
                                     // 0 = disabled entirely.

r.Bloom.Convolution 0/1             // Toggle convolution bloom (expensive — see warning below)

r.Bloom.Convolution.ScatterDispersion // Controls convolution bokeh shape size
```

> [!WARNING]
> **Convolution bloom is significantly more expensive than standard bloom and is rarely necessary for real-time rendering.** Unless the specific lens artifact pattern produced by convolution bloom is a deliberate visual requirement for the project's aesthetic, standard bloom produces visually comparable results at a fraction of the cost. Always profile convolution vs standard bloom in your specific scene before committing to it.

### Debugging Bloom

```
showflag.Bloom 0                    // Disable bloom entirely — measures bloom GPU cost.
                                     // Compare frame time with and without to quantify budget.

r.BloomQuality 0                    // Disable via quality setting.

// In PostProcess Volume:
// Set Bloom Intensity to 0 for a specific volume to isolate its bloom contribution.
// Set Bloom Threshold very high (10+) to see what the scene looks like without threshold pixels.
```

**Unreal Insights events:**

| Event | What It Tells You |
|-------|------------------|
| `BloomSetup` | Initial bloom threshold and downsample setup |
| `BloomDownsample` | Multiple events — each downsample level |
| `BloomUpsample` | Upsample and combine phases |
| `BloomApply` | Final bloom application to scene |

### Bloom Optimization

```
r.BloomQuality [3]                  // Reduce from 5 to 3 — usually imperceptible difference.
                                     // Most impactful single bloom optimization.

// In PostProcess Volume settings:
// Bloom Threshold [1.0]            // Default. Increase to reduce which pixels contribute.
                                     // Setting to 2.0 means only 2× above display white blooms.
                                     // Prevents subtle mid-brightness areas from adding bloom cost.

// Bloom Intensity [1.0]            // Reduce for aesthetic preference without cost change.
                                     // Bloom cost is determined by what blooms, not how intense.
```

> [!NOTE]
> **Bloom threshold significantly affects which scene elements contribute.** A scene with many emissive materials, many bright light sources, or HDR sky regions will have more bloom contributors than an interior with controlled lighting. High bloom threshold reduces contributor count (cheapens the effect); low threshold (or -1) means everything contributes regardless of brightness. Setting threshold appropriately for your scene prevents bloom from processing pixels that will contribute imperceptibly.

---

## Lens Flare

### What It Does

Lens flares simulate the internal reflections and diffractions produced when intense light sources interact with camera lens elements — bright points of light producing hexagonal or circular artifact patterns across the image.

UE5's lens flare system:
1. Identifies bright source pixels above a threshold
2. Generates flare elements (ghosts, halos, streaks) at positions mirrored across the screen center from the source
3. Each bright source generates multiple flare elements at different scales and colors
4. Composited additively over the scene

**Cost:** Scales with the number and intensity of bright sources. A nighttime scene with many bright light sources can have significantly more expensive lens flare than a daytime scene with a single sun.

```
r.LensFlare.Quality [3]             // Lens flare quality (0-4).
                                     // 0 = disabled. Reduce for performance.

showflag.LensFlares 0               // Disable lens flares — measures their cost.
```

> [!NOTE]
> **Lens flares are often disabled in game projects for competitive fairness reasons** — large lens flares over critical screen areas (enemy positions, objective markers) reduce visual clarity. Evaluate whether the aesthetic value justifies the fairness cost for your specific project type.

---

## Tone Mapping

### What It Does

Tone mapping converts the scene's HDR (High Dynamic Range) floating point values into the LDR (Low Dynamic Range) 0-1 range that display devices output. Without tone mapping, the scene's HDR values would simply clip to white at any value above 1.0.

**UE5's ACES Filmic Tone Mapping:**
UE5 uses the **ACES (Academy Color Encoding System)** tone mapping curve by default — an industry-standard curve designed to preserve highlight detail while producing film-like color response.

The ACES curve:
- Lifts shadows slightly (black is not pure black)
- Compresses highlights (very bright regions are preserved rather than clipped)
- Produces a characteristic S-curve response that mimics film stock

**Alternative tone mappers:**
- `r.Tonemapper.FilmicBloom 0` — disables filmic response for a more linear look
- Custom tone mapping curves via `r.Tonemapper.Quality`
- Full bypass via `r.Tonemapper.GammaOnly 1` — applies only gamma correction, no filmic curve

```
r.Tonemapper.Quality [1]            // Tone mapper quality (0-2).
                                     // 0 = fastest (lower precision). 1 = default. 2 = high.

r.Tonemapper.FilmicBloom [1]        // Enable/disable filmic bloom integration in tonemapper.

r.Tonemapper.GammaOnly [0]          // Bypass ACES — apply only gamma correction.
                                     // Use for projects with custom tone mapping in materials.
```

---

## Color Grading

### What It Does

Color grading applies the project's artistic color treatment to the final image — saturation adjustments, contrast curves, color balance, and the overall "look" of the project. In UE5, color grading is applied through:

1. **PostProcess Volume settings** — Sliders for shadows/midtones/highlights color balance, global saturation, contrast, gamma
2. **Color Grading LUT** — A 3D 32×32×32 texture that maps input RGB values to output RGB values. Any color transform can be baked into a LUT — color grading from Photoshop, DaVinci Resolve, or any DCC tool can be applied in realtime via LUT.

**LUT application:**
The LUT is applied after tone mapping — the tonemapped LDR values are looked up in the 3D LUT to produce the final graded output. This happens in the same GPU pass as tone mapping (the combined Tone Mapping + Color Grading pass).

```
r.ColourGrading.Enable 1/0          // Toggle color grading

// LUT settings in PostProcess Volume:
// Color Grading LUT Intensity [1.0] — blend between no grading (0) and full LUT (1)
// Color Grading LUT — assign the 32×32×32 or 64×64×64 LUT texture asset
```

> [!TIP]
> **The combined Tone Mapping + Color Grading pass is extremely cheap** — it's a single fullscreen pass with LUT sampling. Don't optimize it independently; focus on the more expensive effects above if frame time is the concern.

---

## Secondary Effects — Complete Reference

These effects are typically inexpensive individually but accumulate when all enabled simultaneously. They often run combined into a single fullscreen pass with tone mapping.

### Chromatic Aberration

Simulates the color fringing produced by imperfect lens optics — red, green, and blue channels are offset slightly from each other, producing color fringing at the edges of bright details.

```
// In PostProcess Volume → Lens → Image Effects:
// Chromatic Aberration Intensity [0.0]   // 0 = disabled. 0-5 is typical range.
// Chromatic Aberration Start Offset [0.0] // 0 = affects entire frame. 1 = only screen corners.

r.ChromaticAberration 0/1           // Master toggle
```

**Performance:** Negligible — three offset texture samples in the combined pass.

### Vignette

Darkens the image toward the corners, simulating real lens falloff and focusing the viewer's attention toward the center.

```
// In PostProcess Volume → Lens → Image Effects:
// Vignette Intensity [0.4]          // 0 = no vignette. 1 = strong darkening at corners.
```

**Performance:** Essentially free — a per-pixel multiply in the combined pass.

### Film Grain

Adds frame-to-frame noise variation simulating the grain of film stock.

```
// In PostProcess Volume → Film → Grain:
// Grain Intensity [0.0]             // 0 = no grain.
// Grain Jitter [0.0]                // Frame-to-frame variation.
// Grain Density [1.0]               // Spatial frequency of grain pattern.

r.FilmGrain 0/1                     // Master toggle
```

**Performance:** Negligible — texture sample in the combined pass.

### Sharpening (Post-TSR)

Applies spatial sharpening to the final image after TSR upscaling. TSR's temporal accumulation can produce slight softness; sharpening recovers perceived detail.

```
r.Tonemapper.Sharpen [0.0]          // Sharpening strength. 0 = none. 1 = strong.
                                     // Applied in the combined tonemapping pass.
                                     // Too high = haloing at edges; keep at 0.2-0.5 range.
```

### Panini Projection

An alternative projection that reduces the fisheye distortion visible at wide fields of view. Warps the image to maintain straight lines at the cost of scale variation across the frame.

```
r.PaniniProjection 0/1              // Toggle Panini projection
r.PaniniProjection.D [0.0]          // Panini distance parameter — strength of correction
```

---

## Pre-Exposure Pipeline

### What It Is

Pre-exposure is an optimization pipeline where the scene is rendered at a pre-adjusted exposure level rather than applying exposure correction purely in post-processing.

**Why it exists:** Floating-point precision limitations mean that HDR values orders of magnitude different from the display range suffer from precision loss in intermediate buffers. Pre-exposure scales all lighting by the anticipated exposure at render time, keeping intermediate values closer to the representable range.

**Impact on workflow:** Pre-exposure is mostly transparent, but it means that raw SceneColor values in render targets are already exposure-adjusted — a material reading from scene color during rendering sees pre-exposed values. This matters for screen-space effects that sample SceneColor.

```
r.UsePreExposure 1/0                // Toggle pre-exposure (default 1)
r.EyeAdaptation.PreExposureMin      // Minimum pre-exposure clamp
r.EyeAdaptation.PreExposureMax      // Maximum pre-exposure clamp
```

---

## Debugging the Post-Process Chain — Complete Guide

### Step 1: Isolate Total Post-Process Cost

```
showflag.PostProcessing 0           // Disable ALL post-processing.
                                     // Compare frame time — this is your total post-process budget.
                                     // Warning: this is very aggressive and will look wrong,
                                     // but the GPU time delta is accurate.
```

### Step 2: Isolate Individual Effects

Disable effects one by one to identify which are the primary cost contributors:

```
// In approximate cost order (high → low for typical scenes):
showflag.DepthOfField 0            // Cinematic DOF — often most expensive
showflag.MotionBlur 0              // Motion blur — significant at quality 3+
showflag.Bloom 0                   // Standard bloom — moderate cost
r.LocalExposure.Enable 0           // Local exposure — moderate
showflag.EyeAdaptation 0           // Eye adaptation — low cost
showflag.LensFlares 0              // Lens flare — variable
showflag.TemporalAA 0              // TSR/TAA — covered in doc 23
```

After each disable, compare GPU time to establish which effect is your budget leader.

### Step 3: Profile in Unreal Insights

**Complete Unreal Insights event reference for post-processing:**

| Event | Effect | What It Tells You |
|-------|--------|------------------|
| `DiaphragmDOF` | Depth of Field | Total cinematic DOF cost |
| `DOFGatherNearField` | DoF | Near-field blur gather |
| `DOFGatherFarField` | DoF | Far-field blur gather |
| `DOFRecombine` | DoF | Final DoF composition |
| `MotionBlur` | Motion Blur | Total motion blur cost |
| `MotionBlurScatterAndGather` | Motion Blur | Primary sample accumulation |
| `EyeAdaptation` | Exposure | Histogram and adaptation |
| `EyeAdaptationHistogramBuildUp` | Exposure | Histogram construction |
| `LocalExposure` | Local Exposure | Bilateral grid and application |
| `BloomSetup` | Bloom | Initial bloom threshold pass |
| `BloomDownsample` (×6) | Bloom | Each downsample level |
| `BloomUpsample` (×6) | Bloom | Each upsample level |
| `LensFlare` | Lens Flare | Flare generation and composition |
| `Tonemapping` | Tone Map + Grade | Combined tonemapping + LUT + vignette + grain pass |
| `TemporalSuperResolution` | TSR | Covered in doc 23 |

### Step 4: Platform Comparison

Profile post-processing costs across target platforms — effects that are cheap on PC may be expensive on console or mobile due to different memory bandwidth and shader throughput characteristics.

```
// Build a profiling test that enables each effect individually:
// Baseline frame time (all PP off) → add DOF → add MB → add Bloom → etc.
// This gives exact per-effect costs for each platform.
```

### Step 5: Visualize Individual Effects

```
// DOF:
// PostProcess Volume → Debug → Camera → show circle of confusion

// Eye Adaptation:
r.EyeAdaptation.DebugDump 1         // Log current exposure value to output log
showflag.EyeAdaptation 0            // Compare scene appearance without adaptation

// Local Exposure:
r.LocalExposure.VisualizeType 1     // Show correction map (blue=bright, red=dark)

// Bloom:
showflag.Bloom 0                    // Toggle to isolate bloom contribution visually

// Tone Mapping:
r.Tonemapper.GammaOnly 1            // Bypass ACES — see scene in linear space
```

---

## Optimization Strategies — Complete Reference

### Priority Order for Post-Process Optimization

1. **Depth of Field** — Most expensive; largest optimization potential
2. **Motion Blur** — High cost at quality 3-4; large savings at quality 1-2
3. **Local Exposure** — Medium cost; can be disabled on lower-end tiers
4. **Bloom** — Low-medium cost; convolution bloom is the expensive variant
5. **Eye Adaptation** — Low cost; rarely a bottleneck
6. **Lens Flare** — Variable; disable for competitive titles
7. **Secondary effects** — Individually negligible; combined adds up

### Post-Process Quality Scalability Config

```ini
// BaseScalability.ini — example PostProcessQuality tiers

[PostProcessQuality@0]  // Low
r.DepthOfFieldQuality=0
r.MotionBlurQuality=1
r.BloomQuality=2
r.LensFlare.Quality=0
r.LocalExposure.Enable=0
r.Tonemapper.Sharpen=0

[PostProcessQuality@1]  // Medium
r.DepthOfFieldQuality=1
r.MotionBlurQuality=2
r.BloomQuality=3
r.LensFlare.Quality=1
r.LocalExposure.Enable=1
r.Tonemapper.Sharpen=0.2

[PostProcessQuality@2]  // High
r.DepthOfFieldQuality=2
r.MotionBlurQuality=3
r.BloomQuality=4
r.LensFlare.Quality=2
r.LocalExposure.Enable=1
r.LocalExposure.BilateralGridSize=16

[PostProcessQuality@3]  // Epic
r.DepthOfFieldQuality=3
r.MotionBlurQuality=4
r.BloomQuality=5
r.Bloom.Convolution=0       // Still off — profile before enabling
r.LensFlare.Quality=3
r.LocalExposure.Enable=1
r.LocalExposure.BilateralGridSize=32
r.OIT.SortedPixels.Enable=1
```

### Platform-Specific Targets

| Platform | DOF | Motion Blur | Bloom | Notes |
|----------|-----|------------|-------|-------|
| PC High | Cinematic | Quality 3 | Quality 5 | Enable all |
| PC Mid | Cinematic | Quality 2 | Quality 3 | Reduce kernel radii |
| Console | Cinematic or Gaussian | Quality 2 | Quality 3 | Per-game calibration |
| Mobile | Gaussian or off | Quality 1 | Quality 2 | Disable local exposure |

### Global Console Variables Reference

```
// Complete post-processing CVar reference for production configs:

// Depth of Field
r.DepthOfFieldQuality [0-3]
r.DOF.Algorithm [0-1]               // 0=Gaussian, 1=Cinematic
r.DOF.Kernel.MaxBackgroundRadius    // Max far-field blur radius
r.DOF.Kernel.MaxForegroundRadius    // Max near-field blur radius
r.HalfResDOF [0/1]                  // Half-resolution DOF processing

// Motion Blur
r.MotionBlurQuality [0-4]
r.MotionBlur.Amount [0.5]
r.MotionBlur.Max [0.5]
r.MotionBlur.TargetFPS [0]

// Eye Adaptation
r.EyeAdaptation.Method [0-3]
r.EyeAdaptation.SpeedUp [3.0]
r.EyeAdaptation.SpeedDown [1.0]

// Local Exposure
r.LocalExposure.Enable [0/1]
r.LocalExposure.HighlightContrastScale [0.8]
r.LocalExposure.ShadowContrastScale [0.8]
r.LocalExposure.BilateralGridSize [16]

// Bloom
r.BloomQuality [0-5]
r.Bloom.Convolution [0/1]

// Lens Flare
r.LensFlare.Quality [0-4]

// Tone Mapping
r.Tonemapper.Quality [0-2]
r.Tonemapper.Sharpen [0.0]
r.Tonemapper.GammaOnly [0/1]        // Debug: bypass ACES

// Film Grain
r.FilmGrain [0/1]

// Chromatic Aberration
r.ChromaticAberration [0/1]
```

---

## Key Systems and Components

### DiaphragmDOF (Cinematic DOF)
UE5's physically based depth of field implementation. Uses a gather-based kernel approach where each output pixel samples a neighborhood weighted by CoC size. Separate near-field and far-field passes handle the different compositing requirements of foreground blur (bleeding over sharp objects) vs background blur (sharp objects bleeding in front of blurred background). The most expensive DOF method but the most cinematically accurate.

### Eye Adaptation Buffer
A persistent single-value GPU buffer that stores the current adapted luminance. Updated each frame based on the histogram result and adaptation speed settings. Persists across frames — adaptation is continuous. This buffer is read by the tone mapping pass to scale scene luminance to the correct display range. Its persistence is what produces the visible "adjusting" effect when moving between differently lit areas.

### Bloom Pyramid
The multi-resolution structure that makes multi-scale bloom efficient. Rather than applying Gaussian blur at the final resolution (prohibitively expensive for large blur radii), the image is progressively downsampled and each level is blurred, then all levels are progressively upsampled and accumulated. A 1/32-resolution level bloom represents a very wide glow at minimal cost; 1/2-resolution represents a tight sharp bloom around bright edges.

### ACES Tonemapping
The Academy Color Encoding System tonemapping curve — an industry-standard HDR → LDR transform designed for film production. Preserves highlight detail through compression rather than clipping; lifts shadows slightly for film-like response. The filmic S-curve is what gives UE5 projects their characteristic look compared to linear or gamma-only rendering.

### LUT (Look-Up Table) Color Grading
A 32×32×32 (or 64×64×64) 3D texture where each voxel represents the output color for a given input RGB. Any color transform from any grading tool can be baked into a LUT and applied at near-zero runtime cost. The LUT encodes the entire color pipeline — primary corrections, secondary adjustments, creative looks — into a single texture sample per pixel.

---

## 📋 Reader Notes

> [!NOTE]
> **Post-processing is the final defense against a scene that is technically correct but visually incorrect.** Over-relying on post-process correction for issues that should be solved at the lighting or content level is a common project anti-pattern. Exposure compensation, bloom, and color grading cannot substitute for correctly lit scenes. Use post-processing to enhance correct scene data, not to rescue fundamentally incorrect lighting.

> [!NOTE]
> **The combined Tone Mapping + Color Grading + Secondary Effects pass is nearly free relative to the effects preceding it.** Tone mapping, LUT grading, chromatic aberration, vignette, grain, and sharpening all run together in a single pass at negligible GPU cost. Do not spend optimization effort on these — they are not meaningfully impactful on frame time in any real production scenario. Focus on DoF, motion blur, and bloom.

> [!NOTE]
> **Post-processing effects interact with TSR in ways that affect the optimal effect ordering.** Effects that run before TSR (typically DoF) receive TSR's temporal stability benefits in their output — DoF blur is temporally stable because TSR smooths the per-frame variation in the gather samples. Effects that run after TSR (motion blur, bloom, tone mapping) operate on the fully upscaled image and don't benefit from TSR's history.

> [!NOTE]
> **PostProcess Volumes affect ALL cameras by default** — the game camera, any scene captures, and cinematic cameras. A PostProcess Volume configured for gameplay may produce incorrect exposure or bloom settings on scene captures used for reflections or UI elements. Use the `Camera Only` flag or carefully set volume extents to avoid applying game-tuned post-process settings to non-game cameras.

---

## Mental Model

Think of the post-processing chain as:

> *"The scene has been physically rendered — now simulate how a camera would capture it, how film would record it, and how a colorist would grade it, in that order."*

Post-processing proceeds from physical simulation (DoF, motion blur — what the camera lens and sensor do) through perceptual simulation (eye adaptation — how human vision adjusts) through artistic finalization (bloom, color grading, tone mapping — how the final image is stylized for the project's look).

Each step in the chain operates on the accumulated result of all previous steps. DoF blur affects what bloom has to work with. Exposure adaptation affects what tone mapping produces. Tone mapping affects what color grading sees. Understanding this cascade is essential for diagnosing when an effect looks wrong — the cause may be two or three steps earlier in the chain.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| TSR (doc 23) | Runs within the post-process chain — upscaling before motion blur and final passes |
| VelocityParallel (doc 04) | Provides velocity buffer consumed by motion blur |
| Translucency (doc 32) | Translucency composited before post-processing chain begins |
| DownsampleDepth (doc 21) | Half-resolution depth used by DoF CoC calculation |
| SkyAtmosphere (doc 25) | Bloom interacts with bright atmospheric elements |
| PostProcessVolume | Settings delivery system for all post-process parameters |
| Eye Adaptation Buffer | Persistent GPU buffer carrying adapted luminance across frames |

---

## Red Flags to Watch For

- **Post-processing > 4ms total** → `showflag.PostProcessing 0` to confirm; then isolate per-effect with individual show flags; DoF and motion blur are most likely culprits
- **Cinematic DOF with large blur radii always active** → evaluate whether full cinematic quality is needed outside of cutscene moments; `r.DepthOfFieldQuality 1` for gameplay camera
- **`r.MotionBlurQuality 4`** → rarely justified at runtime; 4 is cinematic mode (16 samples); use 2 or 3 for gameplay; reserve 4 for cinematics
- **Convolution bloom enabled (`r.Bloom.Convolution 1`)** → confirm intentional; verify whether standard bloom achieves acceptable results; convolution bloom is 3-5× more expensive
- **Auto exposure adapting aggressively during gameplay** → `Min Brightness` / `Max Brightness` clamp range too wide; constrain range or switch to manual exposure for competitive gameplay
- **Eye adaptation disabled but exposure looks wrong** → exposure issue is in scene lighting or PostProcess Volume settings, not adaptation — `showflag.EyeAdaptation 0` comparison confirms
- **Bloom everywhere, including dark geometry** → `Bloom Threshold` set too low or -1; increase threshold to prevent non-bright areas from contributing
- **Color grading LUT showing banding** → LUT resolution too low (32³ showing limits); use 64³ LUT for high-quality grading
- **Post-process settings not applying in specific level areas** → PostProcess Volume priority or blend radius issue; check Volume overlap with `Show → Post Process Volumes` in editor
- **Scene captures showing incorrect exposure or bloom** → game PostProcess Volume applying to capture cameras; restrict volumes with `Camera Only` flag or precise extents

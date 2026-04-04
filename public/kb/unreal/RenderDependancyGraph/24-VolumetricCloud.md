---
tags:
  - volumetric-clouds
---

# Unreal Engine 5 Rendering Pipeline – Volumetric Cloud

> Stage: **VolumetricCloud**  
> Phase: Atmospheric Rendering / Volumetric Ray March  
> Purpose: Full-quality volumetric ray march of cloud density fields with direct lighting, self-shadowing, and depth-correct compositing against rendered scene geometry  
> Pipeline Position: After `BasePass` and shadow passes, before translucency and final composition

---

## What This Stage Does

The VolumetricCloud pass performs the **primary volumetric ray march** through UE5's cloud system — evaluating cloud density, in-scattering, and self-shadowing for every pixel where clouds are visible, then compositing the result correctly against rendered scene geometry using depth.

For each pixel where a cloud ray intersects the cloud layer:
1. A hierarchical ray march steps through the cloud density volume
2. At each in-cloud sample, density is evaluated from layered procedural noise
3. Direct lighting (sun/moon) is evaluated with secondary shadow rays for self-shadowing
4. In-scattering, extinction, and emissive contributions are accumulated along the ray
5. Sky Atmosphere LUTs are sampled for correct cloud-atmosphere interaction
6. The result is accumulated with temporal history and composited against SceneColor using depth

This is one of the most computationally demanding per-frame passes in the pipeline when clouds have significant screen coverage. It is also one of the most visually impactful — volumetric clouds are the single most effective atmospheric element for establishing time of day, weather, and scene mood.

---

## Two Cloud Passes — Background and Foreground

There are **two separate cloud rendering passes** per frame and it's important to understand the distinction:

**Background Cloud Pass (CompositionBeforeBasePass — doc 10)**
- Runs before BasePass
- Renders clouds visible entirely against the sky — behind all opaque geometry
- Produces the cloud sky contribution that geometry is later drawn over
- May run at reduced quality in some configurations

**This Pass (VolumetricCloud — post-BasePass)**
- Runs after BasePass
- Full-quality cloud render with correct depth compositing against rendered geometry
- Handles clouds that partially overlap geometry (camera below cloud layer with mountains visible through/behind clouds)
- Applies temporal accumulation at full quality
- Produces the final cloud contribution composited into SceneColor

> [!NOTE]
> **Most of the visible cloud quality and cost comes from this post-BasePass pass, not the background pass.** The background pass is a preliminary step; this pass is the definitive cloud render. When profiling cloud cost, `VolumetricCloud` in Unreal Insights refers to this pass. If clouds appear correct in the background but incorrect or missing when geometry is involved, this is the pass to investigate.

---

## Cloud Density Volume — How the Field Is Defined

Clouds in UE5 are not meshes. Their shape is defined by a **layered procedural noise field** evaluated at every ray march sample point in world space.

**Noise layers used:**

| Noise Type | Frequency | Role |
|-----------|-----------|------|
| Perlin-Worley (shape) | Low | Large cloud structure — billowing cumulus forms, anvil tops |
| Worley (detail) | Medium-high | Cloud edge erosion, wispy trails, interior structure |
| Weather map | Scene-wide 2D | Coverage distribution — where clouds exist vs clear sky |
| Curl noise | Medium | Turbulence and distortion for organic movement |

These layers are combined per-sample during the ray march. The cost of each sample is dominated by these texture reads and the noise combination math — denser clouds (higher density values) produce non-zero samples more frequently, increasing the effective work per ray.

> [!NOTE]
> **Cloud density is authored in the `VolumetricCloud` actor's Cloud Layer asset.** The noise frequencies, coverage parameters, and layer altitudes are all configured there. High coverage values (dense clouds filling the sky) directly increase the fraction of ray march samples that return non-zero density — the primary driver of per-ray cost. A clear-sky scene with sparse clouds is significantly cheaper than an overcast scene at the same resolution and sample count.

---

## The Hierarchical Ray March

The ray march uses a **two-phase approach** to avoid spending full-quality samples in empty space:

**Phase 1 — Cheap Entry/Exit Detection**
Long, infrequent steps with cheap density evaluation (low-quality noise only). The ray advances quickly through clear air. When a non-zero density is detected, Phase 2 begins. If the ray exits the cloud layer without finding density, the pixel receives no cloud contribution cheaply.

**Phase 2 — Full-Quality In-Cloud Sampling**
Short, frequent steps with full noise evaluation. At each sample:
- Full multi-layer density evaluation
- Extinction and scattering coefficient computation
- Direct lighting evaluation (see below)
- Transmittance accumulation

When transmittance drops below a threshold (the ray has accumulated enough density to be effectively opaque), the march terminates early — no more light can penetrate.

The total step count scales with:
- Cloud layer thickness (altitude range of the cloud band)
- Camera distance from the cloud layer (longer free-space rays before entry)
- `r.VolumetricCloud.ViewRaySampleCountScale` (the primary quality/cost lever)

---

## Self-Shadowing — The Compounding Cost

This is the most expensive per-sample operation and the primary reason dense clouds are dramatically more expensive than sparse ones.

At each full-quality in-cloud sample, the renderer estimates how much sunlight is attenuated before reaching that sample point. This requires evaluating cloud density **along the sun direction** from each sample — essentially a mini ray march inside the main ray march:

```
For each primary sample:
    For each shadow sample (typically 6-8):
        Evaluate cloud density at shadow sample position
        Accumulate shadow transmittance
    Apply shadow to primary sample's direct lighting
```

This produces the characteristic **lit tops and dark undersides** of realistic cumulus clouds. Without self-shadowing, clouds appear uniformly bright and lose their three-dimensional form.

> [!WARNING]
> **Self-shadowing cost scales with both primary sample count AND shadow sample count per primary sample.** A doubling of either multiplies the total work proportionally. Dense, thick clouds in direct sunlight pay maximum self-shadow cost — every primary sample is deep in the volume with full shadow ray length. Tuning `r.VolumetricCloud.ShadowTracingDistance` reduces shadow ray length at the cost of less accurate deep-cloud shadowing. For overcast or uniformly lit cloud scenarios where crisp self-shadowing is less perceptible, reducing this value can significantly cut per-sample cost.

---

## Cloud Shadows on the Ground

Clouds cast shadows on terrain and world geometry below them via a dedicated **cloud shadow map** — rendered separately from the main cloud ray march.

This is a distinct sub-pass: the shadow map is generated from the directional light's perspective, projecting cloud coverage downward. The result feeds into the directional light's shadow evaluation during deferred lighting, causing the characteristic drifting shadow patches on ground terrain under dynamic clouds.

> [!WARNING]
> **Cloud shadow maps add cost to the shadow rendering phase independently of the main cloud pass.** If clouds are enabled and `Cast Cloud Shadows` is active on the directional light, the shadow map render adds GPU time that appears alongside other shadow pass costs. In scenes where ground-level cloud shadows are not visible (e.g. player always above cloud layer), disabling `Cast Cloud Shadows` on the directional light eliminates this cost with no visual impact.

---

## Temporal Accumulation for Clouds

Clouds render at **reduced per-frame sample count** and rely on temporal accumulation over multiple frames to reach final quality. This is the same principle as Lumen and TSR — doing less work per frame by reusing stable history.

The temporal behavior of clouds has important implications:

**Static or slowly-animated clouds** accumulate history efficiently — after several frames, the result is stable and high quality with low per-frame sample cost.

**Fast wind-animated clouds** constantly shift density values, making previous-frame history increasingly incorrect. The accumulation blend weight shifts toward fresh samples, effectively increasing per-frame sample count to maintain quality.

> [!WARNING]
> **Cloud wind animation speed directly affects temporal accumulation efficiency — and therefore runtime cost.** Fast wind speeds cause the cloud density field to change significantly frame-to-frame, degrading temporal reuse. A scene with fast-moving animated clouds pays meaningfully more per frame than the same scene with static clouds at identical quality settings. If cloud animation is primarily a background atmosphere element, slow wind speeds (almost imperceptible) are dramatically cheaper than fast speeds while preserving the visual impression of living clouds.

---

## Cloud-Atmosphere Interaction

During the ray march, each in-cloud sample samples the **Sky Atmosphere LUTs** (doc 09) for aerial perspective, sky color contribution, and atmosphere-cloud scattering. This is what gives clouds their realistic coloring — orange undersides at sunset, blue-lit edges in overcast light, and correct luminance falloff with altitude.

This LUT sampling adds a small but non-trivial cost per in-cloud sample. The quality of this interaction is controlled by `r.VolumetricCloud.HighQualityAerialPerspective` — disabling it substitutes a cheaper approximation that is visually acceptable in most conditions.

---

## Execution Model

The main cloud ray march is a **GPU compute pass** — no CPU-driven geometry rasterization. The CPU schedules the dispatch; the GPU executes the ray march for every cloud-covered pixel independently.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules cloud ray march dispatch; manages temporal history buffers |
| **GPU Compute** | Executes per-pixel ray march; evaluates density noise; computes self-shadowing; accumulates temporal history |

Unlike the voxel-based Volumetric Fog, there is no fixed-size grid — cloud cost scales with **pixel coverage** of the cloud layer on screen, not with a predetermined voxel count. A frame where clouds cover 80% of the screen is roughly 80% more expensive than a frame where clouds cover 10%.

---

## What Data It Produces

| Output | Format | Consumers |
|--------|--------|-----------|
| Cloud radiance buffer | RGBA16F | Final scene composition (blended into SceneColor) |
| Cloud transmittance buffer | R8 / RGBA8 | Scene composition (attenuates background through cloud coverage) |
| Cloud shadow map | R16F | Directional light shadow evaluation (ground shadow patches) |
| Cloud coverage mask | R8 | Sky light occlusion, aerial perspective integration |

**Consumed downstream by:**
- **Final scene composition** — cloud radiance and transmittance blended into SceneColor
- **Deferred lighting** — cloud shadow map used by directional light shadow projection
- **Sky Atmosphere** — cloud coverage fed back for atmosphere-cloud luminance integration
- **Reflection captures** — clouds optionally rendered into sky reflection capture

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large cloud screen coverage | Ray march executes per cloud-covered pixel — more coverage = linear cost increase | Design cloud layers to not fill the entire sky; use height fog for horizon haze |
| Dense cloud coverage | More non-zero density samples per ray; self-shadow rays longer on average | Reduce coverage parameter in Cloud Layer asset; use patchy coverage |
| Thick cloud layer altitude range | Longer rays → more steps to traverse the volume | Reduce cloud layer thickness; use tightly banded altitude ranges |
| High `ViewRaySampleCountScale` | More primary samples per ray — multiplies total work | Primary performance lever; reduce on lower-end platforms |
| Enabled self-shadowing | Secondary shadow rays per primary sample — compounding multiplier | Reduce `ShadowTracingDistance`; disable in low-detail scalability tiers |
| Multiple cloud layers | Each additional layer adds a near-complete additional ray march | Limit to one cloud layer where possible |
| Fast wind animation | Reduces temporal reuse efficiency; more fresh samples per frame needed | Slow wind speed to minimum visually required |
| Cloud shadows on ground enabled | Separate shadow map render per frame | Disable `Cast Cloud Shadows` when player can't see ground shadows |
| Clouds in scene captures | Each capture ray-marches clouds independently — no sharing | Disable clouds in scene captures; use a static skybox substitute |

> [!WARNING]
> **Multiple cloud layers compound cost nearly linearly.** A second cloud layer at a different altitude (e.g. low cumulus + high cirrus) adds a near-complete second ray march for every cloud-covered pixel. If a scene requires visual complexity across multiple altitudes, evaluate whether a single layer with varied coverage and density achieves the same result before adding a second layer. Each additional layer is one of the most expensive single configuration changes available in the cloud system.

---

## Key Systems and Components

### Cloud Layer Asset
The authored asset defining cloud parameters — altitude band (bottom/top height in kilometers), noise frequencies and amplitudes, coverage density, and precipitation type. All noise parameters directly affect per-sample evaluation cost and the fraction of samples with non-zero density. The cloud layer is referenced by the `VolumetricCloud` actor in the level.

### Worley / Perlin-Worley Noise Evaluation
The dominant compute cost per ray march sample. Three to four texture lookups per sample (shape noise, detail noise, weather map, curl noise) plus the mathematical combination of the results. On GPU, these are parallel texture reads — but the high sample count makes total bandwidth and compute cost significant across all cloud pixels simultaneously.

### Phase Function (Mie Scattering)
Controls the angular distribution of scattered sunlight in clouds. The double Henyey-Greenstein phase function used for clouds produces characteristic forward scattering (silver lining around cloud edges facing the sun) and backward scattering (bright cloud tops in direct sunlight). Parameters `r.VolumetricCloud.SkyLight.SampleCountScale` and the Cloud Layer's phase function `g` parameter control this behavior.

### Temporal Reprojection
Cloud history is stored as a full-resolution (or half-resolution) radiance buffer from the previous frame. The current frame reprojects this buffer using camera motion and cloud layer movement. Where reprojection is valid (cloud position unchanged relative to camera), the history contributes strongly. Where it's invalid (new cloud regions, fast movement), fresh samples dominate. The blend weight between history and fresh samples is the primary knob controlling the quality/noise trade-off during motion.

### Cloud Shadow Map
A top-down shadow map rendered from the sun direction through the cloud density volume. Uses a simplified (fewer samples) ray march from the light's perspective to produce coverage and transmittance at world-space positions. Sampled during directional light shadow evaluation to modulate ground illumination.

---

## 📋 Reader Notes

> [!NOTE]
> **Cloud rendering quality is significantly resolution-dependent in a way that differs from most other passes.** Because clouds are rendered per-pixel through a volumetric ray march, reducing screen percentage reduces cloud resolution along with everything else — but the volumetric nature means the reduced resolution is more visible in clouds than in surface rendering. Clouds rendered at 50% screen percentage look noticeably blurrier and noisier than geometry at the same setting. Consider cloud-specific resolution controls rather than relying solely on global screen percentage for cloud quality management.

> [!NOTE]
> **The distinction between background clouds (CompositionBeforeBasePass) and this pass matters for debugging.** If cloud rendering is visually incorrect only where geometry is involved (clouds clipping through mountains, incorrect depth compositing at horizon geometry), this pass is responsible. If clouds are missing or incorrect in open sky regions with no nearby geometry, the background pass in CompositionBeforeBasePass is more likely the source. Check both passes in Unreal Insights when diagnosing cloud visual issues.

> [!NOTE]
> **Clouds interact with Lumen in a limited way.** Lumen does not trace rays through the cloud volume — cloud contribution to scene lighting (cloud shadows, cloud ambient occlusion) is handled through the cloud shadow map and sky light occlusion systems, not through Lumen surface cache updates. This means rapidly changing cloud lighting (time-of-day transitions, fast storm clouds) does not cause Lumen cache invalidation — the indirect lighting response to cloud coverage changes is handled analytically rather than through GI re-evaluation.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `VolumetricCloud` | Total cloud pass cost — primary container |
| `RenderVolumetricCloud` | Main ray march execution |
| `VolumetricCloudShadowMap` | Cloud shadow map render — separate from main pass |
| `VolumetricCloudTemporalReprojection` | Temporal accumulation and history blend cost |

> [!TIP]
> If `RenderVolumetricCloud` is dominant, cost is in the ray march itself — reduce `r.VolumetricCloud.ViewRaySampleCountScale`, decrease cloud coverage in the Cloud Layer asset, or reduce cloud layer thickness. If `VolumetricCloudShadowMap` is unexpectedly large, disable `Cast Cloud Shadows` on the directional light if ground-level cloud shadows are not perceptible from the camera's position. If cost spikes specifically during camera movement, temporal reprojection efficiency is the issue — reduce wind animation speed.

### Debug Visualizations

```
r.VolumetricCloud.Visualize 1       // Debug view of cloud density and transmittance per pixel.
                                     // Reveals coverage patterns, density distribution,
                                     // and which screen regions are paying full ray march cost.
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — VolumetricCloud appears as a significant block
```

### Useful Console Variables

```
// Master toggles
r.VolumetricCloud 0/1                             // Disable cloud system entirely

// Primary quality/cost levers
r.VolumetricCloud.ViewRaySampleCountScale [1.0]   // Scale total primary sample count per ray.
                                                   // 0.5 = half samples, lower quality, ~40-50% cheaper.
                                                   // 2.0 = double samples, higher quality, ~2× cost.
                                                   // Most impactful single lever.

r.VolumetricCloud.ShadowTracingDistance [15.0]    // Maximum distance of self-shadow secondary rays (km).
                                                   // Reduce to cut shadow sample cost; less deep-cloud shadow accuracy.

r.VolumetricCloud.HighQualityAerialPerspective 0/1 // Full LUT-based aerial perspective per sample (1)
                                                    // vs cheaper approximation (0).

r.VolumetricCloud.SkyLightCloudBottomOcclusion 0/1 // Sky light occlusion from cloud underside.
                                                    // Disable on lower tiers.

// Shadow map
r.VolumetricCloud.ShadowMap.SampleCount [8]       // Samples in cloud shadow map ray march.
                                                   // Reduce for cheaper shadow map at cost of precision.

// Temporal accumulation
r.VolumetricCloud.EnableTAA 0/1                   // Toggle temporal accumulation for clouds.
                                                   // Disabling produces noisier but more responsive result.
```

---

## Optimization Levers

### Sample Count (Highest Impact)
- Reduce `r.VolumetricCloud.ViewRaySampleCountScale` — this is the most direct cost control and scales performance nearly linearly with quality
- Values between 0.25 and 0.5 are acceptable for lower-end platforms where clouds are a background atmospheric element rather than a hero visual
- Combine with temporal accumulation (keep TAA enabled) to maintain apparent quality at reduced per-frame sample counts

### Cloud Layer Design
- Keep coverage below full overcast where possible — patchy coverage means many rays exit without entering density (cheap Phase 1 only)
- Minimize cloud layer altitude range — thinner bands mean shorter in-cloud ray segments and fewer full-quality samples
- Use a single cloud layer; each additional layer nearly doubles ray march cost

> [!WARNING]
> **Avoid overcast coverage (coverage value near 1.0) in performance-constrained builds.** Full overcast means nearly every sky pixel runs a full-depth ray march with multiple in-cloud samples and self-shadow evaluation. Patchy coverage (0.3–0.6) gives similar dramatic effect at a fraction of the cost — many rays exit through gaps in the coverage before accumulating significant density. The visual difference in motion is often imperceptible while the performance difference is significant.

### Self-Shadowing
- Reduce `r.VolumetricCloud.ShadowTracingDistance` for scenes where clouds are viewed from below at distance — deep self-shadowing accuracy matters less from far viewpoints
- Disable self-shadowing in the lowest scalability tier — clouds lose their three-dimensional form but render significantly faster

### Wind and Animation
- Use the minimum wind speed that achieves the visual impression of living clouds — temporal reuse efficiency decreases with animation speed
- For cinematics or scripted moments requiring specific dramatic cloud states, consider baking the cloud appearance rather than animating through it at runtime

### Scene Captures and Views
- Disable clouds in all scene captures where sky accuracy is not needed — use a static skybox or sky capture instead
- Each active scene capture with clouds enabled runs a full independent ray march

---

## Mental Model

Think of Volumetric Cloud as:

> *"For every pixel where a cloud ray intersects the sky, march through the density field step by step — gathering how much light scatters toward you at each point, attenuated by how much the cloud is shadowing itself — then composite the accumulated result against the scene."*

Cloud rendering is expensive because it cannot be precomputed in the same way as shadows or GI — the view-dependent nature of volumetric ray marching and the procedural noise evaluation must happen per pixel per frame. The temporal accumulation system is what makes it viable: by accepting some noise and blending with history, the per-frame sample count is kept low enough to be affordable while the accumulated quality across frames appears high.

The key insight is that **cloud cost is almost entirely determined by what the camera can see of the cloud volume** — screen coverage, cloud density, and cloud thickness. A cloud configuration that looks spectacular from one camera angle may be prohibitively expensive; the same clouds from a different angle where coverage appears lower may be perfectly within budget. Cloud system performance must be evaluated from the worst-case camera positions in your level, not from an average position.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| CompositionBeforeBasePass (doc 10) | Background cloud pass — preliminary cloud render before BasePass; this pass is the full-quality follow-up |
| Sky Atmosphere LUTs (doc 09) | Sampled per in-cloud sample for correct cloud-atmosphere color interaction |
| Virtual Shadow Maps (doc 15/16) | Cloud shadow map fed into directional light shadow evaluation for ground shadows |
| Volumetric Fog (doc 20) | Sibling volumetric system — voxel-based vs ray march; coexist in the same scene |
| Temporal Accumulation | History buffer reduces per-frame sample count; wind speed directly affects its efficiency |
| Scene Captures | Each capture runs a full independent cloud ray march — major cost multiplier |
| Directional Light | Primary cloud lighting source; `Cast Cloud Shadows` controls ground shadow map render |

---

## Red Flags to Watch For

- **`VolumetricCloud` > 3ms** → check `r.VolumetricCloud.ViewRaySampleCountScale` and cloud coverage value in Cloud Layer asset; reduce both on lower-end targets
- **Cost scales heavily with camera angle** → cloud screen coverage is the primary driver; worst-case angles are looking up into overcast sky; evaluate performance from those positions specifically
- **Temporal noise visible during camera movement** → temporal accumulation invalidating; fast wind speed may be degrading history reuse; consider reducing wind animation speed
- **Cloud shadows absent on ground terrain** → `Cast Cloud Shadows` may be disabled on directional light, or cloud shadow map resolution insufficient; check directional light settings
- **`VolumetricCloudShadowMap` appearing unexpectedly large** → shadow map sample count high or shadow map resolution set above requirements; reduce `r.VolumetricCloud.ShadowMap.SampleCount`
- **Overcast coverage value in Cloud Layer** → near-1.0 coverage is worst-case ray march cost; reduce to 0.5–0.7 for patchy appearance at significantly lower cost
- **Multiple cloud layers active** → each layer is near-complete additional ray march; audit `VolumetricCloud` actor settings for layer count
- **Scene captures with clouds active** → each capture is a full independent ray march; disable clouds in non-essential captures
- **Cloud quality noticeably worse than surrounding scene quality** → global screen percentage reduction more visible in clouds than geometry; consider cloud-specific resolution controls

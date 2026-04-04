---
tags:
  - volumetric-clouds
---

# Unreal Engine 5 Rendering Pipeline – VolCloudComposeOverScene

> Stage: **VolCloudComposeOverScene**  
> Phase: Atmospheric Compositing / Cloud Integration  
> Purpose: Composite the volumetric cloud radiance and transmittance buffers over the fully rendered scene using depth-correct blending — correctly resolving the depth relationship between clouds and scene geometry  
> Pipeline Position: After `VolumetricCloud` ray march (doc 22) and all geometry passes, before translucency and final composition

---

## Relationship to the Cloud Ray March (Doc 22)

This pass and the `VolumetricCloud` ray march (doc 22) form a **compute → composite** pair. Understanding why they are separate is essential to understanding what this pass does.

**Doc 22 — VolumetricCloud Ray March**
Marches rays through the cloud density field, evaluating scattering, absorption, and self-shadowing. Produces two output buffers:
- **Cloud radiance buffer** — the color and luminance of the clouds
- **Cloud transmittance buffer** — how opaque the clouds are per pixel (0 = fully opaque, 1 = fully transparent)

The ray march operates entirely in atmospheric space. It does not know or care what scene geometry exists — it steps through density noise and computes cloud appearance independently.

**This pass — VolCloudComposeOverScene**
Takes those two buffers and composites them over the rendered scene — the SceneColor that now contains all geometry, sky atmosphere, fog, and other atmospheric effects. This step is depth-aware: it uses SceneDepth to correctly resolve the ordering between clouds and scene geometry.

**Why the separation:** The ray march is compute-heavy and can be scheduled independently of geometry rendering. The compositing is a fast blend that *requires* complete scene data. Separating them is an architectural efficiency — the ray march doesn't wait for geometry; the compositing reads the finished scene.

---

## What This Stage Does

**Cloud Radiance and Transmittance Compositing**
The fundamental operation is a per-pixel blend of cloud results over scene color:

```
final_color = cloud_radiance + (cloud_transmittance × scene_color)
```

- Where `cloud_transmittance = 1.0` (fully transparent): scene color passes through unchanged — clear sky regions
- Where `cloud_transmittance = 0.0` (fully opaque): cloud radiance entirely replaces scene color — dense cloud core
- Where `cloud_transmittance = 0.5` (partially opaque): blended — cloud edges, wispy regions, semi-translucent coverage

**Depth-Correct Geometry Intersection**
The most architecturally important function of this pass. Scene geometry that extends above or through the cloud layer must appear correctly in front of the clouds at pixels where the geometry is closer to the camera than the cloud layer depth.

For each pixel, the pass tests:
- Where does the scene geometry sit in depth? (from SceneDepth)
- Is that geometry above, inside, or below the cloud layer altitude range?
- Does the cloud transmittance buffer indicate clouds at that pixel?

Geometry closer to the camera than the cloud layer's near depth boundary composites over the clouds. Geometry further than the cloud layer's far depth composites under them. Geometry intersecting the cloud altitude band is handled by the depth-weighted blend.

**Aerial Perspective Integration on Clouds**
Clouds at different distances from the camera should exhibit aerial perspective — distant clouds appear hazier and more desaturated. The Aerial Perspective LUT (from doc 09) is applied during compositing to modulate cloud appearance with depth-based atmospheric haze, ensuring clouds integrate visually with the sky atmosphere.

**Multiple Cloud Layer Ordering**
If multiple cloud layers are defined (e.g. low cumulus at 2km + high cirrus at 8km), each layer's ray march produced separate radiance and transmittance buffers. This compositing pass handles the correct ordering of multiple layers — compositing near layers over far layers over the scene, each depth-correctly resolved.

---

## Why This Pass Exists as a Separate Step

This is a natural question — why not composite during the ray march itself?

**The ray march needs no scene data.** Cloud density evaluation, self-shadowing, and scattering are purely atmospheric calculations. Running the ray march without access to SceneColor or SceneDepth keeps it clean and allows it to potentially overlap with other render work on the async compute queue.

**The compositing needs complete scene data.** The scene must be fully rendered — geometry shaded, sky atmosphere applied, fog composited — before clouds can be correctly layered over it. Compositing requires SceneDepth (for geometry intersection) and SceneColor (for the blend). Neither is fully populated until after BasePass and all preceding geometry work completes.

**Cost separation makes profiling cleaner.** The ray march cost (GPU compute, scales with cloud coverage and sample count) is entirely attributable to cloud rendering complexity. The compositing cost (bandwidth, scales with resolution) is entirely attributable to the blend itself. These are different categories of optimization — separating them makes each diagnosable independently.

---

## Execution Model

VolCloudComposeOverScene is a **fullscreen blend pass** — a pixel shader or compute dispatch that processes every pixel of the output buffer.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the compositing dispatch after VolumetricCloud ray march completion |
| **GPU Pixel Shader / Compute** | Reads cloud radiance, transmittance, SceneColor, SceneDepth; evaluates depth intersection; writes composited SceneColor |

**Cost profile:** Primarily **bandwidth-bound** — the shader logic is simple (blend operations and depth comparisons), but it reads four full-resolution buffers and writes one. At 4K render resolution, this is substantial bandwidth per frame.

The pass is significantly cheaper than the ray march (doc 22) — it's a blend operation, not a volumetric simulation. In most scenes, this pass is a minor fraction of total cloud cost.

---

## What Data This Pass Reads and Produces

**Reads:**

| Input | Source | Purpose |
|-------|--------|---------|
| Cloud radiance buffer | VolumetricCloud ray march (doc 22) | Cloud color to composite |
| Cloud transmittance buffer | VolumetricCloud ray march (doc 22) | Per-pixel cloud opacity mask |
| SceneColor | All preceding passes | Background scene to composite clouds over |
| SceneDepth | PrePass / BasePass / NaniteEmit | Depth-correct geometry intersection testing |
| Aerial Perspective LUT | SkyAtmosphereLUTs (doc 09) | Distance-based cloud haze modulation |

**Produces:**

| Output | Consumers |
|--------|-----------|
| Composited SceneColor (clouds integrated) | Translucency, post-processing, TSR |

---

## Why This Can Be Expensive

This pass is rarely a primary performance concern — the ray march (doc 22) is almost always the dominant cloud cost. When this pass does appear meaningful:

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High render resolution | Fullscreen bandwidth scales with pixel count | Scales with `r.ScreenPercentage` — no pass-specific control |
| Multiple cloud layers | Each layer adds additional buffer reads and blend operations | Limit cloud layer count (see doc 22) |
| Multiple active views | Each view composites independently | Disable clouds in scene captures where accuracy is not needed |
| High cloud screen coverage | More pixels requiring full blend evaluation | Content-driven — same optimization as doc 22 |

> [!NOTE]
> **If cloud performance is a concern, always investigate the VolumetricCloud ray march (doc 22) first.** The ray march is typically 10–20× more expensive than this compositing pass. Optimizing the ray march (sample count, coverage, layer count) will produce far greater frame time savings than anything specific to this compositing pass. This pass only becomes independently notable at very high output resolutions with multiple cloud layers active.

---

## Depth Intersection — The Geometry-Cloud Boundary

The most visually critical function of this pass and the primary reason it requires SceneDepth.

Consider a mountain range with a cloud layer at mid-altitude. From a camera below the clouds looking toward the mountains:
- Mountain peaks above the cloud layer must appear **in front of** the clouds
- Mountain slopes below the cloud layer must appear **behind** the clouds
- The cloud layer intersects the mountain at some altitude boundary — creating the characteristic effect of peaks emerging from cloud cover

Without depth testing, the compositing would simply layer all clouds over all scene geometry regardless of their spatial relationship — mountain peaks would disappear into the cloud layer incorrectly.

The depth test per pixel:
1. Reads the scene geometry depth at that pixel
2. Reconstructs the world-space Z coordinate of that geometry
3. Compares against the cloud layer's altitude bounds
4. Determines whether the geometry is above/inside/below the cloud and adjusts the compositing blend accordingly

> [!NOTE]
> **The quality of depth-correct cloud-geometry intersection depends on the cloud layer's authored altitude range.** If the cloud layer's minimum altitude is set too low, geometry that should emerge above the clouds will instead blend into them. The altitude bounds set in the `VolumetricCloud` actor's Cloud Layer asset directly control where the depth intersection tests are applied. If mountains are incorrectly disappearing into clouds, check the cloud layer bottom altitude relative to the terrain height.

---

## Background Cloud Pass — What This Compositing Does Not Handle

Recall from doc 10 (CompositionBeforeBasePass) that a **background cloud pass** runs before BasePass. That pass handles clouds visible only in the open sky — entirely behind all scene geometry.

This compositing pass handles the **post-BasePass full-quality cloud result** — including depth-correct interaction with geometry. The two passes divide responsibility:

| Pass | Handles | Depth interaction |
|------|---------|------------------|
| Background (doc 10) | Clouds in open sky, no geometry overlap | Not needed — sky pixels have no geometry |
| **This pass** | Full-quality clouds including geometry intersection | Required — geometry may be inside or above cloud layer |

A scene with no terrain or geometry that intersects the cloud altitude would have most of its cloud work done in the background pass. A scene with mountains, towers, or other tall geometry poking into or above the cloud layer relies heavily on this pass's depth-correct compositing.

---

## Key Systems and Components

### Transmittance-Based Alpha Blend
The core compositing operation. Cloud transmittance is used as an alpha value — but unlike standard alpha blending, it's an energy-conserving transmittance value derived from the physical ray march. A transmittance of 0.3 means 30% of the scene color shows through and 70% of the pixel is replaced by cloud radiance. This maintains physically correct light energy across the cloud boundary.

### Depth Reconstruction for Altitude Testing
The pass reconstructs world-space position from SceneDepth using the inverse view-projection matrix. The world-space Y (or Z, depending on coordinate convention) of each pixel is compared against the cloud layer's world-space altitude bounds. This reconstruction is the same operation used by many other passes (SSAO, SSR, Lumen) and adds minimal cost.

### Per-Layer Compositing Order
With multiple cloud layers, the compositing respects physical ordering — higher cloud layers (cirrus) composite first, then lower layers (cumulus) composite over them, then the combined result composites over the scene. This maintains correct visual layering where lower clouds can occlude higher ones when viewed from above.

### Aerial Perspective on Cloud Edges
Distant cloud edges receive aerial perspective haze from the Aerial Perspective LUT, softening cloud boundaries at the horizon and ensuring they visually integrate with the sky atmosphere rather than appearing as sharp-edged objects against the sky background.

---

## 📋 Reader Notes

> [!NOTE]
> **The visible cost of "clouds" in a profile is split between doc 22 (ray march) and this pass (composite).** Always check both events when investigating cloud performance. Ray march cost = cloud quality settings and coverage. Composite cost = resolution and layer count. They require different optimization approaches.

> [!NOTE]
> **This pass runs even if the visible sky area is minimal.** The compositing is a fullscreen operation — it processes every pixel including those with no cloud coverage. For those pixels, the cloud transmittance is 1.0 (fully transparent) and the blend trivially passes through scene color — but the pixel is still evaluated. The cost is proportional to render resolution, not cloud screen coverage.

> [!NOTE]
> **Translucent geometry rendered after this pass can appear in front of clouds correctly.** Because this compositing runs before translucency, translucent objects (particle systems, glass, water surfaces) rendered subsequently will layer over the cloud-composited scene. A translucent object closer to the camera than the cloud layer will correctly appear in front of the clouds. However, translucent objects within the cloud altitude range cannot interact volumetrically with the clouds — they are simply drawn over or under the cloud layer based on depth.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `VolCloudComposeOverScene` | Total compositing cost |
| `VolumetricCloudComposite` | Variant name in some engine versions |
| `VolumetricCloud` | Parent event — check the ray march (doc 22) vs compositing split |

> [!TIP]
> Expand the `VolumetricCloud` parent event in Unreal Insights to see the breakdown between the ray march and this compositing step. In the vast majority of scenes, the ray march will be the dominant cost. If compositing is unexpectedly large relative to the ray march, the cause is almost certainly multiple cloud layers or very high output resolution. There are no quality-reduction CVars specific to this compositing step — the only lever is addressing the inputs (fewer layers, lower resolution).

### Debug Commands

```
r.VolumetricCloud.DisableDepthTest 1    // Disables depth-correct geometry intersection —
                                         // clouds composite over all geometry regardless of depth.
                                         // Useful to isolate whether depth intersection is causing
                                         // a visual artifact or to compare the visual cost of depth testing.
                                         // Never use in production.

r.VolumetricCloud 0                     // Disables the entire cloud system including this compose pass.
                                         // Confirms whether cloud cost (both ray march and composite) is
                                         // the source of a performance or visual issue.
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — VolCloudComposeOverScene appears within VolumetricCloud block
```

---

## Optimization Levers

This pass has very few independent optimization levers — its cost is almost entirely determined by render resolution and layer count, both of which are project-wide decisions rather than pass-specific settings.

**Reduce cloud layer count**
Each additional cloud layer adds buffer reads and blend operations. The compositing cost for two layers is roughly double that of one. This mirrors the ray march cost multiplier from doc 22.

**Render resolution**
The compositing scales exactly with render resolution. Reducing `r.ScreenPercentage` reduces this pass proportionally alongside all other resolution-dependent passes.

**Disable clouds in unnecessary views**
Scene captures with cloud compositing active run a full independent pass. Disabling the cloud system on captures where sky accuracy is not required eliminates the composite cost for those views.

**Trust the ray march optimization first**
Any time spent investigating this compositing pass's cost is time that would produce larger returns investigating the ray march (doc 22). The two are linked — disabling clouds (`r.VolumetricCloud 0`) eliminates both simultaneously. If cloud cost is a concern, start with doc 22's optimization levers.

---

## Mental Model

Think of VolCloudComposeOverScene as:

> *"The cloud simulation is finished — now blend the result into the scene, respecting where the real world geometry sits in space relative to where the clouds live in the atmosphere."*

The ray march answers "what do the clouds look like?" This pass answers "where do they belong in the final image, given everything else in the scene?" The first question requires expensive volumetric simulation. The second question requires only a depth test and a blend — fast, cheap, and geometrically correct.

The key insight is that **the depth correctness of this pass is what makes volumetric clouds look integrated rather than pasted on.** Without it, clouds would appear as a flat layer that mountains, buildings, and terrain simply disappear into at their intersection boundary. The depth test is what allows peaks to emerge from cloud cover naturally, and what gives the system its characteristic photographic appearance of clouds interacting with landscape rather than floating independently above it.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| VolumetricCloud (doc 22) | Produces the radiance and transmittance buffers composited here |
| CompositionBeforeBasePass (doc 10) | Background cloud pass — handles sky-only clouds before BasePass; this pass handles post-geometry compositing |
| SceneDepth | Required input for depth-correct geometry intersection |
| SkyAtmosphereLUTs (doc 09) | Aerial Perspective LUT sampled for cloud edge haze at distance |
| ExponentialHeightFog (doc 26) | Fog has already been applied to SceneColor before this composite — clouds are layered over the fogged scene |
| Translucency | Renders after this pass — can appear in front of composited clouds |
| TSR (doc 23) | Receives the cloud-composited SceneColor as its input |

---

## Red Flags to Watch For

- **`VolCloudComposeOverScene` unexpectedly large relative to ray march** → check cloud layer count; multiple layers multiply compositing bandwidth; also check output resolution
- **Geometry incorrectly disappearing into cloud layer** → cloud layer bottom altitude may be set too low; check `VolumetricCloud` actor cloud layer altitude bounds vs terrain height
- **Clouds appearing in front of geometry that should be above them** → cloud layer top altitude may be set too high; depth intersection testing placing too much geometry below the cloud ceiling
- **Cloud edges showing sharp depth discontinuities at geometry boundaries** → cloud layer altitude intersection is working but the transition needs softening — a cloud material and coverage authoring issue rather than a compositing bug
- **Cost multiplying unexpectedly** → check active scene capture count; each capture runs a full independent composite
- **Aerial perspective not applying to distant clouds** → check Sky Atmosphere component is present and Aerial Perspective LUT has been successfully built; without it, cloud edges at the horizon will appear sharp rather than hazed

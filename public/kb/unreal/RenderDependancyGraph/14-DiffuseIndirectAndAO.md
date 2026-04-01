---
tags:
  - lumen
---

# Unreal Engine 5 Rendering Pipeline – Diffuse Indirect & AO

> Stage: **Diffuse Indirect & AO**  
> Phase: Global Illumination & Ambient Occlusion  
> Purpose: Compute diffuse indirect lighting (bounced light, color bleeding) and ambient occlusion using Lumen's multi-component GI system or screen-space fallback methods  
> Pipeline Position: After `BasePass` and shadow passes, before final lighting combine

---

## What This Stage Does

This stage computes **where light goes after it bounces** — the indirect diffuse lighting that fills shadowed regions, produces color bleeding, and gives scenes their sense of lighting depth and realism. It also computes **ambient occlusion**, which darkens crevices, contact points, and areas that receive little ambient light.

In UE5 with Lumen enabled, both of these are produced by the same system. Without Lumen, they fall back to separate screen-space algorithms (SSAO for AO; no real-time GI for diffuse indirect).

---

## Lumen Architecture — How Diffuse GI Actually Works

This is the most complex stage in the rendering pipeline. Understanding Lumen's architecture is essential for diagnosing performance and knowing which CVars actually do what.

Lumen computes diffuse indirect lighting through a **five-component pipeline**, each building on the previous:

### Component 1: Surface Cache (Mesh Cards)
Lumen represents scene geometry as flat proxy surfaces called **mesh cards** — axis-aligned rectangular patches generated for each mesh offline. These cards are rendered into a **surface cache** texture atlas that stores the *direct and indirect lighting* currently hitting each surface.

The surface cache is updated **incrementally** — only a fraction of cards are refreshed each frame. Cards that haven't changed don't need re-rendering. This is what allows Lumen to represent large scenes without re-evaluating every surface every frame.

> [!NOTE]
> **Mesh card quality depends on mesh coverage.** Meshes with poor card generation (complex shapes that can't be well-approximated by axis-aligned patches) will have lower quality GI representation. Static meshes built with Lumen in mind — with good convex coverage from multiple card directions — produce better indirect lighting results than highly concave or complex meshes.

### Component 2: Screen Probes (Screen Space Gather)
Lumen places a sparse grid of **screen probes** — one probe per 8×8 pixel tile by default. Each probe traces rays outward to sample radiance from the scene. These are short traces that rely heavily on the HZB for efficient intersection.

The probes do **not** trace one ray per pixel — they are subsampled spatial representatives that are later interpolated to fill all screen pixels. This is why Lumen's cost is not directly per-pixel at the tracing stage.

Probe rays can hit:
- The **surface cache** (fetching precomputed lighting from Lumen mesh cards)
- **Screen space** surfaces (HZB ray marching for nearby geometry)
- The **radiance cache** (world-space coverage for distant or off-screen bounces)

### Component 3: Radiance Cache (World Space)
A sparse world-space cache of radiance at sample points distributed through the scene. Provides Lumen with knowledge of off-screen lighting — areas the camera can't directly see but which contribute bounced light into the view. Updated incrementally each frame.

### Component 4: Final Gather and Interpolation
Screen probe radiance samples are **spatially filtered and interpolated** across all screen pixels using importance sampling. This converts the sparse probe coverage into a full-resolution indirect lighting buffer. Temporal accumulation from previous frames significantly reduces the per-frame sample count needed for a stable result.

### Component 5: Denoising
The gathered indirect lighting is **temporally and spatially denoised** to remove sampling noise. The denoiser relies on history from previous frames — fast camera motion reduces history validity, increasing visible noise until new history accumulates.

> [!NOTE]
> **Lumen AO is computed as part of the screen probe gather — it is not a separate pass.** When Lumen is enabled, short-range occlusion (what SSAO would handle) is captured as part of the probe traces. SSAO is disabled by default when Lumen is active. The AO quality is determined by probe density and trace quality settings, not dedicated AO CVars.

---

## Software Lumen vs Hardware Lumen

This is the single most important configuration decision for Lumen performance and quality.

### Software Lumen (Default)
- Uses **Signed Distance Fields (SDFs)** for ray traversal — a precomputed field representing distance to the nearest surface for each world-space point
- Uses **mesh cards** (surface cache) for lighting lookups at ray endpoints
- Works on all modern GPUs that support compute shaders
- Lower trace quality — SDF intersections are approximate; misses fine geometric detail
- Lower cost than hardware Lumen on most hardware

### Hardware Lumen
- Uses **RT cores** (ray tracing hardware on NVIDIA RTX, AMD RDNA2+ GPUs) for actual triangle-level ray intersection
- Higher trace accuracy — hits exact triangle surfaces, not SDF approximations
- Captures fine geometric detail (thin features, small gaps) that software Lumen misses
- Significantly higher GPU cost on scenes with complex geometry
- Falls back to software for surfaces without RT acceleration structures

> [!WARNING]
> **Enabling Hardware Lumen (`r.Lumen.HardwareRayTracing 1`) can dramatically increase GPU cost.** The quality improvement is real and significant, but the cost increase can push a performant scene over budget. Always profile both configurations in your actual scene before choosing. Hardware Lumen is most beneficial in scenes with fine geometric detail (architectural interiors, complex rock formations) where SDF inaccuracy is visible.

---

## SSAO — The Lumen-Off Fallback

When Lumen is disabled, **Screen Space Ambient Occlusion (SSAO)** provides the AO component, and diffuse indirect lighting falls back to either:
- **Baked lightmaps** (static GI only — no dynamic response)
- **Sky light contribution** (uniform ambient, no bounced-light spatial variation)

SSAO computes ambient occlusion by sampling the depth buffer in a hemisphere around each pixel and estimating how much of that hemisphere is occluded by nearby geometry. It is screen-space only — geometry outside the view or behind the camera doesn't contribute.

UE5 also supports **GTAO (Ground Truth Ambient Occlusion)** as a higher-quality SSAO variant. Both are purely screen-space and do not compute diffuse GI — they only darken occluded areas, producing no color bleeding.

> [!NOTE]
> **Lumen and SSAO produce fundamentally different results — not just different quality of the same thing.** Lumen computes actual bounced light and color bleeding. SSAO only computes occlusion darkening with no color contribution. A scene that looks realistic with Lumen may look flat and incorrectly lit with SSAO, even at maximum SSAO quality. This is a rendering architecture difference, not a settings difference.

---

## What Data It Produces

| Output | Format | Consumers |
|--------|--------|-----------|
| Indirect diffuse lighting buffer | RGB16F | Final lighting combine, deferred lighting accumulation |
| Ambient occlusion mask | R8 | Lighting combine (modulates ambient and indirect terms) |
| Bent normals (optional) | RGB16F | Used by some lighting paths for more accurate AO directionality |

**Consumed downstream by:**
- **Deferred lighting combine** — indirect lighting buffer added to direct lighting result
- **Translucency lighting** — indirect contribution applied to forward-shaded translucent surfaces
- **Post-processing** — AO mask used by post-process AO effects

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Hardware Lumen enabled | RT hardware trace cost for all screen probes | Profile vs software Lumen; use hardware only where quality difference is justified |
| Fast camera movement | Previous-frame temporal history invalid; more probes need fresh traces | Unavoidable; increase probe quality to reduce noise during motion rather than chasing temporal stability |
| Complex concave geometry | More ray intersections; surface cache coverage worse for complex shapes | Simplify geometry in GI-critical areas; avoid unnecessary concavity |
| Large emissive surfaces feeding GI | Emissive material areas update surface cache entries and radiance cache heavily | Limit emissive surface area; use point/spot lights for localized emissive effects instead |
| High `ScreenProbeGather.DownsampleFactor` | More probes placed = more traces per frame | Increase downsample factor (coarser probe grid) to reduce trace count |
| High trace octahedron resolution | More rays per probe = more radiance samples | Reduce `TracingOctahedronResolution` for fewer rays per probe |
| Many dynamic objects | Dynamic objects require surface cache updates every frame | Minimize large-scale dynamic geometry in GI-critical scenes |

> [!WARNING]
> **Lumen GI cost spikes during fast camera movement are expected behavior, not a bug.** Lumen's temporal accumulation is its primary cost-reduction mechanism. When the camera moves quickly, fewer history samples are valid and Lumen must trace more new samples per frame to maintain quality. This spike is proportional to camera velocity. In gameplay with predictable camera motion, design your scene to reduce GI complexity in fast-movement areas (simple geometry, fewer unique surfaces).

---

## Key Systems and Components

### Mesh Cards (Surface Cache)
The precomputed proxy geometry Lumen uses to represent scene surfaces for ray endpoint lighting lookups. Each static mesh gets cards generated at build time (or on first load). Cards capture 6 axis-aligned directions. The quality of card coverage — how well the flat patches approximate the actual mesh — determines GI accuracy for that mesh. You can visualize mesh cards with `r.Lumen.Visualize.CardPlacement 1`.

### Signed Distance Fields (SDFs)
Software Lumen's scene representation for ray traversal. Every mesh gets a precomputed SDF — a 3D texture where each voxel stores the distance to the nearest surface. Rays step through this field to find intersections quickly without triangle-level hardware. SDF quality is limited by voxel resolution — thin features and small gaps may be missed. SDF memory adds to GPU resource usage.

### Screen Probes
The sparse radiance sampling points placed per 8×8 screen tile. Each probe traces rays to gather incident radiance, then the probe values are interpolated to fill all pixels. Probe density (downsample factor) and per-probe ray count (octahedron resolution) are the two primary quality/performance levers for the gather phase.

### Temporal Accumulation
Lumen's primary cost-reduction strategy. By reusing radiance samples from previous frames, the effective sample count per frame is multiplied by the number of stable frames. A static scene with no camera movement can accumulate dozens of history frames, producing very high quality at low per-frame cost. Dynamic scenes lose history rapidly.

---

## 📋 Reader Notes

> [!NOTE]
> **"Diffuse Indirect & AO" in Unreal Insights is a container stage.** Expanding it reveals multiple sub-events: `LumenScreenProbeGather`, `LumenSurfaceCacheFeedback`, `DenoiseDiffuseIndirect`, `AmbientOcclusion`, and more. Always look at the sub-events before tuning — the bottleneck may be probe gather, denoising, or surface cache update, and each has different CVars.

> [!NOTE]
> **Lumen works best with well-lit, open geometry.** Tightly enclosed spaces with many small gaps, thin walls, or complex concave shapes challenge both SDF ray traversal (software Lumen) and mesh card coverage. If GI looks incorrect in specific areas, use `r.Lumen.Visualize.CardPlacement 1` to check mesh card coverage and `r.Lumen.Visualize.Mode` for probe gather quality.

> [!NOTE]
> **Disabling Lumen does not automatically give you working AO.** SSAO must be explicitly enabled and configured. Check `r.AmbientOcclusion.Method` and `r.AmbientOcclusionLevels` if you're shipping without Lumen and need screen-space AO as a fallback.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `LumenDiffuseIndirect` | Top-level Lumen GI container — expand for sub-events |
| `LumenScreenProbeGather` | Screen probe placement and trace cost |
| `LumenSurfaceCacheFeedback` | Surface cache update cost this frame |
| `DenoiseDiffuseIndirect` | Spatial + temporal denoising cost |
| `AmbientOcclusion` | SSAO cost (only present when Lumen AO is not active) |
| `LumenRadianceCacheUpdate` | World-space radiance cache update |

> [!TIP]
> If `LumenScreenProbeGather` dominates, reduce probe density or per-probe ray count. If `DenoiseDiffuseIndirect` dominates, the denoiser is working hard due to high noise — improve probe quality so less denoising is needed. If `LumenSurfaceCacheFeedback` is high, many surface cache entries are being updated — check for large dynamic objects or many unique emissive surfaces.

### Debug Visualizations

```
r.Lumen.Visualize.Mode 1        // Lumen indirect lighting only — shows GI contribution isolated
r.Lumen.Visualize.CardPlacement 1  // Shows mesh card placement on scene geometry
                                    // Red/missing cards = poor GI coverage for those meshes
viewmode ambientocclusion        // Shows AO contribution in isolation (SSAO or Lumen AO)
```

### Stat Commands

```
stat GPU     // Overall GPU breakdown — Lumen appears as a block
stat Lumen   // Lumen-specific counters: card updates, probe counts, cache hit rates
```

### Useful Console Variables

```
// Lumen Global
r.Lumen.DiffuseIndirect.Allow 0/1        // Master toggle for Lumen diffuse GI
r.Lumen.HardwareRayTracing 0/1           // Software (0, default) vs Hardware RT (1)

// Screen Probe Quality/Performance
r.Lumen.ScreenProbeGather.DownsampleFactor [2]   // Probe grid density — higher = fewer probes = faster
                                                   // 2 = one probe per 2×2 tiles (default)
                                                   // 4 = one probe per 4×4 tiles (cheaper, lower quality)
r.Lumen.ScreenProbeGather.TracingOctahedronResolution [4]  // Rays per probe (4=16 rays, 8=64 rays)
                                                             // Reduce for fewer rays per probe

// Surface Cache
r.LumenScene.SurfaceCache.MeshCardScale [1.0]     // Card capture resolution scale — reduce for cheaper cache
r.LumenScene.DirectLighting.Allow 0/1             // Multi-bounce GI via surface cache direct lighting

// SSAO (when Lumen disabled)
r.AmbientOcclusion.Method 0/1           // 0 = SSAO, 1 = GTAO (higher quality)
r.AmbientOcclusionLevels [2]            // SSAO quality levels (0-3)
r.AmbientOcclusionRadiusScale [1.0]     // AO sampling radius scale
```

---

## Optimization Levers

### Lumen Quality Reduction (Highest Impact)
- Increase `r.Lumen.ScreenProbeGather.DownsampleFactor` to reduce probe density — most impactful single lever
- Reduce `r.Lumen.ScreenProbeGather.TracingOctahedronResolution` to fewer rays per probe — reduces trace count quadratically
- Use software Lumen (`r.Lumen.HardwareRayTracing 0`) unless hardware RT quality improvement is necessary

### Content and Scene Setup
- Avoid large emissive mesh areas feeding GI — use actual lights for localized emission; emissive GI is expensive to update in the surface cache
- Reduce the number of unique, constantly-changing surfaces in GI-critical areas
- In fast-movement gameplay zones, simplify geometry to reduce surface cache complexity

### Per-Platform Scaling
- Ship with Lumen disabled on hardware that doesn't support it gracefully; configure SSAO fallback explicitly
- Use Scalability settings to drive Lumen quality per platform — `r.Lumen.ScreenProbeGather.DownsampleFactor` is the primary lever for the performance tier

---

## Mental Model

Think of this stage as:

> *"Ask the scene: for every surface that a camera pixel can see, how much light is bouncing onto it from everything else — and answer that question cheaply by not recomputing answers you already know."*

Lumen's efficiency is entirely about **avoiding redundant work through caching**. The surface cache avoids re-evaluating lighting on static surfaces. Temporal accumulation avoids re-tracing stable probes. The radiance cache avoids tracing to off-screen geometry. Each caching layer has a cost when it's invalidated — by moving geometry, fast camera motion, or changing lights.

The key insight is that **Lumen is always a budget trade-off between accuracy and caching efficiency.** A scene that moves constantly and changes every frame gets little benefit from any of the caches. A mostly static scene with gentle camera movement gets enormous benefit. Design your GI-critical areas with temporal stability in mind.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| HZB (BuildHZB) | Screen probe traces use HZB for efficient screen-space ray marching |
| BasePass (GBuffer) | Lumen reads GBuffer normals and albedo for surface cache and probe evaluation |
| SDF Scene | Software Lumen's ray traversal structure — maintained alongside the main scene |
| Mesh Cards (Surface Cache) | Precomputed proxy surfaces; updated incrementally each frame |
| SSAO | Fallback AO system when Lumen is disabled |
| Deferred Lighting | Indirect lighting buffer produced here is added during final lighting combine |

---

## Red Flags to Watch For

- **`LumenScreenProbeGather` > 2ms** → probe density or per-probe ray count too high; increase `DownsampleFactor` or reduce `TracingOctahedronResolution`
- **`DenoiseDiffuseIndirect` > 1ms** → denoiser working hard due to high noise; improve probe quality so denoiser has less to fix
- **GI flickering or noise during camera movement** → expected; reduce by improving probe quality, not by tuning temporal settings
- **GI looks flat or incorrect on specific meshes** → poor mesh card coverage; check `r.Lumen.Visualize.CardPlacement 1` for those meshes
- **`LumenSurfaceCacheFeedback` consistently high** → too many surface cache entries being updated; large dynamic objects or many changing emissive surfaces
- **Hardware Lumen enabled unexpectedly** → check `r.Lumen.HardwareRayTracing`; hardware RT on non-RT capable hardware falls back to software but may have overhead
- **AO absent when Lumen is disabled** → SSAO not configured as fallback; check `r.AmbientOcclusionLevels` and `r.AmbientOcclusion.Method`
- **GI spikes specifically in interior spaces** → enclosed geometry challenging SDF traversal and card coverage; consider simplifying interior architecture or adding light sources to reduce GI dependence

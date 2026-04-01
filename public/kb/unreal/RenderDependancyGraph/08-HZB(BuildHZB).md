---
tags:
  - hzb
  - occlusion
  - lumen
---

# Unreal Engine 5 Rendering Pipeline – HZB (BuildHZB)

> Stage: **HZB (BuildHZB)**  
> Phase: Early Rendering / Visibility Acceleration  
> Purpose: Build a hierarchical depth pyramid from scene depth for fast occlusion culling, Nanite cluster culling, Lumen screen-space tracing, and screen-space effect queries  
> Pipeline Position: Built once from PrePass depth (early), optionally rebuilt after `NaniteEmitDepthTargets` (late)

---

## What This Stage Does

This stage builds the **Hierarchical Z-Buffer (HZB)** — a mip pyramid derived from the scene depth buffer. It is a read-only acceleration structure used by many downstream systems to perform fast spatial queries against scene depth without sampling the full-resolution buffer.

The HZB is constructed as a **hierarchical downsample chain**:

| Mip Level | Coverage | Use |
|-----------|----------|-----|
| Mip 0 | Half-resolution (first downsample of SceneDepth) | Fine-grained depth queries |
| Mip 1 | Quarter-resolution | Medium occlusion tests |
| Mip 2 | Eighth-resolution | Coarse occlusion tests |
| … | Progressively coarser | Large-scale visibility, ray skip steps |

> [!NOTE]
> **Mip 0 of the HZB is half-resolution, not full-resolution.** The full-resolution depth lives in SceneDepth. The HZB is a separate downsampled structure — its first mip is already a 2×2 downsample. This is intentional: HZB is designed for fast *approximate* queries, not exact per-pixel depth reads. Systems that need exact depth sample SceneDepth directly; systems that need fast spatial queries use HZB.

Each mip stores the **maximum (furthest) depth value** in its region — not the average, not the minimum. This is the conservative choice for occlusion: if the furthest depth in a tile is still in front of an object's bounding sphere, every pixel in that tile is in front of the object and it is definitively occluded. The maximum convention guarantees no false occlusion — objects are never incorrectly culled.

---

## Why This Stage Exists

Many systems need to ask "is this point or volume visible from the camera?" every frame. Doing this by testing against full-resolution SceneDepth is prohibitively expensive at scale. The HZB pyramid solves this by providing depth data at multiple granularities — large queries sample coarse mips cheaply, small queries use fine mips precisely.

Systems that depend on HZB:
- **CPU occlusion culling** — bounding box visibility tests for traditional mesh actors
- **Nanite cluster culling** — per-cluster visibility tests during Nanite's GPU-driven cull pass
- **Lumen screen-space tracing** — hierarchical ray stepping through the depth pyramid
- **Screen Space Reflections (SSR)** — ray marching against HZB for intersection detection
- **SSAO** — local occlusion sampling uses HZB for depth lookups
- **Virtual Shadow Maps** — tile visibility tests use HZB to skip shadow updates on occluded tiles

---

## Two Build Points — Early and Late

This is the most architecturally important fact about the HZB and is rarely documented explicitly.

**Early HZB (from PrePass depth only):**
Built immediately after PrePass, before Nanite rasterization. Contains only traditional mesh depth — Nanite geometry is absent. Used by Nanite's own culling pass *this frame* (Nanite needs an HZB to cull against before it has rendered). Because Nanite is absent from this HZB, its culling is based on non-Nanite occluders only.

**Late HZB (after NaniteEmitDepthTargets):**
Optionally rebuilt after Nanite has emitted its depth into SceneDepth. Contains both traditional and Nanite depth. Used by downstream screen-space passes (Lumen tracing, SSR, SSAO) that need complete scene depth coverage. This is the HZB most systems actually read from during a frame.

> [!NOTE]
> **The early HZB creates a deliberate one-frame latency for Nanite occlusion.** Nanite culls against an HZB that doesn't contain Nanite depth from the current frame — it uses PrePass depth from this frame and Nanite depth from the *previous* frame's late HZB (via the prior frame's SceneDepth). This is the same one-frame latency described in the PrePass document. It is an accepted design trade-off, not a bug, and is rarely perceptible in practice.

---

## How HZB Ray Marching Works

Lumen screen-space traces and SSR ray marching both use the HZB pyramid as a **hierarchical ray stepper** — this is why HZB quality directly affects the quality and cost of those passes.

The algorithm works as follows:
1. Start a ray from a screen pixel in a given direction
2. Sample a coarse mip level — if the ray is clearly in empty space (depth behind the ray), advance by a large step
3. As the ray approaches potential geometry, step down to finer mips for more precise intersection testing
4. Resolve the final intersection at mip 0

This lets rays skip large empty regions cheaply and only pay fine-grained cost near actual surfaces. A scene with good depth coverage (dense geometry filling the HZB) produces clean, efficient ray traces. A scene with holes in the HZB (from missing PrePass depth, WPO exclusions, or Nanite emit ordering issues) forces rays to traverse more of the pyramid before terminating, increasing trace cost and producing incorrect misses.

> [!NOTE]
> **Lumen screen-space trace quality is directly coupled to HZB completeness.** Missing depth (from masked materials excluded from PrePass, WPO surfaces, or anything that doesn't write depth correctly) appears as holes in the HZB. Lumen rays passing through these holes will trace further than they should, increasing cost and potentially sampling incorrect geometry. This is why PrePass depth quality has upstream consequences for Lumen performance.

---

## Execution Model

HZB construction is a **GPU compute pass** — a chain of compute shader downsamples that read each mip level and write the next. There is no CPU render thread footprint per mip. The cost scales with the number of mip levels to build and the resolution of each.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the HZB build dispatch |
| **GPU Compute** | Executes the entire downsample chain — all mips built in sequence on GPU |

---

## What Feeds Into HZB

| Source | Included | Notes |
|--------|----------|-------|
| PrePass depth (traditional meshes) | ✅ Yes | Always present in early HZB |
| Nanite depth (post-emit) | ✅ Yes | Present in late HZB only |
| Masked materials | ⚠️ Conditional | Only if included in PrePass via `r.EarlyZPass 2` |
| Translucent geometry | ❌ No | No depth write; absent from HZB |
| Sky | ❌ No | Rendered after HZB construction |
| Single Layer Water | ❌ No | Separate depth pass |

> [!WARNING]
> **Holes in PrePass depth create holes in the early HZB — and those holes directly degrade Nanite culling efficiency and Lumen trace quality.** Geometry that doesn't write depth (WPO exclusions, masked material exclusions, translucency) is invisible to the HZB. Nanite may fail to cull clusters that would have been occluded by that geometry, and Lumen rays may pass through surfaces that should have terminated them. Maximizing PrePass depth coverage is one of the highest-leverage optimizations for downstream system quality.

---

## What Data It Produces

**Primary Output:**
- **HZB texture (depth pyramid)** — mip chain from half-resolution down to a single texel, each mip storing maximum depth values

**Consumed downstream by:**

| System | How It Uses HZB |
|--------|----------------|
| CPU Occlusion Culling | Bounding box tests against coarse mips to determine actor visibility |
| Nanite Cluster Culling | Per-cluster GPU visibility tests during Nanite cull pass (uses early HZB) |
| Lumen Screen Traces | Hierarchical ray stepping — coarse mips skip, fine mips resolve |
| SSR Ray Marching | Same hierarchical stepping as Lumen traces |
| SSAO | Local depth queries for ambient occlusion estimation |
| Virtual Shadow Maps | Tile occlusion tests to skip unnecessary shadow updates |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High render resolution | More pixels at mip 0; more levels to downsample | Tune screen percentage per platform |
| Multiple active views | Each view requires an independent HZB build | Minimize scene captures; each has its own HZB |
| Dynamic resolution | HZB is rebuilt at a new size every frame resolution changes | Use fixed resolution targets or lock dynamic resolution range |
| Many HZB consumers | Lumen, SSR, SSAO, VSM all reading HZB creates bandwidth pressure | Profile consumers separately — HZB build cost vs HZB read cost are distinct |

---

## Key Systems and Components

### Maximum Depth Convention
Each HZB mip stores the maximum (furthest) depth value in its footprint. This conservative choice prevents false occlusion — an object is only considered occluded if the furthest depth in its screen-space region is still closer to the camera than the object. Any doubt means "not occluded." The cost of this conservatism is that some occluded objects may pass the HZB test and be incorrectly marked visible — accepted as a minor inefficiency relative to the catastrophic alternative of incorrect culling of visible objects.

### Hierarchical Ray Stepping
The mechanism by which Lumen and SSR use the HZB for efficient ray marching. Rather than stepping one pixel at a time at full resolution, rays advance through coarse mips (large steps in empty space) and refine when approaching geometry. This makes screen-space tracing O(log n) in depth complexity rather than O(n). The pyramid structure is essential to this — without it, long Lumen rays in open scenes would be unaffordably expensive.

### Early vs Late HZB
Two distinct HZB states within a single frame. The early HZB (PrePass depth only) is the conservative base used by Nanite culling. The late HZB (PrePass + Nanite depth) is the complete version used by all screen-space systems. The late HZB is the one that matters most for screen-space effect quality and is the one that should be examined when diagnosing Lumen trace artifacts.

---

## 📋 Reader Notes

> [!NOTE]
> **HZB is a dependency multiplier — its quality affects many systems simultaneously.** Improving HZB quality (better PrePass depth coverage, ensuring Nanite emit runs before the late build) improves occlusion culling efficiency, Nanite cluster culling accuracy, Lumen trace quality, SSR intersection accuracy, and VSM tile skipping — all at once. Time invested in PrePass and Nanite depth quality pays back across the entire downstream pipeline.

> [!NOTE]
> **The HZB build itself is rarely the bottleneck.** In most scenes, `BuildHZB` is under 0.3ms. If it appears expensive, the cause is almost always resolution (screen percentage too high for the platform) or an excessive number of views (scene captures). The more common HZB-related issue is downstream — poor occlusion effectiveness or Lumen trace artifacts caused by incomplete depth input to the HZB, not the build cost itself.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `BuildHZB` | Total HZB construction cost — may appear twice if early + late builds both run |
| `HZB` | Variant event name depending on pass ordering and engine version |

> [!TIP]
> If occlusion culling feels ineffective (objects visibly popping in, Nanite culling rates low in `stat nanite`), check whether the HZB is being populated with sufficient depth. Use `vis hzb` to inspect the depth pyramid directly — regions showing max depth (far plane value) where geometry should exist indicate missing PrePass depth. Trace the missing depth back to WPO, masked exclusions, or Nanite emit ordering.

### Debug Visualization

```
vis hzb              // Displays the HZB depth pyramid in the viewport.
                     // Each mip level shown progressively coarser.
                     // Bright = far depth, dark = close depth.
                     // Holes (uniform far value) where geometry exists = missing PrePass depth.
```

### Stat Commands

```
stat GPU             // Overall GPU frame breakdown — BuildHZB appears as a block here
```

### Useful Console Variables

```
r.HZBOcclusion 1/0              // Toggle CPU occlusion culling queries against HZB.
                                 // Disabling does NOT skip the HZB build — Lumen and SSR
                                 // still require it. Only the occlusion query step is skipped.
r.HZBOcclusion.MaxMips          // Maximum mip levels built — reduce to lower build cost
                                 // at the expense of occlusion query precision at coarse scales.
r.Lumen.ScreenProbeGather.ScreenSpacePercent  // Controls how much Lumen screen-space tracing
                                               // relies on HZB — reduce to lower HZB read pressure.
```

> [!WARNING]
> **Disabling HZB occlusion (`r.HZBOcclusion 0`) does not skip the HZB build.** The build always runs because Lumen screen-space tracing, SSR ray marching, and Nanite cluster culling all depend on the HZB independently of CPU occlusion queries. Disabling occlusion queries saves only the small query dispatch cost, not the build itself. If the build cost is the problem, the fix is resolution or view count, not toggling occlusion off.

---

## Optimization Levers

### Improve Depth Input Quality
- Maximize PrePass depth coverage — every surface that writes depth improves both HZB occlusion accuracy and Lumen trace quality
- Ensure Nanite emit runs before the late HZB build in your pipeline configuration so Nanite surfaces occlude downstream traces
- Avoid large WPO surfaces and masked material exclusions from PrePass where possible

### Resolution and Views
- Reduce screen percentage on lower-end targets — HZB build cost scales directly with resolution
- Minimize active scene captures — each capture triggers an independent HZB build cycle
- Avoid unnecessary VR or splitscreen views if HZB cost is a concern — each view is a separate build

> [!WARNING]
> **Scene captures do not share the HZB with the main view.** Each active scene capture actor builds its own independent HZB from its own depth buffer. A level with 4 active scene captures runs 5 independent HZB build chains per frame (4 captures + main view). This is the same multiplicative cost pattern seen in Nanite emit and light grid passes — scene captures are expensive across all of these systems simultaneously.

---

## Mental Model

Think of the HZB as:

> *"A depth atlas organized by detail level — so any system that needs to ask 'what's in front of what?' can get a fast answer at whatever precision it needs."*

The HZB is infrastructure. It doesn't render anything — it makes everything else faster by providing depth queries that scale from pixel-precise to scene-wide at different mip levels. Its quality is entirely determined by the depth that went into it. Better input depth means better occlusion, better Lumen traces, and better SSR — across the entire frame simultaneously.

The key insight is that **HZB quality and PrePass quality are the same problem**. Every choice made in PrePass about what writes depth cascades forward through the HZB into every system that reads it.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| PrePass | Primary depth source for early HZB — quality directly determines HZB completeness |
| NaniteEmitDepthTargets | Depth source for late HZB — Nanite surfaces absent from early HZB |
| Nanite Cluster Culling | Uses early HZB for per-cluster visibility tests during Nanite cull pass |
| Lumen Screen Traces | Uses late HZB for hierarchical ray stepping in screen space |
| SSR | Uses late HZB for reflection ray marching |
| SSAO | Uses HZB for local depth queries |
| Virtual Shadow Maps | Uses HZB for tile occlusion tests |
| CPU Occlusion Culling | Uses HZB for bounding box visibility tests on traditional mesh actors |

---

## Red Flags to Watch For

- **`BuildHZB` > 0.5ms** → check screen percentage first; then check active view count (scene captures)
- **`vis hzb` showing holes (far-plane depth) over visible geometry** → PrePass depth missing for that geometry; trace back to WPO exclusions, masked material settings, or Nanite emit ordering
- **Nanite culling rate low in `stat nanite` despite occluded scene** → early HZB missing depth for key occluders; PrePass geometry coverage may be insufficient
- **Lumen traces producing noise or incorrect misses over specific surfaces** → those surfaces absent from late HZB; check depth write behavior for that geometry type
- **`BuildHZB` appearing twice in Unreal Insights GPU track** → both early and late builds running; verify this is intentional for your pipeline configuration
- **SSR showing incorrect intersections or over-tracing** → HZB completeness issue; same root cause as Lumen trace artifacts
- **Scene captures causing `BuildHZB` to multiply in cost** → each active capture has its own HZB; disable or throttle captures as with all other per-view passes

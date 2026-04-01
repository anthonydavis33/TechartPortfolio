---
tags:
  - shadows
---

# Unreal Engine 5 Rendering Pipeline – Virtual Shadow Map Array Build (Page Allocation)

> Stage: **Virtual Shadow Map Array Build – Page Allocation**  
> Phase: Shadow Setup / Virtual Memory Management  
> Purpose: Determine which shadow map pages are needed this frame, check which cached pages are still valid, and build the work list for shadow depth rendering  
> Pipeline Position: After `BuildRenderingCommandsDeferred`, before `ShadowDepths`

---

## What Virtual Shadow Maps Are

Traditional shadow maps render the entire shadow frustum at a fixed resolution every frame — expensive and inflexible. **Virtual Shadow Maps (VSM)** replace this with a large sparse virtual texture.

The VSM system maintains a single **16k × 16k virtual shadow map atlas** per light (or per clipmap level for directional lights). This atlas is divided into **128×128 pixel tiles called pages**. Only pages that are actually needed — where shadows will be visible from the current camera view — are physically allocated and rendered. Pages that remain unchanged from previous frames are **cached** and reused at zero rendering cost.

This is the most important efficiency property of VSM: **unchanged shadow geometry is rendered once and cached indefinitely.**

### Directional Light: Clipmap Structure
For the directional light (sun), VSM uses a **clipmap** — a set of concentric rings centered on the camera position, each covering a larger area at lower resolution. The innermost ring has the highest shadow texel density (sharpest shadows near the camera); outer rings get progressively coarser. As the camera moves, the clipmap shifts and new pages at the edges need to be rendered while old pages at the now-off-camera edges can be discarded.

### Local Lights: Perspective Shadow Maps
For point and spot lights, VSM uses perspective projection — similar in concept to traditional shadow maps but with virtual page management instead of a fixed-resolution atlas.

---

## What This Stage Does

Page Allocation is **shadow visibility and memory management** — it determines what shadow rendering work needs to happen, before any geometry is actually rendered into shadow maps.

This stage:
1. **Analyzes the scene** — tests light frustums against camera view frustum, uses HZB to identify which areas of each light's shadow map are potentially visible to the camera
2. **Checks page validity** — for every page that was rendered in a previous frame, determines if it is still valid (no shadow caster moved, no geometry changed in its region)
3. **Marks pages as dirty** — pages whose contents are invalid are marked for re-rendering
4. **Allocates physical pages** — maps dirty virtual pages to physical entries in the VSM pool
5. **Builds the render list** — produces the ordered list of pages that ShadowDepths will render

---

## Page Invalidation — What Makes a Cached Page Dirty

This is the most important concept for understanding VSM performance. **Cached pages are the entire point of VSM efficiency.** Understanding what breaks the cache determines what drives shadow rendering cost.

| Event | Pages Invalidated |
|-------|------------------|
| Static geometry (no changes) | ✅ Never — cached indefinitely |
| Movable light transforms | All pages for that light every frame |
| Dynamic geometry moves (skeletal meshes, physics) | Pages in all lights that could shadow from/onto that object |
| Camera moves (directional light clipmap) | Edge pages of the clipmap that shift out of range |
| New geometry enters light frustum | Pages covering the new geometry |
| Material changes at runtime | Pages covering affected geometry |

> [!WARNING]
> **Movable lights invalidate all their shadow pages every frame regardless of whether they actually moved.** The light's Mobility setting — not whether it animated this frame — determines whether its pages are cached. A Movable light that is placed in the world and never moves still rebuilds all shadow pages every frame. Convert lights that don't need per-frame movement to **Stationary** to enable VSM page caching for their static geometry contributions. This is the single highest-impact shadow optimization in most projects.

> [!WARNING]
> **Dynamic geometry (skeletal meshes, physics objects, moving actors) invalidates pages in every light that intersects their movement path.** Each character walking through a lit area marks shadow pages dirty in every shadow-casting light overhead. In a scene with many characters under many lights, this can cause significant per-frame page churn. Reduce the number of shadow-casting lights over areas with heavy dynamic activity, or disable shadow casting on non-hero dynamic objects.

---

## Why This Stage Exists

Without VSM, every shadow-casting light would need to:
1. Render its entire shadow frustum from scratch every frame
2. At fixed resolution — either high quality everywhere (too expensive) or low quality everywhere (unacceptable)
3. With no frame-to-frame reuse

VSM's page allocation stage enables the whole caching system — it is the decision engine that determines what actually needs to be rendered this frame. In a well-authored scene with mostly static geometry and stationary lights, this stage may determine that **zero pages need re-rendering for those lights**, making shadow depth cost for static content effectively zero.

---

## Execution Model

This stage is primarily **GPU compute** — the visibility analysis and page validity checking run as GPU compute dispatches. The CPU contributes by determining which lights are visible (already done in `InitViews`) and submitting the compute dispatches.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Provides light visibility data from InitViews; schedules page allocation dispatches |
| **GPU Compute** | Analyzes page visibility using HZB; checks page validity; builds dirty page list |

---

## What Data It Produces

| Output | Consumers |
|--------|-----------|
| Allocated VSM pages per light | `ShadowDepths` — renders only into allocated dirty pages |
| Page residency tables | Shadow projection pass — maps virtual page addresses to physical memory |
| Page-to-world mappings | Shadow projection — provides correct world-space depth comparison per page |
| Dirty page render list | `ShadowDepths` — ordered work list of pages needing re-rendering |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many shadow-casting Movable lights | Every Movable light invalidates all pages every frame — no caching | Convert to Stationary wherever per-frame movement is not needed |
| Many dynamic shadow casters | Each moving object invalidates pages across all lights it intersects | Disable shadow casting on non-hero dynamic objects; reduce dynamic object count under shadow-casting lights |
| Fast camera movement | Directional light clipmap shifts — many edge pages need re-allocation | Cannot eliminate; reduce shadow distance to limit clipmap extent |
| Large light influence volumes | More pages potentially visible per light | Reduce light `Attenuation Radius` to minimum needed |
| Poor occlusion | More pages pass HZB visibility test — more allocated | Improve scene occlusion; add occluders in open spaces |
| High VSM page pool size | More pages to analyze for validity | Tune `r.Shadow.Virtual.MaxPhysicalPages` to scene needs |

---

## Key Systems and Components

### VSM Page Pool
The physical backing store for virtual shadow map pages — a fixed-size pool of 128×128 pixel tiles. Pages are mapped in and out of this pool as needed. The pool size (`r.Shadow.Virtual.MaxPhysicalPages`) determines how many pages can be resident simultaneously. If the pool overflows, least-recently-used pages are evicted and must be re-rendered if needed again.

### Page Validity Cache
The mechanism that enables the zero-cost static shadow property. Each allocated page stores a hash or timestamp of the shadow casters that contributed to it. Each frame, the system checks whether any contributing caster has changed. If none have changed, the page is valid and skipped by ShadowDepths. Static geometry contributes pages that are valid forever until explicitly invalidated.

### HZB-Based Page Visibility
The page allocation system uses the HZB to determine which shadow pages are actually visible from the camera. A shadow page that exists entirely behind opaque geometry from the camera's perspective can be culled — no allocation, no rendering. This is how VSM avoids computing shadows for geometry the camera can never see.

### Directional Light Clipmap
The multi-level ring structure for sun shadow coverage. Typically 5–7 clipmap levels covering increasing distances from the camera. Each level has its own set of pages. The innermost levels have high density (sharp shadows near the player); outer levels have low density (softer shadows at distance). Shadow max distance controls how many levels exist and how far the outer ring extends.

---

## 📋 Reader Notes

> [!NOTE]
> **VSM is enabled by default in UE5 projects and replaces the older Cascaded Shadow Maps (CSM) system for most use cases.** CSM is still used for some specific cases, but VSM is the primary shadow system. All documentation about "shadow page" behavior in this doc applies to lights using VSM. Legacy CSM lights do not use page allocation.

> [!NOTE]
> **The page allocation stage cost in isolation is not the full shadow story.** This stage decides *what* to render; `ShadowDepths` (doc 16) actually renders it. A high page allocation cost with low ShadowDepths cost means you're doing a lot of visibility analysis but most pages are cached. A low page allocation cost with high ShadowDepths cost means many pages are being validated quickly but the re-rendering is expensive. Profile both stages together.

> [!NOTE]
> **`r.Shadow.Virtual.Visualize 1` is one of the most useful debug tools in UE5 for shadow performance.** It shows exactly which pages are allocated, which are dirty (red), which are cached (green), and which are being evicted. Green is good — cached pages are free. Red means re-rendering. If most of your scene shows green and only character-shadow areas show red, your setup is well-optimized.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `VirtualShadowMapArrayBuild` | Total page allocation analysis cost |
| `VSMPageAllocation` | Per-light page allocation dispatches |
| `Shadow.Virtual.BuildPages` | Variant event name depending on engine version |

> [!TIP]
> If page allocation is expensive, check the page visualization first. High dirty page counts (many red pages) mean lots of geometry is changing each frame — dynamic objects or Movable lights are the cause. If allocation itself is slow but page counts seem reasonable, check how many shadow-casting lights are active — each adds allocation analysis cost.

### Debug Visualizations

```
r.Shadow.Virtual.Visualize 1        // Page residency visualization:
                                     // Green = cached (free this frame)
                                     // Red = dirty (will be re-rendered)
                                     // Empty = not allocated (not visible from camera)

r.Shadow.Virtual.ShowPageUsage 1    // Shows physical page pool utilization —
                                     // if pool is near capacity, pages are being evicted and re-rendered
```

### Stat Commands

```
stat GPU      // Overall GPU breakdown — VSM allocation appears as a block
stat shadow   // Shadow counters including VSM page stats and light counts
```

### Useful Console Variables

```
r.Shadow.Virtual.Enable 1/0                    // Toggle VSM system (falls back to CSM)
r.Shadow.Virtual.MaxPhysicalPages [2048]       // Page pool size — reduce if GPU memory is constrained
r.Shadow.Virtual.ResolutionLodBias [0]         // Positive = lower resolution = cheaper
                                                // Negative = higher resolution = more expensive
r.Shadow.Virtual.Cache.StaticSeparate 0/1      // Separate static and dynamic shadow caches
                                                // When enabled: static geometry shadow cached separately
                                                // from dynamic, preventing dynamic objects from invalidating
                                                // all static shadow pages
r.Shadow.DistanceScale [1.0]                   // Global shadow distance scale — reduce to limit
                                                // clipmap extent and total page count
```

---

## Optimization Levers

### Lighting Setup (Highest Impact)
- Convert all non-animating lights from Movable to **Stationary** — this is the single most impactful shadow optimization. Stationary lights cache VSM pages for static geometry indefinitely.
- Reduce the number of simultaneously active shadow-casting lights
- Reduce light `Attenuation Radius` to minimum visual requirement — smaller radius = fewer pages potentially visible per light

### Dynamic Objects
- Disable shadow casting on non-hero dynamic objects — foliage, small props, distant characters
- Enable `r.Shadow.Virtual.Cache.StaticSeparate 1` to prevent dynamic object movement from invalidating static geometry's shadow pages

### Shadow Distance
- Reduce `r.Shadow.DistanceScale` or per-light shadow max distance — fewer clipmap levels = fewer pages to allocate and render
- Use fog or other atmospheric effects to visually justify shorter shadow distances

### Page Pool
- Tune `r.Shadow.Virtual.MaxPhysicalPages` — too small causes eviction churn; too large wastes GPU memory
- Use `r.Shadow.Virtual.ShowPageUsage 1` to see actual pool utilization before adjusting

---

## Mental Model

Think of this stage as:

> *"Check which shadow 'tiles' in a massive virtual shadow atlas still have valid contents from previous frames — then flag only the ones that need fresh rendering."*

VSM page allocation is the intelligence that makes VSM efficient. It avoids re-rendering what hasn't changed. A perfectly tuned scene — all static geometry, all stationary lights — can reach a state where nearly all shadow pages are green (cached) and this stage produces an almost-empty render list for ShadowDepths, making shadow cost essentially zero for the static content.

The optimization strategy is entirely about **maximizing cache stability**: keep lights stationary, keep geometry static where possible, and limit the number of dynamic objects invalidating pages under shadow-casting lights.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| ShadowDepths (doc 16) | Renders into pages flagged dirty by this stage |
| HZB | Used to cull shadow pages not visible from the camera |
| BuildRenderingCommandsDeferred | Light visibility from InitViews feeds which lights have pages allocated |
| Light Mobility | Stationary vs Movable directly determines whether pages can be cached |
| Deferred Lighting | Reads VSM page data for shadow projection during lighting |

---

## Red Flags to Watch For

- **`VirtualShadowMapArrayBuild` > 1ms** → check page visualization for high dirty-page counts; trace to Movable lights or dynamic objects
- **`r.Shadow.Virtual.Visualize` showing mostly red pages** → poor cache efficiency; check light mobility settings and dynamic object count
- **`r.Shadow.Virtual.ShowPageUsage` near maximum capacity** → page pool too small for scene; increase `r.Shadow.Virtual.MaxPhysicalPages` or reduce shadow distance
- **Shadow page churn during camera movement only** → directional light clipmap shift; reduce shadow distance to limit clipmap extent
- **Dynamic characters causing widespread page invalidation** → each character invalidates pages in all nearby lights; reduce shadow-casting light count in high-character-density areas
- **Movable lights that never animate** → audit light Mobility settings; Movable lights that don't need per-frame movement should be Stationary

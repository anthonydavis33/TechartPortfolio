---
tags:
  - nanite
---

# Unreal Engine 5 Rendering Pipeline – Nanite Emit Depth Targets

> Stage: **Nanite Emit Depth Targets**  
> Phase: Nanite → Traditional Renderer Interop  
> Purpose: Resolve Nanite's internal depth representation into the standard SceneDepth and stencil targets so all downstream passes can treat Nanite geometry as normal depth-tested geometry  
> Pipeline Position: After `NaniteVisibilityBuffer`, before `BasePass` and `BuildHZB` (post-Nanite)

---

## What This Stage Does

Nanite's visibility rasterizer writes depth into **Nanite-internal targets** — a packed format optimized for its own GPU-driven pipeline. The rest of the UE5 renderer, however, expects depth in a standard **32-bit float SceneDepth** buffer that all downstream passes sample from directly.

This stage is the **resolve** between those two representations. It reads Nanite's internal depth output and writes it into:
- The standard **SceneDepth** buffer (32-bit float) — consumed by all screen-space effects, lighting, Lumen, and any pass that samples depth
- The **stencil buffer** — specific stencil bits are written to mark which pixels were covered by Nanite geometry

Without this stage, every downstream pass would have a hole in the depth buffer wherever Nanite geometry exists — screens-space effects would fail, lighting depth tests would pass through Nanite surfaces, and HZB construction would be incomplete.

---

## Why This Stage Exists

Nanite's internal rendering pipeline is GPU-driven and uses its own intermediate depth representation optimized for cluster-level visibility. That format is not directly compatible with the depth buffer interface the rest of the engine expects.

This "handshake" stage bridges that gap so:
- **Deferred lighting** can depth-test against Nanite surfaces correctly
- **Screen-space effects** (SSAO, SSR, DoF) can sample depth over Nanite geometry
- **Lumen** screen traces and reprojection have valid depth data where Nanite exists
- **HZB construction** (if ordered after this stage) includes Nanite depth for occlusion culling
- **BasePass** can use stencil to identify Nanite-covered pixels and skip redundant geometry rendering

---

## The Stencil Write — Why It Matters

This stage writes more than just depth. Specific **stencil bits are written for every pixel covered by Nanite geometry**. These bits serve as a per-pixel flag used by downstream passes to distinguish between:
- Pixels where Nanite handled geometry (stencil bit set)
- Pixels where traditional raster handled geometry (stencil bit clear)

BasePass reads these stencil bits to avoid rendering traditional mesh draw commands onto pixels already owned by Nanite. This prevents double-shading and ensures the two raster pipelines don't conflict.

> [!WARNING]
> **Any pass between NaniteEmitDepthTargets and BasePass that clears or overwrites the stencil buffer will break this handshake.** Nanite-covered pixels will lose their stencil flag and BasePass may attempt to render traditional geometry on top of them, causing visual corruption or wasted shading work. Custom stencil operations scheduled between these two stages should be audited carefully.

---

## Execution Model

Like the Nanite Visibility Buffer pass, this is a **GPU compute operation** — not a CPU-driven command list. The CPU schedules the dispatch; the GPU executes the resolve entirely on its own.

The cost scales with:
- **Pixel coverage** of Nanite geometry on screen — more Nanite-covered pixels means more depth values to resolve
- **Render resolution / screen percentage** — higher resolution means more pixels to write
- **Number of active views** — each view requires its own full emit cycle

> [!NOTE]
> Because this is a GPU compute pass, its cost appears in the **GPU track in Unreal Insights**, not on the render thread. There is no meaningful CPU footprint for this stage — if it's expensive, the fix is always on the content or rendering configuration side, not CPU-side.

---

## HZB Ordering Dependency

This stage has a direct relationship with HZB construction timing that affects occlusion quality:

**If HZB is built before NaniteEmitDepthTargets (from PrePass depth only):**
Nanite geometry is not present in that frame's HZB. Occlusion culling for this frame does not account for Nanite surfaces as occluders. Nanite geometry contributes to the HZB only in the *next* frame after emission.

**If HZB is rebuilt after NaniteEmitDepthTargets:**
The HZB includes Nanite depth and Nanite surfaces act as occluders this frame. This produces more accurate occlusion culling but adds a second HZB build cost.

> [!NOTE]
> In most UE5 configurations, the HZB is built from PrePass depth and Nanite depth feeds into *next* frame's occlusion — same one-frame latency described in the PrePass document. This is the expected and accepted behavior, not a bug. Be aware of it when debugging occlusion artifacts near Nanite geometry.

---

## What Data It Produces

**Primary Outputs:**

| Output | Format | Consumers |
|--------|--------|-----------|
| SceneDepth | 32-bit float | All screen-space effects, lighting, Lumen, HZB, BasePass depth test |
| Stencil bits | Per-pixel flags | BasePass (skip Nanite pixels), custom stencil effects |

**Consumed downstream by:**
- **BasePass** — uses stencil to identify and skip Nanite-covered pixels; depth test against Nanite surfaces
- **HZB Construction** (post-Nanite) — if rebuilt after this stage, Nanite depth contributes to occlusion
- **SSAO / SSR / DoF** — all screen-space effects sample SceneDepth written here
- **Lumen** — screen traces and surface reprojection use SceneDepth for spatial accuracy
- **Virtual Shadow Maps** — tile validity checks use SceneDepth

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Large Nanite screen coverage | More pixels to resolve; scales linearly with covered pixel count | Improve occlusion upstream; reduce always-on-screen Nanite density |
| High render resolution / screen percentage | Directly multiplies pixel count to resolve | Tune screen percentage per platform; this pass scales exactly with resolution |
| Multiple active views | Each view requires a full independent emit cycle | Minimize scene captures; avoid unnecessary extra views |
| Ineffective upstream culling | More clusters survived → more coverage → more pixels to emit | Ensure PrePass quality; improve HZB occlusion effectiveness |

> [!WARNING]
> **Each scene capture actor triggers a completely independent Nanite visibility + emit cycle for its view.** This is not a shared or cached operation. A level with 3 active scene captures runs the full Nanite pipeline 4 times per frame (3 captures + main view). Scene captures are one of the most efficient ways to make Nanite expensive in a scene. Disable, pool, or reduce update frequency on all scene capture actors.

---

## Key Systems and Components

### SceneDepth Buffer
The standard 32-bit float depth buffer that all renderer passes after this stage read from. Before this emit step, SceneDepth contains only the PrePass depth for traditional geometry. After emit, Nanite-covered pixels are correctly populated. Any pass that samples `SceneDepth` is implicitly depending on this stage having run first.

### Stencil Interop Bits
The per-pixel stencil flags that mark Nanite coverage. These are the contract between the Nanite pipeline and the traditional raster pipeline. BasePass respects these bits to avoid redundant work. They are also available for custom stencil effects downstream — but writing over them before BasePass runs will break the contract.

### Multi-View Cost Multiplication
Every independent view (main camera, each scene capture, VR eye, planar reflection) requires its own emit pass. The cost is not shared between views even when the same Nanite geometry is visible in multiple views. This is a key reason why scene captures are disproportionately expensive in Nanite-heavy scenes.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass is narrow in scope but sits on a critical dependency chain.** It is rarely the most expensive pass in a frame, but failures here — from stencil corruption, timing issues, or unexpected extra views — cascade into visual artifacts across BasePass, screen-space effects, and Lumen simultaneously. It's worth understanding precisely because its failures are hard to trace back to source.

> [!NOTE]
> **Screen percentage affects this pass directly and proportionally.** Unlike some passes where resolution reduction has diminishing returns, emit depth cost scales cleanly with pixel count. Reducing screen percentage from 100% to 75% reduces this pass's pixel workload by ~44%. This makes screen percentage one of the most effective levers for this specific pass — but it affects every resolution-dependent pass simultaneously.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `NaniteEmitDepthTargets` | Total resolve cost — scales with Nanite screen coverage and resolution |
| `NaniteEmitGBuffer` | Related emit for G-buffer data if applicable to the configuration |

> [!TIP]
> If `NaniteEmitDepthTargets` is unexpectedly expensive, check two things first: render resolution (is screen percentage high?) and active view count (are scene captures running?). Use `stat nanite` to confirm cluster and pixel counts. A spike that correlates with camera movement into open areas usually indicates poor upstream occlusion, not a configuration problem.

### Stat Commands

```
stat nanite   // Cluster counts and pixel coverage — shows how much Nanite is being emitted
stat GPU      // Overall GPU breakdown — NaniteEmitDepthTargets appears as a block here
```

### Nanite Visualization

```
r.Nanite.Visualize overdraw    // Heatmap of Nanite cluster overdraw — high overdraw = more emit cost
r.Nanite.Visualize coverage    // Shows which pixels are Nanite-covered — directly maps to emit workload
```

---

## Optimization Levers

### Content & Level Design
- Reduce always-on-screen dense Nanite coverage — open vistas with no occlusion are the worst case
- Add foreground occluders to break sightlines in dense Nanite environments
- Ensure PrePass and HZB are working effectively — better upstream culling means fewer clusters survive to emit depth

### Rendering Configuration
- Reduce screen percentage on lower-end targets — this pass scales directly with resolution
- Disable or throttle scene capture update frequency aggressively — each active capture is a full extra Nanite cycle

> [!WARNING]
> **Reducing screen percentage is not a targeted optimization for this pass alone** — it lowers cost here but simultaneously degrades all screen-space effects (SSAO, SSR, DoF) and TSR input quality. Use it as a platform-wide budget lever, not as a fix specifically for emit depth cost. If emit depth is expensive, the root cause is almost always upstream: too much Nanite coverage or too many views.

---

## Mental Model

Think of Nanite Emit Depth Targets as:

> *"Nanite finished its private rasterization work — now it hands the depth results to the rest of the renderer so everyone agrees on where the world is."*

Nanite runs in its own lane with its own internal data formats. This stage is the moment it rejoins the standard renderer pipeline. Everything downstream — lighting, shadows, screen-space effects, Lumen — depends on this handoff having happened correctly.

The cost is simple and direct: more Nanite pixels on screen at higher resolution across more views equals more work. There's no hidden complexity here. The optimization strategy is entirely about reducing those three inputs.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| NaniteVisibilityBuffer | Upstream producer — internal depth resolved here |
| SceneDepth Buffer | Primary output target — shared with all downstream passes |
| Stencil Buffer | Secondary output — marks Nanite pixels for BasePass interop |
| BasePass | Reads stencil to skip Nanite-covered pixels; depth tests against emitted depth |
| HZB Construction | If rebuilt post-emit, Nanite depth contributes to this frame's occlusion |
| Scene Captures | Each active capture triggers a full independent emit cycle |

---

## Red Flags to Watch For

- **`NaniteEmitDepthTargets` spiking on camera movement** → camera moving into area with poor upstream occlusion; more clusters surviving to emit
- **Cost consistently high regardless of camera position** → too much always-visible Nanite coverage; reduce scene density or improve layout occlusion
- **Multiple scene captures active simultaneously** → each is a full independent emit cycle; disable or throttle captures aggressively
- **Visual corruption at Nanite surface boundaries in BasePass** → possible stencil overwrite between emit and BasePass; audit custom stencil operations in that range
- **Screen-space effects failing or showing holes over Nanite surfaces** → SceneDepth not correctly populated; emit may have failed or been skipped
- **Cost scaling unexpectedly with resolution changes** → confirms this pass is the bottleneck; screen percentage is the most direct lever

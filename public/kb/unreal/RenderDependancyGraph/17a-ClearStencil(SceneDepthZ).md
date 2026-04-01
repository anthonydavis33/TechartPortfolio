---
tags:
  - stencil
  - depth
  - housekeeping
---

# Unreal Engine 5 Rendering Pipeline – ClearStencil (SceneDepthZ)

> Stage: **ClearStencil (SceneDepthZ)**  
> Phase: Pre-Lighting Housekeeping  
> Purpose: Reset stencil buffer contents after all pre-lighting stencil consumers have finished, so post-lighting passes start from a clean state  
> Pipeline Position: After `LightCompositionTasksPreLighting`, before deferred lighting passes  
> Performance Impact: **Negligible** — fixed-cost GPU clear operation

---

## What This Stage Does

This is a **stencil-only clear** of the `SceneDepthZ` surface — the combined depth-stencil render target. It resets all stencil values to zero across the entire screen.

Critically, it clears **only the stencil component** — the depth (Z) values written during PrePass remain completely intact. Depth must be preserved because deferred lighting, screen-space effects, and Lumen tracing all still need it. Only the stencil bits are no longer needed by any pre-lighting system and are safe to wipe.

---

## What SceneDepthZ Is

In UE5 (and GPU APIs generally), depth and stencil are stored together in a single **depth-stencil surface** — `SceneDepthZ`. Each pixel has:
- A **32-bit float depth value** (or 24-bit on some platforms)
- An **8-bit stencil value** — a small integer that individual passes can read and write for masking

These two components share a surface but can be cleared independently. This pass clears only the 8-bit stencil component and leaves the 32-bit depth component untouched.

---

## Why This Point in the Pipeline

By this stage, every system that wrote stencil data for pre-lighting purposes has been fully consumed:

| Stencil Data | Written By | Last Read By |
|-------------|-----------|-------------|
| Nanite coverage bits | `NaniteEmitDepthTargets` | `BasePass` (skip Nanite pixels for traditional raster) |
| Lighting channel bits | `BasePass` (per-primitive) | `CopyStencilToLightingChannels` |
| Decal stencil masks | `LightCompositionTasksPreLighting` | Same stage (decal projection culling) |

All three datasets have served their purpose. Carrying them forward into the lighting and post-processing phases would risk stale stencil values interfering with post-lighting passes that use stencil for entirely different purposes.

> [!NOTE]
> **The stencil buffer is a shared resource reused across multiple unrelated systems throughout a frame.** This clear is the handoff point between the pre-lighting stencil users (Nanite, lighting channels, decals) and the post-lighting stencil users (custom depth outlines, post-process stencil masks, screen-space effect masking). Without it, post-lighting passes would read garbage stencil data from the previous phase.

---

## What Comes After That Needs Clean Stencil

Post-lighting passes that write to or read from stencil depend on this clear having happened:
- **Custom Depth / Custom Stencil** — outline effects and stencil-based selection highlighting
- **Post-process stencil masks** — effects that apply only to specific stencil-tagged objects
- **Screen-space effects** — some SSAO, SSR, and reflection passes use stencil for masking
- **Translucency stencil tests** — certain translucency rendering modes read stencil

If this clear were skipped or happened at the wrong time, any of these passes could accidentally read Nanite coverage bits or lighting channel bits as though they were their own stencil data — producing incorrect masking and visual corruption that is very difficult to trace back to a missing clear.

---

## Performance

This operation is effectively free in any real-world frame budget:
- Fixed-cost GPU clear command
- Scales only with render resolution (more pixels = more stencil bytes zeroed)
- No scene complexity dependency
- Typically appears as < 0.05ms in any profile

It will never appear as a performance concern and does not need to be optimized. It is documented here for **architectural understanding**, not for tuning.

---

## Mental Model

Think of ClearStencil as:

> *"Erase the whiteboard between classes — the pre-lighting systems are done writing, the post-lighting systems haven't started yet, and leaving old notes up would only cause confusion."*

The stencil buffer is borrowed by each phase of the renderer for its own purposes. This clear is the moment the borrow ends and the slate is wiped clean for the next borrower.

---

## Debugging Context

> [!NOTE]
> **If stencil-based post-process effects show incorrect masking or unexpected bleed,** one possible cause is that this clear ran at the wrong point in the frame — either too early (clearing data still needed by a pre-lighting consumer) or too late / not at all (leaving stale pre-lighting stencil data visible to post-lighting passes). In Unreal Insights, verify that `ClearStencil` appears between `LightCompositionTasksPreLighting` and the first deferred lighting event. If a custom render pass inserted by project code or a plugin disrupts this ordering, stencil artifacts can result.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| `NaniteEmitDepthTargets` | Writes Nanite coverage stencil bits — cleared here after BasePass consumes them |
| `CopyStencilToLightingChannels` | Reads lighting channel stencil bits — cleared here after extraction is complete |
| `LightCompositionTasksPreLighting` | Uses stencil for decal projection masking — cleared here after decal rendering |
| Custom Depth / Stencil | Post-lighting system that depends on this clear having produced a clean starting state |
| SceneDepthZ surface | The combined depth-stencil target — depth preserved, stencil zeroed |

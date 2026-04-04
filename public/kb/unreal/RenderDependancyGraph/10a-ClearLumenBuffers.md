---
tags:
  - lumen
---

# Unreal Engine 5 Rendering Pipeline – ClearLumenBuffers

> Stage: **ClearLumenBuffers**  
> Phase: Lumen Pre-Computation Housekeeping  
> Purpose: Clear Lumen's per-frame working buffers before this frame's GI computation begins, without disturbing the persistent caches that carry temporal history  
> Pipeline Position: Before `DiffuseIndirect & AO`, after GBuffer is populated  
> Performance Impact: **Negligible** — fixed-cost GPU clear of several working buffers

---

## What This Stage Does

This pass performs a **targeted clear of Lumen's per-frame working buffers** — the internal textures and structured buffers that Lumen writes fresh data into each frame as part of its screen probe gather and surface cache update pipeline.

The buffers cleared include:
- **Screen probe radiance buffer** — the texture that receives probe trace results for this frame's gather
- **Indirect lighting accumulation buffer** — the buffer that collects this frame's GI contribution before denoising
- **Gather feedback buffers** — tracking which surface cache entries received probe hits this frame
- **Probe occlusion working data** — per-probe visibility information used during the gather

These buffers must start from zero each frame so that stale data from the previous frame's compute doesn't contaminate the current frame's result.

---

## What Is NOT Cleared Here

This is the most important conceptual point. Lumen maintains two distinct categories of buffers:

| Buffer Type | Cleared Here | Reason |
|-------------|-------------|--------|
| Screen probe working buffers | ✅ Yes | Written fresh every frame |
| Indirect lighting accumulation | ✅ Yes | Assembled from scratch each frame |
| Gather feedback structures | ✅ Yes | Per-frame tracking |
| **Surface Cache** | ❌ No | Persistent — accumulates lighting incrementally across frames |
| **Radiance Cache** | ❌ No | Persistent — world-space radiance accumulated over time |
| **Temporal history buffer** | ❌ No | Preserved for denoiser to reuse across frames |

The persistent caches are precisely what make Lumen affordable. Clearing them would force a full cold-start rebuild every frame — catastrophically expensive and visually identical to having no temporal accumulation. This pass deliberately leaves them untouched.

> [!NOTE]
> **If Lumen appears to "restart" visually after a level change, streaming event, or `r.Lumen.DiffuseIndirect.Allow` toggle, it's because the persistent caches were invalidated — not because of this clear.** This pass clears only working buffers; it has no role in cache invalidation. Cache invalidation is driven by scene changes, level loads, or explicit CVar resets.

---

## Why This Point in the Pipeline

By the time this clear runs, the GBuffer has been fully populated by BasePass and finalized by LightCompositionTasksPreLighting. Lumen's gather reads from the GBuffer (normals, albedo, roughness) to determine surface properties at probe hit points. The clear happens just before Lumen begins that gather — the working buffers need to be empty before the GPU starts writing probe results into them.

If the clear were skipped, probe traces from the previous frame could persist in the working buffers and be composited with this frame's results — producing doubled or ghosted indirect lighting that lags one frame behind.

---

## Performance

This pass clears multiple buffers rather than one, so it has slightly more GPU work than the stencil clear — but remains effectively free in any real frame budget:
- Fixed-cost GPU clear dispatches
- Screen probe buffer size scales with render resolution and `r.Lumen.ScreenProbeGather.DownsampleFactor`
- No scene complexity dependency whatsoever
- Typically well under 0.1ms

It will never appear as a meaningful cost in a profile.

---

## Mental Model

Think of ClearLumenBuffers as:

> *"Wipe down the workbench before starting this frame's Lumen calculations — but leave the filing cabinet of accumulated knowledge untouched."*

The working buffers are scratch space. The persistent caches are institutional memory. This pass clears the scratch space so Lumen can write this frame's results cleanly, without any contamination from last frame's intermediate work.

---

## Debugging Context

> [!NOTE]
> **Lumen flickering or incorrect GI on specific frames** is almost never caused by this clear. If flickering occurs, the more likely causes are: temporal history invalidation from fast camera movement, surface cache misses on geometry with poor mesh card coverage, or `r.Lumen.ScreenProbeGather.DownsampleFactor` set too high causing sparse probe coverage. ClearLumenBuffers is a passive housekeeping step — if it runs correctly (which it always does barring engine bugs), it has no visible effect on output quality.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| `DiffuseIndirect & AO` (doc 14) | Primary downstream consumer — uses cleared buffers to gather this frame's GI |
| Lumen Surface Cache | Persistent — explicitly not cleared here; accumulates across frames |
| Lumen Radiance Cache | Persistent — explicitly not cleared here |
| Screen Probe Gather | Writes into the cleared working buffers during DiffuseIndirect |
| Temporal Denoiser | Reads cleared accumulation buffer after gather writes results into it |

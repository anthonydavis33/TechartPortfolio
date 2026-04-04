---
tags:
  - velocity
---

# Unreal Engine 5 Rendering Pipeline – RenderVelocities (VelocityParallel)

> Stage: **RenderVelocities (VelocityParallel)**  
> Phase: Early Rendering / Temporal Data Setup  
> Purpose: Generate per-pixel motion vectors for TSR, TAA, motion blur, Lumen reprojection, and temporal denoisers  
> Pipeline Position: After `PrePass`, before `BasePass`

---

## What This Stage Does

This pass renders the **velocity buffer** — a screen-resolution texture where each pixel stores a 2D vector describing where that pixel came from in the previous frame (in normalized device coordinate / NDC space). This data is stored as **RG16F** (two 16-bit floats per pixel).

The velocity buffer covers:
- Moving opaque meshes (actors with transform changes between frames)
- Skinned meshes (characters, cloth, animated props)
- World Position Offset (WPO) — any mesh whose vertices move via material
- Nanite meshes that are moving or using WPO (via fallback raster path)
- Masked materials on moving geometry (optional, controlled by project settings)

Static meshes with no WPO do **not** write to the velocity buffer. Their apparent screen motion from camera movement is handled analytically — TSR and TAA compute camera-relative reprojection using the view/projection matrices directly, without needing per-pixel writes for every static surface.

The name **VelocityParallel** refers to the same parallel command list architecture as `DepthPassParallel` — draw commands are split across worker threads and executed concurrently.

---

## Why This Stage Exists

UE5's entire temporal rendering stack depends on knowing precisely how each pixel moved between frames. Without accurate velocity data:

- **TSR / TAA** smear moving edges and ghost disoccluded regions
- **Motion blur** produces incorrect or missing blur on moving objects
- **Lumen** temporal reprojection of indirect lighting becomes unstable, producing flickering or lighting lag on moving geometry
- **Temporal denoisers** (SSR, SSAO, reflections) ghost heavily on and around moving objects
- **Nanite temporal passes** lose stability on animated or moving Nanite geometry

Velocity is the foundation that makes temporal rendering possible. Every frame that produces bad velocity data cascades instability across every temporal system simultaneously.

---

## Camera Motion vs Object Motion

This distinction is critical for understanding what actually writes to the velocity buffer and why.

**Camera Motion (analytical — no velocity buffer writes needed)**
Static geometry doesn't move in world space. Its apparent screen motion comes entirely from camera movement. TSR and TAA reconstruct this analytically using the previous and current frame's view-projection matrices. No per-pixel velocity writes are required for static surfaces — the reprojection math handles it.

**Object Motion (explicit velocity buffer writes required)**
Any mesh whose vertices actually change position in world space between frames must write explicit velocity vectors. This includes skinned characters, moving physics objects, WPO materials, and any actor with a changing transform. These cannot be reconstructed analytically because the motion is object-specific.

> [!NOTE]
> This is why the velocity pass is **vertex-bound rather than pixel-bound**. The cost comes from processing geometry and computing per-vertex displacement, not from filling pixels. A high-poly skinned character at small screen size still pays full vertex cost. This makes LOD critical for velocity pass performance — reducing triangle count on off-screen or distant characters directly reduces velocity pass cost.

---

## Threading Model

Like `DepthPassParallel`, velocity draw commands are distributed across parallel render command lists on worker threads.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Distributes velocity draw commands into parallel lists; owns submission |
| **Task Graph (Workers)** | Each worker builds a subset of velocity draw commands — primarily skinned mesh velocity |
| **RHI Thread** | Receives merged command lists and submits to GPU |

> [!NOTE]
> GPU skinning for velocity is a significant part of this stage's cost. Skinned mesh vertex positions are computed on GPU before velocity vectors can be written. In Unreal Insights, look for skinning compute work in the GPU track alongside `VelocityParallel` — high skinning cost on many characters will compound velocity pass time.

---

## What Data It Produces

**Primary Output:**
- **Velocity Buffer (RG16F)** — per-pixel 2D screen-space motion vectors in NDC space. Red channel = horizontal motion, Green channel = vertical motion. In the `vis velocity` debug view, static pixels appear grey (zero motion), moving pixels show colored deviation.

**Downstream Consumers:**

| System | How It Uses Velocity |
|--------|---------------------|
| TSR (Temporal Super Resolution) | Primary consumer — uses velocity to reproject history samples onto current frame |
| TAA (Temporal Anti-Aliasing) | Same reprojection use as TSR; TSR is more sensitive to velocity quality |
| Motion Blur | Velocity vectors directly drive per-pixel blur direction and magnitude |
| Lumen | Reprojects cached indirect lighting using velocity to reduce per-frame update cost |
| Temporal Denoisers | SSR, SSAO, and reflection denoisers use velocity to stabilize across frames |
| Nanite Temporal Passes | Velocity used to stabilize Nanite's own temporal filtering |

---

## Geometry Included

| Geometry Type | Included | Notes |
|--------------|----------|-------|
| Moving opaque meshes | ✅ Yes | Any actor with a changing world transform |
| Skinned meshes | ✅ Yes | Characters, cloth, animated props |
| Static meshes (no WPO) | ❌ No | Camera motion handled analytically in TSR/TAA |
| WPO meshes | ✅ Yes | Any mesh with WPO active, even if the actor is static |
| Nanite meshes (moving/WPO) | ✅ Yes | Via traditional raster fallback — Nanite GPU path not used |
| Masked materials (moving) | ⚠️ Optional | Controlled by material velocity settings |
| Translucent meshes | ❌ No | Translucency has its own optional velocity path |

---

## r.VelocityOutputPass and r.BasePassOutputsVelocity

These two CVars control *when* velocity is written, not *whether* it is written. Understanding both before changing either is important.

| CVar | Value | Behavior |
|------|-------|----------|
| `r.VelocityOutputPass` | `0` | Velocity written in a dedicated pass before BasePass (default) |
| `r.VelocityOutputPass` | `1` | Velocity written during BasePass (merged output) |
| `r.BasePassOutputsVelocity` | `0` | Velocity pass is separate from BasePass |
| `r.BasePassOutputsVelocity` | `1` | BasePass outputs velocity as an additional MRT target |

> [!WARNING]
> **Merging velocity into BasePass (`r.BasePassOutputsVelocity 1`) adds bandwidth and MRT pressure to the most expensive pass in the frame.** While it eliminates the separate velocity pass, it increases BasePass output bandwidth — every pixel now writes an additional RG16F channel. In bandwidth-constrained scenes or on memory-limited platforms, the separate pass is usually the better trade. Profile both configurations in your specific scene.

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many high-poly skinned meshes | Full vertex processing per character every frame | Aggressive LODs on characters; reduce base mesh triangle counts |
| WPO on large static geometry | Forces explicit velocity writes for every vertex — scales with polycount | Limit WPO to hero assets with clearly visible animation |
| Many moving actors | Each requires velocity draw command and vertex processing | Reduce simultaneous moving object count; use static meshes where motion is imperceptible |
| Two-sided materials | Backface culling disabled; doubles vertex processing | Disable two-sided on velocity-writing materials unless required |
| High poly skinned meshes at small screen size | Full vertex cost regardless of screen coverage | LOD aggressively — small distant characters should be very low poly |
| Nanite + WPO | Falls back to traditional raster for velocity | Limit WPO on Nanite meshes; or accept the raster cost as intentional |
| Masked velocity materials | `clip()` prevents hardware optimizations | Minimize masked materials on moving geometry |

> [!WARNING]
> **WPO on large-scale geometry (foliage fields, animated world surfaces) forces per-vertex velocity writes for every triangle in those meshes.** This cost scales with polygon count, not screen coverage. A field of wind-animated foliage with 200k triangles pays full vertex cost in the velocity pass even if half of it is off-screen. Use WPO on foliage sparingly and always pair it with aggressive LODs that zero out WPO at distance.

---

## Key Systems and Components

### Velocity Buffer (RG16F)
The output texture. Stores 2D screen-space motion vectors — the distance in NDC space each pixel traveled since the last frame. Red = horizontal, green = vertical. Zero motion (static surfaces from camera reprojection) is not stored here. The buffer is sparse — only explicitly moving geometry writes to it.

### GPU Skinning
Before velocity vectors can be computed for a skinned mesh, the GPU must compute the current-frame vertex positions from the bone palette. This skinning compute pass is a prerequisite for velocity writes on characters and is a significant portion of velocity pass cost when many characters are on screen simultaneously.

### TSR (Temporal Super Resolution)
UE5's primary temporal algorithm and the most demanding consumer of velocity data. TSR uses motion vectors not just for reprojection but for its internal confidence and disocclusion detection. Incorrect or missing velocity data causes TSR to fall back to lower-confidence history samples, producing shimmer, smearing, or ghosting on and around the affected geometry.

### Analytical Camera Reprojection
The mechanism that handles apparent motion for static geometry without velocity buffer writes. TSR and TAA reconstruct where each static pixel was last frame using the inverse of the view-projection transform. This is why static meshes don't need to write to the velocity buffer — their motion is fully predictable from the camera matrices alone.

---

## 📋 Reader Notes

> [!NOTE]
> **TSR is significantly more sensitive to velocity quality than TAA.** TSR uses motion vectors for disocclusion detection and history confidence weighting — not just simple reprojection. Missing or incorrect velocity data causes TSR-specific artifacts (shimmer, halo edges, temporal lag) that TAA would have handled more gracefully. If you're using TSR (recommended for UE5), velocity correctness is more critical than it was in UE4 TAA workflows.

> [!NOTE]
> **Translucent geometry has its own separate optional velocity path.** Translucent surfaces do not write to the main velocity buffer by default. Materials can opt in via the `Output Velocity` material setting, but this adds cost and complexity. If you see TSR ghosting specifically on translucent objects (water surfaces, glass, smoke), this is the system to investigate.

> [!NOTE]
> **`stat skinnedmesh` reports CPU-side skinning prep cost, not GPU skinning cost.** For GPU skinning cost in the velocity pass, look at the GPU track in Unreal Insights for skinning compute dispatches alongside `VelocityParallel`. Both CPU and GPU skinning costs are real and must be profiled separately.

---

## How to Debug / Profile

### Unreal Insights
Key named events to look for in the **Render Thread** and **GPU** tracks:

| Event | What It Tells You |
|-------|------------------|
| `VelocityParallel` | Total velocity pass time including parallel command work |
| `RenderVelocities` | Top-level render thread event wrapping the velocity pass |
| `SkinCache` | GPU skinning compute cost — prerequisite for skinned mesh velocity |

> [!TIP]
> Because this pass is vertex-bound, GPU time in `VelocityParallel` correlates to **triangle count on moving geometry**, not screen resolution or pixel count. If the pass is expensive, identify which meshes are writing velocity. The `vis velocity` debug view (see below) shows which screen regions have high motion — bright areas are writing velocity; grey is analytically handled camera motion.

### Debug Visualization

```
vis velocity     // Renders velocity buffer as color — grey = camera motion only,
                 // colored = explicit velocity writes. Bright = fast motion, dark = slow.
                 // Use to identify which objects are writing velocity unexpectedly.
```

### Stat Commands

```
stat GPU          // Shows velocity pass time under "Velocity" — start here
stat skinnedmesh  // CPU-side skinning prep cost (not GPU skinning — see note above)
```

### Useful Console Variables

```
r.VelocityOutputPass 0/1          // 0 = separate velocity pass (default), 1 = merged into BasePass
r.BasePassOutputsVelocity 0/1     // Controls MRT velocity output during BasePass
r.MotionBlurQuality [0-4]         // Motion blur quality — lower values reduce velocity consumer cost
r.TSR.Velocity.Extrapolation      // TSR velocity extrapolation for disoccluded regions
```

---

## Optimization Levers

### Content
- Apply aggressive LODs to all skinned characters — triangle count at distance directly reduces velocity pass cost
- Limit WPO to hero assets where the animation is clearly visible at gameplay distance
- Disable two-sided on moving geometry wherever not visually required
- Use `MaxDrawDistance` on non-hero animated props to stop velocity writes beyond visible range

> [!WARNING]
> **Do not disable velocity writes on materials that actually move.** The `Output Velocity` material flag should only be disabled on geometry that is provably static in world space. Disabling it on a moving mesh will cause TSR ghosting, Lumen lighting lag, and motion blur failure on that object — and these artifacts can be subtle and difficult to trace back to the velocity setting. When in doubt, leave velocity enabled.

### Engine Settings
- Use `r.VelocityOutputPass 0` (default) to keep velocity as a separate pass and avoid adding MRT pressure to BasePass
- Reduce `r.MotionBlurQuality` on lower-end targets to reduce the cost of the velocity *consumer*, not the producer

### Nanite
- Avoid WPO on Nanite meshes where possible — WPO forces a full traditional raster fallback for velocity, defeating much of the Nanite efficiency gain

> [!WARNING]
> **Nanite + WPO falls back to traditional raster for the velocity pass — this is the same hard cutoff as in PrePass.** A large Nanite mesh with a WPO material will rasterize all of its visible triangles traditionally for velocity output. On a high-poly cliff or building with wind-animated WPO, this can be a significant and unexpected velocity pass cost. Audit WPO on Nanite geometry specifically.

---

## Mental Model

Think of this stage as:

> *"For every pixel that physically moved in the world since last frame, record exactly where it came from — so every temporal system can reach back in time and grab what it needs."*

The velocity buffer is the shared memory of UE5's temporal stack. TSR, motion blur, Lumen, and every temporal denoiser all read from it. A single bad frame of velocity data doesn't just break the velocity pass — it introduces artifacts across every one of those systems simultaneously, because they all trusted the same bad data.

The key insight is the **analytical vs explicit split**: static geometry is essentially free because camera motion math handles it. Only geometry that actually moves in world space pays the explicit write cost. Keeping that set minimal, well-LOD'd, and intentional is the entire optimization strategy for this pass.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| TSR (Temporal Super Resolution) | Primary consumer; most sensitive to velocity quality |
| TAA (Temporal Anti-Aliasing) | Secondary consumer; less sensitive than TSR |
| Motion Blur Pass | Velocity vectors directly drive blur direction and magnitude |
| Lumen | Uses velocity for temporal reprojection of indirect lighting cache |
| GPU SkinCache | Computes skinned vertex positions as prerequisite for velocity writes |
| Nanite Raster Fallback | Nanite meshes with WPO fall back to this path for velocity |
| Temporal Denoisers | SSR, SSAO, reflection denoisers all read velocity buffer |

---

## Red Flags to Watch For

- **`VelocityParallel` > 1ms** → identify which moving geometry is writing velocity; use `vis velocity` to pinpoint screen regions
- **TSR shimmer or ghosting on a specific mesh** → that mesh may have incorrect or disabled velocity output; check material `Output Velocity` setting
- **Lumen indirect lighting lagging or flickering on moving objects** → velocity reprojection failure; same root cause as TSR ghosting
- **High GPU skinning cost alongside `VelocityParallel`** → too many high-poly characters on screen simultaneously; apply aggressive character LODs
- **WPO foliage fields with high velocity pass cost** → per-vertex velocity writes scaling with foliage polygon count; reduce WPO range or disable at LOD distance
- **Nanite mesh with unexpected velocity cost** → check for WPO on that material; Nanite + WPO forces full traditional raster fallback
- **`vis velocity` showing large bright regions on geometry that appears static** → WPO or incorrect `Output Velocity` flag causing unnecessary writes
- **Motion blur incorrect or missing on specific objects** → velocity buffer not being written for that mesh; check geometry type and material settings

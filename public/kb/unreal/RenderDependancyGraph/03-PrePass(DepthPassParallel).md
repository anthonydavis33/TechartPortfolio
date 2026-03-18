---
tags:
  - rendering-pipeline
  - prepass
  - early-z
  - nanite
  - hzb
  - wpo
  - performance
  - profiling
  - ue5
  - tech-art
  - gpu
---

# Unreal Engine 5 Rendering Pipeline – PrePass (DepthPassParallel)

> Stage: **PrePass (DepthPassParallel)**  
> Phase: Early Rendering / Depth Setup  
> Purpose: Render depth-only geometry early to enable occlusion, HZB construction, and overdraw reduction in all later passes  
> Pipeline Position: After `BuildRenderingCommandsDeferred`, before `BasePass`

---

## What This Stage Does

The PrePass renders **depth-only geometry** before any shading occurs. No color, no lighting — just depth values written to the Z buffer as fast as possible.

This stage:
- Rasterizes opaque geometry writing only to the depth buffer
- Optionally includes masked materials (controlled by `r.EarlyZPass`)
- Outputs the Scene Depth buffer used by every downstream pass
- Builds input data for the HZB (Hierarchical Z Buffer) used in next frame's occlusion culling
- Provides depth for Nanite visibility determination
- Excludes translucent geometry (no depth write by design)
- Excludes sky and Single Layer Water (handled by dedicated passes)

The name **DepthPassParallel** refers to the fact that draw commands are distributed across multiple parallel render command lists and executed concurrently — the "parallel" is the implementation, not just a label.

---

## Why This Stage Exists

Without a PrePass, the GPU shades every pixel it rasterizes — including pixels that will immediately be overwritten by closer geometry. In a complex scene with significant overdraw, this wasted shading work can dwarf the cost of the PrePass itself.

PrePass enables:
- **Early-Z rejection** in BasePass — pixels that fail the depth test are discarded before the pixel shader runs
- **HZB construction** — the depth buffer is downsampled into a mip chain used for occlusion culling the *following* frame
- **Nanite cluster visibility** — Nanite uses the depth buffer to determine which clusters are visible before rasterizing them
- **Virtual Shadow Maps (VSM)** — depth data contributes to shadow cache validity
- **Lumen surface cache** — scene depth feeds Lumen's world-space surface update
- **Screen-space effects** — SSAO, SSR, and depth of field all read from the Scene Depth buffer

---

## Threading Model

The "Parallel" in DepthPassParallel is architectural. Draw commands for the depth pass are split into parallel command lists and submitted concurrently across render worker threads, then merged and submitted to the RHI.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Distributes depth draw commands into parallel lists; owns submission |
| **Task Graph (Workers)** | Each worker builds a subset of depth draw commands in parallel |
| **RHI Thread** | Receives merged command lists and submits to GPU |

> [!NOTE]
> The parallel command list architecture means PrePass scales with CPU core count to a point. If you see many short parallel tasks in Unreal Insights around `DepthPassParallel`, this is expected and healthy. The bottleneck is either the total number of depth draw commands (too many meshes) or the GPU raster cost (too many polygons or masked materials).

---

## r.EarlyZPass — What Gets Rendered

The `r.EarlyZPass` CVar is the primary control for what geometry participates in the PrePass. Understanding its values is essential before tuning.

| Value | Behavior |
|-------|----------|
| `0` | PrePass disabled — no depth prepass at all |
| `1` | Opaque meshes only (default in most projects) |
| `2` | Opaque + Masked materials |
| `3` | Opaque + Masked + all other depth-writable geometry |

> [!WARNING]
> **Disabling PrePass (`r.EarlyZPass 0`) does not save net frame time in complex scenes.** The overdraw cost doesn't disappear — it moves to BasePass, where each redundantly-shaded pixel is far more expensive because the full material is evaluated. Only disable PrePass on scenes with minimal overdraw or as a diagnostic tool.

---

## What Data It Produces

**Primary Outputs:**
- **Scene Depth Buffer (Z buffer)** — the main output; consumed by nearly every downstream pass
- **Stencil Buffer** — written selectively for effects that need per-pixel masking (e.g. custom depth, outline effects)

**Downstream Consumers:**

| Pass | How It Uses PrePass Depth |
|------|--------------------------|
| BasePass | Early-Z test rejects occluded pixels before shading |
| HZB Construction | Depth buffer downsampled into mip chain for next-frame occlusion |
| NaniteVisibilityBuffer | Depth used to determine visible Nanite clusters |
| Virtual Shadow Maps | Depth contributes to shadow cache validity checks |
| Lumen | Scene depth feeds surface cache updates |
| SSAO / SSR / DoF | All screen-space effects read Scene Depth directly |

---

## Geometry Included

| Geometry Type | Included | Notes |
|--------------|----------|-------|
| Opaque meshes | ✅ Yes | Always included |
| Masked materials | ⚠️ Optional | Controlled by `r.EarlyZPass` value |
| Translucent meshes | ❌ No | No depth write; handled in Translucency pass |
| Nanite meshes | ✅ Yes | Via separate Nanite depth path, not traditional raster |
| Sky | ❌ No | Rendered in dedicated sky pass |
| Single Layer Water | ❌ No | Rendered in dedicated water pass |

> [!NOTE]
> **Nanite geometry does not go through the traditional PrePass raster pipeline.** Nanite has its own GPU-driven depth output that feeds into the Scene Depth buffer separately. This is why Nanite meshes don't contribute PrePass overhead in the way traditional meshes do — their depth cost is accounted for in the Nanite rasterization pass.

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High polycount (non-Nanite) | Raster cost scales with triangle count even for depth-only | Enable Nanite on dense static geometry |
| Masked materials in PrePass | `clip()` instruction disables GPU early-Z hardware; no raster optimization possible | Limit masked materials in PrePass; use `r.EarlyZPass 1` |
| World Position Offset (WPO) | Vertex positions change per-frame; depth varies; early-Z disabled for those meshes | Limit WPO to hero assets; avoid on large foliage fields |
| Two-sided geometry | Backface culling disabled; GPU rasterizes both sides | Disable two-sided on any mesh where it isn't visually necessary |
| Dense foliage fields | Thousands of masked, two-sided, often WPO-driven meshes compound all of the above | Use Nanite foliage where applicable; reduce masked foliage density |
| No Nanite on heavy static meshes | Full triangle cost paid in traditional raster | Enable Nanite on rocks, buildings, cliffs, large props |

> [!WARNING]
> **WPO (World Position Offset) on foliage is one of the most common PrePass performance traps.** WPO disables GPU early-Z optimization for that mesh because vertex positions are unpredictable, and it forces the mesh off the cached static draw command path. A field of WPO foliage pays triple: raster cost, no early-Z savings, and dynamic draw command rebuild every frame.

> [!WARNING]
> **Masked materials with `r.EarlyZPassOnlyMaterialMasking 1` render twice per frame.** They appear in the PrePass to write depth and again in the BasePass to write color. In scenes with heavy masked geometry (foliage, fences, decals), the depth-pass cost may exceed the BasePass overdraw savings. Profile both settings in your specific scene before committing to one.

---

## Key Systems and Components

### Early-Z Rejection
The hardware mechanism that makes PrePass valuable. After PrePass writes depth, the GPU's depth test unit can reject incoming fragments in BasePass *before* the pixel shader runs — meaning occluded pixels cost almost nothing in BasePass. The benefit scales directly with scene overdraw complexity.

### HZB (Hierarchical Z Buffer)
Built immediately after PrePass by downsampling the depth buffer into a mip chain. Each mip level stores the maximum depth value in a region of screen space. This structure is what enables efficient occlusion culling — the CPU can test an object's bounding box against the HZB in a single texture sample. The HZB built this frame feeds *next frame's* occlusion decisions, which is why occlusion has one-frame latency.

### Stencil Buffer
Written in PrePass for effects that need per-pixel tagging — custom depth outlines, selective post-process effects, decal masking, and similar. Stencil writes are cheap, but reading back the stencil in later passes adds bandwidth cost. Keep stencil usage intentional.

### Nanite Depth Path
Nanite geometry bypasses the traditional triangle raster entirely for depth. Nanite's own GPU-driven visibility pass outputs depth directly. This is why Nanite meshes have effectively zero PrePass overhead on the CPU and much lower GPU depth cost than equivalent traditional geometry.

---

## 📋 Reader Notes

> [!NOTE]
> **The PrePass is a deliberate trade — it adds GPU work upfront to save more GPU work in BasePass.** The trade is profitable when your scene has significant overdraw (complex geometry, many overlapping objects, interior scenes). In very simple open scenes with minimal overdraw, PrePass may cost more than it saves. Know your overdraw profile before tuning `r.EarlyZPass`.

> [!NOTE]
> **`r.EarlyZPassOnlyMaterialMasking` is a separate CVar from `r.EarlyZPass`.** Setting `r.EarlyZPass 2` includes masked materials. Setting `r.EarlyZPassOnlyMaterialMasking 1` additionally controls whether masked materials are *only* in the PrePass or also in the BasePass. These two CVars interact — understand both before changing either.

> [!NOTE]
> **Platform variance matters here.** On mobile GPUs (tile-based deferred renderers), the PrePass trade-off is different — tile-based architectures handle overdraw more efficiently on-chip, which can make PrePass less beneficial. On PC and console with traditional immediate-mode GPUs, PrePass is almost always a net win in complex scenes.

---

## How to Debug / Profile

### Unreal Insights
Key named events to look for in the **Render Thread** and **GPU** tracks:

| Event | What It Tells You |
|-------|------------------|
| `DepthPassParallel` | Total PrePass time including all parallel command list work |
| `PrePass` | Top-level render thread event wrapping the depth pass |
| `NaniteDepth` | Nanite's separate depth output — distinct from traditional raster depth |
| `BuildHZB` | HZB mip chain construction from PrePass depth — runs immediately after |

> [!TIP]
> If `DepthPassParallel` is expensive, check whether the cost is **raster-bound** (high polycount, many masked materials — GPU time dominates) or **command-bound** (too many depth draw commands — CPU/RHI time dominates). In Unreal Insights, look at whether the GPU track or the render thread track is the bottleneck. They require different fixes.

### Stat Commands

```
stat GPU          // Shows PrePass GPU time under "Depth" — start here for GPU cost
stat initviews    // Shows draw call count feeding into PrePass
stat RHI          // Draw call submission cost from the parallel command lists
```

### Useful Console Variables

```
r.EarlyZPass [0-3]                  // Controls what geometry renders in PrePass (see table above)
r.EarlyZPassOnlyMaterialMasking 1   // Restricts masked materials to PrePass depth only
r.HZBOcclusion 1/0                  // Toggle HZB occlusion culling to isolate its contribution
r.DepthPass.MeshSizeThreshold       // Minimum mesh screen size to include in depth pass
```

---

## Optimization Levers

### Project Settings
- Set `r.EarlyZPass 1` (Opaque Only) as your baseline — only add masked if profiling shows a net benefit
- Audit `r.EarlyZPassOnlyMaterialMasking` carefully in scenes with heavy foliage before enabling

### Content
- Disable two-sided on any mesh where it isn't a hard visual requirement — every two-sided mesh doubles depth raster work
- Avoid WPO on large static world geometry — use it only on hero assets where the animation is clearly visible
- Reduce masked foliage density; replace with opaque card-based foliage where LOD distance makes the difference imperceptible

### Nanite
- Enable Nanite on rocks, cliffs, buildings, and large props — their depth cost drops dramatically
- Nanite foliage (UE5.1+) handles the two-sided masked foliage problem at scale without traditional raster overhead

> [!WARNING]
> **Two-sided + masked + WPO on the same mesh is a worst-case combination.** All three disable or degrade different GPU optimizations simultaneously. Dense foliage fields using all three can make PrePass the most expensive single pass in the frame. Audit foliage material setups specifically when PrePass cost is high.

---

## Mental Model

Think of PrePass as:

> *"Stamp every solid surface's depth into the Z buffer as fast as possible, so everything that comes after only touches pixels it actually needs to."*

The PrePass is a deliberate upfront investment. It costs GPU time now to save significantly more GPU time across BasePass, shadows, and screen-space effects later. The investment pays off when your scene is overdraw-heavy. It's a bad trade in scenes where everything is visible and nothing overlaps.

The key architectural insight is the **HZB chain**: PrePass doesn't just help *this* frame's BasePass. The depth buffer it produces becomes the HZB that powers *next* frame's occlusion culling. PrePass is simultaneously paying back last frame's investment and making a new one for next frame.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Early-Z Hardware | GPU feature that rejects fragments using PrePass depth before pixel shader runs |
| HZB (Hierarchical Z Buffer) | Built from PrePass depth; feeds next-frame occlusion culling |
| BasePass | Primary beneficiary of early-Z rejection from PrePass depth |
| Nanite Depth Path | Parallel depth output; bypasses traditional raster but feeds the same Scene Depth buffer |
| Virtual Shadow Maps | Uses Scene Depth for shadow cache validity |
| Lumen | Scene depth feeds surface cache updates each frame |
| Screen-Space Effects | SSAO, SSR, DoF all read Scene Depth written here |

---

## Red Flags to Watch For

- **`DepthPassParallel` > 2ms** on mid-range GPU → identify whether cost is raster-bound (polycount/masked) or command-bound (too many draw calls)
- **Masked foliage fields across large world areas** → check `r.EarlyZPass` setting; consider switching to opaque foliage cards at distance
- **Two-sided + masked + WPO on the same material** → worst-case combination; audit foliage material setups
- **WPO on non-hero static geometry** → disables early-Z and static draw command cache for every mesh using it
- **`BuildHZB` appearing expensive after PrePass** → scene depth complexity making HZB construction slow; indirectly caused by PrePass content issues
- **Nanite disabled on geometry with > 100k triangles** → full raster cost paid in depth pass and BasePass; strong Nanite candidate
- **`NaniteDepth` absent or trivially small while `DepthPassParallel` is large** → most geometry is not Nanite; heavy non-Nanite scenes should have significant Nanite coverage

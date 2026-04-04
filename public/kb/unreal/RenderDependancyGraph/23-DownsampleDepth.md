---
tags:
  - depth
---

# Unreal Engine 5 Rendering Pipeline – DownsampleDepth

> Stage: **DownsampleDepth**  
> Phase: Depth Preparation / Screen-Space Setup  
> Purpose: Create a half-resolution copy of SceneDepth using conservative depth selection for use by all passes that deliberately run at reduced resolution  
> Pipeline Position: After `NaniteEmitDepthTargets` and `BasePass` (SceneDepth fully populated), before SSAO, SSR, depth of field, and soft particle passes  
> Performance Impact: **Low** — fixed-cost fullscreen downsample; scales with render resolution only

---

## What This Stage Does

DownsampleDepth reads the full-resolution `SceneDepth` buffer and produces a **half-resolution depth texture** that reduced-resolution passes can sample efficiently. The pass runs once after SceneDepth is fully populated — containing depth from PrePass, BasePass geometry, and Nanite emit — and the result is reused by multiple downstream passes throughout the remainder of the frame.

The result is not a simple bilinear average of source depth values. The downsampling uses **conservative depth selection** — choosing a specific depth value from the 2×2 source quad rather than blending them. Which value is selected depends on the downstream consumer's needs, but the key invariant is: the output depth always corresponds to a real surface depth in the scene, never a mathematically interpolated value that no surface actually occupies.

---

## Why Averaging Depth Is Wrong

This is the central concept of this pass and explains why a dedicated downsample exists rather than using standard hardware bilinear filtering.

Consider a 2×2 source pixel quad at a foreground object's edge against a distant background:

```
[ 0.1 (near) ][ 0.1 (near) ]
[ 0.9 (far)  ][ 0.9 (far)  ]
```

A bilinear average produces depth **0.5** — a value that doesn't correspond to any surface in the scene. An SSAO or depth of field pass sampling this value would believe a surface exists halfway between the foreground and background, producing incorrect occlusion estimates or CoC values at that pixel.

Conservative selection instead picks either the minimum (0.1 — nearest surface wins) or maximum (0.9 — farthest surface wins) from the quad. Both values are real. The downstream pass receives a depth it can trust as belonging to an actual surface.

---

## Min vs Max — Which Passes Need Which

Different downstream consumers need different conservative values depending on what they're testing.

| Selection Method | Depth Semantic | Primary Consumers |
|-----------------|---------------|------------------|
| **Maximum (farthest)** | Conservative for occlusion — if the farthest depth is still in front of an object, all pixels in the quad are in front of it | SSAO, HZB-based occlusion, screen-space AO |
| **Minimum (nearest)** | Conservative for intersection — nearest surface prevents false depth-test passes | Soft particles, screen-space contact shadows, depth of field near CoC |

UE5 may produce more than one downsampled depth variant in a frame depending on which features are active. The primary output most passes reference is the half-resolution depth closest to the HZB convention — maximum depth within each quad — for consistency with how the HZB was built.

---

## Why This Stage Exists

Several rendering passes run at **half resolution** by design for performance reasons:

| Pass | Why Half Resolution | Uses Downsampled Depth For |
|------|--------------------|---------------------------|
| SSAO | 75% fewer pixels = 75% cheaper compute | Depth queries in sampling hemisphere |
| SSR ray march | Reduces trace cost significantly | Depth comparisons during screen-space steps |
| Depth of Field (CoC) | CoC calculation at half res; upscaled for final | Circle of confusion per pixel |
| Screen-space contact shadows | Trace cost reduction | Shadow ray depth comparisons |
| Soft particles | Depth-fade at geometry intersections | Particle vs geometry depth delta |
| Some Lumen screen operations | Reduces probe trace overhead | Screen-space depth samples |

All of these passes need depth data. If they sampled full-resolution `SceneDepth` directly, they'd be performing expensive cross-resolution texture fetches that don't align with their internal pixel grid, producing filtering artifacts and cache inefficiency. Providing a pre-built half-resolution depth that exactly matches their pixel grid resolves both problems.

> [!NOTE]
> **Half-resolution passes using this depth produce results that must eventually be composited back to full resolution.** The compositing step uses the full-resolution depth alongside the half-resolution result to reconstruct edges cleanly — a technique called **bilateral upsampling**. The quality of this upscaling is what determines whether the half-resolution nature of these effects is perceptible in the final image. DownsampleDepth is the input that makes bilateral upsampling possible.

---

## Edge Artifacts — Understanding the Root Cause

The conservative selection method produces a known class of artifact at depth discontinuities (foreground geometry edges against distant backgrounds). Understanding it helps distinguish expected behavior from bugs.

At an edge, the 2×2 source quad contains a mix of near and far depth values. Conservative selection picks one extreme. The result is that the half-resolution depth at that boundary region is assigned entirely to one surface or the other — there is no smooth transition. When SSAO, soft particles, or depth of field composite back to full resolution, this step edge in the half-resolution depth creates a narrow halo or fringe at geometry edges:

- **SSAO edge halo** — a thin bright ring around foreground objects where SSAO underestimates occlusion because the sampled depth is incorrectly deep at the boundary
- **Soft particle popping** — particles abruptly become opaque very close to a geometry edge because the half-resolution depth suddenly assigns the far value
- **DoF edge fringing** — slight CoC mismatch at foreground edges where the half-resolution CoC calculation uses the wrong depth

> [!NOTE]
> **These edge artifacts are the expected cost of running effects at half resolution.** They are not caused by incorrect downsampling — they are the unavoidable consequence of halving the spatial resolution of a discontinuous signal. Bilateral upsampling mitigates them but does not eliminate them entirely. If these artifacts are visible and objectionable in your scene, the fix is running the affected pass at full resolution (higher cost) rather than tuning the downsampling method.

---

## Execution Model

DownsampleDepth is a lightweight **GPU compute or pixel shader pass** — typically implemented as a single compute dispatch that reads 4 source texels per output texel and writes the selected value.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the downsample dispatch |
| **GPU** | Reads 2×2 source quads; selects conservative depth; writes half-resolution output |

There is no CPU complexity, no scene traversal, no light evaluation. The pass is a pure texture read-and-write at a fixed cost per pixel.

---

## What Data It Produces

| Output | Resolution | Format | Consumers |
|--------|-----------|--------|-----------|
| Half-resolution SceneDepth | 50% × 50% of render resolution | R32F (or R16F on some platforms) | SSAO, SSR, DoF CoC, soft particles, contact shadows, some Lumen screen ops |

---

## Why This Can Be Expensive

This pass is not expensive in any realistic scenario. Cost is strictly:

| Factor | Effect |
|--------|--------|
| Render resolution | Higher resolution = more source pixels to read and downsample |
| Multiple active views | Each view produces its own independent half-resolution depth |

Neither factor is meaningfully controllable specifically for this pass — resolution and view count affect every pass in the pipeline equally. If DownsampleDepth appears in a profile at all, it's as a negligibly small entry.

---

## Key Systems and Components

### Conservative Depth Selection (Min/Max Gather)
The 2×2 gather operation at the heart of this pass. Four source depth texels are read simultaneously using a texture gather instruction (available on all modern GPU APIs). The gather result is a 4-component vector containing all four source values, from which min or max is computed in a single instruction. This is highly efficient — one texture fetch, one comparison, one write per output pixel.

### Bilateral Upsampling
The complementary operation that uses the downsampled depth on the way back out. When a half-resolution pass (SSAO, DoF, etc.) produces its result, the compositing step needs to reconstruct full-resolution output. Bilateral upsampling weights each neighboring half-resolution sample by the similarity of its depth to the full-resolution pixel's depth — using depth proximity as a guide to avoid blending values across depth discontinuities. DownsampleDepth is a prerequisite for this upsampling to work correctly.

### Full-Resolution Depth Availability
This pass implicitly assumes SceneDepth is fully populated when it runs. If any geometry writes depth after this pass (which can happen with certain custom passes or plugin-inserted geometry), those depth writes will not be represented in the downsampled buffer. Downstream passes using the half-resolution depth will have incorrect values for those surfaces.

---

## 📋 Reader Notes

> [!NOTE]
> **DownsampleDepth is one of several depth-related passes in the pipeline, each serving different purposes.** The HZB (doc 08) is a mip chain for coarse occlusion queries. SceneDepth is the full-resolution primary depth buffer. DownsampleDepth is the half-resolution convenience copy for reduced-resolution effects. They are three separate textures with three separate purposes — confusing them leads to incorrect conclusions about which pass is producing which artifact.

> [!NOTE]
> **Soft particle depth fade quality is directly tied to this pass.** Soft particles sample the half-resolution depth to compute how close each particle is to scene geometry and fade accordingly. At geometry edges, the conservative depth selection causes the depth delta to jump abruptly — producing a visible "hard edge" in the particle fade near object silhouettes. This is a fundamental limitation of the technique. For hero particle effects where this artifact is unacceptable, full-resolution depth sampling in the particle material (more expensive) can be used instead.

> [!NOTE]
> **On platforms with limited memory bandwidth, the format of the downsampled depth matters.** R32F (32-bit float) provides full depth precision. R16F (16-bit half float) halves the bandwidth cost but reduces precision — acceptable for nearby geometry but can produce banding artifacts on distant surfaces in depth of field or SSAO. Some platform configurations default to R16F for the downsampled buffer. Verify depth precision meets quality requirements on your target platforms if depth-dependent effects show unexpected banding.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `DownsampleDepth` | Total downsample cost — should be negligible (<0.1ms) |
| `HalfResDepth` | Variant event name in some engine versions |

> [!TIP]
> DownsampleDepth should never appear as a meaningful entry in a performance investigation. If you're looking at this stage in a profile, you're almost certainly investigating an artifact in a downstream effect (SSAO halo, soft particle popping, DoF fringing) rather than a performance problem. Trace artifact investigations to the **consumer** of the downsampled depth, not to this pass itself.

### Stat Commands

```
stat GPU    // Overall GPU breakdown — DownsampleDepth appears as a negligibly small block
```

### Useful Console Variables

```
r.DepthTexture.HalfRes 0/1      // Toggle half-resolution depth generation — disabling forces
                                  // downstream passes to sample full-resolution SceneDepth directly.
                                  // Useful for debugging whether an artifact is caused by the
                                  // downsample step or exists in the full-resolution source.
```

---

## Optimization Levers

There are no meaningful optimization levers specific to this pass. Its cost is determined entirely by render resolution and is non-negotiable given the downstream systems that depend on it.

If reducing the cost of passes that **consume** the downsampled depth is the goal, the relevant CVars are on those passes — `r.AmbientOcclusionLevels`, `r.SSR.Quality`, `r.DepthOfField.MaxSize`, and equivalents — not here.

---

## Mental Model

Think of DownsampleDepth as:

> *"Produce a smaller, correctly-sampled depth reference card that half-resolution effects can read from — cheaper to access and perfectly aligned to their pixel grid."*

The pass exists because depth is not a color — it's a spatial measurement, and spatial measurements cannot be averaged across discontinuities. By providing a conservatively-selected half-resolution copy rather than asking downstream passes to figure out the correct filtering themselves, the renderer centralizes a subtle correctness decision in one place and ensures every consumer gets consistent depth semantics.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| SceneDepth | Source — full-resolution depth this pass reads from; must be fully populated before this runs |
| HZB (doc 08) | Sibling depth structure — mip chain for occlusion queries; separate purpose, separate texture |
| SSAO | Primary consumer — uses half-resolution depth for occlusion hemisphere sampling |
| Screen Space Reflections | Uses half-resolution depth for ray march depth comparisons |
| Depth of Field | Uses half-resolution depth for circle of confusion calculation |
| Soft Particles | Uses half-resolution depth for geometry intersection fade |
| Bilateral Upsampling | The complementary operation that composites half-res effect results back to full resolution using this depth as a guide |
| NaniteEmitDepthTargets (doc 06) | Must have completed before this runs — Nanite depth must be in SceneDepth first |

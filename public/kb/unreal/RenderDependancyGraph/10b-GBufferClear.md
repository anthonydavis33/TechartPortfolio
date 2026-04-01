---
tags:
  - gbuffer
  - housekeeping
---

# Unreal Engine 5 Rendering Pipeline – GBufferClear

> Stage: **GBufferClear**  
> Phase: Pre-BasePass Housekeeping  
> Purpose: Initialize all GBuffer render targets to known default values before BasePass writes material data into them  
> Pipeline Position: Before `BasePass`, after `PrePass` and `CompositionBeforeBasePass`  
> Performance Impact: **Negligible** — fixed-cost GPU clear of multiple render targets

---

## What This Stage Does

This pass **clears all GBuffer render targets** to known default values, establishing a clean baseline before BasePass begins rasterizing geometry and writing material data into them.

The GBuffer targets cleared include:

| Target | Contains | Default Clear Value |
|--------|---------|-------------------|
| GBufferA | World-space normal + shading model ID | (0,0,0,0) — no normal, shading model 0 |
| GBufferB | Metallic / Specular / Roughness | Defined defaults per channel |
| GBufferC | Base Color / Ambient Occlusion | (0,0,0,1) — black surface, full AO |
| GBufferD | Custom data (SSS color, hair tangent, etc.) | (0,0,0,0) |
| GBufferE | Pre-shadow factor (stationary lights) | (1,1,1,1) — fully lit, no pre-shadow |

SceneColor is **not** cleared here — that is handled separately in `CompositionBeforeBasePass` where the sky background is initialized. GBufferClear is specifically the material data targets, not the final color output.

---

## Why Default Values Matter

Not every pixel on screen will be covered by geometry. Sky pixels, areas outside the world geometry, and any pixel visible only through translucency will never receive a BasePass write. These pixels retain whatever the GBuffer was cleared to, and that data will be read by downstream passes.

The default clear values are chosen so that unshaded pixels behave predictably when sampled by:
- **SSAO** — sampling GBuffer normals around sky pixels; clear value of (0,0,0) produces neutral AO
- **SSR** — checking GBuffer roughness for reflectivity; clear defaults produce no spurious reflections
- **Lumen screen traces** — reading GBuffer albedo/normal at probe hit points; clear defaults produce black/neutral contribution
- **Deferred lighting** — evaluating any shading model on a cleared pixel; defaults produce no unwanted lighting contribution

> [!NOTE]
> **GBufferE (pre-shadow factor) is cleared to white (1,1,1,1), not black.** This is intentional — the pre-shadow term represents how much stationary light reaches a surface. A cleared pixel that receives no geometry write defaults to "fully lit" (1.0) rather than "fully shadowed" (0.0). This prevents sky regions from incorrectly appearing as fully-shadowed areas in the stationary light evaluation.

---

## Distinct From Other Clears

By this point in the pipeline, several other buffer clears have happened or will happen, and it's worth understanding which is which:

| Clear Pass | What It Clears | When |
|-----------|---------------|------|
| `CompositionBeforeBasePass` | SceneColor (sky background) | Before BasePass |
| **`GBufferClear`** | **GBuffer A–E render targets** | **Before BasePass** |
| `ClearLumenBuffers` | Lumen working buffers | Before Lumen DiffuseIndirect |
| `ClearStencil (SceneDepthZ)` | Stencil component only | After LightCompositionTasksPreLighting |

Each clears a different set of resources for different downstream systems. GBufferClear's specific responsibility is the material data targets — the ones BasePass writes to and deferred lighting reads from.

---

## Performance

Multiple render targets are cleared rather than one, but the operation remains effectively free:
- Fixed-cost GPU clear — one clear command per GBuffer target
- Scales with render resolution (higher resolution = more pixels to clear across all targets)
- No scene complexity dependency
- Typically appears as < 0.05ms per target in any profile

It is never a performance concern.

---

## Mental Model

Think of GBufferClear as:

> *"Set every page of the material data notebook to its blank default before BasePass starts filling it in — so any page that never gets written to still contains something sensible rather than garbage."*

BasePass will overwrite the cleared values for every pixel it covers. The clear only matters for pixels BasePass doesn't reach — primarily sky and background regions — where downstream passes will still sample the GBuffer and need to find coherent data.

---

## Debugging Context

> [!NOTE]
> **Unexpected darkening, incorrect AO, or missing reflections specifically in sky or background regions** can sometimes trace back to GBuffer clear values. If a screen-space effect is sampling GBuffer data in an area where no geometry was rendered and producing incorrect output, check what default value that GBuffer channel was cleared to. An SSAO artifact in an open sky area, or an SSR hit on nothing, is the kind of symptom that points here. These are rare edge cases but understanding the clear is the first step in debugging them.

> [!NOTE]
> **GBuffer format settings (`r.GBufferFormat`) affect what data is available per channel** but do not change the fact that a clear happens. A lower GBuffer format reduces per-target bandwidth (and therefore the bandwidth cost of this clear) but also reduces the precision of the cleared defaults. On memory-constrained platforms where GBuffer format is reduced, verify that the default clear values still produce acceptable results in sky and background regions.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| `CompositionBeforeBasePass` (doc 10) | Clears and initializes SceneColor — distinct from GBufferClear |
| `BasePass` (doc 11) | Primary writer — overwrites cleared GBuffer values for all visible geometry |
| `ClearStencil (SceneDepthZ)` (doc 17b) | A later, separate clear — stencil only, unrelated to GBuffer targets |
| `ClearLumenBuffers` (doc 18a) | Another housekeeping clear — Lumen working buffers, not GBuffer |
| SSAO / SSR / Lumen | Read cleared GBuffer channels for sky/background pixels — depend on sensible defaults |
| `r.GBufferFormat` | Controls GBuffer channel layout and precision; affects bandwidth cost of this clear |

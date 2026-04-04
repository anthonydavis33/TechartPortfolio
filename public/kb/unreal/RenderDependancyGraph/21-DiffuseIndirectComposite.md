---
tags:
  - lumen
---

# Unreal Engine 5 Rendering Pipeline – DiffuseIndirectComposite

> Stage: **DiffuseIndirectComposite**  
> Phase: Indirect Lighting Integration  
> Purpose: Apply the indirect diffuse lighting buffer computed by Lumen — compositing GI results with the direct lighting already in SceneColor, applying AO, and completing the full lighting picture  
> Pipeline Position: After `DiffuseIndirect & AO` (doc 14) and `Lights` (doc 28), before Lumen Reflections and translucency

---

## Relationship to DiffuseIndirect & AO (Doc 14)

This pass and `DiffuseIndirect & AO` (doc 14) form a **compute → composite** pair, identical in structure to the VolumetricCloud/VolCloudComposeOverScene split:

**Doc 14 — DiffuseIndirect & AO**
Computes the indirect diffuse lighting result using Lumen's screen probe gather, surface cache, radiance cache, and temporal denoising. Produces:
- An indirect diffuse lighting buffer (what bounced light reaches each pixel)
- An AO mask (how occluded each pixel is from ambient light)

**This pass — DiffuseIndirectComposite**
Takes those results and applies them to the scene — combining indirect lighting with the direct lighting from the `Lights` pass already accumulated in SceneColor.

**Why they are separate:** The indirect lighting computation (doc 14) is a complex multi-phase GPU compute pipeline that runs independently of SceneColor. The compositing is a simple blend that requires SceneColor (populated by the direct lighting pass) to exist before it can combine with it. The computation doesn't need SceneColor; the compositing does.

---

## What This Stage Does

**Indirect Diffuse Application**
The indirect diffuse lighting buffer is added to SceneColor. This is an additive blend — the indirect bounced light contribution is layered on top of the direct lighting already present from the `Lights` pass.

For each pixel:
```
SceneColor += indirect_diffuse_lighting × base_color × (1 − metallic)
```

The base color modulates the indirect lighting — a white surface reflects the full GI contribution; a dark surface reflects very little. Metallic surfaces receive no diffuse indirect contribution (metals have no diffuse response).

**AO Application**
The AO mask (from SSAO when Lumen AO is inactive, or from Lumen's screen probe gather when active) is applied as a modulator of ambient and indirect lighting terms. AO darkens regions where ambient light has limited access — crevices, contact areas, corners, the underside of objects.

The AO modulates:
- The indirect diffuse contribution (indirect light scaled down in occluded areas)
- The sky ambient contribution
- Ambient terms in materials

It does **not** modulate direct lighting — shadows from lights handle direct light occlusion. AO applies only to the ambient and indirect components.

**Bent Normals (Where Active)**
If bent normals are computed as part of the AO pass, they are applied here to improve the directionality of indirect lighting. Rather than applying the full indirect radiance uniformly, bent normals weight the radiance by the direction from which ambient light most easily reaches the surface — improving accuracy in partially occluded areas.

**Sky Light Contribution**
The sky light's diffuse contribution (from the sky light capture or Lumen sky integration) is composited here as part of the indirect diffuse combination. This is the ambient sky lighting that fills shadowed outdoor areas with blue sky light.

---

## Why This Pass Is Separate From Both Doc 14 and The Lights Pass

Three separate passes handle what might seem like one system:

| Pass | What It Does |
|------|-------------|
| `Lights` (doc 28) | Evaluates direct light → accumulates into SceneColor |
| `DiffuseIndirect & AO` (doc 14) | Computes indirect light → stores in indirect buffer |
| **This pass** | Applies indirect buffer → adds to SceneColor |

The separation between the `Lights` pass and this pass is deliberate — direct and indirect lighting have completely different computation methods, timing requirements, and quality/cost levers. Running them independently and compositing afterward is simpler, more debuggable, and allows each to be optimized independently.

---

## Execution Model

DiffuseIndirectComposite is a **fullscreen compute or pixel shader pass** — a per-pixel blend of the indirect lighting buffer into SceneColor.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the compositing dispatch |
| **GPU** | Reads indirect buffer and AO mask; applies GBuffer-informed modulation; writes to SceneColor |

**Cost profile:** Primarily **bandwidth-bound** — reads indirect diffuse buffer, AO mask, GBuffer base color and metallic channels, and SceneColor; writes SceneColor. The math is minimal (multiply-adds). Cost scales with render resolution.

---

## What Data This Pass Reads and Produces

**Reads:**

| Input | Source | Purpose |
|-------|--------|---------|
| Indirect diffuse buffer | DiffuseIndirect & AO (doc 14) | The GI contribution to apply |
| AO mask | DiffuseIndirect & AO (doc 14) | Ambient occlusion for modulation |
| GBufferC (Base Color / Metallic) | BasePass (doc 11) | Base color for indirect light modulation; metallic for diffuse masking |
| SceneColor (direct lighting) | Lights pass (doc 28) | Existing direct lighting result to add indirect on top of |
| Sky Light capture / Lumen sky | Sky Light system | Sky diffuse ambient contribution |
| Bent normals (if active) | DiffuseIndirect & AO | Directional AO weighting |

**Produces:**

| Output | Consumers |
|--------|-----------|
| SceneColor with full direct + indirect lighting | Lumen Reflections (doc 19), translucency, post-processing, TSR |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High render resolution | Fullscreen pass scales with pixel count | Scales with `r.ScreenPercentage` |
| Multiple active views | Each view composites independently | Minimize scene captures |
| Wide indirect diffuse buffer resolution | Higher-resolution indirect buffer = more bandwidth to read | Indirect buffer resolution scales with `r.Lumen.ScreenProbeGather.DownsampleFactor` |

> [!NOTE]
> **This compositing pass is rarely a primary performance concern.** Its cost is almost always a small fraction of the indirect lighting computation that preceded it (doc 14). If GI performance is the concern, investigate `LumenScreenProbeGather` and `DenoiseDiffuseIndirect` in Unreal Insights before looking at this compositing step. This pass's cost is bounded by bandwidth — essentially unavoidable given that the indirect result must be read and written to SceneColor.

---

## AO Modulation — What Gets Darkened

AO affects specific lighting components, not all lighting:

| Lighting Component | AO Applied? |
|-------------------|-------------|
| Direct sunlight (directional light) | ❌ No — shadows handle this |
| Direct local light | ❌ No — shadows handle this |
| **Indirect diffuse (Lumen GI)** | ✅ Yes — primary AO target |
| **Sky ambient** | ✅ Yes — sky light is ambient |
| **Material ambient terms** | ✅ Yes |
| Specular reflections | ❌ No — specular AO is a separate term |

This selective application explains why AO looks correct — shadows handle per-light occlusion while AO handles the soft ambient occlusion that shadows are too coarse to capture.

---

## Key Systems and Components

### Indirect Lighting Buffer
The R16G16B16 (or similar) texture containing the Lumen GI result per pixel. This buffer represents the total diffuse radiance arriving at each pixel from all indirect (bounced) light sources. It is not yet modulated by the surface's albedo — that modulation happens here during compositing, which is why a white wall and a black wall in the same location produce different final GI contributions despite having the same incoming radiance.

### AO Integration
The AO mask from doc 14 (either SSAO or Lumen AO) is a per-pixel value ranging from 0 (fully occluded) to 1 (fully unoccluded). During compositing, indirect lighting is multiplied by this value — occluded pixels receive proportionally less indirect light. The result is the characteristic darkening in corners, under objects, and in contact shadow areas that grounds scene elements and adds spatial depth.

### Specular Occlusion (Separate from Diffuse AO)
While this pass handles diffuse indirect AO, specular occlusion is a related but separate term — some rendering configurations apply a specular AO term to reduce specular reflections in occluded areas (bright reflections in dark crevices are visually implausible). This is handled separately from the diffuse AO applied here, typically through material or reflection pass configurations.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass completes the full lighting picture.** After this pass, SceneColor contains both direct lighting (from the `Lights` pass) and indirect lighting (Lumen GI applied here). All subsequent passes — reflections, translucency, post-processing, TSR — work from this complete lighting result. Artifacts that appear in both lit and shadowed regions equally are typically downstream issues; artifacts that affect only indirect or AO contribution specifically are attributable to doc 14 or this compositing pass.

> [!NOTE]
> **Disabling Lumen GI (`r.Lumen.DiffuseIndirect.Allow 0`) skips both doc 14 and this compositing pass.** The indirect diffuse buffer never gets computed, so there is nothing to composite. SceneColor after the `Lights` pass would contain only direct lighting — shadowed regions would be black or dark ambient only. If fallback SSAO is configured, its result is still applied through this pass.

> [!NOTE]
> **The indirect diffuse applied here does not include specular indirect (reflections).** Specular indirect — Lumen reflections (doc 19) — is added after this pass in a separate compositing step. The split between diffuse indirect (this pass) and specular indirect (Lumen Reflections) mirrors the split between diffuse and specular BRDFs — they are evaluated and composited through independent pipelines.

---

## How to Debug / Profile

### Unreal Insights

| Event | What It Tells You |
|-------|------------------|
| `DiffuseIndirectComposite` | Total indirect diffuse compositing cost |
| `CompositeIndirectDiffuse` | Variant name in some engine versions |

> [!TIP]
> If `DiffuseIndirectComposite` shows unexpectedly high cost relative to the GI computation, the cause is almost always render resolution — the compositing bandwidth scales exactly with output pixel count. Any optimization here is a global resolution decision. If the GI visual quality is the concern rather than performance, investigate doc 14 (the computation) rather than this compositing step.

### Debug Visualizations

```
r.Lumen.Visualize.Mode 1        // View indirect diffuse contribution in isolation
                                 // Shows what this pass is compositing into the scene
viewmode ambientocclusion       // View AO contribution in isolation
                                 // Shows the mask being applied during compositing
showflag.GlobalIllumination 0   // Toggles GI contribution — skips indirect composite
                                 // Shows scene with direct lighting only
```

### Stat Commands

```
stat GPU    // Overall breakdown — DiffuseIndirectComposite appears as a small block
```

### Useful Console Variables

```
r.Lumen.DiffuseIndirect.Allow 0/1    // Disables Lumen GI entirely — skips both computation
                                      // (doc 14) and this compositing pass

r.IndirectLightingIntensity [1.0]    // Global indirect lighting multiplier applied during composite.
                                      // Useful for artistic control without disabling GI.
                                      // Values > 1.0 amplify; < 1.0 reduce indirect contribution.

r.AmbientOcclusionIntensity [1.0]   // AO mask intensity multiplier applied during compositing.
                                      // 0.0 = no AO effect; 1.0 = full AO.

r.AmbientOcclusionStaticFraction    // Fraction of AO applied to static lighting contribution.
```

---

## Optimization Levers

This pass has minimal independent optimization levers. Its cost is bounded by:
- Render resolution (address with `r.ScreenPercentage`)
- Whether indirect lighting is enabled at all (`r.Lumen.DiffuseIndirect.Allow`)

For meaningful performance improvements in the GI pipeline, optimize the computation in doc 14 (probe density, sample count, hardware vs software Lumen). This compositing pass is not the bottleneck in any typical scenario.

---

## Mental Model

Think of DiffuseIndirectComposite as:

> *"The lighting calculation is finished — both direct and indirect results are ready. Now blend them together into the single color buffer that represents the scene's complete illumination."*

This pass is the final integration point of the lighting pipeline. Direct lighting arrived first (from the `Lights` pass). Indirect lighting was computed separately (doc 14). This pass is the moment they merge — the last step before the scene's lighting is considered complete and downstream systems (reflections, translucency, post-processing) take over.

The key insight is that indirect lighting is not additive on top of direct without modulation — it is modulated by surface albedo and AO before being added. A bright surface in a dark corner receives full indirect radiance but reflects it according to its albedo. A dark surface in an open area receives the same radiance but reflects almost none of it. AO further darkens areas with limited hemisphere access. This pass applies both of those modulations to produce physically plausible indirect lighting integration.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| DiffuseIndirect & AO (doc 14) | Produces the indirect buffer and AO mask composited here |
| Lights (doc 28) | Produces the direct lighting in SceneColor that indirect is added on top of |
| Lumen Reflections (doc 19) | Runs after this pass — adds specular indirect on top of full diffuse lighting |
| BasePass (doc 11) | Provides GBuffer base color and metallic channels used for albedo modulation |
| AO system (SSAO / Lumen AO) | AO mask source depending on project configuration |
| Sky Light | Sky diffuse contribution composited as part of indirect lighting application |

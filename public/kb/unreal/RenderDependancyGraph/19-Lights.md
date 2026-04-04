---
tags:
  - lighting
---

# Unreal Engine 5 Rendering Pipeline – Lights (Deferred Lighting)

> Stage: **Lights (Deferred Lighting)**  
> Phase: Direct Lighting Evaluation  
> Purpose: Evaluate direct lighting contributions from all light types against GBuffer surface data using physically based BRDFs, apply shadow map lookups, and accumulate the result into SceneColor  
> Pipeline Position: After `LightCompositionTasksPreLighting` and shadow passes, before `DiffuseIndirect & AO`

---

## What This Stage Does

The deferred lighting pass is where **all direct lighting is computed**. It reads the fully populated GBuffer (written by BasePass and finalized by LightCompositionTasksPreLighting) and evaluates the lighting contribution from every active light in the scene, accumulating the results into SceneColor.

No geometry is rasterized here. No material graphs are evaluated. The GBuffer already contains everything needed — normals, roughness, metallic, base color, AO, shading model — and the lighting pass processes that data entirely without touching scene geometry.

This pass handles:
- The directional light (sun/moon) via a fullscreen evaluation
- Local lights (point, spot, rect) via screen-space bounding geometry
- Shadow map application for all shadow-casting lights (VSM lookups)
- IES profile attenuation where configured
- Light function material evaluation where configured
- Lighting channel masking (from doc 12)
- Subsurface scattering treatment for SSS shading models
- Capsule shadow evaluation for character soft shadows

**What it does NOT handle:**
- Indirect lighting (bounced light) — that is Lumen's domain (doc 14)
- Sky light ambient — evaluated separately through Lumen or reflection captures
- Translucency lighting — handled in a separate forward pass
- Reflections — handled by Lumen Reflections (doc 19)

---

## Deferred Lighting Architecture — Direct vs Indirect

Before going further, the foundational distinction:

**Direct lighting (this pass):** Light that travels in a straight line from a light source to a visible surface. The sun illuminating the ground. A lamp casting a pool of light on a table. A spot light hitting a character.

**Indirect lighting (Lumen, doc 14):** Light that bounced off one or more surfaces before reaching the camera. The warm orange light filling a shadowed room from a sunlit wall outside the window. The blue tint in shadows from a blue sky. Color bleeding from a red wall onto a white floor.

This pass computes only direct. Lumen computes only indirect. Both contribute to the final illuminated appearance, through completely separate systems with separate performance budgets.

> [!NOTE]
> **A scene lit entirely by direct lighting (Lumen disabled) will appear flat and artificially dark in shadowed regions.** Shadows will be completely black rather than softly lit by bounced light. This is not a bug — it's the correct direct-only result. The visual richness of real lighting comes from indirect contributions that only Lumen (or baked lightmaps) provides. Understanding this split is fundamental to diagnosing whether a lighting issue originates in this pass or in Lumen.

---

## How Each Light Type Is Rendered

Different light types use fundamentally different GPU rendering strategies. Understanding these determines which profiling events to look for and what makes each type expensive.

### Directional Light (Sun / Moon)
**Strategy:** Fullscreen triangle covering every pixel on screen.  
**Cost model:** Always evaluates every pixel regardless of light direction or camera orientation.  
**Shadow:** VSM clipmap lookup (see doc 15/16) applied per pixel across the entire screen.  
**Special:** Atmospheric integration with Sky Atmosphere (transmittance through atmosphere applied to direct lighting).

The directional light is evaluated last after all local lights in most configurations, using an additive blend over the accumulated local light result.

### Point Lights
**Strategy:** Sphere mesh bounding the light's influence volume is rasterized. Only pixels inside the sphere receive lighting evaluation.  
**Cost model:** Scales with both the sphere's screen-space coverage and depth complexity within it.  
**Shadow:** VSM point light shadow lookup (all-direction coverage). Shadowed point lights are significantly more expensive than unshadowed.

### Spot Lights
**Strategy:** Cone mesh bounding the spot's influence cone. Tighter cone = smaller raster footprint = cheaper.  
**Cost model:** Scales with cone screen coverage. Narrow spots are much cheaper than wide spots at the same luminance.  
**Shadow:** VSM perspective shadow lookup for the cone frustum.

### Rect Lights
**Strategy:** Box mesh bounding the rect light's influence volume.  
**Cost model:** Most expensive local light type per area covered due to LTC (Linearly Transformed Cosines) BRDF evaluation.  
**Shadow:** VSM rect light shadow.

> [!WARNING]
> **Rect lights use Linearly Transformed Cosines (LTC) for accurate area light BRDF evaluation — significantly more expensive than point or spot light evaluation per covered pixel.** LTC requires additional texture lookups (LTC coefficient tables) and more complex math to correctly represent the distribution of incoming light from an area source. A scene with many overlapping rect lights in a small area can see lighting pass cost 3–5× higher than the same scene with equivalent point lights. Use rect lights for hero lighting moments where the area light appearance is visually critical; prefer point or spot lights for ambient fill.

### Capsule Shadows (Character Soft Shadows)
**Strategy:** Screen-space capsule shadow evaluation per character. Capsule shapes approximate character geometry for cheap soft shadow casting.  
**Cost model:** Scales with number of characters on screen and their screen-space coverage.  
**Benefit:** Far cheaper than full dynamic shadow maps for character self-shadowing and ground contact.

---

## The BRDF — What Happens Per Lit Pixel

For each pixel affected by a light, the lighting shader evaluates a physically based BRDF (Bidirectional Reflectance Distribution Function). UE5 uses the **Cook-Torrance specular BRDF** with **GGX normal distribution** and a **Lambertian diffuse term**.

Per lit pixel, the evaluation:
1. **Reads GBuffer:** Normal (GBufferA), Roughness + Metallic + Specular (GBufferB), Base Color (GBufferC), Shading Model ID
2. **Reconstructs world position** from depth using inverse view-projection
3. **Computes light vector** from world position to light source (for local lights) or uses the constant direction (directional light)
4. **Evaluates GGX specular:** Normal distribution function + geometry function + Fresnel term
5. **Evaluates diffuse:** Lambert diffuse × (1 - metallic) — metals have no diffuse component
6. **Applies attenuation:** Distance falloff for local lights; no attenuation for directional
7. **Applies shadow:** VSM depth comparison if the light casts shadows
8. **Applies IES / light function** if configured
9. **Applies lighting channel mask** (from doc 12 — skip if channels don't match)
10. **Accumulates result** into SceneColor (additive blend)

The roughness value from the GBuffer is the single most impactful per-pixel variable for specular cost. Rough surfaces (high roughness) produce wide specular lobes that require accurate GGX distribution evaluation. Smooth surfaces (low roughness) produce tight specular highlights — also expensive due to high frequency.

---

## Shadowed vs Unshadowed Lights — Cost Difference

Shadow adds substantial cost per light. Understanding the breakdown clarifies where lighting budgets go.

**Unshadowed light evaluation:**
- GBuffer reads + BRDF math + attenuation = fast
- Batched efficiently using the tiled/clustered light grid (doc 07)
- Multiple unshadowed lights per pixel processed in a single shader pass

**Shadowed light evaluation:**
- All of the above, plus:
- VSM page lookup — finding the correct virtual page for the pixel's world position
- Depth comparison — comparing scene depth against shadow map depth
- Shadow filtering — PCF or VSM filtering for soft shadow edges
- Potentially multiple samples for penumbra estimation

> [!WARNING]
> **Shadow-casting lights cost significantly more per light than unshadowed lights.** A scene with 20 unshadowed local lights may cost less in the lighting pass than a scene with 5 shadowed local lights. Every shadow-casting local light adds a full VSM lookup per lit pixel in its influence volume. Consider carefully which lights genuinely need shadow casting — ambient fill lights, bounce approximations, and distant accent lights rarely need shadows and can be made unshadowed at no visual cost.

---

## Light Functions — The Hidden Per-Light Cost Multiplier

A light function is a material applied to a light that modulates its color or intensity spatially — cookie effects, projected patterns, flickering noise, moving shadows. They produce visually compelling results but at significant per-pixel cost.

For every pixel a light with a light function affects, the light function material is evaluated as a full material pass — texture samples, material math, UV projection. This runs in addition to the standard BRDF evaluation.

**Cost multiplier:** A light with a light function costs approximately the same as the BRDF evaluation plus the light function material evaluation combined. A complex light function material with multiple texture reads on a wide-influence light can double the per-pixel cost for that light.

> [!WARNING]
> **Light functions on lights with large screen influence volumes are one of the highest-cost lighting configurations possible.** A directional light with a light function evaluates the light function for every pixel on screen, every frame. A point light with a large radius and a complex light function evaluates it for every pixel within the entire sphere projection on screen. Reserve light functions for hero lights with intentionally limited influence volumes (tight spot lights, area lights with explicit coverage), and prefer static texture cookies over procedural noise material graphs wherever possible.

---

## IES Profiles — Attenuation Cost

IES (Illuminating Engineering Society) profiles define real-world light distribution patterns — how a physical light fixture's output varies by direction. Applied to point or spot lights, they modulate intensity based on the angle between the light-to-pixel vector and the light's principal direction.

**Cost:** An additional texture lookup per lit pixel per light using the IES profile texture. Lower cost than a light function but non-trivial on lights with large coverage.

**When worthwhile:** IES profiles are most valuable on visible practical lights (lamp fixtures, stage lights, automotive headlights) where the angular distribution is a key visual property. They add unnecessary cost on lights used purely as fill or ambient where the directional distribution is not perceptible.

---

## Subsurface Scattering in Lighting

Materials using SSS shading models (Subsurface, Subsurface Profile, Preintegrated Skin, Two Sided Foliage) receive special lighting treatment.

**The SSS lighting split:**
1. **Specular component:** Evaluated from the surface normal — same as standard lighting
2. **Diffuse component:** Evaluated with a wrap-around term that accounts for light penetrating below the surface. For Subsurface Profile, a separable SSS convolution pass runs after the main lighting pass.
3. **Transmission (Two Sided Foliage):** Light that transmits through the material — evaluated from the back-face contribution

The subsurface data prepared in LightCompositionTasksPreLighting (doc 17) is consumed here. The Subsurface Profile shading model in particular adds a post-lighting screen-space blur pass for skin scatter that is a separate GPU cost.

> [!NOTE]
> **Subsurface Profile is the most expensive SSS model because it requires a separable screen-space scattering convolution after the main lighting pass.** The blur radius scales with the profile's scattering distance — large scattering radii (soft skin, thick wax) require wider blur passes. Reserve Subsurface Profile for hero characters; use Preintegrated Skin or standard Subsurface for secondary characters where the quality difference is imperceptible.

---

## Threading Model

Deferred lighting uses parallel command list architecture similar to BasePass.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules light evaluation passes per light type; manages light batching |
| **Task Graph (Workers)** | Parallel command list build for light draw calls |
| **RHI Thread** | Submits merged command lists to GPU |
| **GPU** | Executes BRDF, shadow lookup, and accumulation per lit pixel |

Lights are processed in batches — unshadowed local lights are batched together using the clustered light grid; shadowed lights typically receive individual passes; the directional light gets a dedicated fullscreen pass.

---

## What Data This Pass Reads

| Input | Source | Used For |
|-------|--------|----------|
| GBufferA (Normal) | BasePass | BRDF normal, view-dependent evaluation |
| GBufferB (Metallic/Specular/Roughness) | BasePass | BRDF material properties |
| GBufferC (Base Color / AO) | BasePass | Diffuse albedo, per-material AO |
| GBufferD (Custom Data) | BasePass | SSS color, shading model-specific data |
| GBufferE (Pre-shadow) | BasePass | Stationary light pre-shadowed term |
| SceneDepth | PrePass / NaniteEmit | World position reconstruction |
| VSM Shadow Pages | ShadowDepths (doc 16) | Shadow application per shadowed light |
| Lighting Channel Mask | CopyStencilToLightingChannels (doc 12) | Per-pixel light eligibility |
| Light Grid (tiled/clustered) | ComputeLightGrid (doc 07) | Per-tile light list for batched evaluation |
| IES Textures | Light assets | Angular attenuation per IES-enabled light |
| LTC Tables | Engine built-in | Area light BRDF (rect lights) |

---

## What Data This Pass Produces

| Output | Consumers |
|--------|-----------|
| Direct lighting in SceneColor | DiffuseIndirectComposite (adds indirect on top), post-processing, TSR |
| SSS scatter input | Subsurface scattering blur pass |

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many shadow-casting local lights | Per-light VSM lookup for each lit pixel | Convert non-essential lights to unshadowed; reduce shadow-casting light count |
| Lights with light functions on large influence volumes | Full material evaluation per lit pixel per light | Limit light functions to tightly scoped hero lights; use simple cookie textures |
| Rect lights with wide coverage | LTC BRDF more expensive than point/spot | Replace fill rect lights with spot or point; reserve rect for hero practical lights |
| Large light attenuation radii | More pixels affected per light | Reduce `Attenuation Radius` to minimum visual requirement |
| Many Subsurface Profile characters on screen | Post-lighting SSS convolution scales with character screen coverage | Limit Subsurface Profile to hero characters; use Preintegrated Skin for others |
| High GBuffer bandwidth | Reading 5 render targets per lit pixel is memory bandwidth intensive | Reduce GBuffer format (`r.GBufferFormat`) on memory-constrained platforms |
| Complex specular surfaces at high screen coverage | GGX evaluation expensive for large rough-specular areas | Address at material level; reduce specular complexity on background geometry |

---

## Key Systems and Components

### Cook-Torrance GGX Specular BRDF
The physically based specular model used for all standard lit shading models. Three components:
- **GGX Normal Distribution Function (NDF):** Models how microfacets are statistically distributed. The roughness parameter directly controls this — smooth surfaces (low roughness) concentrate microfacets producing tight highlights; rough surfaces spread them producing wide diffuse-looking highlights
- **Geometry Function (G):** Accounts for microfacet self-shadowing and masking. Prevents physically impossible retroreflection
- **Fresnel (Schlick approximation):** Controls reflectivity based on angle — all surfaces become more reflective at grazing angles regardless of material properties

### Tiled / Clustered Light Evaluation
Non-shadowed local lights are batched using the light grid from doc 07. The lighting shader looks up the per-tile light list, iterates over all lights in the tile, and evaluates all of them in a single shader invocation. This batching eliminates redundant GBuffer reads — without it, each light would require its own GBuffer read per lit pixel.

### Virtual Shadow Map Lookup
For each shadow-casting light, the lighting shader performs a VSM page lookup — finding the virtual page covering the pixel's world position, sampling the depth value in that page, and comparing against the reconstructed world depth. Soft shadows emerge from page-level filtering. Static geometry on stationary lights uses cached pages (near-zero marginal cost per frame after caching); dynamic or Movable light pages are re-evaluated each frame.

### Linearly Transformed Cosines (LTC)
The mathematical technique enabling accurate area light (rect light) evaluation. Transforms the integral of the GGX BRDF over the rect light's solid angle into an analytically solvable form using precomputed LTC coefficient tables. Produces correct area light specular highlights (the rectangular shape is reflected in the highlight) at a cost higher than point light approximations.

### Lighting Channel Masking
Per-pixel lighting channel mask (from doc 12) evaluated for each light. If the bitwise AND of the pixel's channel mask and the light's channel assignment is zero, the light contribution is skipped entirely. This check happens before BRDF evaluation — the GPU branches around the full evaluation, making the check essentially free in most configurations.

---

## 📋 Reader Notes

> [!NOTE]
> **The deferred lighting pass is typically in the top 3 most expensive passes per frame alongside BasePass and Lumen.** Unlike passes with variable cost based on feature configuration, every scene with lights pays this cost. Setting realistic expectations: 2–5ms is normal for complex lit scenes with multiple shadow-casting lights on mid-range hardware. Significant outliers above this are almost always attributable to specific light configurations — light functions, excessive shadow-casting light count, or wide-influence rect lights.

> [!NOTE]
> **Stationary lights are a major optimization over Movable for direct lighting cost.** Stationary lights pre-bake their static lighting contribution into lightmaps sampled in BasePass, leaving only dynamic shadow evaluation in this pass. Their indirect contribution is fully baked. A scene that converts non-animating Movable lights to Stationary typically sees significant reductions in both shadow depth cost (doc 16) and per-pixel shadow lookup cost in this pass simultaneously.

> [!NOTE]
> **In Unreal Insights, lighting events appear per light type and per light, not in a single "Lights" block.** Look for `DirectionalLight`, `StandardDeferredLighting`, `ShadowedLights`, and individual light events. The total lighting cost is the sum of all these events. Filtering by "light" in Unreal Insights reveals the full breakdown — critical for identifying which specific lights or light types are the cost drivers.

> [!NOTE]
> **The direct lighting pass cost and the shadow pass cost (doc 16) are tightly coupled.** A light that costs more in shadow depth rendering (more shadow pages, more geometry) also costs more here (more shadow lookups per lit pixel). Optimizing shadow page count via Stationary light conversion saves cost in both passes simultaneously. Always profile them together when investigating lighting performance.

---

## How to Debug / Profile

### Unreal Insights
Key events in the **GPU track** (lighting events are per-type and per-light):

| Event | What It Tells You |
|-------|------------------|
| `DirectionalLight` | Fullscreen directional light evaluation cost |
| `StandardDeferredLighting` | Batched unshadowed local light evaluation |
| `ShadowedLights` | Shadow-casting local light evaluation (often one event per light) |
| `CapsuleShadows` | Character capsule shadow evaluation |
| `SubsurfaceScattering` | Post-lighting SSS convolution for Subsurface Profile materials |

> [!TIP]
> If `ShadowedLights` is dominant, the fix is reducing shadow-casting light count or converting to Stationary. If `StandardDeferredLighting` is dominant, the problem is too many unshadowed lights with large radii — tune the light grid (doc 07) and reduce light count. If `DirectionalLight` is dominant, check whether a light function is applied to the directional light — this is one of the most expensive single-light configurations possible.

### Debug Visualizations

```
viewmode lit                  // Standard lit view — baseline reference
viewmode unlit                // Removes all lighting — isolates material/geometry cost from lighting
viewmode lightcomplexity      // Heatmap of lights-per-pixel. 
                               // Green = few lights. Red/white = many overlapping lights.
                               // Primary tool for identifying light overlap hotspots.
showflag.DirectionalLights 0  // Toggle directional lights — isolates directional light cost
showflag.PointLights 0        // Toggle point lights
showflag.SpotLights 0         // Toggle spot lights
showflag.RectLights 0         // Toggle rect lights
```

### Stat Commands

```
stat GPU            // Overall GPU breakdown — lighting events appear as multiple blocks
stat Lights         // Light counts by type and mobility — identifies configuration issues
stat SceneRendering // Broader rendering stats including light draw calls
```

### Useful Console Variables

```
// Light quality controls
r.Shadow.Quality [3]                    // Shadow quality (0-5). Reduce on lower-end platforms.
r.ShadowQuality [3]                     // Alias for shadow quality setting

// Specific light type toggles (debug/profiling only)
r.AllowStaticLighting 0/1              // Toggle static/stationary light baked contribution

// SSS controls
r.SubsurfaceScattering 0/1             // Toggle SSS post-lighting blur pass

// Light function
r.LightFunctionQuality [1]             // Light function evaluation quality

// Capsule shadows
r.CapsuleShadows 0/1                   // Toggle capsule shadow evaluation

// Shadow softness
r.Shadow.Virtual.SMRT.RayCountLocal    // Shadow ray count for soft shadows on local lights
r.Shadow.Virtual.SMRT.RayCountDirectional // Shadow ray count for directional light soft shadows

// GBuffer bandwidth
r.GBufferFormat [1]                    // GBuffer layout — lower values reduce bandwidth
```

---

## Optimization Levers

### Light Count and Configuration (Highest Impact)
- Convert all non-animating lights to **Stationary** — pre-bakes static contribution, eliminates indirect shadow lookup, reduces page churn in doc 16
- Disable shadow casting on lights that don't need it — every shadow-casting light adds VSM lookup overhead per lit pixel in its influence volume
- Reduce `Attenuation Radius` to minimum visual requirement — directly reduces lit pixel count per light

### Light Functions
- Remove light functions from lights with large influence volumes
- Replace animated procedural light function materials with pre-baked cookie textures
- Use light functions only on spot lights with tight cone angles where screen coverage is inherently limited

> [!WARNING]
> **A light function on a directional light is a fullscreen material evaluation every frame.** This is one of the single most expensive lighting configurations in UE5. A complex light function material on the sun affects every pixel on screen, every frame — equivalent to running an additional fullscreen post-process shader. If atmospheric cloud shadow or similar effects are needed, prefer Volumetric Fog with VSM shadow integration over light functions on the directional light.

### Rect Lights
- Replace fill and ambient rect lights with point or spot lights
- Reserve rect lights for hero practical sources (softbox lights, fluorescent tubes, monitor screens) where the area light specular highlight shape is visually significant
- Limit rect light screen coverage — unlike spot lights, rect lights project omnidirectionally within their bounding volume, making their coverage less intuitive to control

### SSS Characters
- Audit which characters use Subsurface Profile vs Preintegrated Skin
- Subsurface Profile is visually superior but costs a screen-space blur pass — Preintegrated Skin is nearly equivalent for medium and background characters
- Limit the number of hero characters visible simultaneously if SSS post-pass cost is significant

### Platform Configuration
- Reduce `r.Shadow.Quality` on lower-end platforms — shadow filtering quality scales inversely with cost
- Disable capsule shadows (`r.CapsuleShadows 0`) on platforms where character soft shadow quality is less critical

---

## Mental Model

Think of the deferred lighting pass as:

> *"With all geometry material data already written and every light's shadow map ready, systematically evaluate how much light from each source reaches each visible pixel — accounting for material properties, shadows, light falloff, and angular distribution — and accumulate the result."*

Deferred rendering's core promise is that lighting cost is **decoupled from geometry complexity**. No matter how many triangles a surface has, its lighting cost in this pass is purely a function of its screen-space pixel coverage, the lights that reach it, and the complexity of those lights. A million-polygon surface costs the same to light as a four-polygon surface if they cover the same screen area.

The key insight is the **light budget tradeoff:** every shadow-casting light, every light function, every rect light, and every large-radius local light is a per-pixel cost multiplier applied to every frame. The rendering architecture is efficient; the lighting design choices determine whether that efficiency is exploited. Most lighting performance problems trace back to authoring decisions — light count, shadow casting settings, light functions, and attenuation radii — not to rendering configuration.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| BasePass (doc 11) | Populates the GBuffer this pass reads — material properties for BRDF evaluation |
| ComputeLightGrid (doc 07) | Provides the tiled/clustered light lists used for batched local light evaluation |
| LightCompositionTasksPreLighting (doc 17) | Finalizes GBuffer; prepares SSS data consumed here |
| CopyStencilToLightingChannels (doc 12) | Provides channel mask consumed per lit pixel |
| ShadowDepths (doc 16) | Provides VSM page depth data used for shadow lookup |
| DiffuseIndirect & AO (doc 14) | Computes indirect lighting added on top of this pass's direct result |
| DiffuseIndirectComposite | Combines indirect Lumen result with this pass's direct result |
| Lumen Reflections (doc 19) | Handles specular indirect — separate from direct specular evaluated here |

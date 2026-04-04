---
tags:
  - fog
---

# Unreal Engine 5 Rendering Pipeline – Exponential Height Fog

> Stage: **ExponentialHeightFog**  
> Phase: Atmospheric Compositing / Analytical Fog  
> Purpose: Apply analytically computed depth-and-altitude-based fog to the scene — attenuating distant geometry and adding inscattering contribution — without voxels, ray marching, or light injection  
> Pipeline Position: After `BasePass`, `SkyAtmosphere`, and geometry passes, before translucency and final composition

---

## What This Stage Does

ExponentialHeightFog applies **analytical fog** to the rendered scene. For each pixel, it reads SceneDepth, reconstructs the world-space position, computes how much fog exists between the camera and that point using a closed-form exponential integral, and writes the result into SceneColor as attenuation of the scene color plus an inscattering contribution.

No voxels. No ray marching. No light injection. The fog amount is solved exactly from a mathematical function — the exponential height density model — making this one of the most computationally efficient full-screen effects in the pipeline.

The pass evaluates up to **two independent fog layers simultaneously** and optionally applies **directional inscattering** for sun-aligned brightening.

---

## The Exponential Height Function

The density at any world-space point is defined as:

```
density(h) = FogDensity × exp( −FogHeightFalloff × (h − FogHeight) )
```

Where:
- `h` = world-space altitude of the point
- `FogDensity` = base density at the reference height
- `FogHeightFalloff` = how quickly density decreases with altitude (higher = thinner fog band)
- `FogHeight` = world-space altitude where density equals `FogDensity`

**Why this function is efficient:** The fog transmittance along a ray from the camera to a world-space point requires integrating this density over the ray's length. Crucially, for an exponential height function, this integral has a **closed-form analytical solution** — it can be computed exactly in a handful of math operations, with no stepping, no sampling, no approximation. The result is exact fog at negligible compute cost.

This is the fundamental efficiency advantage over Volumetric Fog's voxel grid: no precomputed structure, no per-step evaluation, just per-pixel math from a formula.

---

## Exponential Height Fog vs Volumetric Fog — Critical Distinction

These two systems are frequently confused. They coexist and serve different purposes:

| Property | Exponential Height Fog | Volumetric Fog (doc 20) |
|----------|----------------------|------------------------|
| Architecture | Analytical — per-pixel math | Voxel grid — 3D simulation |
| Light interaction | None / directional inscattering only | Full per-light injection and scattering |
| God rays | ❌ Not supported | ✅ Supported |
| Per-pixel cost | Very low | Moderate to high |
| Shadows in fog | ❌ No | ✅ Yes (from VSM) |
| Color from lights | Approximation only | Physically computed |
| GPU cost | ~0.1–0.3ms | 0.5–3ms+ |

> [!NOTE]
> **The "Volumetric Fog" checkbox on the Height Fog actor does not add cost to this pass.** Enabling it on the actor tells Height Fog's density function to feed into the Volumetric Fog voxel grid (doc 20) — affecting how that system computes its density. The analytical height fog pass shown here runs at the same cost regardless of whether that checkbox is on or off. The Volumetric Fog cost is entirely in doc 20's voxel pipeline.

---

## The Two Fog Layers

The `ExponentialHeightFog` actor supports two independent layers, each with its own density, height, falloff, and color. Both are computed and combined in a single GPU pass.

**Layer 1 (Primary):**
- `FogDensity` — base density at the reference height
- `FogHeightFalloff` — density falloff rate with altitude
- `FogHeight` — world-space altitude of the reference density
- `FogMaxOpacity` — caps fog opacity to prevent complete geometry concealment
- `StartDistance` — camera-space distance before fog begins accumulating
- `FogCutoffDistance` — maximum distance fog affects geometry
- `FogInscatteringColor` — the color of the scattered light in the fog
- `FogInscatteringLuminance` — fog brightness

**Layer 2 (Secondary):**
- `SecondFogDensity` — independent density for the second layer
- `SecondFogHeightFalloff` — independent falloff rate
- `SecondFogHeight` — independent reference altitude

The final fog is the combined transmittance and inscattering of both layers evaluated simultaneously. Common uses:

| Configuration | Effect |
|--------------|--------|
| Low dense Layer 1 + sparse high Layer 2 | Ground mist with upper atmospheric haze |
| Both layers at similar height, different colors | Complex fog color variation with depth |
| Layer 1 thick, Layer 2 as far-distance desaturation | Depth cueing for large open worlds |

> [!NOTE]
> **Both fog layers compute in the same pass at the same GPU cost.** Having a second fog layer adds negligible additional GPU cost — the shader evaluates both analytically and combines them in the same pixel shader invocation. The performance difference between one and two layers is effectively zero. The second layer is a free authoring tool.

---

## Directional Inscattering

Optional directional inscattering adds a cone-shaped fog brightening toward the sun direction — simulating the forward-scattering behavior that makes fog appear to glow when looking toward a light source.

This is an **analytical approximation** of volumetric forward-scattering, not physical light simulation. It produces a visually plausible sun-aligned glow in the fog without requiring the full Volumetric Fog voxel pipeline.

Properties:
- `DirectionalInscatteringExponent` — controls the cone width (higher = tighter cone around sun direction)
- `DirectionalInscatteringStartDistance` — minimum camera distance before directional inscattering applies
- `DirectionalInscatteringColor` — tint of the directional component (typically warm near sun direction)

> [!WARNING]
> **Directional inscattering is not the same as god rays.** It produces a smooth gradient brightening in the sun direction across the entire fogged region — not discrete light shaft beams. If the visual requirement is visible god rays penetrating through objects (trees, windows, clouds), Volumetric Fog with shadow integration (doc 20) is required. Directional inscattering is a convincing cheap approximation for open scenes where the sun is visible and uniform brightening in the sun direction is sufficient.

---

## Sky Atmosphere Integration

When both `SkyAtmosphere` and `ExponentialHeightFog` are active, the aerial perspective computed from the Sky Atmosphere LUTs (doc 09) can be incorporated into the height fog calculation.

Controlled by `r.SkyAtmosphere.HeightFogContribution`:
- **Enabled (1):** Height fog uses aerial perspective data from the Sky Atmosphere LUTs for distant geometry, producing haze that physically matches the sky's atmospheric model — correct color shift, correct luminance behavior at the horizon
- **Disabled (0):** Height fog uses only its own `FogInscatteringColor` — simpler but may not match the sky atmosphere's coloring at the horizon

This integration is most visually significant in open worlds where distant mountains or terrain need to match the sky atmosphere's aerial perspective. Without it, terrain fog color and sky atmosphere horizon color can diverge noticeably.

---

## StartDistance and FogMaxOpacity — Authoring Properties

**StartDistance** defines the camera-space distance before fog begins accumulating. Objects closer than this distance receive no fog, regardless of fog density. Common use cases:
- Preventing fog from obscuring the player character or nearby props
- Keeping foreground detail clear while applying atmosphere to the distance
- Matching fog start to a level's near clipping geometry

**FogMaxOpacity** caps the maximum fog opacity value (0–1). At 1.0, fog becomes completely opaque at sufficient distance. At 0.8, a faint silhouette of distant geometry always remains visible. Used to:
- Prevent complete geometry concealment at extreme distances
- Keep depth readable through heavy fog
- Create stylized fog effects where distance is always legible

> [!WARNING]
> **FogDensity values that are too high can cause fog to affect nearby objects the player is supposed to clearly see.** A common mistake is setting `FogDensity` high to achieve a thick distant atmosphere, without configuring an appropriate `StartDistance` to protect nearby content. The exponential function at high density drops transmittance rapidly with distance — even 100 units from the camera may be heavily fogged at certain density values. Always profile fog density with a scene camera at gameplay positions, not from the editor overview.

---

## Translucency and Height Fog

Height fog is applied to translucent geometry as part of the translucency rendering pass — translucent surfaces accumulate fog based on their world-space depth and altitude. This is handled automatically when the translucent material does not opt out of fog.

For translucent geometry that should not receive fog (UI elements, certain particle effects), the material's `Apply Fogging` property can be disabled.

> [!NOTE]
> **Particle systems in fog require attention to material fog settings.** Dense particle effects very close to the camera may appear incorrectly fogged if their world-space depth puts them in the fog region. The `StartDistance` property helps, but for particle systems that span a wide depth range, per-material fog control may be needed.

---

## Execution Model

ExponentialHeightFog is a **fullscreen pixel shader pass**:

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the fog pass; binds SceneDepth and SceneColor |
| **GPU Pixel Shader** | Reconstructs world position from depth; evaluates exponential fog integral analytically; applies inscattering and attenuation to SceneColor |

**What it reads:**
- SceneDepth — for distance and world position reconstruction
- SceneColor — to apply fog attenuation and add inscattering
- Aerial Perspective LUT — if Sky Atmosphere integration enabled
- Directional light direction — for directional inscattering cone

**Cost profile:** Primarily **bandwidth-bound** — the shader itself is mathematically simple. The bottleneck is reading SceneDepth and writing SceneColor at full resolution. The analytical math adds minimal ALU cost on top of the bandwidth requirement.

---

## What Data This Pass Produces

| Output | Consumers |
|--------|-----------|
| Fog-composited SceneColor | Translucency, post-processing, TSR |

This pass modifies SceneColor in-place — geometry pixels are attenuated by transmittance and brightened by inscattering. Sky pixels (at far depth) receive full inscattering, producing the fog-colored horizon and distant atmosphere.

---

## Why This Can Be Expensive

This pass is rarely a primary performance concern — the analytical math is cheap. When it does appear meaningful in a profile:

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High render resolution | Fullscreen pass scales exactly with pixel count | Scales with `r.ScreenPercentage` — no pass-specific control |
| Directional inscattering enabled | Per-pixel cone evaluation adds ALU cost | Disable if not visually needed; use Volumetric Fog if god rays are required |
| Multiple active views | Each view runs full pass independently | Disable fog on scene captures where atmospheric accuracy is unnecessary |
| Very high `FogDensity` | No direct GPU cost increase, but may require adjusting `FogCutoffDistance` to cull geometry correctly | Author issue rather than GPU issue |

---

## Key Systems and Components

### Analytical Ray Integral
The mathematical core of the system. Given camera position, ray direction, and scene depth, the fog transmittance is computed by integrating the exponential density function along the ray segment from the camera to the surface. Because the exponential density function integrates analytically, this is O(1) — constant cost regardless of distance or density value. This is what makes height fog so cheap compared to any volumetric approach.

### Fog Inscattering
The additive light component — the color the fog itself appears to glow with. Physically, inscattering represents light from the environment scattering into the camera along the ray. For the analytical system, this is a tunable color and intensity approximating ambient and directional light contributions to the fog medium. Not physically accurate but authoritatively controllable.

### Second Fog Layer
A completely independent fog layer with separate altitude, density, and falloff. Computed simultaneously with the primary layer at no additional per-pass overhead. The final fog is the product of both layers' transmittances and the sum of both layers' inscattering contributions.

### Sky Atmosphere Aerial Perspective Contribution
When enabled, the Aerial Perspective LUT (from doc 09) is sampled for distant pixels, replacing the height fog's own inscattering calculation with the physically accurate scattering result from the sky atmosphere model. Ensures consistent haze appearance between the fog system and the sky background at the horizon.

### FogCutoffDistance
A maximum fog application distance beyond which fog stops being applied. Geometry beyond this distance receives no additional fogging. Can be used to disable fog entirely beyond a certain point — relevant for games using distant HLOD geometry where fogging at extreme distances is handled by artist-authored color rather than runtime fog.

---

## 📋 Reader Notes

> [!NOTE]
> **ExponentialHeightFog and Volumetric Fog are not mutually exclusive — they serve different visual purposes and often coexist.** Height Fog provides cheap depth attenuation and color blending for the entire scene. Volumetric Fog provides physically lit scattering and god rays in specific regions. A common production configuration is Height Fog for the global atmosphere with Volumetric Fog enabled only in specific interior or dramatically lit areas.

> [!NOTE]
> **The `ExponentialHeightFog` actor is required for Volumetric Fog to function.** Volumetric Fog is a property on the Height Fog actor — there is no standalone Volumetric Fog actor. Even if the height fog parameters are set to minimal density, the actor must be present and `Volumetric Fog` must be checked on it for the voxel-based fog system to activate. Removing the Height Fog actor disables both analytical fog and Volumetric Fog simultaneously.

> [!NOTE]
> **Height fog does not know about shadow casters.** Directional inscattering produces uniform brightening in the sun direction regardless of whether the sun is blocked by geometry or clouds. For fog that darkens correctly in shadow regions (interior spaces, canyons, under dense foliage), Volumetric Fog with VSM shadow integration is the correct tool.

> [!NOTE]
> **Fog can be a powerful tool for performance optimization beyond its visual purpose.** Objects completely obscured by dense fog can be culled — their geometry is invisible to the player but still costs GPU time to render. Setting `FogCutoffDistance` to match the point where fog becomes fully opaque, and then limiting placed geometry to within that distance, eliminates draw calls and shading cost for objects the player can never see. This is a level design and streaming distance decision, not a rendering configuration.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `ExponentialHeightFog` | Total fog pass cost |
| `RenderFog` | Variant name in some engine versions |

> [!TIP]
> If this pass appears notable in a profile, check two things: first, whether directional inscattering is enabled (toggle `r.Fog.DirectionalInscattering` to see its contribution); second, whether the pass is being multiplied by active scene captures. The base pass without directional inscattering at 1080p is typically under 0.1ms — any value significantly above that warrants investigation.

### Debug Visualizations

```
showflag.Fog 0          // Toggles fog rendering entirely — useful to isolate fog's
                         // visual contribution and confirm the pass is the source
                         // of a particular depth-based visual issue

r.Fog 0                 // CVar equivalent — disables fog system globally
```

### Stat Commands

```
stat GPU    // Overall GPU breakdown — ExponentialHeightFog appears as a small block
```

### Useful Console Variables

```
// Master controls
r.Fog 0/1                                   // Master toggle for the fog system
r.Fog.DirectionalInscattering 0/1           // Toggle directional inscattering component
                                             // Isolate to measure its cost contribution

// Sky atmosphere integration
r.SkyAtmosphere.HeightFogContribution 0/1   // Toggle sky atmosphere aerial perspective
                                             // integration into height fog calculation
                                             // 1 = physically matched haze with sky atmosphere
                                             // 0 = height fog uses its own InscatteringColor only

// Translucency interaction
r.Fog.DirectionalInscatteringInTranslucency 0/1  // Toggle directional inscattering on
                                                   // translucent surfaces specifically
```

---

## Optimization Levers

### Directional Inscattering
- Disable `r.Fog.DirectionalInscattering 0` on lower-end platforms where the subtle sun-directional brightening is not a key visual requirement — this removes the only non-trivial ALU cost in the pass

### FogCutoffDistance as a Content Tool
- Set `FogCutoffDistance` to match or slightly exceed the distance where fog becomes fully opaque — prevents the pass from processing geometry the player can never see through the fog
- Align this with streaming and draw distance settings — geometry that would be completely fogged shouldn't be drawn at all

### Fog as a Cull Tool
- Design level geometry placement to stop at the distance where fog becomes opaque — objects beyond full-opacity fog are invisible and should not be rendered
- Use `FogMaxOpacity` to control whether distant objects are completely hidden (1.0) or partially visible (< 1.0), affecting how aggressively the fog can be used to justify culling decisions

### Scene Captures
- Disable fog contribution in scene captures where atmospheric accuracy is not needed — the analytical pass is cheap but multiplies with every active capture
- For captures used as reflection sources in interior scenes, disabling exterior fog avoids incorrect fog color in reflections

> [!WARNING]
> **Setting `FogDensity` very high to achieve artistic effects without adjusting `StartDistance` is one of the most common height fog authoring mistakes.** High density causes fog to visibly affect geometry even close to the camera. If the intent is a thick foggy atmosphere at distance while keeping near content clear, `StartDistance` must be set to an appropriate near clip value. Profile fog appearance specifically from player-camera positions at ground level — editor overview cameras at typical height see fog very differently from player view.

---

## Mental Model

Think of ExponentialHeightFog as:

> *"For every pixel in the frame, compute how much air the light had to travel through to reach the camera — accounting for the fact that air is denser near the ground and thinner at altitude — then dim the scene color by that amount and add the glow color of the air itself."*

The efficiency comes from the word "compute" rather than "simulate." Unlike Volumetric Fog which simulates light behavior step-by-step through a grid, height fog solves the exact answer from a mathematical formula in a single calculation. The trade-off is no shadows, no per-light response, no god rays — but for scenes where the goal is atmospheric depth and color grading rather than physically accurate light scattering, that trade-off is almost always worth it.

The key authoring insight is that **height fog is a depth and altitude effect, not a distance effect.** Objects at the same depth but different altitudes receive different amounts of fog. A mountain peak at 10km has almost no fog; a valley floor at 10km may be completely fogged out. This altitude sensitivity is the system's most powerful authoring tool — and the most common source of unexpected results when artists expect uniform depth-based fog.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Volumetric Fog (doc 20) | Sibling system — voxel-based, physically lit; Height Fog's density can feed its grid |
| SkyAtmosphereLUTs (doc 09) | Aerial perspective LUT optionally integrated for physically consistent haze |
| SkyAtmosphere Render (doc 25) | Sky coloring at the horizon is complementary to fog color — should be artistically consistent |
| Virtual Shadow Maps | Height fog receives no shadow interaction — use Volumetric Fog for shadowed fog |
| Translucency | Translucent materials receive height fog contribution if `Apply Fogging` is enabled |
| ExponentialHeightFog actor | The UE5 actor whose properties drive this entire pass |
| `r.Fog` | Master CVar toggle — disabling skips this pass entirely |

---

## Red Flags to Watch For

- **`ExponentialHeightFog` > 0.3ms** → check whether directional inscattering is enabled; also check active view count for capture multiplication; base pass this expensive is unusual
- **Fog affecting nearby gameplay-critical objects** → `StartDistance` too low or `FogDensity` too high; profile from player camera positions at ground level
- **Horizon fog color doesn't match sky atmosphere** → `r.SkyAtmosphere.HeightFogContribution` may be 0; enable for physically consistent integration
- **Fog appears uniform regardless of altitude** → `FogHeightFalloff` too low — increase to tighten the fog band and produce altitude-sensitive attenuation
- **Directional inscattering not matching sun direction** → ensure the directional light driving inscattering has correct orientation and the fog actor is referencing the correct light
- **Fog present in scene captures producing incorrect environment reflection color** → disable fog on captures used for interior or environment reflections
- **Geometry visibly beyond intended fog range** → `FogCutoffDistance` not set; objects beyond full-opacity fog wasting render cost — align cutoff with streaming distances
- **"Volumetric Fog" enabled on Height Fog actor but no god rays visible** → Volumetric Fog voxel system running (doc 20) but VSM shadow integration may not be configured; check directional light `Volumetric Scattering Intensity`

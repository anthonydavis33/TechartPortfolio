---
tags:
  - rendering-pipeline
  - sky-atmosphere
  - lut
  - environment-lighting
  - performance
  - ue5
---

# Unreal Engine 5 Rendering Pipeline – Sky Atmosphere LUTs

> Stage: **Sky Atmosphere LUTs**  
> Phase: Environment Lighting Precompute  
> Purpose: Precompute atmospheric scattering lookup tables for fast sky, fog, aerial perspective, and cloud lighting rendering  
> Pipeline Position: Early in frame, before sky rendering, volumetric fog, and Lumen sky integration

---

## What This Stage Does

This stage builds **four lookup tables (LUTs)** that encode the physical behavior of the atmosphere — how light scatters, absorbs, and transmits through it at different angles, altitudes, and distances. These tables are precomputed via GPU compute shaders so that sky rendering, height fog, and aerial perspective can sample small textures rather than evaluating expensive scattering integrals per pixel.

The four LUTs are not equivalent in cost, rebuild frequency, or scope. Understanding each individually is essential for diagnosing rebuild behavior and cost.

---

## The Four LUTs — Individual Breakdown

### 1. Transmittance LUT
**What it stores:** How much sunlight reaches a given point in the atmosphere after traveling through it — accounting for absorption and out-scattering. Stored as a 2D texture indexed by view height and sun zenith angle.

**Resolution:** 256×64 (default)  
**Rebuild trigger:** Atmosphere parameters only (planet radius, layer density, scattering coefficients). Not camera-dependent.  
**Consumers:** All other LUT builds read this first. Sky rendering, height fog, cloud lighting.

**Key property:** This is the most stable LUT — it only changes when atmosphere *composition* changes, not when the camera or sun moves. In a static atmosphere, it may never rebuild after the first frame.

### 2. Multi-Scattering LUT
**What it stores:** The contribution of second-order and higher light bounces within the atmosphere — the glow and brightening that makes real skies look soft rather than hard. Stored as a 2D texture.

**Resolution:** 32×32 (default)  
**Rebuild trigger:** Atmosphere parameters and sun direction. Not camera-dependent.  
**Consumers:** Sky View LUT build (as input), sky rendering.

**Key property:** View-independent. One build serves all views this frame. Cost is low due to small resolution, but it depends on the Transmittance LUT being current.

### 3. Sky View LUT
**What it stores:** The sky color as seen from the camera's current altitude, in all directions. Essentially a pre-integrated panoramic sky sample for the current camera height. Stored as a 2D texture representing the sky hemisphere.

**Resolution:** 192×108 (default)  
**Rebuild trigger:** Camera altitude change, sun direction change, atmosphere parameter change.  
**Consumers:** Sky rendering (skybox), sky light capture updates.

**Key property:** Camera altitude dependent but not camera position dependent — cameras at the same altitude share the same Sky View LUT. In gameplay at ground level, this LUT is very stable.

### 4. Aerial Perspective LUT
**What it stores:** Per-pixel atmospheric depth haze — how much scattering and extinction accumulates between the camera and each depth slice in the scene. A 3D volume texture (width × height × depth slices) that encodes the atmospheric color and transmittance at different screen positions and scene depths.

**Resolution:** 32×32×16 depth slices (default, configurable)  
**Rebuild trigger:** Camera position change, sun direction change, atmosphere parameter change.  
**Consumers:** Translucent material aerial perspective, height fog, volumetric clouds, distant mesh fogging.

**Key property:** This is the **most expensive LUT to build and the most frequently rebuilt**. It is fully 3D and camera-position-dependent — it changes whenever the camera moves. In any game with a moving camera, this LUT rebuilds every single frame.

> [!NOTE]
> **The Aerial Perspective LUT is the dominant cost in this stage for any scene with a moving camera.** The other three LUTs are relatively stable. When profiling sky atmosphere LUT cost, the Aerial Perspective LUT is the first thing to investigate. Its rebuild is not a malfunction — it is by design, since atmospheric haze changes with every camera position.

---

## Per-Scene vs Per-View Rebuild Behavior

This is the most important caching distinction in this pass and is commonly misunderstood.

| LUT | Scope | Rebuilds When |
|-----|-------|--------------|
| Transmittance | Per-atmosphere (shared, all views) | Atmosphere parameters change |
| Multi-Scattering | Per-atmosphere (shared, all views) | Atmosphere parameters or sun direction change |
| Sky View | Per-camera altitude (shared within altitude band) | Camera altitude, sun direction, or atmosphere changes |
| Aerial Perspective | Per-view (camera position dependent) | Camera moves, sun direction, or atmosphere changes |

> [!WARNING]
> **The Aerial Perspective LUT is per-view — each active scene capture actor with sky atmosphere enabled builds its own.** Unlike Transmittance and Multi-Scattering which are shared, the Aerial Perspective LUT cannot be reused across views. Three active scene captures add three independent Aerial Perspective LUT builds per frame. This is the same per-view multiplication cost pattern seen in HZB, light grid, and Nanite emit.

---

## Why This Stage Exists

Evaluating physically-based atmospheric scattering per-pixel at full screen resolution would require solving multi-dimensional scattering integrals for every pixel every frame — completely unaffordable at real-time rates. The LUT approach precomputes these integrals once (or rarely) at low resolution, stores the results as small textures, and allows all rendering passes to sample from them cheaply.

The trade-off is LUT resolution precision vs rebuild cost. Lower resolution LUTs are cheaper to build but may show banding on gradients. Higher resolution LUTs are more expensive but produce smoother results. Most of UE5's default resolutions are chosen to be imperceptible at typical sky compositions.

---

## Execution Model

All four LUTs are built via **GPU compute shaders** — no CPU render thread per-pixel work. The CPU schedules the dispatches; the GPU executes the scattering integrals entirely in compute.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules LUT build dispatches; checks dirty flags to determine which LUTs need rebuilding |
| **GPU Compute** | Executes scattering integral compute shaders for each LUT that is dirty |

The dirty flag system is what enables caching — only LUTs whose inputs have changed are rebuilt. Understanding which inputs map to which LUTs (see table above) tells you exactly when each LUT rebuilds.

---

## What Data It Produces

| LUT | Format | Primary Consumers |
|-----|--------|------------------|
| Transmittance LUT | 2D RG11B10F | Multi-Scattering LUT build, sky rendering, cloud lighting |
| Multi-Scattering LUT | 2D RG11B10F | Sky View LUT build, sky rendering |
| Sky View LUT | 2D RG11B10F | Sky background rendering, sky light capture |
| Aerial Perspective LUT | 3D volume RGBA16F | Height fog, translucent materials, volumetric clouds, distant mesh fogging |

**Consumed downstream by:**
- **Sky rendering pass** — samples Sky View LUT for skybox color
- **Volumetric clouds** — samples all LUTs for cloud-atmosphere interaction and aerial perspective
- **Height fog** — samples Aerial Perspective LUT for depth-based fogging
- **Translucent material aerial perspective** — samples Aerial Perspective LUT per fragment
- **Lumen sky lighting** — Transmittance and sky color feeds into Lumen's sky contribution

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Continuous atmosphere parameter animation | All affected LUTs rebuild every frame — no caching | Step time-of-day updates in intervals; avoid per-frame parameter changes |
| Camera always moving (Aerial Perspective LUT) | Aerial Perspective LUT is camera-position-dependent; always dirty | Expected behavior; reduce resolution via CVars if cost is high |
| High LUT resolution settings | More compute work per rebuild | Reduce resolution CVars per platform (see below) |
| Multiple Sky Atmosphere components | Each component builds its own full LUT set | Use exactly one Sky Atmosphere component per level |
| Many active scene captures | Each capture with sky atmosphere builds its own Aerial Perspective LUT | Disable sky atmosphere on scene captures or throttle their update rate |
| Volumetric clouds enabled | Cloud lighting requires denser LUT sampling | Reduce cloud tracing quality or aerial perspective LUT resolution |

> [!WARNING]
> **Continuously animating any atmosphere parameter — even slightly — forces the relevant LUTs to be marked dirty and rebuilt every frame.** A time-of-day system that updates sun direction every tick will rebuild Multi-Scattering, Sky View, and Aerial Perspective LUTs every frame with no caching benefit. Implement time-of-day updates using a minimum angular step threshold — only update when the sun has moved more than X degrees — to allow LUT caching between updates.

> [!WARNING]
> **Multiple SkyAtmosphere components in the same level is almost always an error.** Each component builds a complete independent set of all four LUTs. There is no valid rendering reason to have more than one active Sky Atmosphere component simultaneously. Check the World Outliner if this stage appears unexpectedly expensive — duplicate or lingering Sky Atmosphere actors from level streaming or prefab instancing are a common source.

---

## Key Systems and Components

### Dirty Flag Caching System
The mechanism that makes LUT caching work. Each LUT tracks whether its inputs have changed since the last build. If none of its inputs are dirty, the LUT is reused from the previous frame at zero build cost. The Aerial Perspective LUT is almost always dirty in a game with a moving camera; the Transmittance LUT may stay clean for hundreds of frames at a time in a static atmosphere.

### Transmittance + Multi-Scattering Dependency Chain
The four LUTs are built in dependency order: Transmittance first, Multi-Scattering second (reads Transmittance), Sky View third (reads both), Aerial Perspective last (reads all three). A change to atmosphere base parameters (planet radius, scattering coefficients) invalidates all four in sequence. A sun direction change skips Transmittance and starts the chain from Multi-Scattering.

### Aerial Perspective Volume
The 3D LUT — the most architecturally interesting of the four. It is a frustum-aligned volume texture where each voxel stores the integrated scattering and transmittance from the camera to that depth slice. Distant voxels encode heavy atmospheric haze; near voxels encode clear air. Materials and fog passes sample this volume to add distance-based atmospheric coloring without per-pixel ray marching.

### `r.SkyAtmosphere.FastSkyLUT`
The primary quality/performance trade-off CVar for sky rendering. When enabled, sky rendering samples the precomputed Sky View LUT directly rather than evaluating scattering at full quality per pixel. Disabling it forces per-pixel scattering evaluation — higher quality, significantly higher cost. In almost all production scenarios, `FastSkyLUT` should remain enabled.

---

## 📋 Reader Notes

> [!NOTE]
> **This pass is normally very cheap — often under 0.2ms.** The LUT textures are small and the caching system is effective for stable atmospheres. It only becomes a concern in scenes with aggressive time-of-day animation, many scene captures, or atmosphere parameters being driven from Blueprint every tick. If this pass is consistently expensive, the answer is almost always about rebuild frequency, not LUT resolution.

> [!NOTE]
> **Volumetric clouds significantly increase the value of these LUTs but also increase the cost of their consumers.** Clouds sample the Aerial Perspective and Transmittance LUTs extensively for physically-correct cloud-atmosphere interaction. If volumetric clouds are enabled and sky atmosphere performance is a concern, profile cloud sampling cost separately from LUT build cost — they are distinct problems with different solutions.

> [!NOTE]
> **Sky Atmosphere is a component placed in the level, not a project setting.** Its parameters are driven by the `SkyAtmosphereComponent` on a `SkyAtmosphere` actor. Ensure that any Blueprint or sequencer animation driving sky parameters is audited for update frequency before shipping. A Sequencer track animating `Sun Disk Intensity` even subtly will mark LUTs dirty every frame the track plays.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `SkyAtmosphereLUTs` | Total LUT build cost this frame — includes all dirty LUT rebuilds |
| `BuildSkyAtmosphereLUTs` | Variant name depending on engine version |

> [!TIP]
> If sky atmosphere LUT cost spikes inconsistently, it is almost certainly a rebuild frequency problem rather than a resolution problem. Add a `stat GPU` overlay and watch `SkyAtmosphere` cost frame-by-frame while moving the camera and animating time-of-day separately. If cost is high only when parameters change, the fix is reducing update frequency. If cost is consistently high regardless of changes, the fix is reducing LUT resolution CVars.

### Stat Commands

```
stat GPU           // Overall GPU breakdown — SkyAtmosphereLUTs appears as a block here
```

### Debug Commands

```
r.SkyAtmosphere.Debug 1    // Enables atmosphere debug output — logs LUT rebuild events
                            // and parameter dirty state to the output log.
                            // Use to confirm which LUTs are rebuilding and why.
```

### Useful Console Variables

```
r.SkyAtmosphere.FastSkyLUT 1/0              // Sample precomputed Sky View LUT (1, default)
                                             // vs per-pixel scattering evaluation (0, expensive).
                                             // Should almost always remain 1 in production.

r.SkyAtmosphere.AerialPerspectiveLUT.Depth  // Depth slice count for Aerial Perspective LUT.
                                             // Reduce on lower-end platforms to cut build cost.
                                             // Default 16; 8 is acceptable for most scenarios.

r.SkyAtmosphere.TransmittanceLUT.Resolution // Transmittance LUT resolution multiplier.
                                             // Reduce if banding is acceptable on horizon gradients.

r.SkyAtmosphere.MultiScatteringLUT.Resolution // Multi-Scattering LUT resolution multiplier.
```

---

## Optimization Levers

### Time-of-Day Systems
- Implement a minimum angular change threshold before updating sun direction — avoids rebuilding LUTs every tick for imperceptible movement
- During cinematics with a fixed sky, lock atmosphere parameters entirely to prevent any rebuild
- Use sequencer sparingly for atmosphere parameter animation — every animated parameter marks the relevant LUTs dirty for every frame the sequence plays

### Rendering Configuration
- Keep `r.SkyAtmosphere.FastSkyLUT 1` enabled at all times in production — per-pixel scattering evaluation is rarely justified
- Reduce `r.SkyAtmosphere.AerialPerspectiveLUT.Depth` on lower-end targets — 8 depth slices is sufficient for most outdoor scenes
- Reduce Aerial Perspective LUT resolution on platforms where atmospheric precision is less critical

### Level and Component Setup
- Use exactly one `SkyAtmosphere` actor per streaming level — audit for duplicates if the pass appears unexpectedly expensive
- Disable sky atmosphere contribution on scene captures where atmospheric accuracy is not needed
- Throttle scene capture update rates to reduce per-view Aerial Perspective LUT rebuilds

---

## Mental Model

Think of Sky Atmosphere LUTs as:

> *"Solve the physics of the entire sky once at low resolution, store the answer in a few small textures, and let every other pass look up the answer cheaply for the rest of the frame."*

The efficiency of this system depends entirely on how often the "solve" step is triggered. A sky that never changes is essentially free after the first frame. A sky that animates every tick pays full solve cost every frame — and the caching system provides no benefit at all.

The key insight is that **atmospheric LUT cost is a design problem, not a rendering problem.** The GPU compute work per LUT is fixed and small. The problem is always rebuild frequency — how often the dirty flag gets set. Solving this at the content and gameplay system level (update thresholds, parameter animation discipline) is the only effective fix.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Sky Rendering Pass | Samples Sky View LUT for skybox color output |
| Volumetric Clouds | Samples all LUTs for cloud-atmosphere lighting and aerial perspective |
| Height Fog | Samples Aerial Perspective LUT for depth-based atmospheric haze |
| Lumen Sky Lighting | Uses atmosphere transmittance for sky contribution to indirect lighting |
| Sequencer / Blueprint | Common sources of per-frame atmosphere parameter changes — primary rebuild trigger in production |
| Scene Captures | Each active capture with sky atmosphere builds its own Aerial Perspective LUT |

---

## Red Flags to Watch For

- **`SkyAtmosphereLUTs` cost inconsistent frame-to-frame** → LUTs rebuilding on some frames but not others; trace to parameter animation or camera altitude transitions
- **Cost consistently high regardless of camera movement** → either high LUT resolution settings or multiple Sky Atmosphere components active; check World Outliner for duplicates
- **Aerial Perspective LUT rebuilding on scene captures** → each capture builds independently; disable sky atmosphere on captures or throttle update frequency
- **Blueprint or Sequencer driving atmosphere parameters every tick** → marks LUTs dirty every frame; implement update threshold to restore caching
- **Banding visible on sky horizon or distant haze** → LUT resolution reduced too aggressively; increase `r.SkyAtmosphere.AerialPerspectiveLUT.Depth` or resolution multipliers
- **`r.SkyAtmosphere.FastSkyLUT 0` set in a project** → per-pixel scattering active; rarely justified; revert to 1 unless specific quality need is documented

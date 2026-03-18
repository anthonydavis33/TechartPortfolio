# Unreal Engine 5 Rendering Pipeline – FXSystemPreRender

`#niagara` `#particles` `#fx` `#rendering-pipeline` `#pre-render` `#gpu-compute` `#async-compute` `#performance` `#profiling` `#ue5` `#tech-art` `#simulation` `#threading`

> Stage: **FXSystemPreRender**  
> Phase: Pre-Render / Simulation Prep  
> Purpose: Prepare all FX systems before any rendering passes begin  
> Pipeline Position: After `InitViews`, before `BasePass`

---

## What This Stage Does

This stage prepares **all visual effects (FX)** systems before rendering starts.  
No pixels are drawn yet — this is simulation, data preparation, and GPU buffer setup.

Includes:
- Niagara systems (CPU & GPU simulation)
- Ribbon / trail geometry updates
- Sort key generation for translucent particles *(full depth sort + draw happens downstream in the Translucency pass)*
- View frustum culling of FX emitters based on world-space bounds
- Uploading particle instance data to GPU buffers (positions, velocities, colors, custom attributes)
- Dispatching GPU simulation compute shaders (can run on async compute queue)
- Ticking Niagara Data Interfaces (NDIs) that feed simulation inputs

This ensures all FX are in a valid, up-to-date state before render passes consume them.

---

## Why This Stage Exists

FX systems are:
- **Time-dependent** — simulation must advance by delta time each frame
- **GPU-driven** — structured buffers must be populated before draw calls are issued
- **View-dependent** — visibility and bounds checks require a valid view before culling can run
- **Potentially expensive** — thousands of particles across dozens of active systems

This stage ensures:
- Particle positions, velocities, sizes, colors, and custom attributes are current
- Emitters are culled or activated correctly per view
- GPU buffers are resident and ready for downstream rendering passes

---

## Threading Model

Understanding *which thread owns what* is essential for profiling this stage correctly.

| Thread | Responsibility |
|--------|---------------|
| **Game Thread** | `FNiagaraWorldManager::Tick()` — registers active systems, kicks off async CPU sim tasks |
| **Task Graph (Workers)** | CPU Niagara particle simulation runs in parallel worker tasks, not purely on the main thread |
| **Render Thread** | Issues GPU compute dispatches; populates `FNiagaraGPUInstanceCountManager` buffers |
| **Async Compute Queue** | GPU Niagara simulation can overlap with other render thread work if async compute is enabled |

> **Key insight:** CPU Niagara ticks via parallel tasks kicked from the game thread — so `stat Niagara` may *underreport* true cost if you're only looking at main-thread time. Check Unreal Insights task graph view to see worker thread load.

The game thread and render thread must **sync** at the end of this stage to guarantee simulation results are ready before draw commands consume them. This sync point is a common source of frame stalls.

---

## What Data It Produces

**GPU Resources Created / Updated:**
- Structured buffers containing particle instance data (position, velocity, color, lifetime, custom attributes)
- Indirect draw argument buffers for GPU-driven particle rendering
- GPU particle count buffers managed by `FNiagaraGPUInstanceCountManager`
- Sort key buffers for translucent particles *(consumed by the Translucency pass sort)*

**CPU-Side Results:**
- Per-emitter culling and visibility state
- Active system list passed to render thread

**Consumed downstream by:**
- **BasePass** — opaque FX meshes (mesh particles, ribbons)
- **Translucency passes** — sprite and mesh particles with translucent materials
- **Lumen** — emissive FX contribute to indirect lighting (expensive if high-density)
- **Velocity pass** — per-particle motion vectors for motion blur
- **Depth of Field** — particles respect CoC if materials are set up correctly

---

## Why This Can Be Expensive

| Issue | Why It Hurts | Mitigation |
|-------|-------------|------------|
| High GPU particle counts | Per-frame compute dispatch scales with particle count | Cap max particles per emitter; use Niagara Scalability Groups |
| CPU Niagara emitters | Parallel tasks still have overhead; sync cost at task completion | Migrate to GPU sim; use `Sim Target = GPU Compute` |
| Translucent particle sort | Depth sort is O(n log n) on GPU; runs every frame | Reduce translucent particle count; use `Sort Mode = None` where order is imperceptible |
| Too many unique Niagara materials | Breaks GPU batching; increases draw call count | Share base materials; use dynamic parameters instead of material variants |
| Particle collision (CPU) | Scene queries per particle, per frame | Use depth-buffer collision instead of full physics collision; reduce collision frequency |
| Particle collision (GPU) | Reads depth buffer every frame | Limit to hero FX only; use lower-res depth if project supports it |
| Dynamic bounds | `FNiagaraSystemInstance` recalculates world bounds every tick | Set fixed bounds on non-hero systems; only use dynamic bounds where precision is critical |
| Expensive Data Interfaces | NDIs that sample skeletal meshes, read render targets, or query physics | Cache NDI results; avoid per-particle skeletal mesh samples at high counts |
| Simulation Stages | Custom GPU compute stages run each tick; each stage is a full dispatch | Profile with `fx.Niagara.DumpNiagaraStageInfo`; combine stages where possible |

> **⚠️ Unbounded GPU particle counts can silently exhaust memory.** Without a max particle cap, a GPU sim emitter under stress (e.g. a looping spawn effect that isn't being properly deactivated) can grow until it hits GPU memory limits. This will not throw a clear error — it will manifest as hitches, corruption, or crashes on lower-end hardware. Always set a max particle count.

---

## Key Systems and Components

### FNiagaraWorldManager
The central UE5 class that owns all active `FNiagaraSystemInstance` objects in a world. It drives the top-level tick that kicks off CPU simulation tasks and coordinates render thread readback. If you're reading source, this is the entry point for this entire stage.

### FNiagaraGPUInstanceCountManager
Manages GPU-side particle count buffers. This is what allows indirect draw calls — the GPU reads counts from this buffer rather than requiring a CPU readback. Keeping this buffer coherent is part of what `FXSystemPreRender` is doing on the render thread.

### Niagara Data Interfaces (NDIs)
NDIs feed external data *into* Niagara simulations — skeletal mesh surfaces, audio spectrum data, collision scene queries, render target reads, etc. They tick as part of this stage and can be a hidden cost. A GPU simulation reading a skeletal mesh NDI at 10,000 particles is doing significant work here.

### Simulation Stages
A Niagara feature allowing custom compute shader passes to run *within* the GPU simulation loop (e.g. fluid simulation, neighbor searches, custom force fields). Each stage adds a compute dispatch. These appear in Unreal Insights under the GPU track as Niagara compute workloads.

> **⚠️ Simulation Stages have per-dispatch cost regardless of particle count.** An emitter with 10 particles and 3 Simulation Stages still dispatches 3 compute passes per frame. Don't add Simulation Stages to effects that don't genuinely need them.

---

## 📋 Reader Notes

> **Engine Version:** This document targets **UE5.1+**. Niagara is treated as the primary FX system throughout. Cascade is considered legacy — if your project still uses Cascade emitters, `stat FX` will surface them, but most of the threading and buffer concepts here do not apply to them.

> **Audience:** This doc assumes familiarity with Unreal's render thread / game thread split and basic Niagara authoring. If the threading model section feels unfamiliar, read the Unreal Engine Parallel Rendering Overview documentation first.

> **Platform Variance:** Async compute scheduling behaves differently across platforms. On PC (DX12/Vulkan), overlap is driver and hardware dependent. On console, async compute queues are more predictable and this stage is often where the most platform-specific tuning happens. PC profiling results may not translate directly to console budgets.

> **Threshold Calibration:** The `> 1ms` flag in Red Flags assumes a **60fps frame budget (~16.6ms total)**. Adjust thresholds for your target framerate and platform.

> **CVar Stability:** Console variable names can change between minor engine versions. Always verify current names in the editor's CVar browser (open console with `~`, type the prefix) or in engine source before using them in automation or config files.

---

## How to Debug / Profile

### Unreal Insights
Key named events to look for in the **Game Thread** and **Render Thread** tracks:

| Event | What It Tells You |
|-------|------------------|
| `FXSystemPreRender` | Total stage time on render thread |
| `NiagaraSimulate` | CPU simulation task time |
| `NiagaraGPUCompute` | Render thread GPU dispatch cost |
| `NiagaraWorldManagerTick` | Game thread orchestration cost |
| `NiagaraUpdateInstanceData` | Time spent updating GPU instance buffers |

> Also check the **Task Graph** view — CPU Niagara sim tasks will appear on worker threads, not the main thread.

> In the **GPU track**, Niagara compute dispatches appear directly under this stage as compute workloads. This is distinct from particle *rendering* cost, which appears later under translucency. Measure both separately — a system can be cheap to simulate but expensive to draw, or vice versa.

### Stat Commands

```
stat Niagara          // Overview: tick time, active systems, emitter/particle counts
stat NiagaraVerbose   // Per-system breakdown — identifies expensive individual systems
stat FX               // Legacy Cascade stats (if any Cascade systems still in use)
stat GPU              // GPU frame breakdown; shows Niagara compute under "Particle Simulation"
```

### Useful Console Variables for Debugging

```
fx.Niagara.AllowGPUParticles 1/0          // Toggle GPU sim globally to isolate cost
fx.Niagara.GPUSorting 1/0                 // Toggle GPU particle sorting
fx.Niagara.QualityLevel [0-3]             // Force a scalability level to test
fx.Niagara.MaxGPUParticlesSpawnPerFrame   // Cap spawn rate for stress testing
fx.Niagara.DumpNiagaraStageInfo           // Log active simulation stages per system
r.Niagara.GPUParticles.OverlapComputeAndDraw  // Toggle async compute overlap
```

---

## Optimization Levers

### Niagara Authoring
- Reduce spawn counts; use Niagara Scalability Groups to scale with platform/quality settings
- Prefer `Sim Target = GPU Compute` for high-count emitters

> **⚠️ CPU → GPU sim migration is not always a win.** GPU simulation has fixed per-dispatch overhead. Migrating a CPU emitter with fewer than ~500 particles to GPU sim can *increase* frame cost. Profile before and after.

- Use **fixed bounds** — dynamic bounds recalculate every frame and block tight culling

> **⚠️ Fixed bounds that are too small will cause incorrect culling.** If you set fixed bounds conservatively and the effect exceeds them at runtime, the emitter will be culled even when clearly visible on screen. Always validate fixed bounds against the effect's real-world scale range.

- Add **Niagara LODs** (Significance-based) to reduce simulation fidelity at distance
- Reduce collision complexity — prefer depth-buffer collision over CPU scene queries
- Limit expensive Data Interfaces to hero effects only
- Avoid spawning and destroying `UNiagaraComponent` every frame — use pooling (`UNiagaraComponent::PoolingMethod`)
- Set `Sort Mode = None` on emitters where draw order isn't visually meaningful
- Combine multiple low-particle emitters into one higher-count emitter where possible

### Rendering & Project
- Reduce translucent particle overdraw — stack cost compounds per layer
- Use `r.SeparateTranslucency 0` on lower-end targets to reduce translucency pass overhead (tradeoff: affects DoF interaction)

> **⚠️ `r.SeparateTranslucency 0` has visual side effects.** Disabling separate translucency affects how Depth of Field interacts with translucent particles — they will no longer be excluded from the DoF blur. Test visually in representative scenes before shipping with this setting.

- Disable FX systems when off-screen using significance handlers or `UNiagaraComponent::SetPaused`
- Avoid `SpawnSystemAtLocation` in hot paths — prefer pooled components

> **⚠️ `SpawnSystemAtLocation` allocates a new component every call.** If called in a tick or a frequently-fired event, this bypasses pooling, causes garbage collection pressure, and can produce cascading hitches. Use `UNiagaraFunctionLibrary::SpawnSystemAtLocation` only for fire-and-forget one-shots; use a pooled component for anything recurring.

- Limit GPU Simulation Stages to effects where the visual return justifies the compute cost

---

## Mental Model

Think of **FXSystemPreRender** as:

> *"Every active particle system in the world advances its simulation, packs its results into GPU buffers, and tells the renderer exactly what to draw — before a single pixel is touched."*

This stage is a **prerequisite gate**: if it stalls, every subsequent rendering pass is delayed. A frame that's expensive here is expensive *before* geometry, shadows, or lighting even begin.

The key architectural insight is the **two-thread handoff**: the game thread ticks and manages systems, the render thread issues GPU work and owns the buffers. The sync between them is the fragile point — a slow CPU sim blocks the render thread from starting GPU work on time.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| Niagara (CPU & GPU) | Primary FX system being simulated |
| `FNiagaraWorldManager` | Owns and orchestrates all active Niagara instances |
| Translucency Pass | Consumes sort buffers; renders translucent particles |
| Lumen | Emissive FX feed into Lumen radiance cache if enabled |
| Velocity Pass | Per-particle motion vectors for motion blur |
| Async Compute | GPU Niagara sim can overlap with other render work |
| Niagara Significance Manager | Drives LOD and culling decisions feeding into this stage |

---

## Red Flags to Watch For

- **`FXSystemPreRender` > 1ms** on render thread → investigate with `stat NiagaraVerbose`
- **CPU Niagara systems with > ~2,000 particles** in gameplay-critical scenes → migrate to GPU sim
- **Translucent emitters with `Sort Mode = View Depth`** and high particle counts → profile sort cost specifically
- **`NiagaraWorldManagerTick` stalls on game thread** → check for synchronous NDI reads or dynamic bounds on many systems
- **GPU sim particle count unbounded** (no max particle limit set) → can silently scale to millions under stress
- **FX spawning via `SpawnSystemAtLocation` every frame** → object pool is not being used; GC pressure compounds the issue
- **Simulation Stages on non-hero effects** → each stage is a full compute dispatch regardless of particle count
- **Skeletal mesh NDI sampling at high particle counts** → extremely expensive; cache the sample or reduce frequency

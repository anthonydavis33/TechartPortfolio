---
tags:
  - nanite
  - lod
  - hlod
  - instancing
---

# Unreal Engine 5 Rendering Pipeline – BuildRenderingCommandsDeferred / CullInstances

> Stage: **BuildRenderingCommandsDeferred / CullInstances (Generic)**  
> Phase: Pre-Render / Visibility & Draw Command Setup  
> Purpose: Gather all renderable objects, determine visibility, and build GPU draw command lists  
> Pipeline Position: After `InitViews` setup, before `PrePass` and `BasePass`

---

## What This Stage Does

This stage determines **what will be drawn this frame** and **how it will be drawn**.

Unreal:
- Walks the scene graph and finds all renderable primitives (meshes, instances, FX meshes, actors)
- Performs multi-layered visibility determination (frustum, distance, occlusion, HLOD)
- Selects LOD levels per object per view
- Batches instances (ISM / HISMC) into indirect draw calls
- Builds or retrieves cached draw command lists for the GPU
- Builds Nanite cluster visibility lists (separate path from traditional meshes)
- Gathers dynamic mesh elements for objects that can't use cached commands

No pixels are drawn yet — this stage prepares the render graph that all subsequent passes consume.

---

## Why This Stage Exists

The GPU can only draw what Unreal explicitly submits to it. Without this stage there is no filtering, no batching, and no LOD — the GPU would be asked to draw everything in the scene at full detail every frame.

This stage:
- Prevents drawing off-screen or irrelevant objects
- Reduces draw calls through instancing and command batching
- Selects proper LODs to reduce geometry cost
- Organizes draw calls by Pipeline State Object (PSO) to minimize GPU state changes
- Sets up all downstream passes: PrePass, BasePass, Shadows, Nanite, Velocity

This is one of the most **CPU-sensitive** stages in the renderer. A scene that is GPU-bound can easily become CPU-bound here if it is authored poorly.

---

## Threading Model

This stage is heavily parallelized. Understanding the thread split is essential for reading profiles correctly.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Drives `InitViews`; owns the top-level visibility and relevance pass |
| **Task Graph (Workers)** | `FRelevancePacket` tasks run in parallel — each packet processes a batch of primitives for visibility and relevance |
| **Render Thread** | Collects results, builds final draw command lists, dispatches to RHI |

> [!NOTE]
> The relevance gathering pass (`ComputeRelevance`) is one of the most parallelized sections of the entire renderer. If you see many short worker tasks in Unreal Insights around `InitViews`, this is expected — it is the relevance packets running. The bottleneck is usually the number of primitives, not the thread count.

---

## Static vs Dynamic Draw Command Paths

This is the most important conceptual distinction in this stage.

**Static Draw Commands (cached)**
- Built once when a mesh is first added to the scene
- Reused every frame with no rebuild cost
- Used by: static meshes with static materials, Nanite geometry, ISM instances
- Stored in `FCachedMeshDrawCommands`

**Dynamic Draw Commands (rebuilt every frame)**
- Rebuilt every frame via `GatherDynamicMeshElements`
- Used by: skeletal meshes, procedural meshes, anything whose state changes per-frame
- Significantly more expensive — every dynamic primitive pays a CPU cost every frame

> [!WARNING]
> **Runtime changes to static meshes silently push them onto the dynamic path.** Toggling visibility, swapping materials, or changing parameters in ways that invalidate the cached draw command will force a full rebuild every frame for that primitive. This is a common source of unexpected CPU cost that doesn't show up as "dynamic mesh" in the obvious way — profile with `stat InitViews` and look for unexpectedly high `GatherDynamicMeshElements` time.

---

## What Data It Produces

**Per-View Visibility Results:**
- Visible primitive lists with LOD selections
- Per-instance visibility flags for ISM / HISMC batches
- Occlusion query results (from previous frame's HZB)

**Draw Command Buffers:**
- Static mesh draw commands (retrieved from cache)
- Dynamic mesh draw commands (freshly built this frame)
- Instance data buffers for indirect draw calls
- Nanite cluster visibility lists (separate pipeline)
- Render command lists sorted by material and Pipeline State Object (PSO)

**Consumed downstream by:**
- **PrePass** — depth prepass uses the visible primitive list
- **BasePass** — primary opaque rendering
- **NaniteVisibilityBuffer** — Nanite's own rasterization path
- **Shadow passes** — each shadow cascade gets its own culled primitive list
- **Velocity pass** — moving objects need draw commands for motion blur

---

## Culling & Selection Performed

| Culling Type | Description |
|-------------|-------------|
| View Frustum | Removes primitives whose bounds fall entirely outside the camera frustum |
| Distance Culling | Removes primitives beyond their `MaxDrawDistance`; feeds into LOD selection |
| LOD Selection | Chooses the appropriate mesh LOD based on projected screen size |
| HLOD | Substitutes World Partition HLOD proxy meshes for distant clusters |
| HZB Occlusion Culling | Uses a mip chain of the *previous frame's* depth buffer to cull occluded objects — see note below |
| Nanite Cluster Culling | Per-cluster visibility for Nanite meshes; runs on GPU as part of the Nanite pipeline |
| Per-Instance Culling | ISM / HISMC instance visibility; can be GPU-driven |

> [!NOTE]
> **HZB (Hierarchical Z-Buffer) occlusion culling has a one-frame latency by design.** The occlusion results used this frame were generated from last frame's depth render. This means a newly revealed object may be incorrectly culled for one frame before occlusion data catches up. This is an accepted trade-off in UE5 and is rarely visible in practice, but it is important to understand when debugging culling artifacts on fast-moving cameras or sudden scene transitions.

---

## Why This Can Be Expensive

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many unique actors | CPU traversal cost scales with primitive count | Merge static meshes; use ISM/HISMC for repeated objects |
| Many small meshes | High draw call count; poor batching | Merge or instance small decorative meshes |
| Unique materials per mesh | Each unique material = unique PSO = breaks batching | Share master materials; use material parameter collections |
| Dynamic primitives | `GatherDynamicMeshElements` rebuilt every frame | Minimize runtime material/visibility changes on static meshes |
| High light interaction count | More shader permutations and draw call variants | Reduce overlapping dynamic lights; use static/stationary lights where possible |
| Blueprint-heavy actors | Many components = slow scene traversal | Reduce component count; consolidate actors |
| No instancing | Every identical mesh is a separate draw call | Convert repeated meshes to ISM / HISMC |
| World Partition churn | Frequent cell load/unload triggers visibility rebuilds | Tune streaming distances; avoid camera positions that straddle streaming boundaries |
| No HLOD | Distant geometry fully tessellated | Set up HLOD layers for World Partition levels |

---

## Key Systems and Components

### FCachedMeshDrawCommands
The cache that stores pre-built draw commands for static primitives. This is what makes static meshes essentially free to process on the CPU each frame — their commands were built at load time and are simply retrieved here. Any operation that invalidates this cache causes an expensive rebuild.

### GatherDynamicMeshElements
The function responsible for building draw commands for all dynamic primitives each frame. This is the most expensive per-frame work in this stage. High time here means too many dynamic primitives — profile with `stat InitViews` to identify offenders.

### FRelevancePacket
The parallel work unit for visibility and relevance processing. Each packet handles a batch of primitives and runs on worker threads. The render thread collects results once all packets complete. This is why primitive *count* matters more than primitive *complexity* at this stage — more primitives means more packets regardless of triangle count.

### Pipeline State Objects (PSOs)
Draw commands are sorted and batched by PSO — a descriptor that defines the full GPU pipeline state (shaders, blend modes, rasterizer state). Every unique material combination that requires a unique PSO breaks batching. Minimizing PSO variety is one of the most impactful optimizations for draw call count.

### Nanite Cluster Pipeline
Nanite geometry follows an entirely separate visibility and culling path — GPU-driven cluster culling replaces the CPU-side draw command building used for traditional meshes. This is why Nanite meshes largely remove the "too many polygons" problem while shifting concern to material count and overdraw instead.

---

## 📋 Reader Notes

> [!NOTE]
> **Nanite changes this stage significantly.** For Nanite-enabled meshes, the traditional CPU-side draw command building is replaced by GPU-driven cluster culling. The `BuildRenderingCommandsDeferred` overhead for Nanite geometry is minimal — the cost shifts to the Nanite rasterization pass instead. This means a scene with many Nanite meshes can have a very low `InitViews` cost while still being GPU-expensive.

> [!NOTE]
> **World Partition changes HLOD and streaming behavior.** In World Partition levels, HLOD layers are managed automatically per streaming cell. The quality of your HLOD setup directly affects how many full-detail meshes this stage must process at any camera position. Poorly configured streaming distances or missing HLOD layers are a frequent cause of high `InitViews` cost in large open-world scenes.

> [!NOTE]
> **Draw call budgets vary significantly by platform and RHI.** The `>5–10k draw calls` threshold in Red Flags is a rough PC/DX12 guideline. On consoles, draw call overhead is lower due to explicit APIs, but the CPU traversal cost of many primitives still applies. On mobile, draw call limits are much tighter. Always profile on your target platform.

> [!NOTE]
> **`r.ShowPrecomputedVisibilityCells`** is a legacy UE4 visualization tool. Precomputed visibility volumes still exist in UE5 but are rarely used in World Partition projects. Don't spend time setting these up unless you're on a fixed-camera or very constrained mobile project where the bake cost is justified.

---

## How to Debug / Profile

### Unreal Insights
Key named events to look for in the **Render Thread** and **Worker Thread** tracks:

| Event | What It Tells You |
|-------|------------------|
| `InitViews` | Total visibility and relevance pass time — the parent event for most of this stage |
| `BuildRenderingCommandsDeferred` | Time spent building and retrieving draw command lists |
| `CullInstances` | Instance-level culling cost for ISM / HISMC batches |
| `GatherDynamicMeshElements` | Time rebuilding draw commands for dynamic primitives — high value = too many dynamic objects |
| `ComputeRelevance` | Parallel relevance packet work on worker threads |

> [!TIP]
> If `InitViews` is high but `GatherDynamicMeshElements` is low, your cost is in primitive *count* — too many objects being traversed, even if they're static. If `GatherDynamicMeshElements` is high, your cost is in dynamic primitives being rebuilt every frame. These require different fixes, so distinguish them before optimizing.

### Stat Commands

```
stat initviews       // Primitive counts, visibility time, draw call totals — start here
stat sceneRendering  // Broader render thread breakdown including this stage
stat RHI             // Draw call count and GPU resource submission cost
stat GPU             // GPU-side cost breakdown for downstream passes
```

### Visualization Helpers

```
r.VisualizeOccludedPrimitives 1   // Shows which primitives are being culled by HZB occlusion
r.ShowPrecomputedVisibilityCells 1  // Legacy — only useful for non-World Partition projects
```

---

## Optimization Levers

### Content & Level Design
- Merge static meshes that always appear together and share a material
- Use HLOD layers for all distant geometry in World Partition levels
- Use ISM / HISMC for any mesh that appears more than 2–3 times in a scene
- Reduce unique materials — shared master materials with parameters preserve batching
- Avoid placing thousands of tiny decorative meshes as individual actors

> [!WARNING]
> **Aggressive mesh merging has tradeoffs.** Merging meshes eliminates per-mesh occlusion culling — a large merged mesh will never be culled even if most of it is offscreen or occluded. It can also break lightmap UV layouts and per-mesh collision. Merge small clusters, not large areas of a level.

### Nanite
- Enable Nanite on dense static geometry to offload triangle cost to the GPU-driven path
- Keep material count low on Nanite assets — material slots, not polygon count, determines draw call cost for Nanite meshes

> [!WARNING]
> **WPO (World Position Offset) fully disables Nanite for that mesh — it is not a degradation, it is a hard cutoff.** Any Nanite mesh with a material using WPO falls back entirely to the traditional raster path. This can silently re-introduce high triangle cost. Audit WPO usage carefully and limit it to non-Nanite hero assets.

### Blueprint / Actor Setup
- Reduce component count per actor — every component is a potential primitive in the scene graph
- Avoid unnecessary ticking on actors that don't need per-frame updates
- Minimize runtime spawn/despawn churn — each spawn triggers a scene graph update and potential draw command rebuild

### World Partition
- Tune cell streaming distances to avoid loading more geometry than the camera can actually see
- Use HLOD layers correctly — every streaming cell should have a valid HLOD proxy
- Avoid camera positions or paths that constantly straddle streaming cell boundaries, which triggers continuous load/unload

---

## Mental Model

Think of this stage as:

> *"Before touching the GPU, Unreal makes a precise list of everything worth drawing — filtered, sorted, batched, and formatted exactly the way the GPU expects it."*

The quality of this list is the foundation of your entire frame. A well-built list means the GPU gets clean, batched work. A poorly-built list means the GPU gets thousands of tiny, redundant commands — and the CPU was slow building it too.

The key insight is the **static/dynamic split**: static meshes are nearly free to process because their commands were cached at load time. Every dynamic primitive is a fresh CPU cost every frame. Keeping the dynamic set small is the single highest-leverage optimization in this stage.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| `FCachedMeshDrawCommands` | Stores pre-built draw commands for static primitives |
| `GatherDynamicMeshElements` | Rebuilds draw commands for dynamic primitives each frame |
| HZB (Hierarchical Z-Buffer) | Previous-frame depth mip chain used for occlusion culling |
| Nanite Cluster Pipeline | Parallel GPU-driven visibility path for Nanite geometry |
| ISM / HISMC | Instance batching systems; their culling runs as part of `CullInstances` |
| World Partition / HLOD | Streaming and proxy mesh selection feeds directly into this stage |
| PrePass / BasePass | Primary consumers of the draw command lists built here |

---

## Red Flags to Watch For

- **`InitViews` > 2ms** on render thread → run `stat initviews` to break down primitive count vs dynamic gather cost
- **`GatherDynamicMeshElements` > 1ms** → too many dynamic primitives; audit runtime material/visibility changes on static meshes
- **Draw calls > 5–10k (non-Nanite scenes)** → instancing and material consolidation needed
- **Primitive count > ~5,000 visible** → scene graph traversal becoming expensive; consider HLOD and merging
- **High `ComputeRelevance` worker task count with long duration** → too many primitives for relevance packets to process; reduce scene density or increase HLOD coverage
- **WPO materials on Nanite meshes** → Nanite silently disabled for those meshes; full triangle cost reintroduced
- **World Partition streaming cells constantly loading/unloading** → camera near a streaming boundary; tune distances or reposition content
- **Identical meshes placed as individual actors instead of ISM** → every instance is a separate draw call and a separate primitive in the scene graph

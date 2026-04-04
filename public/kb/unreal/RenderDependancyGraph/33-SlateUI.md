---
tags:
  - slate
---

# Unreal Engine 5 Rendering Pipeline – SlateUI (Title)

> Stage: **SlateUI (Title)**  
> Phase: UI Rendering / Final Frame Composition  
> Purpose: Render all game UI elements — UMG widgets, HUD, overlays — on top of the fully composited scene at native output resolution  
> Pipeline Position: **Final pass** — after all scene rendering, post-processing, and tone mapping; immediately before frame presentation

---

## What This Stage Does

SlateUI renders the game's entire user interface over the completed rendered scene. This is the last operation before the frame is presented to the display. Every HUD element, menu widget, minimap, health bar, dialog box, subtitle, inventory screen, and debug overlay is produced in this pass.

Slate is UE5's foundational UI framework. UMG (Unreal Motion Graphics) — the Blueprint-based widget system — compiles down to Slate widgets at runtime. Every UMG widget the game creates becomes a node in Slate's widget tree, traversed and rendered here.

**The "(Title)" suffix** in the pass name distinguishes the game application's Slate render from the editor's Slate render. In packaged builds, only `SlateUI (Title)` exists. In PIE (Play In Editor), both the game's Slate and the editor's Slate run as separate passes — profiling in PIE will show both.

---

## Why UI Is Always Last

UI must always appear on top of the 3D scene regardless of depth — health bars do not recede into the distance; subtitles do not disappear behind geometry. Rendering UI after all scene passes, post-processing, and upscaling is the only way to guarantee it is always visually dominant.

More specifically:
- UI must not be affected by depth of field (blurring)
- UI must not receive motion blur
- UI must not be tone-mapped with the scene (UI elements are authored for sRGB display output, not HDR scene space)
- UI must not be affected by screen percentage — shrinking the scene render should not shrink the UI

All of these requirements are satisfied by rendering Slate after all scene and post-process work is complete.

---

## Critical Property: Native Resolution Independence

**Slate always renders at the native output resolution, regardless of `r.ScreenPercentage`.**

If a game runs the scene at 66% screen percentage (TSR upscaling from ~720p to 1080p), Slate still renders at 1080p. If screen percentage drops to 50%, Slate still renders at 1080p. The scene gets cheaper; the UI does not.

This has two important implications:

1. **UI cost is not reduced by scene rendering optimizations.** Lowering screen percentage, reducing Nanite quality, or simplifying materials does not affect the UI rendering budget.

2. **Complex UI on high-resolution displays has a fixed high cost.** A full-screen UI at 4K costs the same regardless of the scene rendering configuration. This is often the limiting factor in UI complexity on resolution-constrained platforms.

> [!NOTE]
> **On console platforms targeting 4K output with variable scene resolution, UI cost can become a meaningful fraction of the frame budget.** A complex UI at 4K with many layers and dynamic elements can cost 1–2ms regardless of whether the scene renders at 1440p or 1080p. Budget UI complexity against output resolution, not render resolution.

---

## The Two-Sided Cost: CPU and GPU

Unlike most rendering passes where GPU time is the primary concern, Slate has significant **CPU-side work** that must complete before any GPU commands are issued. Both sides must be understood and profiled independently.

### CPU Side (Game Thread / Slate Thread)

Every frame, Slate must:
1. **Traverse the widget tree** — visit every active widget from the root down
2. **Compute layout** — calculate position, size, and visibility for every widget
3. **Check invalidation** — determine which widgets have changed since last frame
4. **Prepare draw elements** — generate the draw element list for changed widgets
5. **Build batches** — group draw elements by texture/material into GPU draw calls

For a UI with many widgets, many dynamic elements, or no invalidation panel coverage, this CPU work happens for every widget every frame. On complex UIs, this can cost multiple milliseconds on the game thread.

**Slate thread:** Slate can run its layout and invalidation traversal on a dedicated Slate thread, decoupled from the game thread and render thread. This reduces game thread pressure but the Slate thread still contributes to total frame time.

### GPU Side (Render Thread → GPU)

The GPU receives the batched draw calls prepared on the CPU side and executes:
1. UI geometry rasterization (rectangles, rounded corners, arbitrary mesh widgets)
2. Texture sampling (UI textures, render textures, atlases)
3. Material evaluation (any UI material graph nodes)
4. Text glyph rendering (SDF or bitmap)
5. Compositing each layer over the previous

GPU cost scales with:
- Total UI pixel coverage (overdraw of layered UI panels)
- Number of draw calls (unique texture/material breaks per batch)
- Complexity of UI materials (shader instruction count per pixel)
- Font rendering complexity (character count, font atlas switches)

---

## Invalidation Panels — The Key Performance Architecture

The most important UI performance concept in Slate. **Invalidation panels** allow regions of the UI to be skipped entirely when their contents haven't changed.

**How they work:**
A widget marked as an invalidation panel (or wrapped in `SInvalidationPanel` / `URetainerBox` in UMG) caches its render output. On subsequent frames, if no widget inside the panel has been marked dirty (changed), Slate skips the entire layout traversal and draw element generation for that panel — reusing the cached result directly.

**Effect:**
- Static UI regions (a permanent minimap border, a skill icon frame, a background panel) pay their CPU layout cost once, then nothing until they change
- Dynamic UI regions (a health bar changing constantly, an animated icon) still pay full cost every frame

**Explicit invalidation:**
When a widget changes, it calls `Invalidate()` on itself or its parent panel. This marks the panel dirty for the next frame. Only dirty panels go through the full rebuild process.

```
// UMG: Use URetainerBox to wrap static UI sections
// URetainerBox → Phase: Every N frames or specific trigger
// This retains the rendered output and only re-renders when invalidated.

// SInvalidationPanel in C++ Slate:
SNew(SInvalidationPanel)
[
    // Static content here is cached
]
```

> [!WARNING]
> **A widget that calls `Invalidate()` every frame, even if its visual output hasn't changed, defeats the invalidation panel entirely.** Common sources of unintentional per-frame invalidation: binding a widget's attribute to a property that always returns a new object even if the value is identical, Blueprint tick events that call `SetText` or `SetVisibility` with the same value as already set, and animated widgets inside a panel that was intended to be static. Audit invalidation rates with `Slate.VisualizeInvalidation 1`.

---

## Batching — How Slate Groups Draw Calls

Slate groups consecutive draw elements with the same rendering state into a single GPU draw call. Every break in consecutive matching states creates a new batch — a new draw call.

**What breaks batching:**
- A different texture (new sprite sheet, different UI panel texture)
- A different material (custom UI material node)
- Clipping rectangle changes (masked areas, scroll boxes)
- Layer changes (ZOrder breaks)
- Certain widget types that require state changes

**What preserves batching:**
- Multiple elements using the same texture atlas (all from the same sprite atlas = one texture = one batch)
- Same material across consecutive elements
- Same clip rect
- No ZOrder interruption

**Practical implications:**
- A UI with 50 elements all using the same sprite atlas may render in 1-3 draw calls
- The same UI with 50 elements each using unique textures produces 50 draw calls
- Custom UI materials are expensive primarily because they frequently break batching

> [!TIP]
> **Texture atlasing is the single most impactful batching optimization for UI.** Group all UI sprites, icons, and elements into shared atlas textures. Unreal's Paper2D and UI atlas tools can pack textures automatically. When all icons share one atlas and all panel backgrounds share another, entire screens can render in a handful of draw calls rather than dozens or hundreds.

---

## Text Rendering

Text is one of the most expensive UI elements when handled carelessly. Slate uses two text rendering approaches:

### Signed Distance Field (SDF) Fonts
- A single texture represents the font at any scale
- Rendered with a special shader that produces sharp edges regardless of scale
- Recommended for fonts that appear at varied sizes (scaling UI, large title text)
- More expensive per glyph than bitmap but resolution-independent

### Rasterized Bitmap Fonts
- Pre-rasterized at specific point sizes
- Sharp at the intended size, blurry when scaled
- Cheaper per glyph for static layouts at known sizes
- Each unique size requires its own font atlas entry — using 5 different text sizes requires 5 font atlas entries

**What makes text expensive:**
- Many unique characters requiring large font atlases
- Many different font families or weights (each is a separate atlas)
- Rich text with mixed sizes, colors, and inline images
- Text that changes every frame (counters, timers) — invalidates every frame
- Very long strings

> [!NOTE]
> **Text that updates every frame — damage numbers, countdown timers, score counters — is one of the most common sources of per-frame CPU invalidation.** Every frame the text changes, the widget invalidates, the text is re-laid-out, and the glyph draw elements are regenerated. For frequently-updating numbers, consider pooling text widgets, using a single pre-formatted layout that only changes the number string, or using a custom rendered counter implementation rather than a standard text widget.

---

## Execution Model

| Thread | Responsibility |
|--------|---------------|
| **Game Thread / Slate Thread** | Widget tree traversal, layout computation, invalidation checking, draw element generation, batch building |
| **Render Thread** | Translates Slate draw batches into RHI draw commands |
| **GPU** | Rasterizes UI geometry, samples textures, evaluates materials, composites over scene |

The CPU side completes before the render thread submits GPU commands. A slow Slate CPU phase delays the render thread from beginning UI GPU work — a CPU-GPU pipeline bubble specific to UI.

---

## What Data This Pass Reads and Produces

**Reads:**
- Scene output (fully post-processed SceneColor at output resolution) — UI composites over this
- UI textures and atlases
- Font SDF textures / bitmap atlases
- Render textures (if widgets use `SceneCapture2D` as a source — e.g. minimap)
- UMG widget tree state from game thread

**Produces:**
- **Final frame image** — scene + all UI layers composited at native output resolution
- This output is what is presented to the display / swap chain

---

## Why This Can Be Expensive

### CPU-Side (Game Thread / Slate Thread)

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many widgets with no invalidation panels | Full tree traversal every frame | Wrap static UI sections in `URetainerBox` / `SInvalidationPanel` |
| Widgets calling `Invalidate()` every frame unnecessarily | Defeats invalidation caching entirely | Audit invalidation sources; only invalidate on actual change |
| Deep widget hierarchies | More nodes to traverse even when nothing changed | Flatten widget trees; prefer fewer, more complex widgets over many simple ones |
| Frequently-changing text | Text invalidation and re-layout every frame | Pool text widgets; use purpose-built counters for numeric displays |
| Complex Blueprint tick functions updating UI | Game thread work per widget per frame | Move UI updates to events (event-driven) rather than tick-driven |

### GPU-Side

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| Many unique textures | Breaks batching; high draw call count | Use texture atlases; pack UI sprites |
| Custom UI materials with complex graphs | More shader cost per pixel | Simplify UI materials; avoid expensive nodes |
| Heavy UI overdraw (many stacked panels) | Translucent UI layers compound per-pixel | Merge panels; reduce visual layer count |
| Large UI screen coverage | More pixels to shade | Design UI to occupy minimum necessary screen area |
| Many font atlases | Each font family/size is a separate texture | Limit font variety; prefer fewer sizes |
| High-resolution UI on 4K targets | Full 4K rasterization regardless of scene resolution | Design UI for resolution; use scalable layouts |

---

## Debugging and Profiling

### Slate-Specific Profiling Tools

**Widget Reflector** (in-editor tool):
`Window → Widget Reflector` opens UE5's built-in Slate inspection tool. It shows:
- The full widget hierarchy and tree depth
- Paint geometry (actual rendered bounds per widget)
- Update frequency indicators
- Which widgets are invalidating

This is the starting point for any Slate CPU performance investigation.

### Console Commands and CVars

```
Slate.VisualizeInvalidation 1       // Highlights invalidated widget regions each frame.
                                     // Flashing regions = widgets invalidating every frame.
                                     // Use to identify unintended per-frame invalidation.
                                     // Static UI should show minimal flashing.

Slate.VisualizeDrawBatches 1        // Shows draw batch boundaries and count.
                                     // Each differently-colored region is a separate batch.
                                     // Many small regions = many draw calls = batching problems.
                                     // Use to identify textures that are breaking batching.

Slate.ThrottleWhenMouseIsIdle 0/1   // Disable/enable Slate throttling when idle.
                                     // Disable for accurate performance measurement.

Slate.EnableInvalidationPanels 0/1  // Toggle invalidation panel system entirely.
                                     // 0 = everything redraws every frame (baseline).
                                     // Compare timings to measure invalidation savings.
```

### Stat Commands

```
stat Slate                          // Key Slate performance counters:
                                     // - Num Widgets: total active widgets
                                     // - Num Painted Widgets: widgets actually rendered this frame
                                     // - Num Batched Draws: GPU draw calls generated
                                     // - Num Texture Switches: batching breaks from texture changes
                                     // - Tick Time: game thread Slate tick cost
                                     // - Paint Time: draw element generation cost

stat SlateVerbose                   // Per-widget breakdown of paint time.
                                     // Identifies specific widgets with high render cost.

stat RHI                            // Draw call count — includes UI draw calls.
                                     // Compare with/without UI to see UI draw call contribution.
```

### Unreal Insights Events

| Event | Thread | What It Tells You |
|-------|--------|------------------|
| `SlateUI` | GPU | Total GPU time for UI rendering |
| `Slate::Tick` | Game Thread | Widget tree traversal and layout cost |
| `Slate::Paint` | Game Thread / Slate Thread | Draw element generation and batch building |
| `SlateDrawCalls` | Render Thread | RHI command generation from Slate batches |

> [!TIP]
> In Unreal Insights, check **both the game thread and GPU track** for Slate events. If `Slate::Tick` or `Slate::Paint` on the game thread is expensive, the problem is CPU-side — widget tree complexity, invalidation volume, or layout computation. If `SlateUI` on the GPU track is expensive, the problem is GPU-side — draw call count, material complexity, or overdraw. These require completely different fixes.

---

## Optimization Strategies

### Strategy 1: Invalidation Panels (Highest Impact for Complex Static UI)

Wrap every section of UI that is static or changes infrequently in a `URetainerBox`:

```
// In UMG:
// 1. Select a container widget (Canvas Panel, Vertical Box, etc.)
// 2. Right-click → Wrap With → RetainerBox
// 3. Set Phase to "Every N Frames" (N=1 for every frame, N=2 for every other frame, etc.)
// 4. Or set Phase to "None" and manually call RequestRender() when content changes

// Result: everything inside the RetainerBox renders once and is cached
// until you call RequestRender() or content changes automatically invalidate it.
```

Good candidates for RetainerBox wrapping:
- Skill/ability icon bars (only change on ability use/cooldown)
- Inventory panel backgrounds and borders
- Map/minimap border and overlay elements
- Stat displays that change on discrete events (level up, item equip)
- Any background panel or decorative element

Poor candidates (still change frequently):
- Health/mana bars during combat (update multiple times per second)
- Active timers and countdowns
- Damage number floaters
- Animated/looping UI elements

### Strategy 2: Texture Atlasing

Pack all UI sprites into shared atlas textures:
- Use UE5's texture atlas tools or external tools like TexturePacker
- Group sprites by usage context (all HUD sprites in one atlas, all menu sprites in another)
- Ensure atlas textures are power-of-two dimensions for GPU efficiency

```
// In content browser:
// Right-click → Create → User Interface → Sprite Atlas
// Add all UI sprites → the atlas auto-packs them
// Reference sprites from the atlas in materials/widgets

// Verify batching improvement with:
Slate.VisualizeDrawBatches 1
// Before atlasing: many colored regions
// After atlasing: fewer, larger regions
```

### Strategy 3: Reduce Widget Count

Flatten unnecessary widget hierarchy depth:
- A `Canvas Panel → Vertical Box → Horizontal Box → Border → Image` for a single icon can often be simplified to a `Canvas Panel → Image` with the appropriate margin/alignment
- Avoid widget trees more than 5-6 levels deep for static content
- Audit `stat Slate` → `Num Widgets` — high counts (thousands) indicate over-architectured UI

### Strategy 4: Event-Driven Updates

Replace tick-based UI updates with event-driven updates:

```cpp
// AVOID: Updating UI every tick
void UMyWidget::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
    HealthBar->SetPercent(PlayerCharacter->GetHealthPercent()); // Every frame
}

// PREFER: Update on change event
void UMyWidget::NativeConstruct()
{
    PlayerCharacter->OnHealthChanged.AddDynamic(this, &UMyWidget::OnHealthChanged);
}

void UMyWidget::OnHealthChanged(float NewPercent)
{
    HealthBar->SetPercent(NewPercent); // Only when health actually changes
}
```

Event-driven updates fire Invalidate() only when values actually change, preserving invalidation panel caching between changes.

### Strategy 5: Simplify UI Materials

Custom UI materials should be as simple as possible:
- Avoid complex noise functions, multiple texture samples, or expensive math nodes
- UI materials run at full output resolution — instruction count matters more than in 3D materials
- Prefer pre-baked visual complexity (baked into a texture) over runtime computation
- Avoid changing material parameters every frame — this invalidates batches

### Strategy 6: Font Management

- Limit the project to 2-3 font families maximum
- Use a small set of font sizes (define a typographic scale: small/medium/large/header)
- Avoid inline styling that mixes sizes within the same text widget
- SDF fonts for scalable UI; bitmap fonts only when scale is known and fixed

### Strategy 7: Render Textures / SceneCapture in UI

UI elements that use `SceneCapture2D` as their source (minimap, character portrait, equipment preview) are extremely expensive — they trigger a full independent scene render every frame. Options:

```
// Control update frequency:
SceneCapture2D->bCaptureEveryFrame = false;
// Call CaptureScene() only when the displayed content has changed

// Reduce capture resolution:
SceneCapture2D->TextureTarget->SizeX = 256; // Minimap doesn't need 1080p
SceneCapture2D->TextureTarget->SizeY = 256;
```

> [!WARNING]
> **A `SceneCapture2D` set to capture every frame for a minimap renders a full scene every frame including Nanite, shadows, and lighting for that capture's view.** This can add 2–5ms per minimap capture. Use sparse capture (update every 10+ frames), reduce render features on the capture camera, and use the smallest workable texture resolution.

---

## Key Systems and Components

### Widget Tree
The hierarchical data structure that defines all active UI. Every UMG widget added to the viewport creates a Slate widget in this tree. Traversed top-down every frame during the Slate tick phase. Tree depth and total widget count are the primary CPU scalability factors.

### SInvalidationPanel / URetainerBox
The caching layer that prevents redundant re-rendering of static UI regions. The most powerful Slate optimization primitive. When content inside is unchanged, the entire subtree is skipped during layout and draw element generation.

### Draw Element List
The intermediate representation generated after widget traversal — a flat list of draw commands (draw textured quad, draw border, draw text) prepared by the CPU before being converted to GPU commands. Batching collapses consecutive compatible elements.

### Slate Font Atlas
A dynamically-built texture atlas that packs font glyphs as they're first needed. Each font family, weight, and size (for bitmap fonts) occupies its own atlas. Font atlas switches are expensive batching breaks. The atlas grows at runtime as new characters are first rendered — avoid first-rendering rare unicode characters during gameplay-critical moments.

### Slate Rendering Thread
When `GSlateIsRunningInMainThread` is false, Slate's paint and layout work runs on a dedicated thread. This decouples slow Slate CPU work from the game thread at the cost of a one-frame display latency for UI updates. An important configuration choice for UI-heavy titles where game thread time is precious.

---

## 📋 Reader Notes

> [!NOTE]
> **Slate performance issues are often invisible in GPU-only profiles.** If you profile only GPU time, a Slate-related CPU stall (game thread pausing waiting for widget updates to complete before the render thread can submit) appears as a GPU idle gap unrelated to Slate itself. Always profile Slate with a tool that captures both CPU thread timings and GPU timings simultaneously — Unreal Insights with full CPU/GPU capture is required for accurate Slate diagnosis.

> [!NOTE]
> **PIE (Play In Editor) has two Slate renders — the game's and the editor's.** Profiling in PIE will show `SlateUI (Title)` for the game and additional Slate work for the editor. This inflates perceived Slate cost during development. Always profile UI performance in a standalone game or packaged build for accurate shipping-representative numbers.

> [!NOTE]
> **UMG animations that run via UMG's animation system (not Blueprint tick) do not necessarily invalidate widgets every frame.** UMG animations communicate changes through Slate's attribute binding system, which can be more efficient than manually setting properties via Blueprint tick. However, they do still produce per-frame property changes — wrap the animated widget region in a RetainerBox with a high capture frequency to manage the cost.

> [!NOTE]
> **UI is not affected by TSR screen percentage but IS affected by output resolution.** At 4K output with 50% screen percentage, the scene renders at 2K but UI renders at full 4K. If reducing output resolution is on the table for performance (displaying at 1080p instead of 4K), that reduces UI cost proportionally. If only screen percentage is reduced, UI cost is unchanged.

---

## How to Debug / Profile — Quick Reference

```
// Step 1: Measure total UI cost
showflag.SlateUI 0                  // Not always available; alternatively:
// Compare frame time in PIE with UI hidden vs visible (set all widgets invisible)

// Step 2: Check CPU vs GPU split
stat Slate                          // CPU side: Tick Time, Paint Time
stat GPU                            // GPU side: SlateUI block

// Step 3: Find invalidation issues
Slate.VisualizeInvalidation 1       // Flashing = per-frame invalidation

// Step 4: Find batching issues  
Slate.VisualizeDrawBatches 1        // Many colors = many draw calls

// Step 5: Find expensive widgets
stat SlateVerbose                   // Per-widget paint time breakdown

// Step 6: Use Widget Reflector
// Window → Widget Reflector → enable "Update Every Frame"
// Shows live widget tree, bounds, update frequency
```

---

## Optimization Checklist

Before shipping, verify:
- [ ] Static UI regions wrapped in `URetainerBox`
- [ ] All UI sprites packed into texture atlases
- [ ] Widget trees are no deeper than necessary
- [ ] No UI updates via Blueprint tick (replaced with event-driven)
- [ ] `SceneCapture2D` in UI configured with sparse capture (not every frame)
- [ ] Font variety limited to project typographic scale
- [ ] Custom UI materials are simple (< 20 shader instructions)
- [ ] `stat Slate` → Num Texture Switches is low (< 20 for most screens)
- [ ] `Slate.VisualizeInvalidation 1` shows minimal per-frame flashing for static UI
- [ ] Profile performed in packaged/standalone build, not PIE

---

## Mental Model

Think of SlateUI as:

> *"After all the physics and rendering are done, lay a perfectly flat, always-sharp sheet of UI glass over the final image — drawn at native resolution regardless of how the scene behind it was rendered."*

Slate is infrastructure, not spectacle — its job is to be invisible while enabling all the game's communication with the player. The optimization philosophy is therefore about **minimizing unnecessary work** rather than reducing quality. Invalidation panels eliminate re-rendering of things that haven't changed. Atlasing eliminates GPU state changes between elements that could share state. Event-driven updates eliminate CPU cycles spent confirming that nothing changed.

The key insight is the **CPU-GPU duality**. Most rendering problems are GPU problems. Slate problems are frequently CPU problems — the widget tree is too deep, too much is invalidating, or too much work happens in Blueprint tick. Solving Slate performance requires understanding which side is the bottleneck before applying any fix.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| PostProcessing (doc 33) | Runs before SlateUI — UI composites over the tone-mapped output |
| TSR (doc 23) | UI renders after TSR at native output resolution — not upscaled |
| SceneCapture2D | Used by some UI elements (minimap, portrait) — each capture is an additional render |
| UMG | The Blueprint widget system that compiles to Slate at runtime |
| Font Rendering | SDF and bitmap font atlases built and managed by Slate |
| RHI | UI draw calls submitted via RHI just like 3D draw calls |
| Swap Chain / Presentation | Receives the final frame with UI composited — the last step before display |

---

## Red Flags to Watch For

- **`stat Slate` → Tick Time > 1ms** → CPU-side Slate traversal expensive; audit widget tree depth and widget count; enable Widget Reflector
- **`stat Slate` → Paint Time > 1ms** → Draw element generation expensive; too many widgets invalidating; use `Slate.VisualizeInvalidation 1` to find per-frame invalidators
- **`stat Slate` → Num Texture Switches > 50** → Poor batching; texture atlas coverage inadequate; use `Slate.VisualizeDrawBatches 1` to find break points
- **`SlateUI` > 1ms on GPU** → UI overdraw or many draw calls; check UI layer count and material complexity
- **`Slate.VisualizeInvalidation 1` showing full-screen invalidation every frame** → critical invalidation issue; something is marking the root widget dirty every frame
- **SceneCapture2D updating every frame in a UI element** → adds full render cost per capture per frame; set `bCaptureEveryFrame = false` immediately
- **UMG animations not using RetainerBox** → animated regions driving per-frame invalidation of surrounding static content; wrap animation regions separately from static regions
- **Widget depth > 8-10 levels for simple UI elements** → over-architectured widget hierarchy; flatten with fewer container widgets
- **Profiling Slate in PIE and seeing high cost** → includes editor Slate; profile in standalone or packaged build for accurate shipping cost
- **UI appearing blurry** → UI is inside `r.ScreenPercentage` resolution accidentally; check UI rendering path; UI should always be at native resolution

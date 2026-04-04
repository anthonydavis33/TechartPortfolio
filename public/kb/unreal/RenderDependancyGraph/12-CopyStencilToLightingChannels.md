---
tags:
  - lighting
---

# Unreal Engine 5 Rendering Pipeline – CopyStencilToLightingChannels

> Stage: **CopyStencilToLightingChannels**  
> Phase: Lighting Setup / Mask Preparation  
> Purpose: Convert per-pixel lighting channel membership encoded in stencil bits into a shader-readable mask texture for use by deferred lighting passes  
> Pipeline Position: After `BasePass`, before deferred lighting evaluation

---

## What This Stage Does

During BasePass, each rendered primitive writes its **lighting channel membership** into specific bits of the stencil buffer — a compact side channel that stores per-pixel integer flags. Stencil is fast to write but not directly readable in the format that deferred lighting shaders require.

This pass performs a **fullscreen blit/compute** that reads the stencil bits encoding lighting channel data and writes them into a dedicated **lighting channel mask texture** — a simple R8 or R8G8 format buffer where each pixel contains a bitmask of which lighting channels that pixel belongs to.

Deferred lighting passes then read this texture per pixel to determine which lights are permitted to illuminate it — skipping any light whose channel set doesn't intersect with the pixel's channel mask.

---

## Why This Stage Exists

### Why Stencil Can't Be Read Directly
The stencil buffer is packed with multiple uses — Nanite coverage flags, custom depth flags, and lighting channel bits all share the same 8-bit stencil value. The specific bits encoding lighting channels cannot be isolated and sampled directly by lighting shaders without an intermediate decode step. The copy creates a clean, purpose-specific texture that lighting shaders can sample without bit-manipulation overhead per light per pixel.

### What Lighting Channels Enable
UE5 supports **three lighting channels: 0, 1, and 2.** All meshes and lights default to Channel 0. A light only illuminates pixels that share at least one channel with it.

Common use cases:
- **Character-only key lights** — a rim or key light set to Channel 1, applied only to characters also set to Channel 1, without affecting world geometry
- **Weapon lights** — a subtle fill light for the player weapon that doesn't bleed onto the environment
- **Cinematic selective illumination** — lighting specific hero props differently from their surroundings
- **Gameplay readability** — highlighting interactive objects with a dedicated accent light not shared with the world

---

## The Three-Channel System

| Channel | Default Assignment | Typical Use |
|---------|------------------|-------------|
| 0 | All meshes and lights (default) | World geometry, environment lighting |
| 1 | Opt-in per mesh/light | Characters, hero props, selective lights |
| 2 | Opt-in per mesh/light | Secondary selective layer (weapons, UI geometry, special FX) |

A mesh or light can belong to **multiple channels simultaneously** — a character might be on Channels 0 and 1, receiving both world lights and character-specific lights.

> [!NOTE]
> **Channel 0 is the universal default — everything is on it unless explicitly changed.** A light on Channel 1 only affects objects also explicitly set to Channel 1. If a character is on Channels 0 and 1, it receives both world lights (Channel 0) and character lights (Channel 1). If a light is on Channel 0 only, it affects all default objects regardless of whether they also have other channels set.

---

## Execution Model

This is a **fullscreen GPU pass** — a single screen-resolution dispatch that reads the stencil buffer and writes the output mask texture. There is no per-primitive work; it is a uniform cost regardless of scene complexity.

| Thread | Responsibility |
|--------|---------------|
| **Render Thread** | Schedules the fullscreen copy dispatch |
| **GPU** | Executes the blit — reads stencil bits, writes mask texture, one thread per pixel |

Cost scales linearly with render resolution and view count. There is no content-complexity scaling — a scene with 1 object and a scene with 10,000 objects pay identical cost in this pass at the same resolution.

---

## What Data It Produces

**Primary Output:**
- **Lighting channel mask texture (R8)** — per-pixel bitmask encoding which of the three lighting channels each pixel belongs to

**Consumed downstream by:**

| Pass | How It Uses the Mask |
|------|---------------------|
| Deferred Lighting | Per-light channel check: skip this light if pixel mask ∩ light channel mask = 0 |
| Shadowed Lighting Evaluation | Same channel check applied to shadow-casting lights |
| Some Translucency Lighting | Translucency lighting paths that support channels read this mask |

---

## Why This Can Be Expensive

This pass is almost always under 0.1ms and is rarely a meaningful contributor to frame time. When it does appear expensive, the cause is almost always one of:

| Problem | Why It Hurts | Mitigation |
|---------|-------------|------------|
| High render resolution | Fullscreen cost scales directly with pixel count | Reduce screen percentage; this pass scales exactly with resolution |
| Many active views | Each view runs an independent fullscreen copy | Minimize scene captures; each active view pays this cost separately |

> [!NOTE]
> **This pass only runs if at least one mesh in the scene has non-default lighting channel assignment.** If all meshes use the default Channel 0 and no lights have been assigned to custom channels, UE5 skips this pass entirely. It is a zero-cost no-op in scenes that don't use the lighting channels feature.

---

## Key Systems and Components

### Stencil Bit Packing
The stencil buffer stores 8 bits per pixel. Multiple systems share these bits by convention — Nanite coverage uses specific bits, custom depth stencil uses others, and lighting channels occupy bits 3–5 (encoding the 3-channel bitmask). The copy pass masks out only the lighting channel bits and writes them to the dedicated output texture. This is why a direct stencil read in lighting shaders isn't practical — it would require bit-masking and decoding per light per pixel, duplicating work across every lighting pass.

### Lighting Channel Mask Texture
The output texture — typically R8 format, one byte per pixel, with each bit corresponding to one lighting channel. Deferred lighting evaluates a simple bitwise AND between the pixel's channel mask and each light's channel mask. If the result is zero (no shared channels), the light contribution is skipped entirely for that pixel — no shading work is done.

### Per-Light Channel Skip
The optimization this system enables. Without lighting channels, every deferred light evaluates every pixel in its screen-space tile. With channels, lights that don't share a channel with a pixel skip it entirely — the skip check is a single bitwise AND, making it essentially free compared to a full lighting evaluation. The channel system adds a small per-pixel read cost here and a negligible per-pixel AND check in lighting, in exchange for enabling light selection that would otherwise require separate render passes.

---

## 📋 Reader Notes

> [!NOTE]
> **Lighting channels are a selective tool, not a global feature.** They are designed for specific hero cases — a character key light, a weapon fill, a cinematic accent. Assigning custom channels to large numbers of world meshes to "keep options open" defeats the purpose and adds unnecessary stencil write overhead in BasePass and mask read overhead in lighting passes. Use them deliberately and sparingly.

> [!NOTE]
> **Lighting channel mismatches are a common source of "this light isn't working" bugs.** If a newly added light doesn't illuminate certain objects, check whether the light's channel assignment matches the mesh's channel assignment. Channel 0 is the default — both must share at least one channel for illumination to occur. Check light and mesh channel settings before assuming a shadow or material issue.

> [!NOTE]
> **This pass is where lighting channel correctness can be visually verified.** If deferred lights appear to be affecting objects they shouldn't (or not affecting objects they should), the lighting channel mask texture is the first place to check. If the mask is correct and lighting is still wrong, the issue is downstream in the deferred lighting pass itself.

---

## How to Debug / Profile

### Unreal Insights
Key events to look for in the **GPU track**:

| Event | What It Tells You |
|-------|------------------|
| `CopyStencilToLightingChannels` | Total pass cost — should be negligible (<0.1ms); if high, check view count or resolution |

> [!TIP]
> This pass is worth knowing about primarily for two reasons: understanding *why* it exists (stencil is not directly readable for lighting), and debugging lighting channel correctness. If a light is not illuminating the right objects, check that the light's `Lighting Channels` setting and the affected mesh's `Lighting Channels` setting share at least one channel. The most common mistake is setting a light to Channel 1 without also setting the target mesh to Channel 1.

### Stat Commands

```
stat GPU    // Overall GPU breakdown — CopyStencilToLightingChannels appears as a trivially small block
```

---

## Optimization Levers

### Lighting Channel Usage
- Use lighting channels only for hero cases — character lights, weapon lights, cinematic accents
- Do not assign custom channels to large numbers of world meshes; the stencil write in BasePass and mask read in lighting are small per object but accumulate

> [!WARNING]
> **Assigning non-default lighting channels to large numbers of meshes adds a per-pixel cost to every deferred lighting evaluation.** Each lit pixel must read the channel mask and perform a bitwise AND per light. In a scene with many lights and many non-default-channel objects, this overhead can become measurable. Lighting channels are designed for tens of objects, not thousands. Reserve them for objects where selective lighting is a genuine visual requirement.

### Rendering
- Reduce extra active views — each view runs an independent fullscreen copy pass
- Lower render resolution if this pass is unexpectedly expensive — it scales exactly with resolution, so screen percentage directly controls it

---

## Mental Model

Think of this stage as:

> *"Translate the stencil's per-pixel lighting channel membership into a format lighting shaders can actually use — so each light only does work for the pixels it's allowed to illuminate."*

This is a thin infrastructure pass. It doesn't make lighting decisions — it just converts data from one representation (packed stencil bits) to another (readable mask texture) so the deferred lighting passes that follow can make those decisions efficiently.

Its existence is a reminder that the GPU's stencil buffer, while fast for writing, is not a general-purpose readable resource. Bridging between the two representations requires this dedicated copy step.

---

## Related Systems

| System | Relationship |
|--------|-------------|
| BasePass | Writes lighting channel bits into stencil during geometry rendering |
| Stencil Buffer | Source data — shares bits with Nanite coverage and custom depth flags |
| Lighting Channel Mask Texture | Output — clean per-pixel channel bitmask readable by lighting shaders |
| Deferred Lighting Passes | Primary consumer — uses mask to skip lights whose channels don't match each pixel |
| Light Actor Settings | `Lighting Channels` property on lights controls which channels they affect |
| Mesh Component Settings | `Lighting Channels` property on meshes controls which channels they belong to |

---

## Red Flags to Watch For

- **`CopyStencilToLightingChannels` > 0.2ms** → unusually high for a fullscreen blit; check active view count and render resolution; also check for shader compilation issues on first frame
- **Lights not illuminating expected objects** → lighting channel mismatch; verify light channels vs mesh channels share at least one value
- **Lights unexpectedly illuminating objects they shouldn't** → mesh incorrectly assigned to a channel shared with a light; audit channel assignments on both light and mesh
- **Pass present in profile when no lighting channels are in use** → stencil bit may be getting set unexpectedly; check for meshes with non-default channel assignment in the World Outliner
- **Cost scaling with view count** → each active scene capture adds a full copy pass; disable or throttle unnecessary captures

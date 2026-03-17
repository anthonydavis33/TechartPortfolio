---
title: Nanite Overview
tags: [unreal, nanite, rendering, optimization]
---

# Nanite Overview

Nanite is UE5's virtualized geometry system. It dynamically streams and processes mesh data so you can use film-quality assets directly in real-time.

## How It Works

1. **Mesh clustering** — Nanite breaks meshes into small clusters of triangles
2. **Hierarchical LOD** — Clusters are organized into a DAG (directed acyclic graph) of LOD levels
3. **GPU-driven rendering** — Visibility and LOD selection happen entirely on the GPU
4. **Software rasterizer** — Small triangles are rasterized in compute shaders, bypassing the hardware rasterizer

> [!WARNING]
> Nanite does **not** support skeletal meshes, translucent materials, or masked materials with complex opacity. Plan your asset pipeline accordingly.

## Performance Considerations

- **Overdraw** is the main cost — overlapping Nanite meshes in screen space hurt performance
- Use `stat Nanite` in the console to see triangle counts and rasterization costs
- **Material complexity** still matters — Nanite optimizes geometry, not shading

## When to Use Nanite

- **Static environment meshes** — rocks, buildings, props (ideal use case)
- **High-poly scanned assets** — photogrammetry fits perfectly
- **NOT for** — characters, foliage with masked materials, VFX meshes

```cpp
// Enable Nanite on a static mesh in C++
UStaticMesh* Mesh = LoadObject<UStaticMesh>(...);
Mesh->NaniteSettings.bEnabled = true;
```

> [!TIP]
> You can convert existing meshes to Nanite in the Static Mesh Editor under the Build Settings section.

## Related

- [[Blueprints Basics]]
- [[Getting Started with UE5]]

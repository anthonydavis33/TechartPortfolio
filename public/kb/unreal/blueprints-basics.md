---
title: Blueprints Basics
tags: [unreal, blueprints, visual-scripting]
---

# Blueprints Basics

Blueprints are UE5's visual scripting system. They're powerful for rapid prototyping and are used extensively in production pipelines.

## Key Concepts

- **Event Graph** — The main execution flow, driven by events like `BeginPlay` and `Tick`
- **Construction Script** — Runs in the editor when properties change, great for procedural setups
- **Functions** — Reusable logic blocks with inputs/outputs
- **Macros** — Similar to functions but inline-expanded (no call overhead)

## When to Use Blueprints vs C++

| Use Case | Blueprint | C++ |
|----------|-----------|-----|
| Rapid prototyping | Yes | No |
| Performance-critical loops | No | Yes |
| Designer-facing tools | Yes | Expose via UPROPERTY |
| Engine modification | No | Yes |

> [!NOTE]
> A common pattern is to write core logic in C++ and expose it to Blueprints via `UFUNCTION(BlueprintCallable)`.

## Example: Basic Health System

```cpp
UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Health")
float MaxHealth = 100.f;

UPROPERTY(BlueprintReadOnly, Category = "Health")
float CurrentHealth;

UFUNCTION(BlueprintCallable, Category = "Health")
void ApplyDamage(float DamageAmount);
```

This exposes health properties and a damage function to the Blueprint graph, letting designers tweak values without touching code.

## Related Notes

- [[Getting Started with UE5]]
- [[Nanite Overview]]

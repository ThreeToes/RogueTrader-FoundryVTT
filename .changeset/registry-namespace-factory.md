---
"rogue-trader": minor
---

- Attached the talent condition and affliction procedure registries to `CONFIG.ROGUE_TRADER`, so modules can extend them at init as documented.
- Extracted a `createRegistries(seed, namespace)` factory so a sibling system module can seed and expose its own registries under its own CONFIG key, reusing the same registry primitives.
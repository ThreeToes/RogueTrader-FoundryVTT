---
"rogue-trader": patch
---

- Fixed the `TypeError: Cannot assign to read only property 'Actor'` uncaught rejection logged on every world load: the legacy character-type cleanup no longer assigns into the (v14-frozen) `game.documentTypes` registry but strips the retired types in place, so the type registry is actually cleaned instead of silently skipped.
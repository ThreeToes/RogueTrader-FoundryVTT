---
"rogue-trader": patch
---

- Career sheet advance rows now open their compendium talent/skill reliably in live worlds: they resolve through the shared pack-document resolver instead of `fromUuid`, and a broken link now warns (console + toast) instead of failing silently.
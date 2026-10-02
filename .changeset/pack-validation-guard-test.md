---
"rogue-trader": patch
---

- Added a pack validation guard that fails tests when compendium data violates a data model's field choices, bounds or value types (the navigator-power characteristic bug class now fails `bun test` instead of only erroring in-world).
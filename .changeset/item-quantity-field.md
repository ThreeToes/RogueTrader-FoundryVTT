---
"rogue-trader": minor
---

- Added a `quantity` field (integer, min 0, default 1) to the shared Gear data model, so every physical item family — weapons, armour, gear, ammunition, modifications and the rest — can now author a stack count; quantity 0 means spent or depleted.
- Ammunition no longer declares its own duplicate `quantity`; the inherited base default changes an un-authored ammunition's quantity from 0 to 1.
---
"rogue-trader": minor
---

- Item types the system does not declare are now refused by name instead of silently dead: the effect-liveness tables (always-live innate types and per-type equip states), the intrinsic-attack set and the effect breakdown's source labels moved from hard-coded rules code into the per-system item-taxonomy registry, the same seam the rule-knob registry uses. A stray item of an unknown type now raises a named error instead of quietly contributing nothing to tests or attacks.
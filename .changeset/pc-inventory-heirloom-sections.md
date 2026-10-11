---
"rogue-trader": patch
---

- Fixed heirloom items not appearing when added to an existing character: the inventory tab only carried the weapons/armour/gear/ammunition groups, so the two Table 1-2 heirloom special-abilities (Ancestral Seal, Reliquary of Saint Drusus) were cloned onto the actor but rendered nowhere — the drop looked broken. The inventory now has a "Special Abilities" section and a loud "Other Items" catch-all, so a dropped item of any type is visible (the NPC sheet's contract).
- Inventory rows without a weight (abilities, dataless items) no longer show a "0 kg" slot; non-equippable types get no stow/carry toggle.
- Inventory grouping is now a pure, unit-tested module (pc-inventory.ts) beside the NPC sheet's equivalent.

Translation note: the new "Special Abilities" / "Other Items" labels are machine-translated in es/fr/pl (best-effort, not native-reviewed).
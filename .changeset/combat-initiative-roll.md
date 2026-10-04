---
"rogue-trader": patch
---

- Added a Roll Initiative action: a button next to the character sheet's derived-initiative readout and a "Roll Initiative" entry on the core token context menu, rolling 1d10 + the derived initiative bonus (the Agility Bonus) into the active combat encounter through Foundry's default combat tracker (creating/joining combatants as core does). The combat tracker's OWN Roll Initiative button now works too: the system sets default initiative formula `1d10 + @initiativeBonus` (resolving the effective Agility Bonus, gear included) on roll data and CONFIG, so core's roll path and the sheet-button path produce identical results.
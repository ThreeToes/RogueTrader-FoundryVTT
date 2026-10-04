---
"rogue-trader": minor
---

- Added a Roll Initiative action: a button next to the character sheet's derived-initiative readout and a "Roll Initiative" entry on the core token context menu, rolling 1d10 + the derived initiative bonus (the Agility Bonus) into the active combat encounter through Foundry's default combat tracker (creating/joining combatants as core does). The combat tracker's OWN Roll Initiative button works too: the system sets the default initiative formula `1d10 + @initiativeBonus` (resolving the effective Agility Bonus, gear included) on roll data and CONFIG, so core's roll path and the sheet-button path produce identical results.
- The combat tracker's resource chip now defaults to each combatant's current Wounds (fresh worlds; a GM can still switch the slot to any tracked attribute in the tracker configuration).
- Ending a combat encounter now strips encounter-length fear conditions (shaken, frozen, fleeing, frenzied, unnerved) from every combatant automatically, as the conditions rules always promised — timed conditions still expire on their own clock.
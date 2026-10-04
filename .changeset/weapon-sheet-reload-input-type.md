---
"rogue-trader": patch
---

- Fixed the weapon sheet's reload field rendering as a number input while reload carries book notation ("Full", "2 Full", "Half"), which logged a console parse error from Foundry core for most of the arsenal; it is now a text input, as is range ("SBx3" formulas).
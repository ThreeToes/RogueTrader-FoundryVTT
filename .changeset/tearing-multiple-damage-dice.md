---
"rogue-trader": patch
---

- Fixed Tearing on weapons whose damage dice roll as separate terms (e.g. a 2d10 split by a numeric term in the formula): every damage die of the weapon's own die type now competes for the discard, so the lowest of 2d10 [8] + [2] is discarded instead of only the first die's results.
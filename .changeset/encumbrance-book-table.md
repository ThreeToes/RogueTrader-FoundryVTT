---
"rogue-trader": patch
---

- Load capacity now follows Core Rulebook Table 9-33 (p268): capacity keys on the sum of Strength Bonus and Toughness Bonus through the non-linear carrying table instead of the invented linear SB x 3 rule, and Encumbered is reported exactly when the load passes the Carrying Weight.
- Item quantities now count toward carried weight (a stack of 6 grenades weighs 6x, spent 0-quantity stacks weigh nothing); stowed items still count as before.
- Wound creation math verified against the Home World sections (2xTB + wound dice, pp18-23) and confirmed fixed at creation with no runtime Toughness recompute; the +5 Wounds advancement path is now pinned by a test.
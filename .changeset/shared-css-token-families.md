---
"rogue-trader": patch
---

- Dropped the dead fallback literals from every shared design token in the test dialog rules (the token root already defines all of them; the fallbacks were a silently divergent second copy of the palette).
- Widened the shared pick-chip, meter (cb-track/cb-fill) and small-caps gold label rules from `.rogue-trader.sheet` to the whole `.rogue-trader` root and deleted the advancement dialog's restatements, keeping only its genuinely different bits (gold meter fill, button background reset, toolbar search flex).
- Extracted one shared chip anatomy (border + radius + padding + type + cursor) with per-site modifiers, and collapsed the chip selected states into two named treatments: solid gold fill, and dim gold tint — chip chrome now tunes in one place instead of twelve.
- Consolidated the remaining duplicated gold label anatomy (header grid, warrant rows, advancement header, dialog ledger labels, target/vitals/battery-card strips) so each type step has exactly one rule.
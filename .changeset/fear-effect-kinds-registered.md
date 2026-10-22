---
"rogue-trader": minor
---

- Registered the fear-immunity and fear-reroll effect kinds in the effect registry: they now carry localized labels, are offered in the effect editor's kind dropdown and are constrained on the item effect schema, instead of rendering their raw slugs.
- Fear immunity and re-roll detection now reads through the shared effect collector rather than its own item walk.
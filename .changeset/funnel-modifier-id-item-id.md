---
"rogue-trader": patch
---

- Fixed funnel and damage modifier ids that keyed only on the item's name: two different same-named items (e.g. two "Medikit" gear items or identical trait rows on copies) each contribute their own modifier/soak again instead of the second being silently deduped away; a single item's duplicate rows still dedupe.
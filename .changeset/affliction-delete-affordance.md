---
"rogue-trader": patch
---

- Added a delete affordance to mutations and disorders/malignancies on the character sheet's Background tab — affliction chips now carry the same ×-anchor as talent rows (no confirm, as with talents). The chips were dead until the sheet's context also passed item ids through: the anchors rendered an empty `data-item-id`, so both the delete anchor and the mutation attack-roll chip did nothing.
- Character sheet tabs now preserve their scroll position across re-renders (deleting an affliction, equipping gear, etc. no longer jump the sheet back to the top).
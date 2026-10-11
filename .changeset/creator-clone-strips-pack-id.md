---
"rogue-trader": patch
---

- Character creator acquisition, skill and psychic-power grants no longer carry the compendium doc's `_id` into the created Items, so the same pack document can appear in both a kit slot and the chosen acquisition without duplicate `_id`s on one actor.
---
"rogue-trader": patch
---

- Fixed critical-damage chat cards and the critical panel building `BODY_LOCATION.LEFT-ARM`-style keys that fell back to raw key text: kebab-case locations now go through the shared `bodyLocationLabelKey` helper, and the NPC armour panel reuses it too.
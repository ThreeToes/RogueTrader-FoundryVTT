---
"rogue-trader": patch
---

- Fixed the ship initiative Boarding banner never rendering: the `boardedWith` read now matches the S2 pair-object schema and delegates to the shared kernel predicate.
- Untrained Intimidate in ship-combat Interaction rows now tests Strength instead of Fellowship (each row's printed characteristic is carried in the module table).
- The Silent Running −10 difficulty step now also shows as a visible row on the ramming, boarding and break-free combined tests (it was only on the manoeuvre actions).
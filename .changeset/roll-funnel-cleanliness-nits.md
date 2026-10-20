---
"rogue-trader": patch
---

- The roll funnel now checks the weapon document before resolving its attack profile, never relying on `attackProfileOf`'s incidental null tolerance.
- Ship salvos fold the critical-hit automatic Hull Integrity point into the same actor write as the salvo losses (one update, not two off a stale snapshot).
- A typo'd navigator-power mastery now warns loudly instead of silently reading as a +0 bonus.
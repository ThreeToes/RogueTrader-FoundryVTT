---
"rogue-trader": patch
---

- Fixed the dynasty sheet's Clear Warrant Path button: the picks record is now cleared with v14 deletion operators — an empty replacement object was silently dropped by the data layer, so the stored path survived (bead uuef). Selecting a row's "None" chip had the same failure and is fixed by the same change.
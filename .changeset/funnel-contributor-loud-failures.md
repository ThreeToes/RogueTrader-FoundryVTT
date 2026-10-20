---
"rogue-trader": patch
---

- Test-roll modifier contributors that mis-return (a forgotten return, a bare modifier instead of an array, a malformed or source-less entry) now log a console warning naming the failing source instead of silently dropping the breakdown row or crashing the roll dialog.
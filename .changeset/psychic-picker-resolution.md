---
"rogue-trader": patch
---

- The psychic power picker now resolves grants through the shared pack resolver instead of the raw `fromUuid` path that could silently do nothing in-world — a failed grant logs a warning and shows a toast.
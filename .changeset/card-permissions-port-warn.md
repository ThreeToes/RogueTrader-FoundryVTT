---
"rogue-trader": patch
---

- Chat-card damage and condition permission refusals now warn loudly through the shared Permissions port instead of silently doing nothing. Creator-menu refusals were already loud (`CREATOR.NO_CREATE_PERMISSION`); only their permission evaluation was re-routed to the port and moved to per-click time.
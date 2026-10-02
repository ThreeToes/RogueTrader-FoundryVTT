---
"rogue-trader": patch
---

- Stopped a console deprecation warning when right-clicking an actor in the Actors directory: the "Create …" context-menu entries now use Foundry v14's `ContextMenuEntry#visible` field instead of the deprecated `condition` (removed in v16).
---
"rogue-trader": patch
---

- Windows share one resizable-window contract again: every sheet, creator and picker now carries the shared `rtk-window` class, which provides a minimum-size floor fallback (320px × 240px) under each window's own concrete clamps and the standard content-scrolling rule.
- Catalog windows whose list could outgrow the window (the psychic, weapon-mod and ordnance pickers) now scroll their content instead of silently clipping the rows below the window edge.

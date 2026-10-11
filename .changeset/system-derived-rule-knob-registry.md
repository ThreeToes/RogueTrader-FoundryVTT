---
"rogue-trader": minor
---

- The house-rule machinery now runs on the ACTIVE system's rule-knob registry instead of always importing Rogue Trader's, so a second system in this family (Dark Heresy 2e) reuses the same app, merge, diff and import/export code instead of forking it.
- A rules pack's `kind` is now derived from the system it comes from (`<system>.rule-profiles`), so a pack authored for another system is refused by name rather than imported as if it were written for this one.
- Rogue Trader behaves exactly as before: the same knobs, the same core values, the same pack kind and the same settings — nothing in the UI or in the release output changes.

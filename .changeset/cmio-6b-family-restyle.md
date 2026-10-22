---
"rogue-trader": minor
---

- Chips are one component on every window: the shared chip base is keyed on role classes instead of per-site selectors, so the tags, badges and value chips on the psychic, dynasty, starship, combat and item sheets render the same boxed anatomy as the pickers and the test dialog.
- The two selected-chip treatments are named states — opaque gold for a committed choice, dim gold tint for a momentary state — so a new chip picks its meaning on purpose.
- Ship combat buttons share one neutral button anatomy; Roll Initiative, Default Manoeuvre and Emergency Repair stop rendering as raised Foundry chrome.
- Creator wizards (character, ship, planet, warrant) share one quiet frame — muted header, framed step sections, footer strips, a real stepper control for the planet modifier and a properly drawn roll button.
- Framed sections carry their frame again: the `border` class on sheet sections was inert markup and now gives the common framed-section anatomy everywhere it is written.
- Ship component status badges render as proper chips from one shared anatomy.
- Repaired an unterminated CSS comment in the ship sheet styles so the Combat tab stat-grid wrap floor reads as an explicit rule.
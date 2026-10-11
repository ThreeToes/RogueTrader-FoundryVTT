---
"rogue-trader": minor
---

- The house-rule profiles set up by the rule-profile settings can now be edited
  in a **rules app** (Configure Settings → Manage house rules, GM only).
- Profile management in one window: the profile list (with the non-editable
  Core Rulebook entry), create, duplicate, rename, delete, and activate. The
  two settings stay `config: false`, so the app is the only editor — a GM can
  never hand-write a profile the app cannot render.
- The knob form is generated from the knob registry: grouped by section, with
  each rule's Core Rulebook value and its hazard class (auto-recomputed,
  creation-only, ledger-assuming) beside the control, and the hit-location
  table as a whole-replacement band editor. A knob left at its core value
  stores nothing, so an untouched profile is core rules.
- A per-profile JSON tab edits the stored delta directly and validates on save:
  an unknown key or a wrong-typed value is rejected and NAMED, never dropped.
- A diff panel shows core vs effective, and marks the ledger-assuming rules
  (pre-spent xp baseline, Elite Advance cost) BREAKING, because changing them
  makes the spent-xp ledger of every existing character wrong.
- Every new string is translated in en, es, fr and pl. The retired
  `HOMEBREW.PROFILE_NAME` / `HOMEBREW.PROFILE_HINT` keys are gone.

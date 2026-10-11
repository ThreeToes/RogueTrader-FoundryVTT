---
"rogue-trader": minor
---

- Named house-rule profiles are a world configuration seam: a GM stores profiles
  (id, name, knob-keyed delta) in world settings, names the active one, and every
  rule reads the merged result — home rules as data, never a core-code edit.
  Profiles are edited by the rules app, not the native settings form, and an
  unknown id, an empty profile or a blank list all mean the Core Rulebook as
  written.
- **UPGRADE NOTICE:** worlds that had set the old "Homebrew rules profile (JSON)"
  setting have those rules CLEARED on upgrade — the value is not migrated. Any
  prior house rules must be re-entered as a named profile.
- The active rule profile is decoded, validated and merged once per stored value
  instead of once per roll, so an inert or malformed profile nobody has fixed
  stops reporting itself on every attack roll.

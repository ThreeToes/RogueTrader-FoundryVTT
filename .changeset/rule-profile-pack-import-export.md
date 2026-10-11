---
"rogue-trader": minor
---

- Share house-rule profiles as rules packs: the Rules app has an Import / Export tab that writes the active profile (or every profile) to the clipboard or a .json file, and imports one from pasted JSON or a picked file.
- Import is the loud path — unlike reading the world's own setting, a wrong pack kind, an unsupported schema version or an unknown knob refuses the whole pack and NAMES the problem in the app instead of falling back silently.
- A pack records the rules its deltas were authored against, so a later Core Rulebook change can be spotted; the optional snapshot is display-only and never affects what the rules resolve to.
- Importing merges by id: a new profile is added (and can become active straight away), a same-id profile asks before it overwrites.

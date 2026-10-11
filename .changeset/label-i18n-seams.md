---
"rogue-trader": patch
---

- Localized the raw modifier-source labels in the toxic Toughness-test row and the untrained-skill row (SOURCE.FROM_TOXIC / SOURCE.FROM_SKILL) in all four languages, instead of "toxic"/"Skill" free text that warned and never translated.
- The roll card's success line is now one interpolated i18n key (ROLL.SUCCESS_WITH_DEGREES = "Success (+{degrees} degrees)") in all four languages, so other languages can reorder the sentence.
- The damage-type dropdown choices come from one shared damageTypes registry seed instead of a copy-pasted map on the weapon, gear and psychic-power sheets — the psychic-power picker now shows localized labels too.
- Madness-entry kind labels moved from a sheet-local map into the shared madnessEntryKinds registry, so modules can register new kinds with CONFIG.ROGUE_TRADER.madnessEntryKinds.register(...).
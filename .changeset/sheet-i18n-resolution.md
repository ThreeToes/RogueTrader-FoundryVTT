---
"rogue-trader": patch
---

- Fixed the navigator power sheet's mastery row: it composited the translation key from the schema's lowercase value (`NAVIGATOR_POWER.novice`) so every read-only power showed the raw key instead of "Novice" / "Adept" / "Master". The label is now resolved in the sheet, the same seam the characteristic label already used.
- Added the missing `TYPES.Item.gearset` translation, so the starting-kit item type shows a real name in sheet pickers instead of the bare key. Added to all four languages.
- Added a regression guard that renders the real templates against the real `lang/en.json` through a stub `localize` that flags any unresolved key, so a lowercase-composited or dictionary-missing key now fails the test suite rather than shipping untranslated text to a world.

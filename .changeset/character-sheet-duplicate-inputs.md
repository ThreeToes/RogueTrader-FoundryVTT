---
"rogue-trader": patch
---

- Fixed character-sheet edits failing with "insanity: must be a number / corruption: must be a number": the Insanity and Corruption points had bound inputs in two parts of the same sheet (header tracker and Background tab), so Foundry collected both as an array and rejected the whole update. The Background tab now shows the read-only totals and the header chips are the single editing surface.
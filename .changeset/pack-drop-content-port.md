---
"rogue-trader": patch
---

- Fixed drops of compendium Items onto the character inventory, cache, planet game-table attach and vehicle mounted-weapon surfaces silently doing nothing — they resolved through generic uuid lookup, which resolves to nothing for the system's LevelDB compendium packs in-world. All four now resolve through the shared pack resolver.
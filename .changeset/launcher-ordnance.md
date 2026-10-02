---
"rogue-trader": minor
---

- Added launcher ordnance: ranged weapons of the Launcher family now carry an explicit accepted-ordnance kind (`acceptsAmmo`) and a loaded slot (`loadedAmmoId`), resolved against the owning actor's items at attack time — an unloaded launcher's damage roll warns and refuses instead of rolling the book's "—" damage, and loaded ordnance (missile ammunition or grenades) supplies the damage, damage type, penetration and qualities.
- Added the launcher Load/Unload affordances on the weapon sheet: drag an accepted item onto the sheet, or use the Load button's picker of the actor's accepted ordnance; one click unloads, and the loaded item's name and remaining quantity display on the sheet.
- Ammunition is now its own group on the character sheet's inventory tab and the NPC sheet's inventory list: owned ordnance is visible again (drag-to-either's missing half) and its rows drag out to a launcher's load drop, showing the xN quantity count in the weight slot and no equip toggle.
- Added an `ordnance` block to the Ammunition data model (kind, damage, damage type, penetration, qualities) so launcher ammunition carries a real fire profile, displayed read-only on the item sheet.
- Added manual usage tracking to the damage card: cards from a loaded launcher show a usage chip with the fired item's name and remaining quantity plus a one-click −1 spend button (owner/GM permissions); nothing is consumed automatically.
- Localised the load model, the usage chip and the spend affordance in all four system languages.
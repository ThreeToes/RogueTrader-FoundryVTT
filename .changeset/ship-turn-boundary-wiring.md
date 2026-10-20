---
"rogue-trader": patch
---

- Fixed ship-combat turn state going stale (Core Rulebook pp214-218): turn flags now EXPIRE at the starship's own Strategic Turn — the combat tracker's turn change runs the expiry + the previous-turn crew-loss rotation for the ship whose turn starts. Evasive Manoeuvres / Come to New Heading / Lock on Target / Aid the Machine Spirit / Put Your Backs Into It! flags no longer persist forever, and Triage + Hold Fast! now actually cancel the previous turn's Crew Population / Morale damage instead of always reporting nothing to cancel.
- The Aid the Machine Spirit flag is now READ at the combined test: the aided ship's Manoeuvrability/Detection roll carries its +5 as a visible modifier row (Core Rulebook p216).
- The Put Your Backs Into It! flags are now READ at their roll points: the chosen weapon component's salvo and the Emergency Repairs roll carry the +5 as visible rows (Core Rulebook p218); the fire-fighting option (no automatic roll machinery) states on the card that the +5 is applied manually by the GM.
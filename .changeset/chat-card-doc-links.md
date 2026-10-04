---
"rogue-trader": patch
---

- Chat cards (weapon attack, damage, psychic, navigator) render the weapon/power name in the title as a link (tooltip: "Open document"): clicking opens the item's compendium doc read-only, and hand-made or unresolvable names stay plain text. The cards' own buttons (Roll Damage, Apply Damage, toxic test, ordnance spend) are untouched. The chat click handler only fires for anchors inside chat messages, so the advancement dialog's own doc links keep their single dispatch.
- Shared the compendium pack-fetch cache (bead j4io) into pack-resolve so the card links resolve through the same session cache as the advancement dialog.
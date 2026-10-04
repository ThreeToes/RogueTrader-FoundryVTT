---
"rogue-trader": minor
---

- Advancement dialog rank rows now link to their compendium pack entry when one resolves — click the name to open the item's read-only sheet and argue the rules from the source.
- Chat cards (weapon attack, damage, psychic, navigator) render the weapon/power name in the title as a link (tooltip: "Open document"): clicking opens the item's compendium doc read-only, and hand-made or unresolvable names stay plain text. The cards' own buttons (Roll Damage, Apply Damage, toxic test, ordnance spend) are untouched, and the chat click handler only fires for anchors inside chat messages, so the other doc-link surfaces keep their single dispatch.
- Character creator pick chips (career, Origin Path, and the talent option picks) carry the same doc-link affordance — clicking the book icon opens the pack document's sheet read-only, one click from the real rules text while choosing.
- The career link's sheet-less failure toast now interpolates the document uuid instead of rendering a literal `{uuid}` placeholder.
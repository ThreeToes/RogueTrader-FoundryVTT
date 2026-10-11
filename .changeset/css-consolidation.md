---
"rogue-trader": patch
---

- Fixed the amber `.method-hint.warn` styling so it also lights the ship creator's "no options for hull" hint and the chat salvo's crippled note, not just the ship refit tab.
- Removed a shadowed duplicate unequipped-weapon dim rule so the 0.4 opacity level is defined once.
- Removed dead Psy Rating CSS whose input moved to the sheet header.
- Added a `--rt-chat-note` token for the chat-card note ink and collapsed the four note rules into one anatomy.
- Extracted one shared pip family for void-shield pips and unnatural multiplier pips.
- Removed the redundant starship inventory-name rule; ship delete icons now follow the shared faded-red-delete anatomy (muted until hover) instead of always-red.
- Removed a redundant character header-portrait rule and an inert `align-content` line on gear `.stats`.
- Moved the ship-salvo chat card's inline list styling into the CSS bundle as `.salvo-list`.
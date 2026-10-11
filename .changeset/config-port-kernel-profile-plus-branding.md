---
"rogue-trader": minor
---

- The rules' config port now hands out the shared, system-neutral rule profile plus the two bits of system branding (the chat-flag namespace and the roll-card template) instead of Rogue Trader's own creation/advancement constants, so a second system in this family (Dark Heresy 2e) can be driven through the same port, the same roll pipeline and the same home-rule seam without forking any of it.
- Rogue Trader behaves exactly as before: the same profile object, the same chat-flag namespace, the same roll card and the same rules — nothing in the UI or in the release output changes.
- A system that has not named a chat-flag namespace or a roll-card template yet is now told so loudly instead of silently writing chat flags under nothing, so the gap is visible at the point it matters rather than lost.

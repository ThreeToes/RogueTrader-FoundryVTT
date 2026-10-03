---
"rogue-trader": patch
---

- Fixed English roll cards showing the raw `SOURCE.FROM_POWERS` key on psychic and navigation chat cards; the "Powers" source label now localises like the other languages.
- Added a repo-wide i18n guard test asserting identical key sets across all four language files and that every statically referenced key exists, with a recorded allowlist for runtime-composed key families.
- Localised the unloaded-launcher warning: firing an unloaded launcher showed the raw `ROLL.LAUNCHER_UNLOADED` key instead of a message, in every language; the key now exists in all four language files.
- Extended the i18n guard's static scan to also collect keys passed to the notify announcements port (`notify.info/warn/error("KEY")`), so future notification keys cannot silently fall back to the literal string.

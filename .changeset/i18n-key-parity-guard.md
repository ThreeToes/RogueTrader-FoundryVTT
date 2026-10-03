---
"rogue-trader": patch
---

- Fixed English roll cards showing the raw `SOURCE.FROM_POWERS` key on psychic and navigation chat cards; the "Powers" source label now localises like the other languages.
- Added a repo-wide i18n guard test asserting identical key sets across all four language files and that every statically referenced key exists, with a recorded allowlist for runtime-composed key families.
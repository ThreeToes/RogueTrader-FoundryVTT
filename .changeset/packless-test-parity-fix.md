---
"rogue-trader": patch
---

- Made the careers emitter honest on packless checkouts: `keyAdvance` now degrades to verbatim-name resolution with a console warning when the packs are absent, instead of throwing ENOENT; the emit CLI keeps its loud missing-packs gate.
- Added a packless parity pass to the pre-commit hook: it runs `bun test` in a throwaway worktree without `src/packs` (the CI condition), closing the helper-indirection class the static pack-read guard cannot see.
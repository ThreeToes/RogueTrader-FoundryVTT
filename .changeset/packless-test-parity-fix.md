---
"rogue-trader": patch
---

- Made the careers emitter honest on packless checkouts: `keyAdvance` now degrades to verbatim-name resolution with a console warning when the packs are absent, instead of throwing ENOENT; the emit CLI keeps its loud missing-packs gate.
- Added a packless parity pass to the pre-commit hook: it runs `bun test` in a throwaway worktree without `src/packs` (the CI condition), closing the helper-indirection class the static pack-read guard cannot see. Hardened against three probe-discovered defects: git's inherited GIT_INDEX_FILE no longer silently skips the pass (setup failure refuses the commit), and the pass gates the STAGED tree (`write-tree` + `read-tree -m -u`), not the previous HEAD.
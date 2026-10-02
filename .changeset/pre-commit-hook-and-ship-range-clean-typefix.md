---
"rogue-trader": patch
---

- Added a versioned `.githooks/pre-commit` hook that runs typecheck, lint, tests and template verification before a commit (install once per clone with `bun run hooks:install`; bypass with `--no-verify`). A guard test keeps the hook's check set aligned.
- Fixed the `bun run typecheck` error on the ship-weapon range schema's `clean` option without touching its runtime behaviour.
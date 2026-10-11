---
"rogue-trader": minor
---

- The build can now emit a second Foundry system from this same source tree: `bun utils/build.ts --system dark-heresy-2e` (or `SYSTEM=dark-heresy-2e bun run build`) writes `release/dark_heresy_2e/` — its own entry-point bundle resolved against the SHARED `src/ffg` + `src/rules-engine`, plus its own manifest. Nothing else changed for Rogue Trader: a bare `bun run build` still builds Rogue Trader only, and its output is byte-identical.
- The Dark Heresy 2nd Edition system boots from that package and claims the two shared seams at init: DH2's rule-knob registry replaces RT's for that process, and DH2's profile (the shared `dh2Core` data plus DH2's own branding) resolves through the widened config port — so the kernel, the funnel and the roll machinery read DH2's rules with no fork of RT's code.
- The shared layers are now guarded against naming the sibling system: `src/ffg/**` and `src/rules-engine/**` may carry no `dark-heresy`/`dark_heresy` literal, and the architecture test fails if one appears.
- The public release stays Rogue Trader-only, now guarded by a test: the public and private workflows build the default target, the public zip still contains only `release/rogue_trader`, and no build or release script names the sibling unless someone edits it deliberately.

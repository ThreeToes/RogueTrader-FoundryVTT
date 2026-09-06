# This Project

This project is to create a system for FoundryVTT for the Rogue Trader RPG.

# General rules

- Write unit tests where approriate
- Follow existing patterns
- **Terminology: always cite the core book as "Core Rulebook", never "rt_core"**
  (bead 3it4). `rt_core` is only the machine slug where a literal file/directory
  name is required (e.g. `rt_core.pdf`, `--book rt_core`, `extracted-text/rt_core`).
- Use `bun run build` to test application builds, do not hack together bash,
  typescript, javascript or python scripts to try and test the compile
- Use `bun run lint` before declaring any typescript changes done
- When implementing UIs, always make sure the window is resizable
- When modifying i18n strings, update all different translations
- **DO NOT** invoke bash if you have a tool available to achieve your goal
- **DO NOT** invoke bash or write scripts to edit files, use built in
  editing tools instead

- **DO NOT** invoke bash if you have a tool available to achieve your goal
- **DO NOT** invoke bash or write scripts to edit files, use built in
  editing tools instead

# Extraction & rules-engine decisions (apply to future 40k systems)

Conventions decided during the Rogue Trader core-rulebook extraction; reuse
them for any other FFG 40k system brought into this repo (Dark Heresy, Only
War, Black Crusade...).

## Extraction conventions

- **PDFs are machine-local.** Book content lives in the private `src/packs`
  repo and never ships; commit machinery + our own YAML only.
- **Trust the raw text layer over `-layout`** for clipped columns:
  `-layout` silently width-truncates long table cells (see the talents
  "Benefi" header — that truncation is in the BOOK, but other clipped text
  is a layout artifact; verify with raw mode before re-extracting).
- **Verify ambiguous extraction with the owner** — log ambiguity as beads
  WITH page references and sample rows (e.g. "Air of Authority, p92") so the
  owner can eyeball the PDF; never guess at book content. Confirmations are
  recorded on the bead before closing it.
- **Curation patches are config entries, not code** (see
  `src/packs/.extraction-src/parse-tables.yaml`): every hand-set value must
  carry a comment citing where it was verified (page + line). Unmapped
  values fail loudly (emit script throws) — never silently drop.
- **Table parsing patterns that recur across FFG books**: header-offset
  column slicing, per-page repeated table headers = one table, wrapped names
  (prefix/suffix/paren forms), above/below split cell values, name/class
  column overlap recovery, footnote-terminated table regions. All handled in
  `parse-table.mjs` — extend it, don't fork it per book.
- Spot-check every table against the PDF (3-5 rows) before dropping DRAFT
  markers; run `bun run build:packs`, `bun test`, `bun run lint` before
  closing extraction beads.

## Rules-engine design decisions

- **Schema-first, book-notation at the edges**: data models use structured
  fields (e.g. `rateOfFire {singleShot,burst,fullAuto}`, string
  `reload`/`range`); extraction emits schema shape via mapping tables with
  loud failures.
- **Item descriptions come in both flavours**: terse table text (short) AND
  full prose (long) — the group argues rules from item sheets, so terse-only
  is never acceptable.
- **Effect machinery before content authoring**: extend the effect-kind
  machinery (attack-modifier, damage-flat, critical-damage, conditional
  kinds) before mass-authoring talent/power effects.
- **Homebrew is a seam, not a fork**: house rules (e.g. tuning the silly
  burst/full-auto BS bonuses) are data-driven RuleProfile/funnel overrides,
  GM-configurable — never edit core rules code for house rules.
- **No fabricated taxonomy**: the book defines no talent tiers; don't invent
  metadata fields the book doesn't support without an explicit owner
  decision.
- **Modifiers are visible**: every test path shows contributor breakdowns in
  the TestDialog (skill rolls currently bypass it — bead 02u); silent
  modifiers are bugs.

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Review available tools for details.

### Rules

- Use beads for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists

## Agent Context Profiles

Agent onboarding: see [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md) and the visual
conventions in [docs/DESIGN-LANGUAGE.md](docs/DESIGN-LANGUAGE.md). Before closing UI or
lifecycle beads, run the manual pass in [docs/QA-CHECKLIST.md](docs/QA-CHECKLIST.md).

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

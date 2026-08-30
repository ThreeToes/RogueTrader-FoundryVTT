# Agent Guide

Session-earned, verified knowledge for agents working on this system. Consult this
**before** guessing about Foundry behavior — most recurring bugs here were already
answered in core source in minutes.

## 1. AppV2 context contract

`DocumentSheetV2._prepareContext` provides ONLY:

```
{ document, model, source, fields, editable, user, rootId }
```

It does **not** provide `actor` or `system` (V1 vocabulary). Using `system.*` or
`actor.*` binds in AppV2 templates silently produces **blank** values, and on submit
Foundry throws `DataModelValidationError: may not be a blank string`.

- Bind raw editable fields to `source.system.*`.
- Expose derived/computed data via explicitly named context properties added in the
  sheet's `_prepareContext` override.

## 2. Tab switching

Tabs dispatch via `data-action="tab"` ONLY (core `#onClickAction` → `case 'tab'` →
`_onClickTab`). Bare `data-tab` / `data-group` attributes do nothing. Correct pattern:

```hbs
<button type="button" data-action="tab" data-tab="skills" data-group="primary">…</button>
```

## 3. Foundry hooks are NEVER awaited

There is no async work in `preCreate` hooks. Patterns that work:

- Lazy cache at `ready` hook.
- Grant/default documents at `createEmbeddedDocuments` time.
- Render-time backfill on the sheet.

## 4. Legacy pack format (.db)

Legacy `.db` packs are **newline-delimited JSON, one document per line**. Inserting a
JSON array produces a single invalid array document. (Note: the pack pipeline is
**parked** pending a LevelDB-format redesign — see bead `cjn`. Do not patch it.)

## 5. Core source is installed locally

```
~/apps/foundryvtt/FoundryVTT-Linux-14.366/resources/app
```

CONSULT IT for any document-lifecycle / form / context / hook question **before
guessing**. Three recurring session bugs (tabs, context paths, pack format) were all
answerable there in minutes.

## 6. Build & deploy

- Build tasks: `bun run build:js | build:css | build:packs | build:manifest |
  build:languages | build:templates` (aggregate: `bun run build`).
- `release/` is symlinked into the test world (`~/Documents/rogue-trader-test`), so a
  Foundry refresh in the browser **IS the deploy step**.
- Build prunes `release/template`.
- Foundry pack migrations regenerate gitignored LevelDB artifacts — don't delete them.

## 7. i18n discipline

All new keys go into **en, es, fr, pl in one change**. Missing keys fall back to `en`.
Best-effort translations of es/fr/pl should be flagged as such — machine translation
terminology has not been native-review-checked here.

Visual conventions (palette, typography, layout patterns, sizing): see
[DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) — match its tokens whenever restyling.

**i18n audit checklist** (rerunnable, per bead 201): (1) extract `localize ""`
from all `template/**.hbs` + `i18n.localize|format ""` from `src/**` + quoted
registry-family keys; (2) diff against `en` — every used key must exist there;
(3) diff `en` against `es/fr/pl` — every used or registry-family key must exist
in all four; (4) treat registry-seeded key families (QUALITY.*, CLASS.*,
BODY_LOCATION.*, VEHICLE_*, TALENT*, EQUIP_STATE.*) as used-by-construction;
(5) check duplicate keys per file (JSON parsers silently swallow them);
(6) legacy DH-fork keys exist that are unused but NOT deleted (risky) — flagged
in bead 201. Re-run after every lang edit and before releases.

## 8. Verification discipline

`bun` tests green + bundle built + biome clean does **NOT** prove Foundry-runtime
behavior. UI/lifecycle changes require a live-world check per
[QA-CHECKLIST.md](QA-CHECKLIST.md), or an explicit
`UNVERIFIED IN WORLD: <what to check>` note when closing the bead. Never silently.

## 9. data-action attribute pairing convention

Action handlers read state from `target.dataset.*`. The template's `data-*`
attribute names MUST exactly match what the handler reads — a mismatch is a
silent no-op (e.g. `data-value` vs `dataset.ladder` broke every skill ladder
button). When adding an action: write the handler first, copy its expected
dataset keys into the template, then grep the template for that `data-action`
to confirm every call site supplies them.
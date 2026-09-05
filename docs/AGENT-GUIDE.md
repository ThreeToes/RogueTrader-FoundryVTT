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

## 1b. Sheet classes sharing templates must each provide their context

Item tab templates are shared across sheet classes, but every sheet class
computes its own context — extending nothing for free. Example (bead f65
follow-up): the item Description tab (notes.hbs) reads `descriptionHTML` and
`editable`, but only GearSheet/TalentSheet/PsychicPowerSheet computed
`descriptionHTML`; WeaponSheet and ArmourSheet extend ItemSheetV2 directly and
silently rendered an empty tab despite the pack data being correct. When adding
a context key consumed by a shared template, grep the registered sheet classes
for that template and add the computation to every one of them.

## 2. Tab switching

Tabs dispatch via `data-action="tab"` ONLY (core `#onClickAction` → `case 'tab'` →
`_onClickTab`). Bare `data-tab` / `data-group` attributes do nothing. Correct pattern:

```hbs
<button type="button" data-action="tab" data-tab="skills" data-group="primary">…</button>
```

## 2b. LevelDB packs: embedded collections need sublevel records

Foundry v14 compendium packs store embedded collections (e.g. RollTable
`results`) as a SUBLEVEL, not inline. Abstract-level's sublevel separator is
"!", so the layout is:

- `!tables!<tableId>` -> the RollTable source, with `results` = an array of
  result _ids (NOT the inline objects);
- `!tables.results!<tableId>.<resultId>` -> each result record
  ({_id, type: 0, text, img, documentCollection: null, documentId: null,
  weight, range: [start, end]}).

Inline result objects or strings in the table doc are dropped on load and
Foundry warns "N embedded results records ... were undefined and not retrieved
from the tables.results sublevel". Items have no embedded collections, which
is why the flat `!items!<id>` form works. utils/compendia.ts buildPack handles
the split for table packs — keep it that way when adding new pack document
types with embedded collections (e.g. actors with items).

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
in bead 201. Re-run after every lang edit and before releases. **Gotcha**
(bead 9n3): extraction regexes must allow keys spanning lines/nested quotes —
`localize "X"` inside `{{#if}}` blocks or `concat` calls is easily missed;
when in doubt, quote-strip and rerun rather than trusting a first-pass gap list.

## 8. Verification discipline

`bun` tests green + bundle built + biome clean does **NOT** prove Foundry-runtime
behavior. UI/lifecycle changes require a live-world check per
[QA-CHECKLIST.md](QA-CHECKLIST.md), or an explicit
`UNVERIFIED IN WORLD: <what to check>` note when closing the bead. Never silently.

## 9. Authoring compendium packs (local workflow)
The packer (`bun run build:packs`, utils/compendia.ts) converts YAML to Foundry 14
native LevelDB packs. **Authoring sources are local-only** — `src/packs/` is
gitignored and NO copyrighted game data (RT book skill/talent/lists) may be
committed or shipped. Input contract, per `src/packs/<pack>/*.yaml`:

```yaml
- name: My Talent          # becomes the item name; deterministic id derived
  type: Item
  system:
    category: offence      # talentCategories registry key (talent packs)
    tier: 1
    prereqTalent: ""       # registry key of a prerequisite talent (optional)
    effects:               # kind selects the consuming handler/contributor
      - kind: test-modifier
        testKey: ""        # empty = all tests; else characteristic key
        value: 10
        label: My Talent
```

Emit: `release/packs/<pack>` LevelDB (keys `!items!<id>`). Add a matching `packs`
entry to the dev manifest (system-manifests/dev.json) when authoring a new pack.
Users who want official book lists import them via Foundry's own compendium
importer themselves — the system ships the machinery, not the data.

## 10. data-action attribute pairing convention

Action handlers read state from `target.dataset.*`. The template's `data-*`
attribute names MUST exactly match what the handler reads — a mismatch is a
silent no-op (e.g. `data-value` vs `dataset.ladder` broke every skill ladder
button). When adding an action: write the handler first, copy its expected
dataset keys into the template, then grep the template for that `data-action`
to confirm every call site supplies them.
## 11. Code map — effect machinery, advancement, origins, homebrew

Session-earned map of where things live (beads fjw/yb6/r1k/bpd/ay0/g7k/tfk/9if):

- **Effect kinds**: registry + handlers = `src/roguetrader/rules/talent-effects.ts`
  (`talentEffectHandlers` seam, CONFIG-attached in `sheet/init.ts`); test-modifier
  collection = `rules/funnel.ts` (`collectTestModifiers`, contributor registry
  `testContributors`); damage pipeline = `rules/adapter.ts` +
  `collectTalentDamageEffects` (weapon-scoped since 2k5: the attacking weapon's
  own effects apply, gear/armour damage effects inert); effects schema field on
  `data/item/gear.ts` (inherited by Weapon/Armour) + `talent.ts`; editor =
  `template/sheet/item/parts/effect-tab.hbs` + `sheet/item/effect-actions.ts`
  (kind dropdowns from `talentEffectHandlers.kinds()`).
  **Rule of thumb**: new effect kind = register handler + (if roll-mechanic)
  kernel/adapter support — never data-only.
- **Advancement** (g7k/ayw/clng): pure engine = `rules/advancement.ts` (ledger,
  derived rank, Table 2-2 thresholds, PRE_SPENT_BASELINE 4500); ledger on
  `Character.system.advances`; dialog = `sheet/actor/advancement-dialog.ts`
  (single Foundry-coupled layer); creator sets xp {total: 5000, spent: 4500}.
- **Character creation** (ay0): origin chart + mechanics = `origins.ts` (30
  entries, verbatim + structured; chart adjacency from Core Rulebook p16);
  pure creation logic = `rules/creation.ts`; wizard =
  `sheet/actor/character-creator.ts` (also updates an existing actor when
  right-clicked); origin picks persist on `Character.system.origins`;
  consolidated Background tab shows origins + career link + talents.
- **Prereqs** (tfk): pure evaluator = `rules/prereq.ts` (grammar: comma = AND,
  "or" = OR group; characteristic thresholds, "Psy Rating N", talent names,
  specials-as-names); soft confirm wired into the talent picker (parses
  "Prerequisites: ..." from the pack description) and the advancement dialog.
- **Homebrew** (9if): `rules/homebrew.ts` — world setting `homebrewProfile`
  (JSON) read via `CONFIG.ROGUE_TRADER.homebrew.getProfile` in the funnel;
  pilot = fire-mode bonuses; add new overrides as profile fields + a resolver,
  never if/else in contributors.
- **Encumbrance** (yar): `rules/encumbrance.ts` — `carriedWeight` filters by
  equip state (carried weapons/gear, worn armour).

## 12. Extraction conventions (pointers)
The extraction workspace lives in `src/packs/.extraction-src/` (gitignored) —
read its README first: per-column rectangle technique, parse-tables.yaml
curation patches (cite page + line, loud failures), spot-check 3-5 rows against
the PDF, both terse AND prose descriptions per item, verify ambiguity with the
owner via beads. PDFs are machine-local at ~/Documents (Core Rulebook =
`rt_core.pdf`, cited as "Core Rulebook" in user-facing text, `rt_core` in code
comments). Packs register in system.json + system-manifests/dev.json.

# UI Design Language

Canonical visual conventions for Rogue Trader system UIs. When building or restyling
any sheet/component, match these tokens. Canonical implementations:
`less/less/sheet/*.less` (imported by `less/rogue-trader.less`).

## Color palette

All colors are design tokens on the `.rogue-trader` root (bead 3vl6), defined at
the top of `css/sheet-gear.css` (the first file of the CSS bundle). Use the
token, never the raw hex:

| Token | Value | Use |
|---|---|---|
| `--rt-gold` | `#b8860b` | Labels, roll anchors, active ladder, pips, part labels |
| `--rt-gold-soft` | `#d9c38a` | Highlight text (equipped glow, active steps, rank-up notes) |
| `--rt-muted` | `#7a6a53` | Secondary text, group labels, separators, units |
| `--rt-muted-deep` | `#5a4f3f` | "Off" segments (RoF `-`, zero overlays), grips |
| `--rt-muted-faint` | `#55503f` | Stowed equip toggles |
| `--rt-danger` | `#8b5e52` | Destructive actions (`skill-delete`, `inv-delete`) |
| `--rt-danger-deep` | `#c0392b` | Over-encumbered state, negative modifiers |
| `--rt-danger-alarm` | `#b71c1c` | Chat-card failure values |
| `--rt-success` | `#7ca860` | Encumbrance OK fill, positive modifiers |
| `--rt-border-solid` | `rgba(122, 106, 83, 0.9)` | Sustain-active borders |
| `--rt-border-strong` | `rgba(122, 106, 83, 0.5)` | Container/panel borders |
| `--rt-border` | `rgba(122, 106, 83, 0.4)` | Footer strips, pick chips, acq headers |
| `--rt-border-mid` | `rgba(122, 106, 83, 0.35)` | Short-description underline |
| `--rt-border-soft` | `rgba(122, 106, 83, 0.3)` | NPC armour table rows |
| `--rt-border-dim` / `--rt-border-faint` | `rgba(122, 106, 83, 0.25 / 0.2)` | Sustain fill, subtle rows |
| Panel fill | `rgba(0, 0, 0, 0.2)` | Slight inset background inside bordered groups (literal) |
| Pips lit glow | `0 0 3px rgba(184, 134, 11, 0.8)` | Lit unnatural pip (literal) |

## Typography

Type steps are tokens on the same root (bead o6gx): `--rt-fs-xs` `0.75em`,
`--rt-fs-sm` `0.78em`, `--rt-fs-md` `0.85em`, `--rt-fs-lg` `0.9em` (0.72/0.75
fold into xs, 0.78/0.8 into sm, 0.92/0.95 into lg). Corner radii:
`--rt-radius` `4px`, `--rt-radius-sm` `3px` (5px folded into 4px).

- **Section headings**: `<h1>` inside `.stats`/`.combat`/`.inventory` — large serif
  display style, `margin-bottom: 8px` (see `.stats h1` rules).
- **Field labels** (small-caps gold, ONE shared rule — bead xcte):
  `--rt-fs-sm`, bold, uppercase, `letter-spacing: 0.05em`, `--rt-gold` — scoped
  as `.rogue-trader.sheet .stats-row .stat > label` plus the starship/npc
  stat-grid, npc-chars th, career-table thead th, part-label and chip-label
  selectors.
- **Group labels** (`h2.skill-group-label`, `h2.inv-group-label`):
  `--rt-fs-lg`, uppercase, `--rt-muted`, `margin: 8px 0 2px`.
- **Chip labels** (stat-footer chips, capacity): `--rt-fs-sm` bold uppercase gold.

## Layout patterns

- **Rows**: `.stats-row` = flex, `gap: 8px`, `justify-content: space-between`,
  `margin-bottom: 4px`; children `.stat` are flex-column, `flex: 1`
  (`.grow-2` doubles a field's share). Scoped to `.rogue-trader.sheet` so ALL
  item sheets share it — never scope row CSS to one sheet class.
- **Characteristics**: 2-column reactive grid (`repeat(2, 1fr)`, `gap: 6px 24px`),
  each `.char-inputs` is one alignment row (dice icon, `flex: 1` label, value,
  bonus, always-visible unnatural pips).
- **Footer strips**: `.stat-footer` flex with `justify-content: space-between`,
  children `flex: 1 1 0` for even distribution.
- **Tab anatomy**: `<section class="tab" data-group="primary" data-tab="…">` wrapping
  a `.border` container with an `<h1>`; tabs dispatch via `data-action="tab"` ONLY.

## Component vocabulary

- **Composite input group**: bordered flex group with `/` separators
  (`.rof-composite` renders S/2/3: hidden checkbox → `S`/off span; number inputs; a
  `rof-zero` dash overlay when the value is 0).
- **Body-part boxes** (armour): bordered rounded rectangles in centered flex rows,
  gold small-caps label over large bold AP number.
- **Roll anchors**: `<a class="…-roll"><i class="fa-solid fa-dice-d10"></i></a>`,
  gold, `text-shadow: 0 0 4px currentColor` on hover.
- **Pips**: 8–9px circle `border: 1px solid #b8860b`, `.lit` fills gold.
- **Inventory rows**: `.inv-row` flex, grip icon, `flex: 1` ellipsized name (click
  opens sheet), muted weight, faded-red delete.

## Sizing rules

- Every sheet: `window: { resizable: true }` in DEFAULT_OPTIONS, **plus** CSS
  `min-width`/`min-height` on the sheet class — ApplicationV2 clamps resize to the
  app element's computed `minWidth`/`minHeight` (core `application.mjs:1124–1153`).
  Current: `.sheet.character` 500×400, `.sheet.weapon` 500×420.
- Fixed-width inputs: value inputs `3.5em`, bonus `2.5em`, weights `4em`, centered.

## i18n

All keys go into `en`, `es`, `fr`, `pl` in one change (missing keys fall back to
`en`). Insert with minimal-diff JSON (preserve file formatting/ordering); flag
best-effort es/fr/pl wording. Missing-localization console warnings are QA failures
(see docs/QA-CHECKLIST.md).

## Process

Restyles land as beads; before closing a UI bead run docs/QA-CHECKLIST.md and close
with an explicit `UNVERIFIED IN WORLD:` note when no live check was possible.
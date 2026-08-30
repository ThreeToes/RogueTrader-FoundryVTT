# UI Design Language

Canonical visual conventions for Rogue Trader system UIs. When building or restyling
any sheet/component, match these tokens. Canonical implementations:
`less/less/sheet/*.less` (imported by `less/rogue-trader.less`).

## Color palette

| Token | Value | Use |
|---|---|---|
| Gold (accent) | `#b8860b` | Labels, roll anchors, active ladder, pips (border/lit), part labels |
| Muted brown | `#7a6a53` | Secondary text, group labels, separators, units, inactive states |
| Faded red-brown | `#8b5e52` | Destructive actions (`skill-delete`, `inv-delete`) |
| Inactive/dim | `#5a4f3f` | "Off" segments (RoF `-`, zero overlays) |
| Hairline border | `rgba(122, 106, 83, 0.5)` | Container/panel borders (composite groups, body parts, encumbrance bar) |
| Footer border | `rgba(122, 106, 83, 0.4)` | `border-top` of footer strips |
| Panel fill | `rgba(0, 0, 0, 0.2)` | Slight inset background inside bordered groups |
| Pips lit glow | `0 0 3px rgba(184, 134, 11, 0.8)` | Lit unnaturual pip |

## Typography

- **Section headings**: `<h1>` inside `.stats`/`.combat`/`.inventory` — large serif
  display style, `margin-bottom: 8px` (see `.stats h1` rules).
- **Field labels** (item/gear/weapon sheets): `0.78em`, bold, uppercase,
  `letter-spacing: 0.05em`, gold — scoped as
  `.rogue-trader.sheet .stats-row .stat > label`.
- **Group labels** (`h2.skill-group-label`, `h2.inv-group-label`, `h2.skill-group-label`):
  `0.9em`, uppercase, `#7a6a53`, `margin: 8px 0 2px`.
- **Chip labels** (stat-footer chips, capacity): `0.78em` bold uppercase gold.

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
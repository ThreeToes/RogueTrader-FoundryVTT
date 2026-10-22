# UI Design Language

Canonical visual conventions for Rogue Trader system UIs. When building or restyling
any sheet/component, match these tokens. Canonical implementations: the shared base `css/sheet-gear.css` (design
tokens + shared sheet anatomy) plus the per-surface files `css/sheet-career.css`,
`css/sheet-starship.css`, `css/sheet-npc.css` (bead ophm: the career tables, the
starship hull/refit/combat surfaces and the GM NPC sheet live in their own
files, bundled right after the shared base), then `css/sheet-character.css` +
`css/chat-roll.css` + `css/chat-card.css`,
concatenated in that order by `utils/css.ts` into
`release/rogue_trader/css/rogue-trader.css` (plain CSS, no preprocessor).

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
| `--rt-chat-note` | `#4a3f31` | Chat-card note ink (modifier breakdown, quality notes, action note, ordnance usage) |
| `--rt-danger` | `#8b5e52` | Destructive actions (`skill-delete`, `inv-delete`) |
| `--rt-danger-deep` | `#c0392b` | Over-encumbered state, negative modifiers |
| `--rt-danger-alarm` | `#b71c1c` | Chat-card failure values |
| `--rt-success` | `#7ca860` | Encumbrance OK fill, positive modifiers, chat-card success values |
| `--rt-warn` | `#c25b3f` | Amber warnings (starship `damaged` state, battery `warn` banner, capacity/method hints, no-slot cards) |
| `--rt-on-gold` | `#fff` | Text on gold fills (checked chips, active ladder option) |
| `--rt-border-solid` | `rgba(122, 106, 83, 0.9)` | Sustain-active borders |
| `--rt-border-strong` | `rgba(122, 106, 83, 0.5)` | Container/panel borders |
| `--rt-border` | `rgba(122, 106, 83, 0.4)` | Footer strips, pick chips, acq headers |
| `--rt-border-mid` | `rgba(122, 106, 83, 0.35)` | Short-description underline |
| `--rt-border-soft` | `rgba(122, 106, 83, 0.3)` | NPC armour table rows |
| `--rt-border-dim` / `--rt-border-faint` | `rgba(122, 106, 83, 0.25 / 0.2)` | Sustain fill, subtle rows |
| `--rt-gold-alpha-faint` | `rgba(184, 134, 11, 0.15)` | Checked-chip / condition-chip gold fill |
| `--rt-gold-alpha-soft` | `rgba(184, 134, 11, 0.25)` | Career-table row underline |
| `--rt-gold-alpha-strong` | `rgba(184, 134, 11, 0.6)` | Fire-button hover glow (`0 0 6px`) |
| `--rt-white-alpha` | `rgba(255, 255, 255, 0.65)` | Dimmed secondary text on career content (prereqs, attributions, source line) |
| `--rt-panel-shade` | `rgba(0, 0, 0, 0.25)` | Deeper panel fill (readonly description blocks, ship-creator panels) |
| `--rt-panel-shadow` | `rgba(0, 0, 0, 0.3)` | Deepest panel fill (starship vitals strip) |
| Panel fill | `rgba(0, 0, 0, 0.2)` | Slight inset background inside bordered groups (blessed literal) |
| Pips lit glow | `0 0 3px rgba(184, 134, 11, 0.8)` | Lit unnatural pip / shield pips (literal; the one gold-alpha step with two sites kept as a rare one-off) |

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
- **Group labels** (ONE base rule — bead htu1, shared-sheet block of
  css/sheet-gear.css): `--rt-fs-lg`, uppercase, `--rt-muted`,
  `margin: 8px 0 2px`. The ONE rule carries every site's original selector:
  `h2.skill-group-label`, `h2.inv-group-label`, the creator's
  `.origin-row h2`, the advancement dialog's `h2` / `.rank-group h3`, and
  the test dialog's `.dialog-group-label` (that window carries neither
  `.sheet` nor `.rogue-trader`). Modifiers narrow it per site:
  `.inv-group-header` (margin 0, header row), armour-points (centred), the
  starship stat-group and slim action-row variants, and the test dialog's
  strong variant (bold, letter-spacing, 4px top margin — its body is a
  flex column with gap, so the top margin stacks on the gap).
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

- **Chips** (box pass, beads 6zha + huyp/cmio.6b): every boxed chip affordance
  carries one of the family's role classes — `.chip` (the shared vocabulary
  class for plain tags/badges), `pick-chip` / `origin-chip` / `ladder-option`
  / `adv-multiplier`, the starship `state-chip` / `slot-chip`, and the test
  dialog's `difficulty-chip` / `condition-chip` (the dialog window carries
  the rt-component root). ONE base anatomy in `css/40k-components.css`,
  keyed on those role classes — never on a site path: 1px `--rt-border`,
  `--rt-radius`, `1px 8px` padding, `fs-md`, pointer cursor, neutral
  background. Per-site rules are MODIFIERS ONLY (font-size step, border
  token, cursor:help, padding density, display bits).
- **Chip selected states** (bead ecja): two NAMED treatments, opt-in for new
  chips by class, both in the shared layer:
  - `.is-filled` — OPPAQUE GOLD FILL = a COMMITTED CHOICE (the rung you
    took, the radio pick). CSS-driven equivalents that predate the name:
    `.chip-option input:checked + .chip`, `.ladder-option.active`.
  - `.is-tinted` — TRANSLUCENT GOLD TINT = a MOMENTARY/HOLDING STATE (a
    checked toggle, the state a ship component is in right now).
    State-driven equivalents: `difficulty-chip.checked`,
    `condition-chip:has(input:checked)`, starship `state-chip.checked` /
    `slot-chip.checked` (the `.checked` markup there predates the name and
    stays).
- **Buttons** (bead saz2): `.rtk-button` is the ONE neutral push-control
  anatomy (1px `--rt-border`, `--rt-radius`, `2px 8px`, `fs-md`, pointer,
  `background: none` — NO raised Foundry chrome; the family has no
  `--rt-surface` token, empty background is the neutral). Site classes
  (`.sc-fire`, `.sc-break-free`, `.sc-silent-toggle`) are modifiers that
  override only colour/padding/emphasis; previously-unstyled buttons
  (`.sc-initiative`, `.sc-default-manoeuvre`, `.sc-repair`, the
  `rt-creator-nav-back`/`forward` pair keeping their `min-width` floors)
  inherit the base as-is.
- **Creator wizard frame** (bead j9so): ONE shared frame in
  `css/40k-components.css` for the four creators (character, ship, planet,
  warrant — all route through `CreatorApplication`, all carry
  rt-component): muted `.creator-header`, `.creator-section` blocks that
  ride the `.border` modifier, `.creator-footer` / `.creator-actions`
  strips, `.step-counter` and `.step-sep`, `.bump` as a small square
  stepper control and `.roll-draw` on the `.rtk-button` base.
- **Framed sections**: `.border` is the framed-section modifier (1px
  `--rt-border`, `--rt-radius`, `6px 8px` padding) — write
  `class="stats border"` (or any wrapper) and the frame comes with the
  class; never re-declare a section frame per site.
- **Composite input group**: bordered flex group with `/` separators
  (`.rof-composite` renders S/2/3: hidden checkbox → `S`/off span; number inputs; a
  `rof-zero` dash overlay when the value is 0).
- **Body-part boxes** (armour): bordered rounded rectangles in centered flex rows,
  gold small-caps label over large bold AP number.
- **Chat cards** (bead 3j3b): the roll-card anatomy (`.roll-summary`, the note
  lists, doc links, the salvo list) lives in `css/chat-roll.css`; the REST of
  the chat surface — critical, damage, initiative extras (`roll-analysis`,
  `unassigned`, dice note, hint), the psychic one-line cards
  (`power-damage` / `power-corruption` / `phenomena-roll`, which carry no
  `.chat` root) and the ship cards' `p.critical` alarm notes — is styled in
  `css/chat-card.css` with the same token semantics: success/failure/alarm
  inks as the roll cards use them, `--rt-chat-note` note ink,
  `--rt-warn` amber for phenomena/warning states. Chat push-buttons
  (`.rt-apply-condition`, `.rt-toxic-test`, `.apply-damage`,
  `.rt-roll-damage`) mirror the `.rtk-button` base under `.rogue-trader.chat`
  because chat messages carry no `rt-component` root.
- **Roll anchors**: `<a class="…-roll"><i class="fa-solid fa-dice-d10"></i></a>`,
  gold, `text-shadow: 0 0 4px currentColor` on hover.
- **Pips**: 8–9px circle `border: 1px solid #b8860b`, `.lit` fills gold.
- **Inventory rows**: `.inv-row` flex, grip icon, `flex: 1` ellipsized name (click
  opens sheet), muted weight, faded-red delete.

## Component ownership and the shared root class (cmio.6, cmio.8 part 1)

- **Ownership rule**: a component that carries NO system noun lives in the
  shared, system-neutral layer `css/40k-components.css`, once, so both FFG
  40k systems (Rogue Trader, DH2) can bundle it verbatim. A system's skin —
  its window chrome, sheet scaffolding, and any per-site modifier that only
  makes sense on one site — stays in that system's own files. The shared
  layer may use the DESIGN-LANGUAGE tokens (`var(--rt-*)`, defined at the top
  of `css/sheet-gear.css`) but decides no system look.
- **Root convention**: every consuming Application carries the compound root
  `<system-root> rt-component` — the window's `DEFAULT_OPTIONS.classes` (or
  `windowClasses`, for the branding-shaped test dialog) lists the system root
  FIRST and `"rt-component"` LAST. rt sheets: `["rogue-trader", …,
  "rt-component"]`. `utils/rt-component-root.test.ts` guards that every
  classes array in `src` carries it, so a new window cannot silently miss the
  shared components.
- **Neutrality gate**: the shared layer contains NO system slug and NO
  unrooted selector — every rule is rooted on `.rt-component` (the one
  exception: the test dialog's chip entries keep the dialog's own
  `.test-dialog-app` root, bead y8u3). A DH2 bundle can ship the file without
  RT's rules leaking into its windows and vice versa (bead 3xi2, folded into
  cmio.6's acceptance criteria).
- **Bundle order**: components before skins — `css/40k-components.css` is
  FIRST in `utils/css.ts`'s SOURCES so every per-site modifier in the skin
  files keeps winning the cascade over the shared base rules.

## Sizing rules

- Every sheet: `window: { resizable: true }` in DEFAULT_OPTIONS, **plus** CSS
  `min-width`/`min-height` on the sheet class — ApplicationV2 clamps resize to the
  app element's computed `minWidth`/`minHeight` (core `application.mjs:1124–1153`).
  The RULE is the pair on every resizable app class — the values live in `css/`
  next to the class (the stale enumeration that used to sit here misled an
  implementer into shipping only two clamps; bead 3kus).
- **Window contract class (bead cmio.7)**: every resizable Application also
  carries `rtk-window` in its classes array — the shared contract in
  css/40k-components.css giving a `--rtk-window-min-w/h` floor fallback
  (320px × 240px) under the per-class clamps above, and the
  `.window-content { overflow-y: auto }` content scroll rule (core pins window
  content to `overflow: hidden`; a window never scrolls by itself). Per-window
  floors stay in the skin files and beat the fallbacks.
- Fixed-width inputs: value inputs `var(--rt-input-value-w)` (3.5em, defined
  with the other tokens in the sheet-gear token block — bead y3ze), bonus
  `2.5em`, weights `4em`, centered. A wider sibling of a tokenised width needs
  a named modifier class that says WHY (the htu1 modifier pattern); dangling
  overrides for content that no longer renders are dead CSS — delete them.

## i18n

All keys go into `en`, `es`, `fr`, `pl` in one change (missing keys fall back to
`en`). Insert with minimal-diff JSON (preserve file formatting/ordering); flag
best-effort es/fr/pl wording. Missing-localization console warnings are QA failures
(see docs/QA-CHECKLIST.md).

## Process

Restyles land as beads; before closing a UI bead run docs/QA-CHECKLIST.md and close
with an explicit `UNVERIFIED IN WORLD:` note when no live check was possible.
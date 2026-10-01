---
"rogue-trader": minor
---

- Reworked the Spend-XP advancement dialog to the UI design language: rank chips for navigating rank tables, a search box plus affordable/unowned filter chips, an xp-to-next-rank progress meter, gold small-caps header stats, owned-state multiplier chips, skill ladder previews, dimmed unaffordable rows and a locked next-rank preview for planning future purchases.
- Enriched advance rows during purchase planning: key-only rows resolve their display names from the skill/talent packs, unmet prerequisites show on the row, talents carry their benefit text as a tooltip, and the default rank chip opens the lowest rank with an unpurchased advance.
- Fixed a skill-advance purchase turning a promised ladder bump into a duplicate ladder-1 skill: the live application now matches owned skills through the same shared matcher as the ladder preview (pack key first, then trimmed/case-insensitive name), so keyless owned skills with case/whitespace name variants are bumped, never re-granted.
- Fixed every rank's Buy button rendering disabled when the rank table was nested inside the rank-chip loop (a context-depth bug made the buy gate read the wrong frame).
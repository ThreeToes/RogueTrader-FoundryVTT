# In-World QA Checklist

Recurring failure mode: automated checks (`bun` tests, build, biome) pass, yet
runtime behavior is broken in Foundry (tabs not switching, context paths blank,
default skills not granted, pack format invalid). **Before closing any UI or
document-lifecycle bead, run this manual pass.**

## Steps

1. **Deploy & reload** — Reload Foundry in the test world
   (`~/Documents/rogue-trader-test`, which has `release/` symlinked) so the built
   bundle is actually loaded. A Foundry refresh IS the deploy step.
2. **Open every affected sheet type** — pc, npc, gear, ranged-weapon,
   melee-weapon, armour, skill. A fix that works on one sheet type does not
   necessarily generalize.
3. **Click every `data-action`** on the touched tab and confirm the expected side
   effect or chat message actually happens.
4. **Edit-and-reopen one field** per touched schema area — confirm persistence via
   `submitOnChange` (close the sheet, reopen, value still there).
5. **Check the browser console** (F12) for errors **and** missing-localization
   warnings (both matter; the latter means an i18n key was missed in some lang file).
6. **For document-lifecycle changes, create a NEW document** — hooks fire at
   creation, not retroactively on existing documents.

## Closing a bead

A UI bead may be closed with an explicit note:

```
UNVERIFIED IN WORLD: <exactly what to check>
```

…if a live check is genuinely impossible. **Never** close silently. Cross-reference:
[AGENT-GUIDE.md](AGENT-GUIDE.md) §8.
---
"rogue-trader": minor
---

- The Origin Path's xp cost now books into the advancement ledger as a creation-baseline entry, so the character sheet, the advancement dialog's pool and the stored xp all agree from creation onward and stay correct after the first purchase.
- Re-running the character creator on an existing character now merges into its ledger instead of overwriting it, so recorded purchases and spent xp survive a re-run.
- The creation baseline is creator-owned on a re-run: changed origin picks re-book the ledger's Origin Path entry with the right name and cost, and a re-run that prices the path at zero drops the stale entry instead of silently keeping the old cost.
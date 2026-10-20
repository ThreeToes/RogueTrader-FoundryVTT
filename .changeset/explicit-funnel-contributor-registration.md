---
"rogue-trader": patch
---

- RT roll entry points register the fire-mode and origin-trait funnel contributors through an explicit, idempotent, identity-guarded registrar (`registerRtFunnelContributors`, bead 4tx6), so a repeat call or a foreign same-key registration can never silently drop or substitute the RT modifier rows.
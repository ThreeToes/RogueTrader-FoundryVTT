---
"rogue-trader": patch
---

- Made card refusal copy accurate: the damage-apply and condition-apply paths now warn "only the owner or the GM can apply this" instead of the roll pipeline's "you cannot roll for it", and the ordnance-spend chip — formerly a SILENT no-op for a non-owner — now explains the refusal too (added in English, Spanish, French and Polish).
- Routed the remaining ownership checks through the shared Permissions port: the initiative token-menu entry's hand-rolled ownership check now asks `canRoll`, and the ordnance-spend chip (already a port caller via `canRoll`) moved to the write predicate `canModify`; behaviour unchanged.
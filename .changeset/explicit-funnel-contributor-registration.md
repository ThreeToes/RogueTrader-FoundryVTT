---
"rogue-trader": patch
---

- RT roll entry points register the fire-mode and origin-trait funnel contributors through an explicit, idempotent registration function instead of import side effects, so no caller can silently lose those modifier rows through import order.
---
"rogue-trader": minor
---

- Consolidated starship component rows into one shared partial (name, type, status badge, power, space, SP) used by both the Refit tab and the Combat tab.
- Merged the Combat tab's Emergency Repairs and GM Component Conditions sections into a single component roster: a status badge per component, a Repair button only on repair-eligible rows, and the GM state select in the row.
- Fixed component names being squeezed out of view in narrow condition rows (the row name now keeps a minimum width), and gave the status badges a fixed colour code (intact muted, unpowered deep-muted, damaged amber, destroyed alarm-red).
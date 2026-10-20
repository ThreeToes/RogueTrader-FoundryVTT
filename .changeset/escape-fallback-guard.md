---
"rogue-trader": patch
---

- Hardened the dialog-escape fallback guard (a Handlebars global without `escapeExpression` no longer throws) and added fallback-branch test coverage.
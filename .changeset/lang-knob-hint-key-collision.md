---
"rogue-trader": patch
---

- Fixed every sheet rendering raw translation keys (all i18n keys unresolvable at runtime). Foundry loads the language files through `foundry.utils.expandObject`, which throws — and the system silently swallows it — when one flat key is a dotted prefix of another. The rule-knob label rows (`RULES.X`) plus their hint rows (`RULES.X.HINT`) tripped exactly that, dropping the entire system dictionary and leaving only core translations.
- The knob hint keys are now flat siblings: `RULES.X_HINT` in the registry derivation (`hintKeyFor`), its Dark Heresy 2e sibling registry, and all four language files. Wording unchanged.
- Added a parity-guard test asserting no lang key is a dotted prefix of another in any of the four files, so this class of bug fails the suite instead of the runtime.
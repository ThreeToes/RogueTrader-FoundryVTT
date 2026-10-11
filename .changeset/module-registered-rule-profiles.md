---
"rogue-trader": minor
---

- Modules can ship house rules: `CONFIG.ROGUE_TRADER.registerRuleProfile({id, name, delta})` called during a module's own init registers a profile the rules run, exactly like the owner's motivating "lethal crits" module. A module ships a DELTA, so its rules keep tracking the Core Rulebook instead of freezing a snapshot — and nothing about a registration can pin a core value (the registry is what decides that).
- The effective profile composes core rules, the module profiles and the active world profile in ONE merge hop, module first and the world last: a knob both a module and the GM set resolves to the GM's. A module delta never inherits the world's values, so a module's rules cannot depend on a particular world's house rules.
- A module profile is rejected LOUDLY when it fails validation — the console names the profile and the offending knob — and never registered, so a typo'd module cannot quietly run core rules. Re-registering the same id replaces it.
- The Rules app lists module profiles under their own "From modules" heading: read-only (no edit, rename, duplicate or delete) but selectable, and activatable — activating one runs its rules on their own and writes only the active-profile id, never a copy of its delta into the world's profiles. Otherwise a module's rules apply on top of the active profile, which wins any knob both of them set.
- All new strings are translated in en, es, fr and pl.

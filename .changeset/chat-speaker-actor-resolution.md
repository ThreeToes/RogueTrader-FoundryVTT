---
"rogue-trader": patch
---

- Roll cards now name and link the CHARACTER instead of the player: the chat port resolves the rolling actor to its document before asking Foundry for the speaker, so every roll, damage, critical, psychic, fear and ship card is labelled with the character's name and its speaker links through to the actor sheet. Cards for an actor that cannot be resolved still post, falling back to the previous behaviour.

---
"rogue-trader": patch
---

- Aligned the skill ladder cap on the Core Rulebook p74 three-step ladder: a shared `LADDER_MAX` constant now drives both the Spend-XP ladder preview and its live application, replacing the literals that assumed a four-step cap.
- Buying an advance for a skill already at the ladder cap (+20) now asks for confirmation before spending the xp, instead of silently charging for a no-op bump.
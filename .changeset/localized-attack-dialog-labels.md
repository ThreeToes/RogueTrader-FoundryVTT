---
"rogue-trader": patch
---

- Made the attack dialog honest about fire-mode bonuses: the Semi-Auto Burst / Full Auto Burst option labels now render the value actually applied — homebrew-tuned fire-mode bonuses show their real numbers instead of the hardcoded (+10)/(+20), and the Aim row and dialog option read the same AIM_BONUS seam.
- Localized the modifier breakdown: Semi-Auto Burst, Full Auto Burst, Aim, the Inaccurate cancellation and weapon-quality contributions (Accurate, Defensive) now come through labelled i18n keys, so non-English clients see translated breakdown labels on the roll dialog and chat cards instead of untranslated text or raw slugs.
- Fixed a typo in the French Inaccurate quality label ("Impécise" → "Imprécise").
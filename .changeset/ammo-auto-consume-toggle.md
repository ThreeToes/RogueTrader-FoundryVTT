---
"rogue-trader": patch
---

- Added a GM-configurable homebrew toggle for launcher ammunition auto-consumption, off by default — this bead lands the toggle itself; the funnel application follows in the sibling bead.
- Firing a loaded launcher now consumes the loaded ordnance when the toggle is ON: shots spent follow the launcher's printed rate of fire (single = 1, burst/full = the burst/full column when the attack dialog's fire mode reaches the damage path; a burst-capable launcher without a resolvable mode refuses the consume loudly instead of silently consuming one), the exhaustion at 0 takes the existing unloaded warn-and-refuse path, the consume is gated on the attacker's ownership so a non-owner firing rolls damage without a failed write, a failed write throws instead of dropping, and a corrupted quantity refuses without writing; with the toggle OFF the manual −1 chip behaviour is untouched.
- The manual −1 chip and the auto-consume share one quantity-decrement helper, and their permission postures now share the same fail-closed ownership gate.
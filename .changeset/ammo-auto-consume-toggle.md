---
"rogue-trader": minor
---

- Added a GM-configurable homebrew toggle for launcher ammunition auto-consumption, off by default.
- With the toggle ON, firing a loaded launcher consumes the loaded ordnance: shots spent follow the launcher's printed rate of fire (a burst-capable launcher without a resolvable fire mode refuses the consume loudly instead of silently consuming one), exhaustion at 0 takes the existing unloaded warn-and-refuse path, the consume is gated on the attacker's ownership so a non-owner firing rolls damage without a failed write, and a corrupted quantity refuses without writing. With the toggle OFF, the manual −1 chip behaviour is untouched; either way, the manual chip and the auto-consume share one quantity-decrement helper and the same fail-closed ownership gate.
---
"rogue-trader": patch
---

- Roll cards animate again in Dice So Nice!: the dice port now keeps the
  evaluated Roll alongside the numbers the card reads, and the chat port attaches
  it to the message, so every skill, characteristic, damage, psychic, fear, ship
  and initiative card is a roll-type message and its dice roll in 3D. Cards keep
  their own look — Foundry only draws its own dice table into a message whose
  content has no card HTML — and a card whose dice port returns no Roll still
  posts exactly as before.

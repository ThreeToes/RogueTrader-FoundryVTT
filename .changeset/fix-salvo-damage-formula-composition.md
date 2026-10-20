---
"rogue-trader": patch
---

- Fixed salvo damage: the per-hit formula's dice and flat parts now scale separately with the hits ("3d10+6" for 3 hits of "1d10+2") instead of composing "31d10+2", which Foundry read as 31 d10 plus 2 and over-dealt Hull Integrity roughly tenfold per hit.
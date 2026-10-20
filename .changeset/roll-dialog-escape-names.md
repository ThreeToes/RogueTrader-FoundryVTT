---
"rogue-trader": patch
---

- Escaped document names in the ship-critical component prompt and the void-shield prompt before they are interpolated into the dialog HTML, so a component or ship name containing quotes or markup can no longer break or inject into the dialog.
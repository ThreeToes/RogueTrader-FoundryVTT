export const RogueTraderConfig = {
	craftsmanship: {
		poor: "CRAFTSMANSHIP.POOR",
		common: "CRAFTSMANSHIP.COMMON",
		good: "CRAFTSMANSHIP.GOOD",
		best: "CRAFTSMANSHIP.BEST",
	},
	"ranged-weapon-class": {
		pistol: "CLASS.PISTOL",
		basic: "CLASS.BASIC",
		heavy: "CLASS.HEAVY",
		thrown: "CLASS.THROWN",
	},
	availability: {
		ubiquitous: "AVAILABILITY.UBIQUITOUS",
		abundant: "AVAILABILITY.ABUNDANT",
		plentiful: "AVAILABILITY.PLENTIFUL",
		common: "AVAILABILITY.COMMON",
		average: "AVAILABILITY.AVERAGE",
		scarce: "AVAILABILITY.SCARCE",
		rare: "AVAILABILITY.RARE",
		"very-rare": "AVAILABILITY.VERY_RARE",
		"extremely-rare": "AVAILABILITY.EXTREMELY_RARE",
		"near-unique": "AVAILABILITY.NEAR_UNIQUE",
		unique: "AVAILABILITY.UNIQUE",
		special: "AVAILABILITY.SPECIAL",
	},
	// Ship weapon capacity slots (Table 8-4, book p202) — mirrors the
	// WEAPON_SLOTS rule list; used by the ship component sheet's slot
	// dropdown.
	"ship-weapon-slots": {
		dorsal: "STARSHIP.SLOT_DORSAL",
		prow: "STARSHIP.SLOT_PROW",
		port: "STARSHIP.SLOT_PORT",
		starboard: "STARSHIP.SLOT_STARBOARD",
	},
};

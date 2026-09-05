/**
 * Origin Path (bead ay0, rt_core Chapter I p16-35) — creation-time data, not
 * item types. Verbatim book text is preserved in `description` (flavour) and
 * `effect` (mechanics prose); structured `mechanics` carry the machine-
 * applicable subset. Anything the engine cannot resolve yet (mutation table
 * rolls, vendetta enemies, heirloom items, bionic upgrades...) stays in
 * `notes` and is surfaced to the player at the end of the creator — never
 * silently dropped (extraction convention).
 *
 * Chart adjacency (p16): each row after the first allows the selection
 * directly below the previous pick, or either horizontal neighbour of it.
 * Column layout verified against the book's own example (Void Born ->
 * Scapegrace | Scavenger | Stubjack; edge Scavenger -> Tainted | Criminal)
 * and the p16 chart grid.
 */

import type { CharacteristicKey } from "./data/actor/character";

export type OriginRow =
	| "home-world"
	| "birthright"
	| "lure"
	| "trials"
	| "motivation";

/** Characteristic modifier: signed delta applied to the base roll. */
export interface CharMod {
	key: CharacteristicKey;
	value: number;
}

/**
 * Machine-applicable mechanics of one origin option (or variant). Book text
 * that needs GM/player adjudication lands in `notes` instead.
 */
export interface OriginMechanics {
	characteristics?: CharMod[];
	/** Player picks one group of characteristic modifiers (e.g. "+3 WP or +3 Fel"). */
	characteristicChoice?: CharMod[][];
	/** Player picks one whole alternative mechanics blob ("-3 Fellowship OR -1 Fate Point"). */
	alternateChoice?: Array<{ label: string; mechanics: OriginMechanics }>;

	/** Granted skills, verbatim book notation ("Speak Language (Ship Dialect)"). */
	skills?: string[];
	/** Granted talents, verbatim book notation ("Quick Draw"). */
	talents?: string[];
	/** Player picks one entry — mixed skill/talent options ("Logic OR Peer (Academic)"). */
	optionChoice?: string[];
	/** Wounds dice added to 2xTB, book notation (e.g. "1d5+2"). */
	woundsDice?: string;
	/** Flat wound bonus (Motivation: Endurance +1 Wound). */
	woundBonus?: number;
	/** d10 fate table: highest inclusive roll -> value. */
	fateTable?: Array<{ max: number; value: number }>;
	/** Flat fate-point delta (Ship-lorn -1, Fated for Greatness +1, Fortune +1). */
	fateDelta?: number;
	insanity?: number;
	insanityDice?: string;
	corruption?: number;
	corruptionDice?: string;
	/** Player chooses which track takes the dice (Scavenger/Scapegrace 1d5). */
	corruptionOrInsanityDice?: string;
	initiativeBonus?: number;
	profitFactor?: number;
	/** Rules the engine cannot resolve; shown for manual application. */
	notes?: string[];
}

/** A choose-one sub-result row (Criminal, Renegade, Tainted, Zealot...). */
export interface OriginVariant {
	key: string;
	name: string;
	/** Verbatim book effect text for this sub-result. */
	effect: string;
	mechanics: OriginMechanics;
}

export interface OriginEntry {
	key: string;
	row: OriginRow;
	/** Column index (0-based) on the p16 chart; adjacency uses this. */
	col: number;
	name: string;
	/** Flavour prose (verbatim, trimmed). */
	description: string;
	/** Effect text (verbatim) for options without variants. */
	effect?: string;
	mechanics: OriginMechanics;
	variants?: OriginVariant[];
}

/** Chart row order, top (Home World) to bottom (Motivation). */
export const ORIGIN_ROWS: OriginRow[] = [
	"home-world",
	"birthright",
	"lure",
	"trials",
	"motivation",
];

export const ORIGIN_ROW_LABEL_KEYS: Record<OriginRow, string> = {
	"home-world": "ORIGIN.ROW_HOME_WORLD",
	birthright: "ORIGIN.ROW_BIRTHRIGHT",
	lure: "ORIGIN.ROW_LURE",
	trials: "ORIGIN.ROW_TRIALS",
	motivation: "ORIGIN.ROW_MOTIVATION",
};

export const ORIGIN_ENTRIES: OriginEntry[] = [
	// ---------------------------------------------------------------- Home Worlds (p17-24)
	{
		key: "death-world",
		row: "home-world",
		col: 0,
		name: "Death World",
		description:
			"Upon death worlds, the plants, beasts, and sometimes even the environment itself takes aggressive and destructive forms inimical to human life.",
		effect:
			"Characteristic Modifiers +5 Strength, +5 Toughness, -5 Willpower, -5 Fellowship. Starting Skills: Death worlders gain the Survival Skill. Hardened: may choose to start one of the following talents: Jaded or Resistance (Poisons). If It Bleeds, I Can Kill It: gain the Melee Weapon Training (Primitive) Talent. Paranoid: -10 penalty to all Interaction Skill Tests made in formal surroundings. Survivor: +10 bonus to any test to resist Pinning and Shock. Starting Wounds: double starting Toughness Bonus and add 1d5+2. Starting Fate Points: 1d10; 1-5 begins with 2, 6-10 begins with 3.",
		mechanics: {
			characteristics: [
				{ key: "s", value: 5 },
				{ key: "t", value: 5 },
				{ key: "wp", value: -5 },
				{ key: "fel", value: -5 },
			],
			skills: ["Survival"],
			talents: ["Melee Weapon Training (Primitive)"],
			optionChoice: ["Jaded", "Resistance (Poisons)"],
			woundsDice: "1d5+2",
			fateTable: [
				{ max: 5, value: 2 },
				{ max: 10, value: 3 },
			],
			notes: [
				"Paranoid: -10 to all Interaction Skill Tests in formal surroundings.",
				"Survivor: +10 to any test to resist Pinning and Shock.",
			],
		},
	},
	{
		key: "void-born",
		row: "home-world",
		col: 1,
		name: "Void Born",
		description:
			"Not merely star travellers but the products of many generations passed in the darkness between worlds, the void born are relatively few among the teeming multitudes of humanity, but singular.",
		effect:
			"Characteristic Modifiers: -5 Strength, +5 Willpower. Starting Skills: Void born gain the Speak Language (Ship Dialect) Skill. Charmed: whenever a Fate Point is spent (not burned), roll 1d10; on a natural 9 it is not lost. Ill-omened: -5 penalty on all Fellowship Tests to interact with non-void born humans. Shipwise: Navigation (Stellar) and Pilot (Spacecraft) are untrained Basic Skills. Void Accustomed: immune to space travel sickness; zero- or low-gravity is not Difficult Terrain. Starting Wounds: double TB and add 1d5. Starting Fate Points: 1d10; 1-5 begins with 3, 6-10 begins with 4.",
		mechanics: {
			characteristics: [
				{ key: "s", value: -5 },
				{ key: "wp", value: 5 },
			],
			skills: ["Speak Language (Ship Dialect)"],
			woundsDice: "1d5",
			fateTable: [
				{ max: 5, value: 3 },
				{ max: 10, value: 4 },
			],
			notes: [
				"Charmed: when spending a Fate Point (not burning), 1d10 — a natural 9 does not lose the point.",
				"Ill-omened: -5 on Fellowship Tests to interact with non-void born humans.",
				"Shipwise: Navigation (Stellar) (Int) and Pilot (Spacecraft) (Ag) are untrained Basic Skills.",
				"Void Accustomed: immune to space travel sickness; zero-/low-g is not Difficult Terrain.",
			],
		},
	},
	{
		key: "forge-world",
		row: "home-world",
		col: 2,
		name: "Forge World",
		description:
			"You were born in the shadow of the Omnissiah and all your life you have been surrounded by the great wonders and dire terrors of the Machine God's arts.",
		effect:
			"Characteristic Modifiers -5 Weapon Skill, +5 Intelligence. Starting Skills: Common Lore (Tech) and Common Lore (Machine Cult) are untrained Basic Skills. Credo Omnissiah: begin with the Technical Knock Talent. Fit For Purpose: increase a Characteristic of your choice by +3. Stranger to the Cult: -10 on Tests involving knowledge of the Imperial Creed and -5 on Fellowship Tests to interact with members of the Ecclesiarchy in formal settings. Starting Wounds: double TB and add 1d5+1. Starting Fate Points: 1d10; 1-5 begins with 2, 6-9 begins with 3, 10 begins with 4.",
		mechanics: {
			characteristics: [
				{ key: "ws", value: -5 },
				{ key: "int", value: 5 },
			],
			skills: ["Common Lore (Tech)", "Common Lore (Machine Cult)"],
			talents: ["Technical Knock"],
			// Fit For Purpose: +3 to one characteristic of the player's choice.
			characteristicChoice: [
				[{ key: "ws", value: 3 }],
				[{ key: "bs", value: 3 }],
				[{ key: "s", value: 3 }],
				[{ key: "t", value: 3 }],
				[{ key: "ag", value: 3 }],
				[{ key: "int", value: 3 }],
				[{ key: "per", value: 3 }],
				[{ key: "wp", value: 3 }],
				[{ key: "fel", value: 3 }],
			],
			woundsDice: "1d5+1",
			fateTable: [
				{ max: 5, value: 2 },
				{ max: 9, value: 3 },
				{ max: 10, value: 4 },
			],
			notes: [
				"Stranger to the Cult: -10 on Tests involving knowledge of the Imperial Creed; -5 on Fellowship Tests with Ecclesiarchy members in formal settings.",
			],
		},
	},
	{
		key: "hive-world",
		row: "home-world",
		col: 3,
		name: "Hive World",
		description:
			"The great hives are not like the lesser cities of other worlds in the Imperium, and you are not like the common men and women who live there.",
		effect:
			"Characteristic Modifiers -5 Toughness, +5 Fellowship. Starting Skills: Speak Language (Hive Dialect) as an untrained Basic Skill. Accustomed to Crowds: crowds are not Difficult Terrain; no penalty to Agility to keep feet when Running/Charging through dense crowds. Caves of Steel: Tech-Use is an untrained Basic Skill. Hivebound: -10 to all Survival (Int) Tests and -5 to all Intelligence Tests whilst out of proper hab. Wary: +1 bonus to Initiative rolls. Starting Wounds: double TB and add 1d5+1. Starting Fate Points: 1d10; 1-5 begins with 2, 6-8 begins with 3, 9-10 begins with 4.",
		mechanics: {
			characteristics: [
				{ key: "t", value: -5 },
				{ key: "fel", value: 5 },
			],
			skills: ["Speak Language (Hive Dialect)", "Tech-Use"],
			initiativeBonus: 1,
			woundsDice: "1d5+1",
			fateTable: [
				{ max: 5, value: 2 },
				{ max: 8, value: 3 },
				{ max: 10, value: 4 },
			],
			notes: [
				"Accustomed to Crowds: crowds are not Difficult Terrain; no penalty to Agility Tests to keep feet when Running/Charging through dense crowds.",
				"Hivebound: -10 to all Survival (Int) Tests; -5 to all Intelligence Tests whilst out of proper hab.",
			],
		},
	},
	{
		key: "imperial-world",
		row: "home-world",
		col: 4,
		name: "Imperial World",
		description:
			"You hail from an Imperial world, one of a million planets united by a belief in the immortal God-Emperor of Mankind.",
		effect:
			"Characteristic Modifiers: +3 Willpower. Blessed Ignorance: -5 penalty on Forbidden Lore (Int) Tests. Hagiography: Common Lore (Imperial Creed), Common Lore (Imperium), and Common Lore (War) as untrained Basic Skills. Liturgical Familiarity: Literacy and Speak Language (High Gothic) as untrained Basic Skills. Starting Wounds: double TB and add 1d5. Starting Fate Points: 1d10; 1-8 begins with 3, 9-10 begins with 4.",
		mechanics: {
			characteristics: [{ key: "wp", value: 3 }],
			skills: [
				"Common Lore (Imperial Creed)",
				"Common Lore (Imperium)",
				"Common Lore (War)",
				"Literacy",
				"Speak Language (High Gothic)",
			],
			woundsDice: "1d5",
			fateTable: [
				{ max: 8, value: 3 },
				{ max: 10, value: 4 },
			],
			notes: [
				"Blessed Ignorance: -5 penalty on Forbidden Lore (Int) Tests.",
			],
		},
	},
	{
		key: "noble-born",
		row: "home-world",
		col: 5,
		name: "Noble Born",
		description:
			"The only thing that truly matters is the lineage of your blood, the noble worth that flowed in your veins from the very day you were born.",
		effect:
			"Characteristic Modifiers: -5 Willpower, +5 Fellowship. Starting Skills: Literacy, Speak Language (High Gothic), and Speak Language (Low Gothic) as untrained Basic Skills. Etiquette: +10 bonus on Interaction Skill Tests with high authority and in formal situations. Legacy of Wealth: +1 to the group's starting Profit Factor. Supremely Connected: begin with the Peer (Nobility) Talent and one additional Peer from: Academics, Adeptus Mechanicus, Administratum, Astropaths, Ecclesiarchy, Government, Mercantile, Military, or Underworld. Vendetta: powerful enemies (define with the GM). Starting Wounds: double TB and add 1d5. Fate Points: 1d10; 1-3 begins with 2, 4-9 begins with 3, 10 begins with 4.",
		mechanics: {
			characteristics: [
				{ key: "wp", value: -5 },
				{ key: "fel", value: 5 },
			],
			skills: [
				"Literacy",
				"Speak Language (High Gothic)",
				"Speak Language (Low Gothic)",
			],
			talents: ["Peer (Nobility)"],
			optionChoice: [
				"Peer (Academics)",
				"Peer (Adeptus Mechanicus)",
				"Peer (Administratum)",
				"Peer (Astropaths)",
				"Peer (Ecclesiarchy)",
				"Peer (Government)",
				"Peer (Mercantile)",
				"Peer (Military)",
				"Peer (Underworld)",
			],
			profitFactor: 1,
			woundsDice: "1d5",
			fateTable: [
				{ max: 3, value: 2 },
				{ max: 9, value: 3 },
				{ max: 10, value: 4 },
			],
			notes: [
				"Etiquette: +10 on Interaction Skill Tests with high authority and in formal situations.",
				"Vendetta: powerful enemies — define the rival house/group with the GM.",
			],
		},
	},

	// ---------------------------------------------------------------- Birthright (p25-26)
	{
		key: "scavenger",
		row: "birthright",
		col: 0,
		name: "Scavenger",
		description:
			"You became an adult amidst the yearning and poverty of the least of the God-Emperor's flock, one soul amongst countless underhivers, renegades, bonepickers, and a thousand other outcast castes.",
		effect:
			"You gain the Unremarkable Talent or the Resistance (Fear) Talent, plus you gain a +3 bonus to your choice of Willpower or Agility. You suffer your choice of 1d5 Corruption Points or 1d5 Insanity Points.",
		mechanics: {
			optionChoice: ["Unremarkable", "Resistance (Fear)"],
			characteristicChoice: [
				[{ key: "wp", value: 3 }],
				[{ key: "ag", value: 3 }],
			],
			corruptionOrInsanityDice: "1d5",
		},
	},
	{
		key: "scapegrace",
		row: "birthright",
		col: 1,
		name: "Scapegrace",
		description:
			"An orphan of the borderland between light and dark, you spent years living by your wits as a scapegrace amidst entertainers, gangers, reclaimators, and other ne'er-do-wells on the fringes of Imperial society.",
		effect:
			"You gain Sleight of Hand as a trained Basic Skill, plus a bonus of +3 to your choice of Intelligence or Perception. You suffer your choice of 1d5 Corruption Points or 1d5 Insanity Points.",
		mechanics: {
			skills: ["Sleight of Hand"],
			characteristicChoice: [
				[{ key: "int", value: 3 }],
				[{ key: "per", value: 3 }],
			],
			corruptionOrInsanityDice: "1d5",
		},
	},
	{
		key: "stubjack",
		row: "birthright",
		col: 2,
		name: "Stubjack",
		description:
			"You were born to violence. It has surrounded you your whole life, and you've had a weapon in easy reach ever since you were strong enough to grip one.",
		effect:
			"You gain the Quick Draw Talent and gain Intimidate as a trained Basic Skill. You gain a bonus of +5 to your choice of Weapon Skill or Ballistic Skill, but you suffer both -5 Fellowship and 1d5 Insanity Points.",
		mechanics: {
			talents: ["Quick Draw"],
			skills: ["Intimidate"],
			characteristicChoice: [
				[{ key: "ws", value: 5 }],
				[{ key: "bs", value: 5 }],
			],
			characteristics: [{ key: "fel", value: -5 }],
			insanityDice: "1d5",
		},
	},
	{
		key: "child-of-the-creed",
		row: "birthright",
		col: 3,
		name: "Child of the Creed",
		description:
			"It was not until comparatively late in your youth that you set foot in a room in which the stern gaze of the God-Emperor was absent.",
		effect:
			"You gain the Unshakeable Faith Talent and a bonus of either +3 Willpower or +3 Fellowship (your choice), but you suffer -3 Weapon Skill.",
		mechanics: {
			talents: ["Unshakeable Faith"],
			characteristicChoice: [
				[{ key: "wp", value: 3 }],
				[{ key: "fel", value: 3 }],
			],
			characteristics: [{ key: "ws", value: -3 }],
		},
	},
	{
		key: "savant",
		row: "birthright",
		col: 4,
		name: "Savant",
		description:
			"To the scholar's ear, there is no worse sound than the tearing of parchment. It always marks a desecration of one sort or another.",
		effect:
			"You gain your choice of Logic (Int) as a trained Basic skill or the Peer (Academic) Talent. You also gain your choice of +3 Intelligence or +3 Fellowship, but you suffer -3 Toughness.",
		mechanics: {
			optionChoice: ["Logic (Int)", "Peer (Academic)"],
			characteristicChoice: [
				[{ key: "int", value: 3 }],
				[{ key: "fel", value: 3 }],
			],
			characteristics: [{ key: "t", value: -3 }],
		},
	},
	{
		key: "vaunted",
		row: "birthright",
		col: 5,
		name: "Vaunted",
		description:
			"You grew to adulthood upon the spire of wealth and privilege that towers, in some cases literally, high above the common Imperial masses.",
		effect:
			"You gain the Decadence Talent and a bonus of +3 to Agility or Fellowship (your choice). You suffer -3 Perception and 1d5 Corruption Points.",
		mechanics: {
			talents: ["Decadence"],
			characteristicChoice: [
				[{ key: "ag", value: 3 }],
				[{ key: "fel", value: 3 }],
			],
			characteristics: [{ key: "per", value: -3 }],
			corruptionDice: "1d5",
		},
	},

	// ---------------------------------------------------------------- Lure of the Void (p26-27)
	{
		key: "tainted",
		row: "lure",
		col: 0,
		name: "Tainted",
		description:
			"You are vile in the eyes of the holy, declared tainted by your twisted form or marked by your accursed bloodline or your strange demeanour and heretical beliefs.",
		variants: [
			{
				key: "mutant",
				name: "Mutant",
				effect:
					"You must roll once on Table 14-3: Mutations (see page 369). If you choose, you may spend 200 xp to select one result from the table (must be a result of lower than 74-00) instead of rolling randomly.",
				mechanics: {
					notes: [
						"Roll once on Table 14-3: Mutations (rt_core p369) — mutation machinery not modelled yet; record the result manually.",
					],
				},
			},
			{
				key: "insane",
				name: "Insane",
				effect:
					"You suffer your choice of either -3 Fellowship or -1 Fate point. You gain +3 Toughness, the Peer (The Insane) Talent, and suffer 2d10 Insanity Points.",
				mechanics: {
					alternateChoice: [
						{ label: "-3 Fellowship", mechanics: { characteristics: [{ key: "fel", value: -3 }] } },
						{ label: "-1 Fate Point", mechanics: { fateDelta: -1 } },
					],
					characteristics: [{ key: "t", value: 3 }],
					talents: ["Peer (The Insane)"],
					insanityDice: "2d10",
				},
			},
			{
				key: "deviant-philosophy",
				name: "Deviant Philosophy",
				effect:
					"You gain +3 Willpower and the Enemy (Ecclesiarchy) Talent.",
				mechanics: {
					characteristics: [{ key: "wp", value: 3 }],
					talents: ["Enemy (Ecclesiarchy)"],
				},
			},
		],
		mechanics: {},
	},
	{
		key: "criminal",
		row: "lure",
		col: 1,
		name: "Criminal",
		description:
			"The wheels of Imperial justice turn slowly, but they will surely grind to a pulp any life caught in their path.",
		variants: [
			{
				key: "wanted-fugitive",
				name: "Wanted Fugitive",
				effect: "You gain the Enemy (Adeptus Arbites) and Peer (Underworld) Talents.",
				mechanics: {
					talents: ["Enemy (Adeptus Arbites)", "Peer (Underworld)"],
				},
			},
			{
				key: "hunted-by-a-crime-baron",
				name: "Hunted by a Crime Baron",
				effect: "You gain +3 Perception and the Enemy (Underworld) Talent.",
				mechanics: {
					characteristics: [{ key: "per", value: 3 }],
					talents: ["Enemy (Underworld)"],
				},
			},
			{
				key: "judged-and-found-wanting",
				name: "Judged and Found Wanting",
				effect:
					"You suffer -5 Fellowship. You gain one poor-Craftsmanship bionic limb or implant (you may spend 200 xp to upgrade it to common-Craftsmanship or a total of 300 xp to upgrade it to good-Craftsmanship).",
				mechanics: {
					characteristics: [{ key: "fel", value: -5 }],
					notes: [
						"Gain one poor-Craftsmanship bionic limb or implant (200 xp to upgrade to common, 300 xp total to good) — bionics not modelled yet.",
					],
				},
			},
		],
		mechanics: {},
	},
	{
		key: "renegade",
		row: "lure",
		col: 2,
		name: "Renegade",
		description:
			"A rebellious mind such as yours could not be so easily constrained, however, but you have had to pay a price for your freedom and have learned those high walls are there for a reason.",
		variants: [
			{
				key: "recidivist",
				name: "Recidivist",
				effect:
					"You gain the Enemy (Adeptus Arbites) and the Resistance (Interrogation) Talents. You also gain Concealment as a trained Basic Skill.",
				mechanics: {
					talents: ["Enemy (Adeptus Arbites)", "Resistance (Interrogation)"],
					skills: ["Concealment"],
				},
			},
			{
				key: "free-thinker",
				name: "Free-thinker",
				effect:
					"You gain your choice of +3 Intelligence or +3 Perception. You suffer -3 Willpower and gain the Enemy (Ecclesiarchy) Talent.",
				mechanics: {
					characteristicChoice: [
						[{ key: "int", value: 3 }],
						[{ key: "per", value: 3 }],
					],
					characteristics: [{ key: "wp", value: -3 }],
					talents: ["Enemy (Ecclesiarchy)"],
				},
			},
			{
				key: "dark-visionary",
				name: "Dark Visionary",
				effect:
					"You suffer your choice of 1d5+1 Corruption Points or 1d5+1 Insanity Points. In return, you gain the Dark Soul Talent and Forbidden Lore (choose one) as a trained Basic Skill.",
				mechanics: {
					corruptionOrInsanityDice: "1d5+1",
					talents: ["Dark Soul"],
					skills: ["Forbidden Lore (choose one)"],
				},
			},
		],
		mechanics: {},
	},
	{
		key: "duty-bound",
		row: "lure",
		col: 3,
		name: "Duty Bound",
		description:
			"Only the ignorant believe that duty is a prison forced on others by those in power. True duty arises spontaneously from the soul, a call to service and struggle that should be neither shirked nor denied.",
		variants: [
			{
				key: "duty-to-the-throne",
				name: "Duty to the Throne",
				effect:
					"You gain +3 Willpower and (if you meet the WP 40 prerequisite) the Armour of Contempt Talent. You suffer a -10 penalty to Interaction Skill Tests when dealing with any source outside of the Imperium (e.g., aliens and traitors).",
				mechanics: {
					characteristics: [{ key: "wp", value: 3 }],
					talents: ["Armour of Contempt"],
					notes: [
						"Armour of Contempt only if the final WP meets its 40 prerequisite (prereq soft-enforcement bead tfk).",
						"-10 to Interaction Skill Tests when dealing with any source outside of the Imperium.",
					],
				},
			},
			{
				key: "duty-to-humanity",
				name: "Duty to Humanity",
				effect:
					"You gain your choice of +3 Perception or +3 Intelligence. You suffer a -1 to your group's beginning Profit Factor.",
				mechanics: {
					characteristicChoice: [
						[{ key: "per", value: 3 }],
						[{ key: "int", value: 3 }],
					],
					profitFactor: -1,
				},
			},
			{
				key: "duty-to-your-dynasty",
				name: "Duty to Your Dynasty",
				effect:
					"You gain the Rival (Rogue Trader family) Talent and suffer -3 Toughness. You gain a bonus of +1 to your group's beginning Profit Factor.",
				mechanics: {
					talents: ["Rival (Rogue Trader family)"],
					characteristics: [{ key: "t", value: -3 }],
					profitFactor: 1,
				},
			},
		],
		mechanics: {},
	},
	{
		key: "zealot",
		row: "lure",
		col: 4,
		name: "Zealot",
		description:
			"You possess faith so great that it has carried you far beyond the mundane life that would otherwise have been your lot.",
		variants: [
			{
				key: "blessed-scars",
				name: "Blessed Scars",
				effect:
					"You gain +10 to Intimidate Tests and -10 to Charm Tests, and one poor-Craftsmanship bionic (you may spend 200 xp to upgrade it to common-Craftsmanship or a total of 300 xp to upgrade it to good-Craftsmanship).",
				mechanics: {
					notes: [
						"+10 to Intimidate Tests; -10 to Charm Tests.",
						"Gain one poor-Craftsmanship bionic (200/300 xp upgrade path) — bionics not modelled yet.",
					],
				},
			},
			{
				key: "unnerving-clarity",
				name: "Unnerving Clarity",
				effect:
					"You gain +5 Willpower. You also suffer your choice of -5 Fellowship or 1d10 Insanity Points.",
				mechanics: {
					characteristics: [{ key: "wp", value: 5 }],
					alternateChoice: [
						{ label: "-5 Fellowship", mechanics: { characteristics: [{ key: "fel", value: -5 }] } },
						{ label: "1d10 Insanity Points", mechanics: { insanityDice: "1d10" } },
					],
				},
			},
			{
				key: "favoured-of-the-faithful",
				name: "Favoured of the Faithful",
				effect:
					"You gain +5 Fellowship and the Peer (Ecclesiarchy) Talent. You suffer -5 Toughness.",
				mechanics: {
					characteristics: [
						{ key: "fel", value: 5 },
						{ key: "t", value: -5 },
					],
					talents: ["Peer (Ecclesiarchy)"],
				},
			},
		],
		mechanics: {},
	},
	{
		key: "chosen-by-destiny",
		row: "lure",
		col: 5,
		name: "Chosen by Destiny",
		description:
			"For as long as you can recall, you have been certain that a grand destiny awaits you.",
		variants: [
			{
				key: "seeker-of-truth",
				name: "Seeker of Truth",
				effect:
					"You gain the Foresight Talent and the Enemy (Academics or Ecclesiarchy) Talent. You suffer -3 Willpower.",
				mechanics: {
					talents: ["Foresight", "Enemy (Academics or Ecclesiarchy)"],
					characteristics: [{ key: "wp", value: -3 }],
				},
			},
			{
				key: "xenophile",
				name: "Xenophile",
				effect:
					"You gain a bonus of +10 to Fellowship Tests when dealing with alien races or cultures. You suffer a -5 penalty to Willpower Tests involving alien artefacts and alien psychic powers.",
				mechanics: {
					notes: [
						"+10 to Fellowship Tests with alien races or cultures; -5 to Willpower Tests involving alien artefacts and alien psychic powers.",
					],
				},
			},
			{
				key: "fated-for-greatness",
				name: "Fated for Greatness",
				effect: "You gain +1 Fate Point, but you also suffer 1d10+1 Insanity Points.",
				mechanics: {
					fateDelta: 1,
					insanityDice: "1d10+1",
				},
			},
		],
		mechanics: {},
	},

	// ---------------------------------------------------------------- Trials and Travails (p27-29)
	{
		key: "hand-of-war",
		row: "trials",
		col: 0,
		name: "The Hand of War",
		description:
			"The Imperium of Man is wracked by war and violence, whilst beyond its borders the strife and conflict is even worse in many regions.",
		effect:
			"The Ashes of War: You gain one Weapon Training Talent of your choice, or the Leap Up Talent, as well as the Hatred Talent against your foe in the war that defined your past (Orks, Eldar, mutants, Chaos worshipers, the Imperial Guard, the Imperial Navy or void pirates). The Face of the Enemy: you will never willingly have dealings with your sworn enemy; -10 to all Fellowship Tests in such dealings, violent reaction on slightest provocation (Willpower Test to avert).",
		mechanics: {
			optionChoice: [
				"Weapon Training (choose one)",
				"Leap Up",
			],
			talents: ["Hatred (choose one: Orks, Eldar, mutants, Chaos worshipers, Imperial Guard, Imperial Navy, void pirates)"],
			notes: [
				"Face of the Enemy: -10 to Fellowship Tests when dealing with your sworn enemy; violent reaction on provocation (Willpower Test to avert).",
			],
		},
	},
	{
		key: "press-ganged",
		row: "trials",
		col: 1,
		name: "Press-ganged",
		description:
			"Skilled women and men with unique and valuable talents, be they Navigators or Armsmen, are themselves commodities to the unscrupulous and the desperate.",
		effect:
			"Unwilling Accomplice: You gain a single Skill (as long as it has no prerequisites) for your character. You may also either select a single additional Common Lore Skill or improve a Common Lore Skill you already have by one level. Jealous Freedom: you react violently towards the prospect of imprisonment or loss of your freedom (Willpower Test to avert).",
		mechanics: {
			notes: [
				"Unwilling Accomplice: gain a single Skill with no prerequisites (choose from the skill catalog after creation); also select one additional Common Lore Skill or improve an existing one by one level.",
				"Jealous Freedom: react violently towards imprisonment or loss of freedom (Willpower Test to avert).",
			],
		},
	},
	{
		key: "calamity",
		row: "trials",
		col: 2,
		name: "Calamity",
		description:
			"When reaching out beyond the relative safety of the Imperium, one of the great, often underestimated, dangers is disaster.",
		effect:
			"Inured to Adversity: You gain the Light Sleeper Talent and your choice of the Hardy Talent or Nerves of Steel Talent. Echo of Hard Times: you reduce your group's starting Profit Factor by -1.",
		mechanics: {
			talents: ["Light Sleeper"],
			optionChoice: ["Hardy", "Nerves of Steel"],
			profitFactor: -1,
		},
	},
	{
		key: "ship-lorn",
		row: "trials",
		col: 3,
		name: "Ship-lorn",
		description:
			"For those who ply the void, there are few things that provoke as much fear in them as to be robbed of their starship, to have the very crux of their identity cruelly taken from them.",
		effect:
			"Against All Odds: You gain the Survival Skill (or increase it by one level if you already possess it) or the Dark Soul Talent. Additionally, whenever you spend a Fate Point to recover Wounds, you may re-roll the dice if you wish but must accept the second result. Ill-starred: reduce your starting number of Fate Points permanently by -1. Additionally, you suffer -5 on Fellowship Tests when interacting with the void born, Rogue Traders, and other voidfarers who are not personal friends, if they have heard of your background and reputation.",
		mechanics: {
			optionChoice: ["Survival", "Dark Soul"],
			fateDelta: -1,
			notes: [
				"Against All Odds: when spending a Fate Point to recover Wounds, may re-roll (must accept the second result).",
				"Ill-starred: -5 on Fellowship Tests with void born, Rogue Traders, and other voidfarers who are not personal friends.",
			],
		},
	},
	{
		key: "dark-voyage",
		row: "trials",
		col: 4,
		name: "Dark Voyage",
		description:
			"Starport taverns and station galleys are filled with travellers, wanderers, and old voidfarers... But you have no taste for such stories, because you know the truth—you have lived them.",
		effect:
			"Things Man Was Not Meant to Know: You may gain a single Forbidden Lore Skill pertaining to your experiences (or may increase a Forbidden Lore Skill you already possess by one level), or may gain the Resistance (Fear) Talent. Marked by Darkness: Haunted by your experiences, you gain 1d5 Insanity Points.",
		mechanics: {
			optionChoice: ["Forbidden Lore (choose one)", "Resistance (Fear)"],
			insanityDice: "1d5",
		},
	},
	{
		key: "high-vendetta",
		row: "trials",
		col: 5,
		name: "High Vendetta",
		description:
			"Honour, friendship, and loyalty are not mere empty words or worthy ideals to you, they are tools for survival.",
		effect:
			"Blood Will Have Blood: You gain your choice of the Die Hard or Paranoia Talent, and gain the Inquiry Skill (or, if you already possess it, increase it by one level). Brook No Insult: you will allow no serious offence to your honour and person or those under your protection to pass unchallenged (Willpower Test to avert).",
		mechanics: {
			optionChoice: ["Die Hard", "Paranoia"],
			skills: ["Inquiry"],
			notes: [
				"Brook No Insult: no serious offence passes unchallenged (Willpower Test to avert).",
			],
		},
	},

	// ---------------------------------------------------------------- Motivation (p29)
	{
		key: "endurance",
		row: "motivation",
		col: 0,
		name: "Endurance",
		description:
			"You seek to endure and, in enduring, grow stronger. You welcome opposition, risk, setbacks, injury, and pain as old friends.",
		effect: "+1 Wound.",
		mechanics: { woundBonus: 1 },
	},
	{
		key: "fortune",
		row: "motivation",
		col: 1,
		name: "Fortune",
		description:
			"You seek wealth beyond measure, countless Thrones with which to purchase the fulfilment of your every desire.",
		effect: "+1 Fate Point.",
		mechanics: { fateDelta: 1 },
	},
	{
		key: "vengeance",
		row: "motivation",
		col: 2,
		name: "Vengeance",
		description:
			"Vengeance burns within your heart, flaming afresh in your veins each time you wake from dreams of knives and murder.",
		effect: "You gain the Hatred (choose one) Talent.",
		mechanics: { talents: ["Hatred (choose one)"] },
	},
	{
		key: "renown",
		row: "motivation",
		col: 3,
		name: "Renown",
		description:
			"You have grand visions and the burning desire to make them real. Through your actions and victories, you will ensure that your name will be spoken on the lips of the multitudes yet to be born.",
		effect:
			"You gain your choice of the Air of Authority or the Peer (choose one) Talent.",
		mechanics: { optionChoice: ["Air of Authority", "Peer (choose one)"] },
	},
	{
		key: "pride",
		row: "motivation",
		col: 4,
		name: "Pride",
		description:
			"Above all else, you want respect—the admiration of allies and the grudging esteem of foes, and will countenance no insult to your honour to go unchallenged.",
		effect:
			"You gain an Heirloom Item (see Table 1-2: Heirloom Items) or +3 Toughness (your choice).",
		mechanics: {
			alternateChoice: [
				{
					label: "Heirloom Item (Table 1-2)",
					mechanics: {
						notes: [
							"Heirloom Item (Table 1-2, rt_core p29): Archeotech Laspistol; Angevin Era Chainsword; Ancestral Seal; Saint-blessed Carapace Armour; or Reliquary of Saint Drusus — grant manually from the Armoury/compendium.",
						],
					},
				},
				{
					label: "+3 Toughness",
					mechanics: { characteristics: [{ key: "t", value: 3 }] },
				},
			],
		},
	},
	{
		key: "prestige",
		row: "motivation",
		col: 5,
		name: "Prestige",
		description:
			"The Imperium of Mankind is a grand hierarchy, and that, to your eyes, is a ladder reaching from the least peasant to the blinding heights of the God-Emperor's own Holy Terra.",
		effect:
			"You gain your choice of the Talented (choose one) Talent or the Peer (choose one) Talent.",
		mechanics: {
			optionChoice: ["Talented (choose one)", "Peer (choose one)"],
		},
	},
];

// ---------------------------------------------------------------- Table 1-1: Suggested Home Worlds (p18)

/**
 * Table 1-1: Suggested Home Worlds (rt_core p18). The book imposes NO
 * restrictions on home world vs career (p24); this only marks the commonly
 * appropriate combinations for GM guidance.
 */
export const SUGGESTED_HOME_WORLDS: Record<string, string[]> = {
	"arch-militant": ["death-world", "forge-world", "hive-world", "void-born"],
	"astropath-transcendent": ["hive-world", "imperial-world", "void-born"],
	explorator: ["forge-world", "hive-world", "imperial-world", "void-born"],
	missionary: ["death-world", "hive-world", "imperial-world", "noble-born"],
	navigator: ["hive-world", "imperial-world", "noble-born", "void-born"],
	"rogue-trader": ["hive-world", "imperial-world", "noble-born", "void-born"],
	seneschal: ["hive-world", "imperial-world", "noble-born", "void-born"],
	"void-master": ["forge-world", "hive-world", "void-born"],
};

// ---------------------------------------------------------------- Pure helpers

export function originByKey(key: string): OriginEntry | undefined {
	return ORIGIN_ENTRIES.find((entry) => entry.key === key);
}

export function originsInRow(row: OriginRow): OriginEntry[] {
	return ORIGIN_ENTRIES.filter((entry) => entry.row === row).sort(
		(a, b) => a.col - b.col,
	);
}

/**
 * Which columns of `row` are reachable from the previous pick at `prevCol`
 * (p16: the choice directly below, or either adjacent neighbour of it). The
 * first row is completely open.
 */
export function allowedColumns(row: OriginRow, prevCol: number | null): number[] {
	const rowEntries = originsInRow(row);
	const cols = rowEntries.map((entry) => entry.col);
	if (prevCol === null) return cols;
	return cols.filter((col) => Math.abs(col - prevCol) <= 1);
}

/** Total characteristic modifiers from a mechanics blob (choice already made). */
export function characteristicDeltas(
	mechanics: OriginMechanics,
	chosenChoice?: CharMod[],
	chosenVariant?: OriginVariant,
): Partial<Record<CharacteristicKey, number>> {
	const effective = chosenVariant ? chosenVariant.mechanics : mechanics;
	const deltas: Partial<Record<CharacteristicKey, number>> = {};
	for (const mod of effective.characteristics ?? []) {
		deltas[mod.key] = (deltas[mod.key] ?? 0) + mod.value;
	}
	for (const mod of chosenChoice ?? []) {
		deltas[mod.key] = (deltas[mod.key] ?? 0) + mod.value;
	}
	return deltas;
}

/**
 * Evaluate a book dice-notation string of the form used by the Origin Path
 * ("1d5", "1d5+2", "2d10", "1d10+1"). Pure: takes a roll function so the
 * creator can pass foundry.dice.Roll and tests a deterministic roller.
 */
export function evaluateOriginDice(
	notation: string,
	roll: (faces: number, count: number) => number,
): number {
	const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(notation.replace(/\s/g, ""));
	if (!match) return 0;
	const count = Number(match[1]);
	const faces = Number(match[2]);
	const flat = match[3] ? Number(match[3]) : 0;
	let total = flat;
	for (let i = 0; i < count; i += 1) total += roll(faces, count);
	return total;
}

/** Roll a fate-points value from a home world's d10 table. */
export function fateFromTable(
	table: Array<{ max: number; value: number }>,
	d10: number,
): number {
	for (const band of table) {
		if (d10 <= band.max) return band.value;
	}
	return table.length > 0 ? table[table.length - 1].value : 0;
}

/** The active mechanics for an entry: the chosen variant's, or the entry's. */
export function effectiveMechanics(
	entry: OriginEntry,
	variantKey?: string,
): OriginMechanics {
	if (!variantKey || !entry.variants) return entry.mechanics;
	return entry.variants.find((v) => v.key === variantKey)?.mechanics ?? entry.mechanics;
}

// ---------------------------------------------------------------- Resolution

/** One row's selection made in the creator. */
export interface OriginPick {
	key: string;
	/** Chosen sub-result variant key (entries with variants). */
	variantKey?: string;
	/** Chosen option from `optionChoice`. */
	optionChoice?: string;
	/** Chosen group from `characteristicChoice`. */
	charChoice?: CharMod[];
	/** Chosen index from `alternateChoice`. */
	alternate?: number;
}

/** Fully merged mechanics across all five rows (choices already made). */
export interface ResolvedOrigin {
	characteristics: Partial<Record<CharacteristicKey, number>>;
	skills: string[];
	talents: string[];
	/** Chosen options that may be either a skill or a talent (match at grant time). */
	options: string[];
	/** Book dice notation added to 2xTB, one per source. */
	woundsDice: string[];
	woundBonus: number;
	/** d10 fate table from the Home World (null when absent). */
	fateTable: Array<{ max: number; value: number }> | null;
	fateDelta: number;
	insanity: number;
	insanityDice: string[];
	corruption: number;
	corruptionDice: string[];
	/** Player chose which track takes these dice (tracked separately at apply time). */
	corruptionOrInsanityDice: string[];
	initiativeBonus: number;
	profitFactor: number;
	/** Rules needing manual application, with source attribution. */
	notes: string[];
}

/**
 * Merge the five row picks into one deterministic bundle. Choices are
 * resolved exactly once: entry mechanics + chosen variant + one group per
 * choice field. Pure — the caller rolls the dice.
 */
export function resolveOrigins(
	picks: Partial<Record<OriginRow, OriginPick>>,
): ResolvedOrigin {
	const resolved: ResolvedOrigin = {
		characteristics: {},
		skills: [],
		talents: [],
		options: [],
		woundsDice: [],
		woundBonus: 0,
		fateTable: null,
		fateDelta: 0,
		insanity: 0,
		insanityDice: [],
		corruption: 0,
		corruptionDice: [],
		corruptionOrInsanityDice: [],
		initiativeBonus: 0,
		profitFactor: 0,
		notes: [],
	};

	const addChars = (mods: CharMod[]) => {
		for (const mod of mods) {
			resolved.characteristics[mod.key] =
				(resolved.characteristics[mod.key] ?? 0) + mod.value;
		}
	};
	const absorb = (label: string, m: OriginMechanics) => {
		addChars(m.characteristics ?? []);
		resolved.skills.push(...(m.skills ?? []));
		resolved.talents.push(...(m.talents ?? []));
		if (m.woundsDice) resolved.woundsDice.push(m.woundsDice);
		resolved.woundBonus += m.woundBonus ?? 0;
		if (m.fateTable) resolved.fateTable = m.fateTable;
		resolved.fateDelta += m.fateDelta ?? 0;
		resolved.insanity += m.insanity ?? 0;
		if (m.insanityDice) resolved.insanityDice.push(m.insanityDice);
		resolved.corruption += m.corruption ?? 0;
		if (m.corruptionDice) resolved.corruptionDice.push(m.corruptionDice);
		if (m.corruptionOrInsanityDice)
			resolved.corruptionOrInsanityDice.push(m.corruptionOrInsanityDice);
		resolved.initiativeBonus += m.initiativeBonus ?? 0;
		resolved.profitFactor += m.profitFactor ?? 0;
		for (const note of m.notes ?? []) resolved.notes.push(`[${label}] ${note}`);
	};

	for (const row of ORIGIN_ROWS) {
		const pick = picks[row];
		if (!pick) continue;
		const entry = originByKey(pick.key);
		if (!entry || entry.row !== row) continue;
		const label = entry.name;
		const mechanics = effectiveMechanics(entry, pick.variantKey);
		absorb(label, mechanics);
		// Alternate choice replaces/extends with one whole blob.
		if (
			mechanics.alternateChoice &&
			pick.alternate !== undefined &&
			mechanics.alternateChoice[pick.alternate]
		) {
			const alt = mechanics.alternateChoice[pick.alternate];
			absorb(`${label}: ${alt.label}`, alt.mechanics);
		}
		// Characteristic choice: exactly one group.
		if (
			mechanics.characteristicChoice &&
			pick.charChoice
		) {
			addChars(pick.charChoice);
		}
		// Option choice may be a skill or a talent; the caller matches it
		// against the skill catalog first, then the talents pack.
		if (mechanics.optionChoice && pick.optionChoice) {
			resolved.options.push(pick.optionChoice);
		}
	}
	return resolved;
}
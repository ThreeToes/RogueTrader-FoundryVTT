/**
 * PURE per-tab builder tests for the CharacterSheet's context builders
 * (bead 0c48). The builders moved out of character-sheet.ts into
 * character-context.ts precisely so they test headlessly with plain
 * fixtures — WITHOUT the Foundry globals shim the class file needs. The
 * translated strings ride the i18n seam (no-op passthroughs here), the
 * actor view comes from the pure buildActorView, and every pack fetch is
 * a plain input. (buildActionsContext is the one call-time exception: its
 * chip composition lives in actions-view, whose import graph touches the
 * roll pipeline's Foundry stubs — the unit tests don't call it.)
 */
import { describe, expect, test } from "bun:test";
import { buildActorView } from "../../../ffg/domain/model/build";
import { totalSpent } from "../../rules/advancement";
import { setOriginEntries, type OriginEntry } from "../../rules/origins";
import { sorceryRanks } from "../../registry";
import type { Character } from "../../data/actor/character";
import {
	buildBackgroundContext,
	buildCareerContext,
	buildCareerLinkContext,
	buildDerivedContext,
	buildInventoryContext,
	buildMadnessContext,
	buildNotesContext,
	buildPsychicContext,
	buildSkillsContext,
	type BackgroundContextDeps,
	type CareerDocRow,
	type SheetI18n,
	type SheetItemLike,
} from "./character-context";

// --- Fixtures ---------------------------------------------------------------

/** The no-op i18n seam the builders accept (the sheet binds game.i18n). */
const i18n: SheetI18n = {
	localize: (key) => `L:${key}`,
	format: (key, vars) => `F:${key}:${JSON.stringify(vars)}`,
};

/** A plain system fixture shaped like the Character data model slice. */
function system(partial: Record<string, unknown>): Character {
	return {
		characteristics: {
			ws: { value: 40, unnatural: 1 },
			bs: { value: 30, unnatural: 1 },
		},
		characteristicBonus: (key: string) => (key === "ws" ? 4 : 3),
		effectiveCharacteristicBonus: (key: string) =>
			key === "ws" ? 4 : 3,
		...partial,
	} as unknown as Character;
}

function item(
	partial: Partial<SheetItemLike> & { type: string },
): SheetItemLike {
	return {
		id: partial.id ?? "id",
		uuid: partial.uuid ?? `Item.${partial.id ?? "id"}`,
		name: partial.name ?? "",
		type: partial.type,
		system: partial.system ?? {},
	};
}

// --- buildCareerContext ------------------------------------------------------

describe("buildCareerContext", () => {
	test("empty career: generic tooltip, empty label, zero pool", () => {
		const context: Record<string, unknown> = {};
		buildCareerContext(context, system({}), [], i18n);
		expect(context.careerLabel).toBe("");
		expect(context.advancementTooltip).toBe("L:ADVANCE.OPEN");
		expect(context.rankTooltip).toBeUndefined();
		// XP (owner cull): spent derives from the (empty) ledger, total from
		// the stored pool default 0.
		expect(context.xpTotal).toBe(0);
		expect(context.xpSpent).toBe(totalSpent([]));
	});

	test("known career + thresholds: derived-rank tooltip via the seam", () => {
		// Thresholds straddle the creation baseline: spent (empty ledger)
		// lands below the second rank, so the derived rank is the floor (1).
		const baseline = totalSpent([]);
		const careerDocs: CareerDocRow[] = [
			{
				uuid: "Career.rt",
				system: {
					key: "rogue-trader",
					ranks: [
						{ rank: 1, xpLevel: baseline },
						{ rank: 2, xpLevel: baseline + 1 },
					],
				},
			},
		];
		const context: Record<string, unknown> = {};
		buildCareerContext(
			context,
			system({ careerKey: "rogue-trader" }),
			careerDocs,
			i18n,
		);
		// The read-only label resolves via the registry, so homebrew careers
		// keep working — the seed name is the career name itself.
		expect(context.careerLabel).toBe("Rogue Trader");
		// The tooltip rides the format seam and the Advancement button
		// inherits it.
		expect(context.rankTooltip).toContain("F:ADVANCE.RANK_HINT");
		expect(context.rankTooltip).toContain('"rank":"1"');
		expect(context.advancementTooltip).toBe(context.rankTooltip);
	});

	test("spent derives from the ledger the builder was handed", () => {
		const ledger = [
			{
				type: "advancement",
				key: "skill",
				name: "Awareness +10",
				cost: 100,
				rank: 2,
			},
		];
		const context: Record<string, unknown> = {};
		buildCareerContext(context, system({ advances: ledger }), [], i18n);
		expect(context.xpSpent).toBe(totalSpent(ledger as never));
	});
});

// --- buildCareerLinkContext --------------------------------------------------

describe("buildCareerLinkContext", () => {
	test("resolves the compendium career item by system.key", () => {
		const careerDocs: CareerDocRow[] = [
			{ uuid: "Career.item", system: { key: "rogue-trader" } },
		];
		const context: Record<string, unknown> = {};
		buildCareerLinkContext(
			context,
			system({ careerKey: "rogue-trader" }),
			careerDocs,
		);
		expect(context.careerItemId).toBe("Career.item");
	});

	test("no matching doc degrades to an empty link", () => {
		const context: Record<string, unknown> = {};
		buildCareerLinkContext(context, system({ careerKey: "rogue-trader" }), [
			{ uuid: "Career.other", system: { key: "seneschal" } },
		]);
		expect(context.careerItemId).toBe("");
	});

	test("no careerKey at all degrades to an empty link", () => {
		const context: Record<string, unknown> = {};
		buildCareerLinkContext(context, system({}), []);
		expect(context.careerItemId).toBe("");
	});
});

// --- buildPsychicContext -----------------------------------------------------

describe("buildPsychicContext", () => {
	function powersContext(
		items: SheetItemLike[],
		partialSystem: Record<string, unknown> = {},
	) {
		const context: Record<string, unknown> = {};
		buildPsychicContext(context, system(partialSystem), {
			items,
			// A mundane explorer fixture: no psyker markers, no powers.
			view: buildActorView({ type: "explorer", system: {}, items: [] }),
		});
		return context as {
			isPsyker: boolean;
			psyRating: number;
			sanctioned: boolean;
			hasSorcery: boolean;
			psychicPowers: Array<{
				name: string;
				powerClass: string;
				classLabel: string;
				subtypeLabel: string;
				sorcerous: boolean;
				sustained: boolean;
			}>;
			navigatorPowers: Array<{ name: string; masteryLabel: string }>;
		};
	}

	test("mundane defaults: not psyker, Psy Rating 0, no sorcery, sanctioned", () => {
		const context = powersContext([]);
		expect(context.isPsyker).toBe(false);
		expect(context.psyRating).toBe(0);
		expect(context.sanctioned).toBe(true);
		expect(context.hasSorcery).toBe(false);
	});

	test("psychic power rows: name-sorted, labels composed, sorcery + sustained flags", () => {
		const fireball = item({
			id: "b",
			name: "Fireball",
			type: "psychicpower",
			system: { rating: 3 },
		});
		const smite = item({
			id: "a",
			name: "Smite",
			type: "psychicpower",
			system: { powerClass: "unbound", subtype: "assault", rating: 1 },
		});
		const sorcerous = item({
			id: "c",
			name: "Sorcerous Bolt",
			type: "psychicpower",
			system: { rating: 2, castAs: "sorcery" },
		});
		const context = powersContext([fireball, smite, sorcerous], {
			sustainedPowers: [{ itemUuid: "Item.b" }],
		});
		const powers = context.psychicPowers;
		// Sorted by name, not by ownership order.
		expect(powers.map((row) => row.sorcerous)).toEqual([false, false, true]);
		expect(powers[0].classLabel).toBe("PSYCHIC_POWER.BOUND");
		expect(powers[1].classLabel).toBe("PSYCHIC_POWER.UNBOUND");
		expect(powers[1].subtypeLabel).toBe("PSYCHIC_POWER.ASSAULT");
		// Bead sa6: the sustained affordance marks exactly the persisted uuid.
		expect(powers[0].sustained).toBe(true);
		expect(powers[1].sustained).toBe(false);
	});

	test("navigator powers render in the same tab with composed mastery labels", () => {
		const context = powersContext([
			item({
				id: "n",
				name: "The Lidless Stare",
				type: "navigatorpower",
				system: { mastery: "adept" },
			}),
		]);
		expect(context.navigatorPowers).toHaveLength(1);
		expect(context.navigatorPowers[0].masteryLabel).toBe(
			"NAVIGATOR_POWER.ADEPT",
		);
	});

	test("sorcery rank choices come from the registry (epic 0hap)", () => {
		const context = powersContext([]);
		const typed = context as unknown as {
			sorceryRankChoices: Record<string, string>;
		};
		// The manual-fallback select: the empty option plus every registry rank.
		expect(Object.keys(typed.sorceryRankChoices)).toEqual([
			"",
			...Object.keys(sorceryRanks.choices),
		]);
	});
});

// --- buildInventoryContext ---------------------------------------------------

describe("buildInventoryContext", () => {
	function inventoryContext(items: SheetItemLike[]) {
		const context: Record<string, unknown> = {};
		buildInventoryContext(context, items, i18n);
		return context as {
			inventory: Array<{
				labelKey: string;
				items: Array<{
					name: string;
					equipStateLabel: string;
					weightLabel: string;
					isAmmunition?: boolean;
				}>;
			}>;
			talentRows: Array<{ name: string; isWeapon: boolean }>;
			armourLocations: Record<string, { ap: number }>;
			weapons: Array<{ name: string }>;
		};
	}

	test("weapon rows localize the equip label via the registry + seam", () => {
		const context = inventoryContext([
			item({
				id: "w",
				name: "Laspistol",
				type: "melee-weapon",
				system: { weight: 2, equipState: "carried" },
			}),
		]);
		const group = context.inventory.find(
			(group) => group.labelKey === "WEAPON.HEADER",
		);
		expect(group).toBeDefined();
		expect(group!.items).toHaveLength(1);
		// equipStateLabel: the registry's "carried" label through the seam.
		expect(group!.items[0].equipStateLabel).toBe("L:EQUIP_STATE.CARRIED");
	});

	test("ammunition renders the xN quantity as the weight slot (bead 8uc7)", () => {
		const context = inventoryContext([
			item({
				id: "ammo",
				name: "Manstopper Shells",
				type: "ammunition",
				system: { weight: 0.1, quantity: 3 },
			}),
		]);
		const group = context.inventory.find(
			(group) => group.labelKey === "AMMUNITION.HEADER",
		);
		expect(group!.items[0].weightLabel).toBe("×3");
		expect(group!.items[0].isAmmunition).toBe(true);
	});

	test("the loud catch-all renders unclassified types (bead packs-pu9)", () => {
		const context = inventoryContext([
			item({
				id: "h",
				name: "Ancestral Seal",
				type: "special-ability",
				system: { weight: 0 },
			}),
		]);
		const catchAll = context.inventory.find(
			(group) => group.labelKey === "INVENTORY.ABILITIES",
		);
		expect(catchAll).toBeDefined();
		expect(catchAll!.items[0].name).toBe("Ancestral Seal");
	});

	test("talents ride the byType path into the background tab's rows", () => {
		const context = inventoryContext([
			item({ id: "t", name: "Iron Jaw", type: "talent", system: { weight: 0 } }),
		]);
		expect(context.talentRows).toHaveLength(1);
		expect(context.talentRows[0].name).toBe("Iron Jaw");
	});

	test("worn armour sets the per-location AP record", () => {
		const context = inventoryContext([
			item({
				id: "arm",
				name: "Flak Cloak",
				type: "armour",
				system: { equipState: "worn", armourAt: () => 4 },
			}),
		]);
		const covered = Object.entries(context.armourLocations).filter(
			([, row]) => row.ap === 4,
		);
		// The canonical BODY_LOCATION_ORDER rows keyed by loc keep their ap.
		expect(covered.length).toBeGreaterThan(0);
	});
});

// --- buildSkillsContext ------------------------------------------------------

describe("buildSkillsContext", () => {
	test("owned + catalog rows merge per characteristic; isPC from the actor type", () => {
		const context: Record<string, unknown> = {};
		buildSkillsContext(
			context,
			system({}),
			{
				items: [
					item({
						id: "own",
						name: "Awareness",
						type: "skill",
						system: { characteristic: "ws", ladder: 3 },
					}),
				],
				actorType: "explorer",
				catalog: [
					{ id: "cat", name: "Dodge", characteristic: "bs" },
					// Owned under differing casing: the t093 merge drops it.
					{ id: "dup", name: "awareness", characteristic: "ws" },
				],
			},
			i18n,
		);
		expect(context.isPC).toBe(true);
		const groups = context.skillGroups as Array<{
			key: string;
			label: string;
			skills: Array<{ name: string; owned: boolean }>;
		}>;
		expect(groups.map((group) => group.label)).toEqual([
			"CHARACTERISTIC.WS",
			"CHARACTERISTIC.BS",
		]);
		const ws = groups[0].skills;
		// The owned row wins; the case-differing catalog duplicate is dropped.
		expect(ws).toHaveLength(1);
		expect(ws[0].name).toBe("Awareness");
		expect(ws[0].owned).toBe(true);
		// The bs group keeps its catalog entry.
		expect(groups[1].skills.map((row) => row.name)).toEqual(["Dodge"]);
		// The characteristic views ride the format seam.
		const views = context.characteristics as Array<{ label: string }>;
		expect(views.map((view) => view.label)).toEqual([
			"CHARACTERISTIC.WS",
			"CHARACTERISTIC.BS",
		]);
	});

	test("NPCs are not marked isPC even when they own the same skills", () => {
		const context: Record<string, unknown> = {};
		buildSkillsContext(
			context,
			system({}),
			{ items: [], actorType: "npc", catalog: [] },
			i18n,
		);
		expect(context.isPC).toBe(false);
	});
});

// --- buildBackgroundContext --------------------------------------------------

describe("buildBackgroundContext", () => {
	/** A minimal chart entry (seeded into the runtime pool per test). */
	const MOTIVATION_ENTRY: OriginEntry = {
		key: "stubborn-soul",
		row: "motivation",
		col: 4,
		name: "Stubborn Soul",
		description: "",
		mechanics: { characteristics: [{ key: "wp", value: 3 }] },
		variants: [
			{
				key: "endurance",
				name: "Endurance",
				effect: "Gain +1 Wound at creation.",
				mechanics: { characteristics: [{ key: "t", value: -3 }] },
			},
		],
	};

	const noDeps = (deps: Partial<BackgroundContextDeps>) => ({
		talentDocs: [],
		actorContents: [],
		traitDefs: [],
		view: buildActorView({ type: "explorer", system: {}, items: [] }),
		...deps,
	});

	test("talent rows gain packUuid via case-insensitive name matching; unmatched degrades to \"\"", () => {
		// The rows come from the inventory pass exactly like the sheet composes
		// them — the background builder MUTATES the rows it finds in context.
		const context: Record<string, unknown> = {};
		buildInventoryContext(
			context,
			[
				item({ id: "t1", name: "Iron Jaw", type: "talent" }),
				item({ id: "t2", name: "Air of Authority", type: "talent" }),
			],
			i18n,
		);
		buildBackgroundContext(
			context,
			system({}),
			noDeps({
				talentDocs: [
					{ uuid: "Talent.iron-jaw", name: "iron jaw" },
					{ uuid: "Talent.other", name: "Other" },
				],
			}),
		);
		const rows = context.talentRows as Array<{ name: string; packUuid: string }>;
		// Matched by name, case-insensitive.
		expect(rows.find((row) => row.name === "Iron Jaw")!.packUuid).toBe(
			"Talent.iron-jaw",
		);
		// No doc for this name — the row degrades to an empty uuid, not a throw.
		expect(rows.find((row) => row.name === "Air of Authority")!.packUuid).toBe(
			"",
		);
	});

	test("an origin pick resolves against the chart: composed name, effect tooltip, mods", () => {
		setOriginEntries([MOTIVATION_ENTRY]);
		try {
			const context: Record<string, unknown> = {};
			buildBackgroundContext(
				context,
				system({ origins: { motivation: "stubborn-soul|endurance" } }),
				noDeps({}),
			);
			expect(context.hasOrigins).toBe(true);
			const rows = context.originRows as Array<{
				labelKey: string;
				pick: { name: string; tooltip: string; mods: string[] } | null;
			}>;
			expect(rows).toHaveLength(1);
			expect(rows[0].labelKey).toBe("ORIGIN.ROW_MOTIVATION");
			// Variant picks compose "entry: variant" and carry the variant's
			// effect text verbatim + the EFFECTIVE mechanics' modifiers.
			expect(rows[0].pick!.name).toBe("Stubborn Soul: Endurance");
			expect(rows[0].pick!.tooltip).toBe("Gain +1 Wound at creation.");
			expect(rows[0].pick!.mods).toEqual(["-3 T"]);
		} finally {
			setOriginEntries([]);
		}
	});

	test("an unmatched pick degrades off the tab: no rows, hasOrigins false, no throw", () => {
		setOriginEntries([MOTIVATION_ENTRY]);
		try {
			const context: Record<string, unknown> = {};
			buildBackgroundContext(
				context,
				system({ origins: { birthright: "no-such-key" } }),
				noDeps({}),
			);
			expect(context.originRows).toEqual([]);
			expect(context.hasOrigins).toBe(false);
		} finally {
			setOriginEntries([]);
		}
	});

	test("the dynasty picker threads the passed actor contents and the stored pick", () => {
		const context: Record<string, unknown> = {};
		buildBackgroundContext(
			context,
			system({ dynastyUuid: "Actor.vashtorre" }),
			noDeps({
				actorContents: [
					{
						type: "dynasty",
						uuid: "Actor.vashtorre",
						name: "House Vashtorre",
						system: { profitFactor: 3 },
					},
					{
						type: "explorer",
						uuid: "Actor.pc",
						name: "Barnaby Null",
						system: {},
					},
					{ type: "dynasty", uuid: "Actor.unbound", name: "House Unbound" },
				],
			}),
		);
		expect(context.dynastyUuid).toBe("Actor.vashtorre");
		const options = context.dynastyOptions as Array<{
			uuid: string;
			label: string;
			selected: boolean;
		}>;
		// Non-dynasty actors are not picker entries.
		expect(options.map((option) => option.uuid)).toEqual([
			"Actor.vashtorre",
			"Actor.unbound",
		]);
		// PF carries into the label when the dynasty defines it.
		expect(options[0].label).toBe("House Vashtorre (PF 3)");
		expect(options[0].selected).toBe(true);
		// A dynasty without PF shows the bare name and stays unselected.
		expect(options[1].label).toBe("House Unbound");
		expect(options[1].selected).toBe(false);
	});

	test("trait defs keyed on active picks: modifiers, grants with claims, notes — and affliction grants off the view", () => {
		setOriginEntries([MOTIVATION_ENTRY]);
		try {
			const context: Record<string, unknown> = {};
			buildBackgroundContext(
				context,
				system({
					origins: {
						motivation: "stubborn-soul",
						claims: { "stubborn-soul.blade": true },
					},
				}),
				noDeps({
					traitDefs: [
						{
							name: "Stubborn Streak",
							originKey: "stubborn-soul",
							traitKey: "streak",
							kind: "modifier",
							testKey: "wp",
							value: 10,
							grantKind: "",
							text: "+10 Willpower Tests",
						},
						{
							name: "Free Blade",
							originKey: "stubborn-soul",
							traitKey: "blade",
							kind: "grant",
							testKey: "",
							value: 0,
							grantKind: "free-skill",
							text: "One free blade-skill rank",
						},
						{
							name: "Branded",
							originKey: "stubborn-soul",
							traitKey: "brand",
							kind: "note",
							testKey: "",
							value: 0,
							grantKind: "",
							text: "Branded by the Inquisition",
						},
						// A def for a pick the actor does NOT hold resolves to nothing.
						{
							name: "Alien Origin",
							originKey: "some-other",
							traitKey: "x",
							kind: "modifier",
							testKey: "bs",
							value: 5,
							grantKind: "",
							text: "must not resolve",
						},
					],
					view: buildActorView({
						type: "explorer",
						system: {},
						items: [
							{
								type: "mutation",
								name: "Vile Deformity",
								system: {
									effects: [
										{ kind: "grants-item", testKey: "traits:Fear", label: "1" },
									],
								},
							},
						],
					}),
				}),
			);
			expect(
				context.traitModifiers as Array<{
					name: string;
					value: number;
					testKeyLabel: string;
					tooltip: string;
				}>,
			).toEqual([
				{
					name: "Stubborn Streak",
					value: 10,
					testKeyLabel: "WP",
					tooltip: "+10 Willpower Tests",
				},
			]);
			// The grant carries its claim state (persisted) and its resolvable
			// flag (free-skill grants open the skill picker).
			expect(
				context.traitGrants as Array<{
					key: string;
					name: string;
					claimed: boolean;
					resolvable: boolean;
					tooltip: string;
				}>,
			).toEqual([
				{
					key: "stubborn-soul.blade",
					name: "Free Blade",
					claimed: true,
					resolvable: true,
					tooltip: "One free blade-skill rank",
				},
			]);
			expect(context.traitNotes).toEqual([
				{ name: "Branded", tooltip: "Branded by the Inquisition" },
			]);
			expect(context.hasTraits).toBe(true);
			// Affliction grants (epic nt8k) ride the owned mutation's grants-item
			// effect off the view, with the benefit composed into the label.
			expect(context.afflictionGrants).toEqual([
				{
					pack: "traits",
					name: "Fear",
					benefit: "1",
					source: "Vile Deformity",
					label: "Fear 1",
				},
			]);
		} finally {
			setOriginEntries([]);
		}
	});
});

// --- buildDerivedContext -----------------------------------------------------

describe("buildDerivedContext", () => {
	test("the combat read-outs resolve through the passed items + view", () => {
		const view = buildActorView({
			type: "explorer",
			system: { wounds: { max: 12 } },
			// wounds-max rows feed the runtime maximum (Sound Constitution style).
			items: [
				{
					type: "talent",
					name: "Sound Constitution",
					system: { effects: [{ kind: "wounds-max" }, { kind: "wounds-max" }] },
				},
			],
		});
		const actor = system({ initiativeBonus: 2 });
		// The fixture mirrors the model: movement derives from the agility bonus.
		actor.movement = () => {
			const ab = actor.characteristicBonus("agility");
			return { half: ab, full: ab * 2, charge: ab * 3, run: ab * 6 };
		};
		const context: Record<string, unknown> = {};
		buildDerivedContext(context, actor, {
			items: [
				// Only carried types weigh; quantity stacks count (bead 1sxq).
				item({
					id: "g",
					name: "Lascarbine",
					type: "gear",
					system: { weight: 2.5, quantity: 2 },
				}),
				item({
					id: "p",
					name: "Fireball",
					type: "psychicpower",
					system: { weight: 9 },
				}),
			],
			view,
		});
		// Encumbrance keys on SB+TB (3 + 3 = 6 → Table 9-33 row 6 = 36kg); the
		// psychic power's weight is NOT carried weight (wrong type), the gear is
		// 2.5 × 2 copies = 5kg, still inside the capacity.
		const encumbrance = context.encumbrance as {
			weight: number;
			capacity: number;
			state: string;
			stateLabel: string;
		};
		expect(encumbrance.weight).toBe(5);
		expect(encumbrance.capacity).toBe(36);
		expect(encumbrance.state).toBe("ok");
		expect(encumbrance.stateLabel).toBe("INVENTORY.STATE_OK");
		const derived = context.derived as {
			half: number;
			full: number;
			charge: number;
			run: number;
			initiative: number;
			woundsMax: number;
			fatigueMax: number;
		};
		// movement() spread; initiative = the model's bonus; wounds = 12 stored
		// base + 2 Sound Constitution levels; fatigue = the (effective) TB, 3.
		expect(derived.half).toBe(3);
		expect(derived.full).toBe(6);
		expect(derived.charge).toBe(9);
		expect(derived.run).toBe(18);
		expect(derived.initiative).toBe(2);
		expect(derived.woundsMax).toBe(14);
		expect(derived.fatigueMax).toBe(3);
	});
});

// --- buildMadnessContext ------------------------------------------------------

describe("buildMadnessContext", () => {
	test("track rows + owned afflictions map through the madness helper", () => {
		const context: Record<string, unknown> = {};
		buildMadnessContext(context, system({ insanity: 65, corruption: 65 }), {
			// Real book rows (packs/afflictions/madness.yaml): insanity track
			// from Table 10-4 (Core Rulebook p296), corruption track from
			// Table 10-7 (Core Rulebook p298). No fabricated bands.
			rows: [
				{
					kind: "insanity-track",
					rollMin: 60,
					rollMax: 79,
					degree: "Unhinged",
					modifier: -10,
				},
				{
					kind: "corruption-track",
					rollMin: 61,
					rollMax: 90,
					degree: "Debased",
					modifier: -20,
				},
			],
			items: [
				item({
					id: "d1",
					name: "Phobia",
					type: "madnessentry",
					system: {
						kind: "disorder",
						acquiredSeverity: "Minor",
						description: "Terrified of open void.",
					},
				}),
				item({
					id: "m1",
					name: "Vile Deformity",
					type: "mutation",
					system: {
						description: "Gnarled limbs.",
						attack: { damage: "1d10+2 R" },
					},
				}),
			],
			actor: {
				effects: [
					{
						id: "ae1",
						name: "Fleeing",
						statuses: ["fleeing"],
						flags: { "rogue-trader": { snapOut: true } },
					},
					{ id: "ae2", name: "Shaken", statuses: ["shaken"] },
				],
			},
		});
		const madness = context.madness as {
			insanityPoints: number;
			corruptionPoints: number;
			insanityDegree: string;
			insanityModifier: number;
			corruptionDegree: string;
			corruptionModifier: number;
			nextDisorder: number | null;
			nextMutation: number | null;
			dueDisorders: Array<{ at: number; severity: string }>;
			afflictionGroups: Array<{
				label: string;
				entries: Array<{
					id: string;
					name: string;
					severity: string;
					text: string;
					canAttack: boolean;
				}>;
			}>;
		};
		// 65 IP lands in the Unhinged band 60-79 (−10, p296); the Debased
		// corruption band 61-90 (−20, p298) covers the ≥61 CP claim, so both
		// tracks still pin a NEGATIVE modifier mapping. 6 CP would hit the
		// Tainted band 1-30 with modifier 0 — a separate no-change branch.
		expect(madness.insanityPoints).toBe(65);
		expect(madness.insanityDegree).toBe("Unhinged");
		expect(madness.insanityModifier).toBe(-10);
		expect(madness.corruptionDegree).toBe("Debased");
		expect(madness.corruptionModifier).toBe(-20);
		// Minor is held (Phobia's severity), so the next threshold is Acute and
		// only the passed-but-unheld Severe grant is due; the disorder
		// thresholds (40/60/80) come from the DISORDER_THRESHOLDS rule, not the
		// track rows, and the next mutation step is 90 for 65 CP.
		expect(madness.nextDisorder).toBe(80);
		expect(madness.nextMutation).toBe(90);
		expect(madness.dueDisorders).toEqual([{ at: 60, severity: "Severe" }]);
		// One entry per affliction family; the mutation's printed attack block
		// gives it the roll chip (bead kam1).
		expect(madness.afflictionGroups).toEqual([
			{
				label: "AFFLICTION.DISORDER",
				entries: [
					{
						id: "d1",
						name: "Phobia",
						severity: "Minor",
						text: "Terrified of open void.",
						canAttack: false,
					},
				],
			},
			{ label: "AFFLICTION.MALIGNANCY", entries: [] },
			{
				label: "AFFLICTION.MUTATION",
				entries: [
					{
						id: "m1",
						name: "Vile Deformity",
						severity: "",
						text: "Gnarled limbs.",
						canAttack: true,
					},
				],
			},
		]);
		// Carried conditions ride the STRUCTURAL actor the deps hand over.
		expect(context.conditions).toEqual({
			snapOutReady: true,
			carried: ["Fleeing", "Shaken"],
		});
	});

	test("absent rows/totals/actor: zeroed track, default thresholds, no conditions", () => {
		const context: Record<string, unknown> = {};
		buildMadnessContext(context, system({}), {
			rows: [],
			items: [],
			actor: {},
		});
		const madness = context.madness as {
			insanityPoints: number;
			insanityDegree: string;
			insanityModifier: number;
			nextDisorder: number | null;
			nextMutation: number | null;
			afflictionGroups: Array<{ entries: unknown[] }>;
		};
		expect(madness.insanityPoints).toBe(0);
		expect(madness.insanityDegree).toBe("");
		expect(madness.insanityModifier).toBe(0);
		// No covering row → the first thresholds still show as targets.
		expect(madness.nextDisorder).toBe(40);
		expect(madness.nextMutation).toBe(30);
		expect(madness.afflictionGroups.map((group) => group.entries)).toEqual([
			[],
			[],
			[],
		]);
		expect(context.conditions).toEqual({ snapOutReady: false, carried: [] });
	});
});

// --- buildNotesContext --------------------------------------------------------

describe("buildNotesContext", () => {
	test("description + motivation ride the enrich seam; absent motivation degrades to an empty enrich", async () => {
		const enrich = async (text: string) => `ENRICHED:${text}`;
		const withMotivation: Record<string, unknown> = {};
		await buildNotesContext(
			withMotivation,
			system({
				description: "A scarred rogue trader.",
				life: { motivation: "Greed" },
			}),
			{ enrich },
		);
		expect(withMotivation.descriptionHTML).toBe(
			"ENRICHED:A scarred rogue trader.",
		);
		expect(withMotivation.motivationHTML).toBe("ENRICHED:Greed");
		// The field's schema initial is "": absent structured data enriches the
		// empty string rather than throwing.
		const bare: Record<string, unknown> = {};
		await buildNotesContext(
			bare,
			system({ description: "A scarred rogue trader." }),
			{ enrich },
		);
		expect(bare.descriptionHTML).toBe("ENRICHED:A scarred rogue trader.");
		expect(bare.motivationHTML).toBe("ENRICHED:");
	});
});
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
import { sorceryRanks } from "../../registry";
import type { Character } from "../../data/actor/character";
import {
	buildCareerContext,
	buildCareerLinkContext,
	buildInventoryContext,
	buildPsychicContext,
	buildSkillsContext,
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
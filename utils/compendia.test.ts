import { describe, expect, test } from "bun:test";
import {
	actorItemKey,
	actorKey,
	buildPackFolders,
	buildTableResults,
	documentId,
	folderId,
	resolveEntryGroup,
	resolveEntryType,
	toTableSourceDocument,
	type ItemSourceIndex,
	toActorSourceDocument,
	toJournalSourceDocument,
} from "./compendia";

describe("resolveEntryType", () => {
	test("honors a declared non-generic type", () => {
		expect(resolveEntryType({ type: "aptitude" }, "aptitudes")).toBe(
			"aptitude",
		);
	});

	test("maps legacy generic Item type via folder defaults", () => {
		expect(resolveEntryType({ type: "Item" }, "skills")).toBe("skill");
		expect(resolveEntryType({ type: "Item" }, "talents")).toBe("talent");
		expect(resolveEntryType({ type: "Item" }, "unknown")).toBe("gear");
	});

	test("infers weapon type from system.class", () => {
		expect(
			resolveEntryType(
				{ type: "Item", system: { class: "pistol" } },
				"weapons",
			),
		).toBe("ranged-weapon");
		expect(
			resolveEntryType({ type: "Item", system: { class: "basic" } }, "weapons"),
		).toBe("ranged-weapon");
		expect(
			resolveEntryType({ type: "Item", system: { class: "melee" } }, "weapons"),
		).toBe("melee-weapon");
	});

	test("falls back to gear when the type is missing", () => {
		expect(resolveEntryType({}, "misc")).toBe("gear");
	});
});

describe("buildTableResults (criticals scaffolding)", () => {
	test("pending count generates labelled placeholder rows", () => {
		const rows = buildTableResults({ pending: 10, name: "T" });
		expect(rows).toHaveLength(10);
		expect(rows[0].range).toEqual([1, 1]);
		expect(rows[9].range).toEqual([10, 10]);
		expect(String(rows[0].text)).toContain("pending extraction");
		expect(String(rows[4].text)).toContain("severity 5");
	});

	test("string rows auto-range cumulatively", () => {
		const rows = buildTableResults({
			name: "T",
			results: ["one", "two", "three"],
		});
		expect(rows.map((r) => r.range)).toEqual([
			[1, 1],
			[2, 2],
			[3, 3],
		]);
	});

	test("weights widen ranges; explicit ranges are honored", () => {
		const rows = buildTableResults({
			name: "T",
			results: [
				{ text: "a", weight: 3 },
				{ text: "b", range: [9, 10] },
			],
		});
		expect(rows[0].range).toEqual([1, 3]);
		expect(rows[1].range).toEqual([9, 10]);
	});

	test("result ids are stable and distinct", () => {
		const rows = buildTableResults({ pending: 2, name: "T" });
		expect(rows[0]._id).not.toBe(rows[1]._id);
		expect(buildTableResults({ pending: 2, name: "T" })[0]._id).toBe(
			rows[0]._id,
		);
	});

	test("no results and no pending -> empty table", () => {
		expect(buildTableResults({ name: "T" })).toEqual([]);
	});
});

describe("toTableSourceDocument", () => {
	test("shapes a rollable table source", () => {
		const doc = toTableSourceDocument({
			name: "Critical Hit (Energy, Head)",
			formula: "1d10",
			pending: 10,
		});
		expect(doc.formula).toBe("1d10");
		expect(doc.replacement).toBe(true);
		expect(doc.displayRoll).toBe(true);
		expect(doc.results).toHaveLength(10);
		expect(doc._id).toBe(documentId("Critical Hit (Energy, Head)"));
	});

	test("authored results replace pending placeholders", () => {
		const doc = toTableSourceDocument({
			name: "T",
			pending: 10,
			results: ["done"],
		});
		expect(doc.results).toHaveLength(1);
		expect((doc.results[0] as { text: string }).text).toBe("done");
	});
});

describe("documentId", () => {
	test("is deterministic for the same name", () => {
		expect(documentId("Lasgun")).toBe(documentId("Lasgun"));
	});

	test("differs for different names", () => {
		expect(documentId("Lasgun")).not.toBe(documentId("Boltgun"));
	});

	test("honors an explicit id", () => {
		expect(documentId("Lasgun", "abc123")).toBe("abc123");
	});

	test("is a 16-char Foundry id", () => {
		expect(documentId("Lasgun")).toMatch(/^[A-Za-z0-9]{16}$/);
	});
});

describe("actor packs (bead et3x)", () => {
	const index: ItemSourceIndex = new Map([
		[
			"Lasgun",
			[
				{
					pack: "weapons",
					id: documentId("Lasgun"),
					type: "ranged-weapon",
					entry: {
						name: "Lasgun",
						system: { class: "ranged", damage: "1d10+3 E" },
					},
				},
			],
		],
		[
			"Flak Armour",
			[
				{
					pack: "armour",
					id: documentId("Flak Armour"),
					type: "armour",
					entry: { name: "Flak Armour", system: { armourPoints: { body: 4 } } },
				},
				{
					pack: "gear",
					id: documentId("Flak Armour"),
					type: "armour",
					entry: { name: "Flak Armour" },
				},
			],
		],
		[
			"Common Lore",
			[
				{
					pack: "skills",
					id: documentId("Common Lore"),
					type: "skill",
					entry: { name: "Common Lore", system: { characteristic: "int" } },
				},
			],
		],
	]);

	test("shapes an actor source with embedded items split out", () => {
		const { actor, embedded } = toActorSourceDocument(
			{
				name: "Test Raider",
				system: { threatLevel: "Trivial" },
				items: [{ name: "Lasgun" }],
			},
			index,
		);
		expect(actor.type).toBe("npc");
		expect(actor.system).toEqual({ threatLevel: "Trivial" });
		expect(actor.items).toHaveLength(1);
		expect(actor.effects).toEqual([]);
		expect(embedded).toHaveLength(1);
		expect(embedded[0].name).toBe("Lasgun");
		expect((actor.items as string[])[0]).toBe(embedded[0]._id);
	});

	test("stamps the compendium source on linked embedded items", () => {
		const { embedded } = toActorSourceDocument(
			{ name: "X", items: [{ name: "Lasgun" }] },
			index,
		);
		expect(
			(embedded[0].flags as Record<string, Record<string, string>>)[
				"rogue-trader"
			].compendiumSource,
		).toBe(`Compendium.rogue-trader.weapons.${documentId("Lasgun")}`);
	});

	test("linked clones inherit the pack entry's system data (z4aa)", () => {
		const { embedded } = toActorSourceDocument(
			{ name: "X", items: [{ name: "Lasgun" }] },
			index,
		);
		expect(embedded[0].system).toEqual({
			class: "ranged",
			damage: "1d10+3 E",
		});
	});

	test("sourceName links a specialisation clone to its base entry", () => {
		const { embedded } = toActorSourceDocument(
			{
				name: "X",
				items: [
					{
						name: "Common Lore (Imperium)",
						fromPack: "skills",
						sourceName: "Common Lore",
						system: { ladder: 2 },
					},
				],
			},
			index,
		);
		expect(embedded[0].name).toBe("Common Lore (Imperium)");
		// characteristic from the base catalog entry, ladder from the override.
		expect(embedded[0].system).toEqual({ characteristic: "int", ladder: 2 });
		const flags = (embedded[0].flags as Record<string, Record<string, unknown>>)[
			"rogue-trader"
		];
		expect(flags.compendiumSource).toBe(
			`Compendium.rogue-trader.skills.${documentId("Common Lore")}`,
		);
		expect(flags.sourceName).toBe("Common Lore");
	});

	test("fromPack disambiguates a name claimed by multiple packs", () => {
		const { embedded } = toActorSourceDocument(
			{ name: "X", items: [{ name: "Flak Armour", fromPack: "armour" }] },
			index,
		);
		expect(
			(embedded[0].flags as Record<string, Record<string, string>>)[
				"rogue-trader"
			].compendiumSource,
		).toBe(
			`Compendium.rogue-trader.armour.${documentId("Flak Armour")}`,
		);
	});

	test("throws loudly for an unlinked embedded item (never silently drop)", () => {
		expect(() =>
			toActorSourceDocument({ name: "X", items: [{ name: "Mystery Gubbin" }] }, index),
		).toThrow(/matches no compendium pack/);
	});

	test("throws loudly for an ambiguous name without fromPack", () => {
		expect(() =>
			toActorSourceDocument({ name: "X", items: ["Flak Armour"] }, index),
		).toThrow(/ambiguous across packs/);
	});

	test("standalone opts out with intent and stamps nothing", () => {
		const { embedded } = toActorSourceDocument(
			{
				name: "X",
				items: [{ name: "One-off Gubbin", standalone: true, type: "gear" }],
			},
			index,
		);
		expect(
			(embedded[0].flags as Record<string, unknown>)["rogue-trader"],
		).toBeUndefined();
	});

	test("duplicate embedded names get distinct deterministic ids", () => {
		const { actor, embedded } = toActorSourceDocument(
			{
				name: "X",
				items: [
					{ name: "Lasgun" },
					{ name: "Lasgun" },
				],
			},
			index,
		);
		expect(embedded[0]._id).not.toBe(embedded[1]._id);
		expect(new Set(actor.items as string[]).size).toBe(2);
	});

	test("levelDB keys match the Foundry 14 sublevel format", () => {
		expect(actorKey("abc")).toBe("!actors!abc");
		expect(actorItemKey("a1", "b2")).toBe("!actors.items!a1.b2");
	});
});

describe("journal ownership (bead wdeq)", () => {
	const index: ItemSourceIndex = new Map();

	test("entry ownership flows to the journal and every page", () => {
		const { journal, pages } = toJournalSourceDocument(
			{
				name: "Rules",
				ownership: { default: 2 },
				pages: [{ name: "A", text: "a" }, { name: "B", text: "b" }],
			},
			index,
		);
		expect(journal.ownership).toEqual({ default: 2 });
		for (const page of pages) {
			expect(page.ownership).toEqual({ default: 2 });
		}
	});

	test("page-level ownership overrides the journal entry", () => {
		const { pages } = toJournalSourceDocument(
			{
				name: "Rules",
				ownership: { default: 2 },
				pages: [
					{ name: "Open", text: "a", ownership: { default: 3 } },
					{ name: "Closed", text: "b" },
				],
			},
			index,
		);
		expect(pages[0].ownership).toEqual({ default: 3 });
		expect(pages[1].ownership).toEqual({ default: 2 });
	});

	test("GM-only fallback for adventure packs (intothemaw contract)", () => {
		const { journal, pages } = toJournalSourceDocument(
			{ name: "Adventure", pages: [{ name: "A", text: "a" }] },
			index,
		);
		expect(journal.ownership).toEqual({ default: 0 });
		expect(pages[0].ownership).toEqual({ default: 0 });
	});
});

describe("compendium folder groupings (bead nsqt)", () => {
	describe("resolveEntryGroup", () => {
		test("weapons group by weaponFamily with book section labels", () => {
			expect(
				resolveEntryGroup(
					{ name: "Lasgun", system: { weaponFamily: "las" } },
					"weapons",
				),
			).toBe("Las Weapons");
			expect(
				resolveEntryGroup(
					{ name: "Frag", system: { weaponFamily: "thrown" } },
					"weapons",
				),
			).toBe("Thrown Weapons");
		});

		test("weapons unmapped family fails loudly", () => {
			expect(() =>
				resolveEntryGroup(
					{ name: "Mystery Gun", system: { weaponFamily: "plasma-cutter" } },
					"weapons",
				),
			).toThrow(/no folder label for weaponFamily/);
		});

		test("armour unmapped name fails loudly", () => {
			expect(() =>
				resolveEntryGroup({ name: "Mystery Suit" }, "armour"),
			).toThrow(/unmapped — extend ARMOUR_GROUPS/);
		});

		test("gear groups by name suffix before page bands", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Hot-Shot Charge Pack (Unusual Ammunition)",
						system: { source: { book: "rt_core", page: 136 } },
					},
					"gear",
				),
			).toBe("Unusual Ammunition");
			expect(
				resolveEntryGroup(
					{
						name: "Bolt Shells (Ammunition)",
						system: { source: { book: "rt_core", page: 136 } },
					},
					"gear",
				),
			).toBe("Ammunition");
		});

		test("gear groups rt_core Weapon Upgrades and Gear bands", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Mono (Weapon Upgrade)",
						system: { source: { book: "rt_core", page: 133 } },
					},
					"gear",
				),
			).toBe("Weapon Upgrades");
			expect(
				resolveEntryGroup(
					{
						name: "Void Suit",
						system: { source: { book: "rt_core", page: 140 } },
					},
					"gear",
				),
			).toBe("Gear");
		});

		test("gear Backpack override (Table 5-13, p140; cite flagged on nn96)", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Backpack",
						system: { source: { book: "rt_core", page: 135 } },
					},
					"gear",
				),
			).toBe("Gear");
		});

		test("tools group wholesale as the book's Tools section", () => {
			expect(
				resolveEntryGroup(
					{ name: "Multikey", system: { source: { book: "rt_core", page: 145 } } },
					"tools",
				),
			).toBe("Tools");
		});

		test("authoring group: key overrides the derivation", () => {
			expect(
				resolveEntryGroup(
					{ name: "Odd Item", group: "Custom/Deep", system: {} },
					"aptitudes",
				),
			).toBe("Custom/Deep");
		});

		test("ungrouped packs default to root", () => {
			expect(resolveEntryGroup({ name: "Cyber Heart" }, "cybernetics")).toBe(
				null,
			);
		});

		test("a non-string group override fails loudly", () => {
			expect(() =>
				resolveEntryGroup({ name: "X", group: 42 }, "weapons"),
			).toThrow(/must be a non-empty string/);
		});
	});

	describe("buildPackFolders", () => {
		test("emits deterministic folder docs and stamps labels", () => {
			const entries = [
				{ name: "A", system: { weaponFamily: "las" } },
				{ name: "B", system: { weaponFamily: "las" } },
				{ name: "C", system: { weaponFamily: "chain" } },
			];
			const { folders, byLabel } = buildPackFolders("weapons", entries);
			expect(folders).toHaveLength(2);
			const las = folders.find((f) => f.name === "Las Weapons");
			const chain = folders.find((f) => f.name === "Chain Weapons");
			expect(las?.type).toBe("Item");
			expect(las?.folder).toBeNull();
			// Deterministic ids: same label → same _id across rebuilds.
			expect(folderId("weapons", "Las Weapons")).toBe(las?._id);
			expect(byLabel.get("Las Weapons")).toBe(las?._id);
			expect(byLabel.get("Chain Weapons")).toBe(chain?._id);
			// Sort is stable insertion order (depth, then alphabetical:
			// "Chain Weapons" sorts before "Las Weapons").
			expect(chain?.sort).toBeLessThan(las?.sort ?? 0);
		});

		test("nests '/' labels under their parent folder", () => {
			const { folders, byLabel } = buildPackFolders("weapons", [
				{ name: "A", group: "Pistols" },
				{ name: "B", group: "Pistols/Las" },
			]);
			expect(folders).toHaveLength(2);
			const pistols = folders.find((f) => f.name === "Pistols");
			const las = folders.find((f) => f.name === "Las");
			expect(las?.folder).toBe(byLabel.get("Pistols"));
			expect(las?.folder).toBe(pistols?._id);
			// Children sort after their parent.
			expect(pistols?.sort).toBeLessThan(las?.sort ?? 0);
		});

		test("missing nested parent fails loudly", () => {
			expect(() =>
				buildPackFolders("weapons", [{ name: "A", group: "Pistols/Las" }]),
			).toThrow(/has no parent folder/);
		});
	});
});

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	actorItemKey,
	actorKey,
	buildPackFolders,
	buildTableResults,
	conceptFolderLabel,
	documentId,
	folderId,
	guardedBatch,
	mirrorPackAssets,
	readManifestPacks,
	MANIFEST_PACKS_YAML,
	resolveEntryGroup,
	resolveEntryFolder,
	resolveEntryType,
	resolveLinks,
	sourceKey,
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
		// Origin Path (epic 1gb7): chart entries + their trait rows.
		expect(resolveEntryType({ type: "Item" }, "origins")).toBe("origin");
		expect(resolveEntryType({ type: "Item" }, "origin-traits")).toBe(
			"origintrait",
		);
		// Insanity/corruption + mutation content (epic nt8k): typed rows whose
		// kind/tableKey fields vanish if the folder falls back to gear.
		expect(resolveEntryType({ type: "Item" }, "madness")).toBe(
			"madnessentry",
		);
		expect(resolveEntryType({ type: "Item" }, "mutations")).toBe("mutation");
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

describe("concept packs (bead 8ubu)", () => {
	test("sourceKey aliases the ships components file", () => {
		expect(sourceKey("components")).toBe("ships");
		expect(sourceKey("weapons")).toBe("weapons");
	});

	test("conceptFolderLabel nests intra-source labels under the concept", () => {
		const tops = { weapons: "Weapons", skills: "Skills", gametables: null };
		expect(conceptFolderLabel("weapons", "Las Weapons", tops)).toBe(
			"Weapons/Las Weapons",
		);
		expect(conceptFolderLabel("skills", null, tops)).toBe("Skills");
		expect(conceptFolderLabel("weapons", null, tops)).toBe("Weapons");
		// no concept label -> the intra-source label is used as-is
		expect(conceptFolderLabel("gametables", "SOI I", tops)).toBe("SOI I");
	});

	/**
	 * The npcs pack groups by entry NAME through NPC_GROUPS, which only covers
	 * npcs.yaml. A second authoring file in the same pack resolves its group
	 * against that file's STEM instead, so without a SOURCE_TOP_LABELS entry its
	 * documents land at the pack root (bead o2gx: the four Tau drones showed up
	 * loose in the compendium next to the concept folders).
	 */
	test("a second authoring file in an actor pack still gets a folder", () => {
		expect(resolveEntryFolder({ name: "Tau Gun Drone" }, "tau-drones")).toBe(
			"Tau",
		);
		expect(resolveEntryFolder({ name: "Tau Shield Drone" }, "tau-drones")).toBe(
			"Tau",
		);
	});

	test("buildPackFolders groups several sources under one pack", () => {
		const lasgun = { name: "Lasgun", system: { weaponFamily: "las" } };
		const acrobatics = { name: "Acrobatics", type: "Item" };
		const keyOf = new Map<Record<string, unknown>, string>([
			[lasgun, "weapons"],
			[acrobatics, "skills"],
		]);
		const { folders, byLabel } = buildPackFolders(
			"character-options",
			[lasgun, acrobatics],
			"Item",
			(entry) => keyOf.get(entry) ?? "character-options",
			{ weapons: "Weapons", skills: "Skills" },
		);
		expect(folders.map((f) => f.name).sort()).toEqual([
			"Las Weapons",
			"Skills",
			"Weapons",
		]);
		const las = folders.find((f) => f.name === "Las Weapons");
		expect(las?.folder).toBe(byLabel.get("Weapons"));
		expect(byLabel.get("Weapons")).toBe(
			folderId("character-options", "Weapons"),
		);
	});
});

describe("guardedBatch (bead 3e6u)", () => {
	test("throws on a duplicate document key instead of overwriting", () => {
		const written: string[] = [];
		const batch = guardedBatch(
			{
				put: (key) => {
					written.push(key);
				},
				write: () => Promise.resolve(),
			},
			"weapons",
		);
		batch.put("!items!abc", "{}");
		expect(() => batch.put("!items!abc", "{}")).toThrow(
			/duplicate document key/,
		);
		expect(written).toEqual(["!items!abc"]);
	});

	test("allows distinct keys", () => {
		const written: string[] = [];
		const batch = guardedBatch(
			{
				put: (key) => {
					written.push(key);
				},
				write: () => Promise.resolve(),
			},
			"weapons",
		);
		batch.put("!items!a", "{}");
		expect(() => batch.put("!items!b", "{}")).not.toThrow();
		expect(written).toEqual(["!items!a", "!items!b"]);
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
	// Synthetic pack labels: this suite builds its own in-memory index, so the
	// names are arbitrary and NOT the shipped pack ids (which were consolidated
	// into equipment/character-options in beads n7hu/4tj1).
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
					entry: {
						name: "Flak Armour",
						type: "armour",
						system: { armourPoints: { body: 4 } },
					},
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
			// NPC default (bead i1sw): a statblock weapon ships carried.
			equipState: "carried",
		});
	});

	test("compendium NPC inventory ships equipped: weapon carried, armour worn (bead i1sw)", () => {
		const { embedded } = toActorSourceDocument(
			{
				name: "X",
				type: "npc",
				items: [
					{ name: "Lasgun" },
					{ name: "Flak Armour", fromPack: "armour" },
					{ name: "Common Lore" },
				],
			},
			index,
		);
		expect(
			(embedded[0].system as Record<string, unknown>).equipState,
		).toBe("carried");
		expect(
			(embedded[1].system as Record<string, unknown>).equipState,
		).toBe("worn");
		// Non-physical items (skills) have no equip state.
		expect(
			(embedded[2].system as Record<string, unknown>).equipState,
		).toBeUndefined();
	});

	test("an authored equipState wins over the NPC default", () => {
		const { embedded } = toActorSourceDocument(
			{
				name: "X",
				type: "npc",
				items: [{ name: "Lasgun", system: { equipState: "stowed" } }],
			},
			index,
		);
		expect(
			(embedded[0].system as Record<string, unknown>).equipState,
		).toBe("stowed");
	});

	test("only npc actors get the inventory equipped", () => {
		const { embedded } = toActorSourceDocument(
			{ name: "X", type: "starship", items: [{ name: "Lasgun" }] },
			index,
		);
		expect(
			(embedded[0].system as Record<string, unknown>).equipState,
		).toBeUndefined();
	});

	test("a linked clone's type comes from the SOURCE key, not the physical pack (regression)", () => {
		// Concept consolidation: the physical pack is `character-options` while
		// the entry's source (the historical pack name) is `talents`. Resolving
		// from the physical id fell through to "gear" and stripped every NPC
		// statblock item of its real type.
		const conceptIndex: ItemSourceIndex = new Map([
			[
				"Talent of Note",
				[
					{
						pack: "character-options",
						source: "talents",
						type: "talent",
						id: documentId("Talent of Note"),
						entry: { name: "Talent of Note", system: {} },
					},
				],
			],
		]);
		const { embedded } = toActorSourceDocument(
			{ name: "X", type: "npc", items: [{ name: "Talent of Note" }] },
			conceptIndex,
		);
		expect(embedded[0].type).toBe("talent");
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

	test("throws loudly when fromPack names a source without that item (szgv)", () => {
		expect(() =>
			toActorSourceDocument(
				{ name: "X", items: [{ name: "Lasgun", fromPack: "armour" }] },
				index,
			),
		).toThrow(/declares fromPack: armour/);
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

	test("standalone opts out with intent and stamps no source link", () => {
		const { embedded } = toActorSourceDocument(
			{
				name: "X",
				items: [{ name: "One-off Gubbin", standalone: true, type: "gear" }],
			},
			index,
		);
		// Build-time provenance (flags."rogue-trader".source) is always stamped;
		// standalone means no compendium link, not no flags.
		expect(
			(embedded[0].flags as Record<string, Record<string, unknown>>)[
				"rogue-trader"
			]?.compendiumSource,
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

		test("ship components group by the componentType taxonomy (bead 5lbn)", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Jovian Pattern Class 1 Drive",
						type: "ship-component",
						system: { componentType: "plasma-drive" },
					},
					"ships",
				),
			).toBe("Plasma Drives");
			expect(
				resolveEntryGroup(
					{
						name: "Sunhammer Lance Weapon",
						type: "ship-weapon-component",
						system: { componentType: "lance" },
					},
					"ships",
				),
			).toBe("Lances");
		});

		test("ship hulls group by hullClass, npc vessels to their own folder (bead 5lbn)", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Avenger-class Grand Cruiser",
						type: "ship",
						system: { hullClass: "grand-cruiser" },
					},
					"ships",
				),
			).toBe("Grand Cruisers");
			expect(
				resolveEntryGroup(
					{
						name: "Ork Kroozer",
						type: "ship",
						system: { hullClass: "cruiser", npc: true },
					},
					"ships",
				),
			).toBe("NPC Vessels");
		});

		test("vessels actor pack nests starship factions under a Starships folder (bead imiq)", () => {
			const entries = [
				{ name: "Ork Kroozer", type: "starship", group: "Ork", system: {} },
				{ name: "Eldar Hellebore", type: "starship", group: "Eldar", system: {} },
				{ name: "The Sirius", type: "starship", group: "Imperium", system: {} },
				{ name: "Rhino APC", type: "vehicle", system: {} },
			];
			const keyOf = new Map<Record<string, unknown>, string>([
				[entries[0], "starships"],
				[entries[1], "starships"],
				[entries[2], "starships"],
				[entries[3], "vehicles"],
			]);
			const { folders, byLabel } = buildPackFolders(
				"vessels",
				entries,
				"Actor",
				(entry) => keyOf.get(entry) ?? "vessels",
			);
			expect(folders.map((f) => f.name).sort()).toEqual([
				"Eldar",
				"Imperium",
				"Ork",
				"Starships",
				"Vehicles",
			]);
			expect(folders.every((f) => f.type === "Actor")).toBe(true);
			expect(byLabel.get("Vehicles")).toBeDefined();
			expect(byLabel.get("Starships/Ork")).toBeDefined();
			// the faction folder hangs off the Starships concept folder
			const ork = folders.find((f) => f.name === "Ork");
			expect(ork?.folder).toBe(byLabel.get("Starships"));
		});

		test("gametables group by the kind→chapter map (bead 5lbn)", () => {
			expect(
				resolveEntryGroup(
					{
						name: "Planet Body — Rocky 1 Low-Mass",
						system: { kind: "soi-planet-body" },
					},
					"gametables",
				),
			).toBe("SOI I — World Generator");
			expect(
				resolveEntryGroup(
					{
						name: "Planetside Complication — 1 The Passing Storm",
						system: { kind: "soi-complication" },
					},
					"gametables",
				),
			).toBe("SOI II — Planetside Adventures");
			expect(
				resolveEntryGroup(
					{ name: "Warp Encounter — X", system: { kind: "warp-encounter" } },
					"gametables",
				),
			).toBe("Navis Primer — Warp Travel");
		});

		test("npcs group by loose faction/type (bead g0vv)", () => {
			expect(
				resolveEntryGroup({ name: "Eldar Corsair", type: "npc" }, "npcs"),
			).toBe("Eldar");
			expect(
				resolveEntryGroup(
					{ name: "T'Zar the Broker (Herald of Tzeentch)", type: "npc" },
					"npcs",
				),
			).toBe("Chaos & Daemons");
			expect(
				resolveEntryGroup({ name: "Scum", type: "npc" }, "npcs"),
			).toBe("Criminals & Underworld");
		});

		test("unmapped npc name fails loudly (bead g0vv)", () => {
			expect(() =>
				resolveEntryGroup({ name: "Mystery NPC", type: "npc" }, "npcs"),
			).toThrow(/no folder label/);
		});

		test("unmapped gametables kind fails loudly (bead 5lbn)", () => {
			expect(() =>
				resolveEntryGroup(
					{ name: "Mystery Table", system: { kind: "unknown-kind" } },
					"gametables",
				),
			).toThrow(/no folder label for kind/);
		});

		test("unmapped ship componentType fails loudly (bead 5lbn)", () => {
			expect(() =>
				resolveEntryGroup(
					{
						name: "Odd Component",
						type: "ship-component",
						system: { componentType: "mystery" },
					},
					"ships",
				),
			).toThrow(/no folder label for componentType/);
		});
	});

	describe("buildPackFolders", () => {
		test("emits deterministic folder docs and stamps labels", () => {
			const entries = [
				{ name: "A", system: { weaponFamily: "las" } },
				{ name: "B", system: { weaponFamily: "las" } },
				{ name: "C", system: { weaponFamily: "chain" } },
			];
			// Neutral topLabels: this test exercises the raw derivation labels.
			const { folders, byLabel } = buildPackFolders(
				"weapons",
				entries,
				"Item",
				undefined,
				{},
			);
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
			const { folders, byLabel } = buildPackFolders(
				"weapons",
				[
					{ name: "A", group: "Pistols" },
					{ name: "B", group: "Pistols/Las" },
				],
				"Item",
				undefined,
				{},
			);
			expect(folders).toHaveLength(2);
			const pistols = folders.find((f) => f.name === "Pistols");
			const las = folders.find((f) => f.name === "Las");
			expect(las?.folder).toBe(byLabel.get("Pistols"));
			expect(las?.folder).toBe(pistols?._id);
			// Children sort after their parent.
			expect(pistols?.sort).toBeLessThan(las?.sort ?? 0);
		});

		test("nested groups auto-create their implied parent (bead g0vv)", () => {
			// "Pistols/Las" implies "Pistols" — the parent folder is created
			// even when no entry maps to it directly.
			const { folders, byLabel } = buildPackFolders(
				"weapons",
				[{ name: "A", group: "Pistols/Las" }],
				"Item",
				undefined,
				{},
			);
			const parent = folders.find((f) => f.name === "Pistols");
			expect(parent).toBeDefined();
			expect(byLabel.get("Pistols")).toBe(String(parent._id));
			const child = folders.find((f) => f.name === "Las");
			expect(child?.folder).toBe(String(parent._id));
		});
	});
});

/**
 * Pack-declaration fragment (bead: manifest fragment move): every authored
 * pack folder must carry an entry, and structured shape must hold — the
 * fragment feeds the shipped system.json verbatim, so a bad entry ships
 * broken. Skipped wholesale when there is no content clone (CI), same as the
 * governance warning itself.
 */
describe("mirrorPackAssets (bead v2cn)", () => {
	test("mirrors portraits/ into the private asset dir, never the pack dir", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pack-assets-"));
		const src = path.join(root, "src", "npcs");
		const dest = path.join(root, "release", "private", "npcs");
		await mkdir(path.join(src, "portraits"), { recursive: true });
		await writeFile(path.join(src, "portraits", "a.webp"), "x");

		const copied = await mirrorPackAssets(src, dest);
		expect(copied).toEqual(["portraits"]);
		expect(existsSync(path.join(dest, "portraits", "a.webp"))).toBe(true);
		// Foundry owns packs/<pack>/ and rewrites it during compendium
		// migrations, so the mirror must never target a pack directory.
		expect(dest.includes(`${path.sep}packs${path.sep}`)).toBe(false);
	});

	test("replaces the destination wholesale so a deleted portrait cannot linger", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pack-assets-"));
		const src = path.join(root, "src");
		const dest = path.join(root, "private", "npcs");
		await mkdir(path.join(src, "portraits"), { recursive: true });
		await writeFile(path.join(src, "portraits", "keep.webp"), "x");
		await mkdir(path.join(dest, "portraits"), { recursive: true });
		await writeFile(path.join(dest, "portraits", "stale.webp"), "y");

		await mirrorPackAssets(src, dest);
		expect(existsSync(path.join(dest, "portraits", "keep.webp"))).toBe(true);
		expect(existsSync(path.join(dest, "portraits", "stale.webp"))).toBe(false);
	});

	test("is a no-op when the pack ships no art (the public build)", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pack-assets-"));
		const src = path.join(root, "src");
		await mkdir(src, { recursive: true });
		expect(await mirrorPackAssets(src, path.join(root, "dest"))).toEqual([]);
		expect(existsSync(path.join(root, "dest"))).toBe(false);
	});
});

describe("readManifestPacks (manifest-packs.yaml fragment)", () => {
	test("fragment shape and pack-folder coverage", async () => {
		const packs = await readManifestPacks();
		if (!packs) return;
		const names = packs.map((pack) => pack.name).filter(Boolean) as string[];
		expect(names.length).toBe(packs.length);
		expect(new Set(names).size).toBe(names.length);
		// Every declared pack points where the packer emits it.
		for (const pack of packs) {
			expect(String(pack.path)).toBe(`packs/${String(pack.name)}`);
			expect(String(pack.system)).toBe("rogue-trader");
		}
		// Stable spine: removing a fragment entry must be loud, not silent.
		for (const required of [
			"character-options",
			"equipment",
			"afflictions",
			"ships",
			"vessels",
			"rolltables",
			"npcs",
			"rules",
			"intothemaw",
		]) {
			expect(names).toContain(required);
		}
	});

	test("fragment path constant matches the content-repo location", () => {
		expect(MANIFEST_PACKS_YAML).toBe(
			"./src/packs/rogue_trader/manifest-packs.yaml",
		);
	});
});

describe("resolveLinks (journal authoring links)", () => {
	// Synthetic pack labels (arbitrary; the resolver only compares strings).
	const index = new Map<
		string,
		Array<{ pack: string; id: string; type?: string }>
	>([
		[
			"Tainted",
			[
				{ pack: "madness", id: "mad1" },
				{ pack: "origins", id: "ori1" },
			],
		],
		["Soiled", [{ pack: "madness", id: "mad2" }]],
		// Same-pack, same-name entries (the merged character-options pack).
		[
			"Fear",
			[
				{ pack: "character-options", id: "trait1", type: "trait" },
				{ pack: "character-options", id: "origin1", type: "origin" },
			],
		],
	]);

	test("unqualified links resolve to the first pack", () => {
		expect(resolveLinks("[[Soiled]]", index)).toBe(
			"@UUID[Compendium.rogue-trader.madness.mad2]{Soiled}",
		);
	});

	test("pack: qualifier selects the pack and drops the ambiguity", () => {
		expect(resolveLinks("[[madness:Tainted]]", index)).toBe(
			"@UUID[Compendium.rogue-trader.madness.mad1]{Tainted}",
		);
		expect(resolveLinks("[[origins:Tainted|Tainted Lure]]", index)).toBe(
			"@UUID[Compendium.rogue-trader.origins.ori1]{Tainted Lure}",
		);
	});

	test("type: qualifier disambiguates same-name entries in one pack", () => {
		expect(resolveLinks("[[trait:Fear]]", index)).toBe(
			"@UUID[Compendium.rogue-trader.character-options.trait1]{Fear}",
		);
	});

	test("a colon prefix that is not a pack stays part of the name", () => {
		// "Unknown" is not a pack, so the colon is not treated as a qualifier.
		expect(resolveLinks("[[Unknown:Tainted]]", index)).toBe("Unknown:Tainted");
	});

	test("unresolvable names stay literal", () => {
		expect(resolveLinks("[[Nope]]", index)).toBe("Nope");
	});
});

/**
 * The CreatorApplyService's kit / acquisition / grants-and-summary steps
 * (bead hldm), unit-tested in isolation with a fake actor, a fetched docs
 * list and a spy notify — no packs resolved, confirm dialogs live in
 * createOrUpdateActor (creator-apply.test.ts). applyGrantsAndSummary rides
 * the ports seam (setPorts) for its skill-doc fetch + chat post.
 *
 * The module is the sheet edge, so the test uses the same Foundry globals
 * shim + dynamic-import pattern as creator-apply.test.ts and restores the
 * globals after.
 */
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	setOriginEntries,
	resolveOrigins,
	type OriginEntry,
} from "../../rules/origins";
import { setGearsetEntries } from "../../rules/gearsets";
import {
	setPorts,
	resetPorts,
} from "../../../ffg/infrastructure/foundry/ports";
import type { Ports, Notify } from "../../../ffg/application/ports";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;

let chatPosts: string[] = [];
let warns: Array<{ key: string; vars?: Record<string, unknown> }> = [];

globals.game = {
	i18n: {
		localize: (key: string) => `L10N[${key}]`,
		format: (key: string) => `F[${key}]`,
	},
	system: { id: "rogue-trader" },
};
globals.ui = {
	notifications: { warn: () => undefined, info: () => undefined },
};
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: {
				wait: async () => null,
				input: async () => null,
				confirm: async () => true,
			},
		},
		handlebars: {
			renderTemplate: async () => "",
			getTemplate: async () => () => "",
		},
	},
	handlebars: {
		renderTemplate: async () => "",
		getTemplate: async () => () => "",
	},
	documents: {
		Item: class {},
		Actor: class {},
		ChatMessage: {
			create: async (data: { content?: string }) => {
				chatPosts.push(data.content ?? "");
				return { id: "m1" };
			},
		},
	},
	dice: { Roll: class {} },
	utils: { mergeObject: () => undefined },
};

const notify: Notify = {
	warn: (key: string, vars?: Record<string, unknown>) => {
		warns.push({ key, vars });
	},
	error: () => undefined,
	info: () => undefined,
	post: async () => ({ id: "c1" }),
	popup: () => undefined,
} as unknown as Notify;

afterEach(() => resetPorts());
afterAll(() => {
	resetPorts();
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const { applyKit, applyAcquisition, applyGrantsAndSummary } = await import(
	"./creator-apply"
);
const { emptyState } = await import("./creator-state");

// --- Fakes -------------------------------------------------------------------

/** A fake actor: `items` is either an array snapshot (update path) or the
 * "items map" mode (the weapon-update seam the kit mods path uses). */
function fakeActor(itemsMode: "array" | "map" = "array") {
	const created: Record<string, unknown>[] = [];
	const deleted: string[][] = [];
	const updates: Record<string, unknown>[] = [];
	let counter = 0;
	const itemIndex = new Map<
		string,
		{ update?: (d: object) => Promise<unknown> }
	>();
	const actor = {
		name: "Rook",
		uuid: "Actor.abc",
		update: async (data: object) => {
			updates.push(data as Record<string, unknown>);
		},
		createEmbeddedDocuments: async (_type: string, data: object[]) => {
			const out = data.map(() => ({ id: `created-${++counter}` }));
			data.forEach((d, i) => {
				created.push(d as Record<string, unknown>);
				itemIndex.set((out[i] as { id: string }).id, {
					update: async (ud: object) => {
						updates.push(ud as Record<string, unknown>);
					},
				});
			});
			return out;
		},
		deleteEmbeddedDocuments: async (_type: string, ids: string[]) => {
			deleted.push(ids);
		},
		items:
			itemsMode === "array" ? [] : { get: (id: string) => itemIndex.get(id) },
		sheet: { render: () => undefined },
	};
	return { actor, created, deleted, updates };
}

// The origin/kit pools are MODULE-LEVEL runtime state shared with other test
// files (see creator-context.test.ts); re-install this suite's fixtures
// before every test so the assertions are deterministic.
const ORIGIN_FIXTURES: OriginEntry[] = [
	{
		key: "hive-world",
		row: "home-world",
		col: 0,
		name: "Hive World",
		description: "",
		mechanics: { skills: ["Awareness"], woundsDice: "1d5" },
	},
	{
		key: "void-born",
		row: "home-world",
		col: 1,
		name: "Void-born",
		description: "",
		mechanics: {},
	},
];

beforeEach(() => {
	warns = [];
	chatPosts = [];
	setOriginEntries(ORIGIN_FIXTURES);
});

const SKILL_DOCS = [
	{
		name: "Awareness",
		type: "skill",
		uuid: "Compendium.rogue-trader.character-options.Item.awa",
		system: { characteristic: "per" },
	},
];

const EQ_DOCS = [
	{
		name: "Lasgun",
		type: "ranged-weapon",
		flags: { "rogue-trader": { source: "weapons" } },
		toObject: () => ({
			_id: "pack-lasgun",
			name: "Lasgun",
			type: "ranged-weapon",
			system: { mag: 30 },
		}),
	},
	{
		name: "Amasec",
		type: "gear",
		flags: { "rogue-trader": { source: "gear" } },
		toObject: () => ({ _id: "pack-amasec", name: "Amasec", system: {} }),
	},
	{
		name: "Lhot Blade",
		type: "melee-weapon",
		flags: { "rogue-trader": { source: "weapons" } },
		toObject: () => ({ _id: "pack-lhot", name: "Lhot Blade", system: {} }),
	},
	{
		name: "Weapon Mod",
		type: "weapon-modification",
		toObject: () => ({
			_id: "pack-mod",
			name: "Weapon Mod",
			system: { mod: true },
		}),
	},
	{
		name: "Heirloom Locket",
		type: "gear",
		flags: { "rogue-trader": { item: "heirloom-locket" } },
		toObject: () => ({
			_id: "pack-locket",
			name: "Heirloom Locket",
			system: { craftsmanship: "best" },
		}),
	},
];

/** Arch-Militant kit: a fixed slot, an "or" slot (one with mods), a note. */
function kitFixture() {
	return {
		key: "arch-militant",
		label: "Arch-Militant Kit",
		quote: "",
		source: {},
		slots: [
			{
				quote: "fixed",
				options: [
					{ name: "Lasgun", source: "weapons", craftsmanship: "common" },
				],
			},
			{
				quote: "",
				options: [
					{ name: "Amasec", source: "gear", quantity: 2 },
					{
						name: "Lhot Blade",
						source: "weapons",
						mods: ["Weapon Mod"],
					},
				],
			},
			{
				quote: "",
				options: [
					{
						note: true,
						name: "A handwritten note",
						description: "Some gear prose",
					},
				],
			},
		],
	};
}

// --- applyKit -----------------------------------------------------------------

describe("applyKit (bead hldm)", () => {
	test("a career without a kit is a no-op", async () => {
		const { actor, created } = fakeActor();
		await applyKit(actor as never, emptyState(), { docs: EQ_DOCS, notify });
		expect(created).toEqual([]);
	});

	test("options clone by name with overrides + provenance, and never keep _id", async () => {
		setGearsetEntries([kitFixture() as never]);
		try {
			const { actor, created } = fakeActor();
			await applyKit(
				actor as never,
				{ ...emptyState(), careerKey: "arch-militant", kitPicks: { 1: 0 } },
				{ docs: EQ_DOCS, notify },
			);
			// Slot 0 (fixed): the Lasgun clone; slot 1 pick 0: Amasec; slot 2: note.
			expect(created).toHaveLength(3);
			const lasgun = created[0];
			expect(lasgun).toMatchObject({
				name: "Lasgun",
				type: "ranged-weapon",
			});
			expect(lasgun.system as Record<string, unknown>).toMatchObject({
				mag: 30,
				craftsmanship: "common",
				grantedBy: "creator",
			});
			// Clones must not carry the pack doc's _id (repo convention).
			expect(lasgun._id).toBeUndefined();
			expect(created[1].name).toBe("Amasec");
			expect((created[1].system as Record<string, unknown>).quantity).toBe(2);
			const note = created[2];
			expect(note).toMatchObject({ type: "gear" });
			expect((note.system as Record<string, unknown>).description).toBe(
				"Some gear prose",
			);
		} finally {
			setGearsetEntries([]);
		}
	});

	test("weapon mods clone and attach via system.modifications (bead huaf)", async () => {
		setGearsetEntries([kitFixture() as never]);
		try {
			const { actor, created, updates } = fakeActor("map");
			await applyKit(
				actor as never,
				{ ...emptyState(), careerKey: "arch-militant", kitPicks: { 1: 1 } },
				{ docs: EQ_DOCS, notify },
			);
			// All three slots run: Lasgun (fixed), Lhot Blade + its mod, the note.
			expect(created).toHaveLength(4);
			expect(created[1]).toMatchObject({ name: "Lhot Blade" });
			expect(created[2]).toMatchObject({ name: "Weapon Mod" });
			// The weapon's update carries the mod's created id.
			expect(updates).toEqual([{ system: { modifications: ["created-3"] } }]);
		} finally {
			setGearsetEntries([]);
		}
	});

	test("a missing option is a loud warn, never a silent drop", async () => {
		setGearsetEntries([kitFixture() as never]);
		try {
			const { actor, created } = fakeActor();
			await applyKit(
				actor as never,
				{ ...emptyState(), careerKey: "arch-militant" },
				{ docs: [], notify },
			);
			// Both clone slots warn loudly; the note slot needs no doc.
			expect(warns).toEqual([
				{ key: "CREATOR.KIT_MISSING", vars: { name: "Lasgun" } },
				{ key: "CREATOR.KIT_MISSING", vars: { name: "Amasec" } },
			]);
			expect(created).toHaveLength(1);
			expect(created[0].name).toBe("A handwritten note");
		} finally {
			setGearsetEntries([]);
		}
	});
});

// --- applyAcquisition ----------------------------------------------------------

describe("applyAcquisition (bead hldm)", () => {
	test("the chosen acquisition's payload is granted with creator provenance", async () => {
		const { actor, created } = fakeActor();
		await applyAcquisition(
			actor as never,
			{
				...emptyState(),
				acquisition: {
					key: "k",
					name: "Lasgun",
					payload: {
						_id: "pack-lasgun",
						name: "Lasgun",
						system: { mag: 30 },
					},
				},
			},
			{ docs: [], notify },
		);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ name: "Lasgun" });
		// The chip payload is a captured pack doc: the clone must NOT carry
		// its _id — a kit option can BE the chosen acquisition (bead xynx).
		expect(created[0]._id).toBeUndefined();
		expect(created[0].system).toEqual({
			mag: 30,
			grantedBy: "creator",
		});
	});

	test("no acquisition + no heirloom -> nothing granted", async () => {
		const { actor, created } = fakeActor();
		await applyAcquisition(actor as never, emptyState(), {
			docs: [],
			notify,
		});
		expect(created).toEqual([]);
	});

	test("the rolled heirloom clones the flag-marked equipment doc, sans _id", async () => {
		const { actor, created } = fakeActor();
		await applyAcquisition(
			actor as never,
			{ ...emptyState(), heirloom: { roll: 12, name: "Heirloom Locket" } },
			{ docs: EQ_DOCS, notify },
		);
		expect(created).toHaveLength(1);
		const locket = created[0];
		expect(locket).toMatchObject({ name: "Heirloom Locket" });
		expect(locket._id).toBeUndefined();
	});

	test("a missing heirloom doc is a loud warn (the roll happened)", async () => {
		const { actor, created } = fakeActor();
		await applyAcquisition(
			actor as never,
			{ ...emptyState(), heirloom: { roll: 12, name: "Nowhere Locket" } },
			{ docs: EQ_DOCS, notify },
		);
		expect(warns).toEqual([
			{
				key: "CREATOR.HEIRLOOM_MISSING",
				vars: { name: "Nowhere Locket" },
			},
		]);
		expect(created).toEqual([]);
	});
});

// --- applyGrantsAndSummary -----------------------------------------------------

describe("applyGrantsAndSummary (bead hldm)", () => {
	/** The ports fake: the skill-doc fetch resolves the Awareness doc. */
	const fakePorts = {
		dice: {
			roll: async () => ({ total: 0, dice: [], terms: [], formula: "" }),
		},
		content: {
			documentsOrNull: async (packId: string) =>
				packId === "rogue-trader.character-options" ? SKILL_DOCS : [],
			document: async () => null,
		},
		permissions: { can: () => true },
	} as unknown as Ports;

	test("the tail: skill grants and the summary card post (the HTML contract)", async () => {
		setPorts(fakePorts);
		const { actor, created, deleted } = fakeActor();
		const resolved = resolveOrigins({ "home-world": { key: "hive-world" } });
		await applyGrantsAndSummary(
			actor as never,
			{
				...emptyState(),
				speciesKey: "",
				picks: { "home-world": { key: "hive-world" } },
			},
			resolved,
			{ actorName: "Rook" },
		);
		// No legacy content on the create path: nothing is deleted.
		expect(deleted).toEqual([]);
		// The catalog-matched skill (Hive World's Awareness) is granted.
		expect(created.some((item) => item.name === "Awareness")).toBe(true);
		// The summary card posts with the actor's name as the heading, the
		// creator-summary wrapper class and the localize seam visible in the
		// row labels — the HTML contract the acceptance calls for.
		expect(chatPosts).toHaveLength(1);
		expect(chatPosts[0]).toContain("<h3>Rook</h3>");
		expect(chatPosts[0]).toContain("creator-summary");
		expect(chatPosts[0]).toContain(
			"L10N[ORIGIN.ROW_HOME_WORLD]:</strong> Hive World",
		);
		// The Background-tab notes pointer (bead tgq9) closes the card.
		expect(chatPosts[0]).toContain("L10N[CREATOR.NOTES_POINTER]");
	});

	test("the update path wipes creator-granted items per the OLD picks' reconcile", async () => {
		setPorts(fakePorts);
		const { actor, deleted } = fakeActor();
		await applyGrantsAndSummary(
			actor as never,
			emptyState(),
			resolveOrigins({}),
			{
				actorName: "Rook",
				existingItems: [
					{
						id: "creator-awareness",
						type: "skill",
						name: "Awareness",
						system: { grantedBy: "creator" },
					},
					{ id: "manual", type: "gear", name: "Lho Stick" },
				],
				oldOrigins: { homeWorld: "hive-world" },
			},
		);
		expect(deleted).toEqual([["creator-awareness"]]);
	});
});

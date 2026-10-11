/**
 * Affliction drop pipeline tests (bead yxpk — extracted from
 * character-sheet.ts, previously untestable without instantiating the sheet).
 *
 * Pattern per adapter-ammo-consume.test.ts: Foundry globals are stubbed before
 * the dynamic import, then setPorts() swaps the dice/chat fakes in. Pack
 * lookups (Ravaged Body's mutation table + by-name resolve) ride a stubbed
 * game.packs — no Foundry application is ever instantiated.
 */

const postedCards: Array<{ template: string; vars: Record<string, unknown> }> =
	[];
const rollCalls: string[] = [];

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
	packs: {
		get: (id: string) => MUTATION_PACK_STORE[id],
	},
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	utils: {},
};

/**
 * The stubbed afflictions pack: two mutation rows (one a "re-rolled Ravaged
 * Body" band) and one non-mutation row mixed in to pin the type filter.
 */
const MUTATION_PACK_STORE: Record<string, unknown> = {};

/** A pack mutation document fixture; toObject returns a FRESH deep-ish copy. */
const mutation = (
	name: string,
	rollMin: number,
	rollMax: number,
	documentId: string,
): Record<string, unknown> => ({
	_id: documentId,
	name,
	type: "mutation",
	system: {
		tableKey: "mutations",
		rollMin,
		rollMax,
		// Real pack data: Ravaged Body carries its own procedure, so a
		// re-rolled Ravaged Body must be granted WITHOUT re-running the table.
		procedure: name === "Ravaged Body" ? "ravaged-body" : "",
	},
	toObject(): unknown {
		const self = this as unknown as {
			_id: string;
			name: string;
			system: Record<string, unknown>;
		};
		// Document semantics: a fresh object each call, so the settled clone
		// (procedure cleared, effects appended) cannot corrupt the pack entry.
		return {
			_id: self._id,
			name: self.name,
			system: { ...self.system },
		};
	},
});
MUTATION_PACK_STORE["rogue-trader.afflictions"] = {
	getDocuments: async () =>
		[
			mutation("Ravaged Body", 1, 5, "doc-rb"),
			mutation("Skeptic", 6, 100, "doc-skept"),
			{ name: "Disorder stub", type: "madnessentry", system: {} },
		] as unknown[],
};

const { prepareDroppedItems, mutationRowsFrom, resolveMutationByName } =
	await import("./affliction-drop");
const { foundryPorts, resetPorts, setPorts } = await import(
	"../../../ffg/infrastructure/foundry/ports"
);

import { afterAll, afterEach, describe, expect, test } from "bun:test";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

afterEach(() => {
	resetPorts();
	postedCards.length = 0;
	rollCalls.length = 0;
});

/** Swap in dice/chat fakes; `queue` answers formulas in roll order. */
function wireDice(queue: Array<{ formula: string; total: number }>): void {
	let cursor = 0;
	setPorts({
		...foundryPorts,
		dice: {
			roll: async (formula: string) => {
				rollCalls.push(formula);
				const entry = queue[cursor];
				if (entry && entry.formula === formula) cursor++;
				return {
					total: entry && entry.formula === formula ? entry.total : 1,
					dice: [],
					terms: [],
					formula,
				};
			},
		},
		chat: {
			async post(
				_actor: unknown,
				template: string,
				vars: Record<string, unknown>,
			) {
				postedCards.push({ template, vars });
				return { id: "msg-1" };
			},
			async postHtml() {
				return { id: "msg-1" };
			},
			async update() {
				// not exercised by the drop path.
			},
		},
	});
}

// --- Fixtures -------------------------------------------------------------

/** A dropped Item fixture (plain object; types are erased at runtime). */
const droppedItem = (system: Record<string, unknown>): foundry.documents.Item =>
	({
		name: "Test Affliction",
		type: "mutation",
		toObject: () => ({
			_id: "src-1",
			name: "Test Affliction",
			system: { ...system },
		}),
	}) as unknown as foundry.documents.Item;

/** A fake actor: system answers characteristic reads, items is plain. */
const fakeActor = (
	options: { insanity?: number; held?: Array<{ acquiredSeverity?: string }> } = {},
): foundry.documents.Actor =>
	({
		system: {
			insanity: options.insanity ?? 0,
			effectiveCharacteristicValue: (_key: string) => 40,
		},
		items: (options.held ?? []).map((held) => ({
			type: "madnessentry",
			system: { kind: "disorder", acquiredSeverity: held.acquiredSeverity },
		})),
	}) as unknown as foundry.documents.Actor;

// --- mutationRowsFrom ------------------------------------------------------

describe("mutationRowsFrom (bead yxpk)", () => {
	test("maps pack docs onto table rows, defaulting tableKey", () => {
		expect(
			mutationRowsFrom([])
		).toEqual([]);
		expect(
			mutationRowsFrom([
				{ name: "Ravaged Body", system: { rollMin: 1, rollMax: 5 } },
				{
					name: "Skeptic",
					system: { tableKey: "chaos", rollMin: 6, rollMax: 100 },
				},
			]),
		).toEqual([
			{ name: "Ravaged Body", tableKey: "mutations", rollMin: 1, rollMax: 5 },
			{ name: "Skeptic", tableKey: "chaos", rollMin: 6, rollMax: 100 },
		]);
	});

	test("a row with no name or no band THROWS (silent defaults corrupt the table)", () => {
		expect(() =>
			mutationRowsFrom([{ name: "No Band", system: {} }]),
		).toThrow("no table band");
		expect(() =>
			mutationRowsFrom([{ system: { rollMin: 1, rollMax: 5 } }]),
		).toThrow();
		// A band without rollMax is not a band either.
		expect(() =>
			mutationRowsFrom([{ name: "Half Band", system: { rollMin: 1 } }]),
		).toThrow();
	});
});

// --- prepareDroppedItems ---------------------------------------------------

describe("prepareDroppedItems (bead yxpk)", () => {
	test("an item with no system passes through untouched", async () => {
		wireDice([]);
		const actor = fakeActor();
		const source = { name: "Plain", toObject: () => ({ _id: "x" }) } as never;
		const payloads = await prepareDroppedItems(actor, source);
		expect(payloads).toEqual([{ _id: "x" }]);
		expect(rollCalls).toEqual([]);
		expect(postedCards).toHaveLength(0);
	});

	test("degenerate-mind settles the sub-roll pick once and clears the procedure", async () => {
		wireDice([
			{ formula: "1d10", total: 2 }, // band 1-3 → talents:Frenzy
		]);
		const actor = fakeActor();
		const source = droppedItem({ procedure: "degenerate-mind", effects: [] });
		const payloads = await prepareDroppedItems(actor, source);
		expect(payloads).toHaveLength(1);
		const system = (payloads[0].system ?? {}) as {
			procedure?: string;
			effects?: Array<{ kind: string; testKey?: string }>;
		};
		expect(system.procedure).toBe("");
		expect(system.effects).toEqual([
			{ kind: "grants-item", testKey: "talents:Frenzy" },
		]);
		expect(rollCalls).toEqual(["1d10"]);
	});

	test("signed characteristic dice roll ONCE and settle as value", async () => {
		wireDice([
			{ formula: "-1d10", total: -7 },
		]);
		const actor = fakeActor();
		const source = droppedItem({
			procedure: "",
			effects: [
				{
					kind: "characteristic-modifier",
					testKey: "ag",
					dice: "-1d10",
				},
			],
		});
		const payloads = await prepareDroppedItems(actor, source);
		const effects = (payloads[0].system as { effects: unknown[] }).effects;
		expect(effects).toEqual([
			{ kind: "characteristic-modifier", testKey: "ag", dice: "-1d10", value: -7 },
		]);
	});

	test("an already-settled characteristic effect is not re-rolled", async () => {
		wireDice([]);
		const actor = fakeActor();
		const source = droppedItem({
			effects: [
				{
					kind: "characteristic-modifier",
					testKey: "ag",
					dice: "-1d10",
					value: -4,
				},
			],
		});
		const payloads = await prepareDroppedItems(actor, source);
		expect((payloads[0].system as { effects: unknown[] }).effects).toEqual([
			{ kind: "characteristic-modifier", testKey: "ag", dice: "-1d10", value: -4 },
		]);
		expect(rollCalls).toEqual([]);
	});

	test("a disorder records the severity it was gained at (dueDisorders)", async () => {
		wireDice([]);
		const disorderItem = () => {
			const item = droppedItem({ kind: "disorder" });
			(item as unknown as { type: string }).type = "madnessentry";
			return item;
		};
		// 45 insanity crosses the Minor (40) threshold, not Severe (60).
		const payloads = await prepareDroppedItems(
			fakeActor({ insanity: 45 }),
			disorderItem(),
		);
		expect(
			(payloads[0].system as { acquiredSeverity: string }).acquiredSeverity,
		).toBe("Minor");

		// 10 insanity: no threshold due.
		const later = (await prepareDroppedItems(
			fakeActor({ insanity: 10 }),
			disorderItem(),
		))[0].system as Record<string, unknown>;
		expect(later.acquiredSeverity).toBe("");
	});

	test("an already-held severity is not re-recorded", async () => {
		wireDice([]);
		const source = droppedItem({ kind: "disorder" });
		(source as unknown as { type: string }).type = "madnessentry";
		const payloads = await prepareDroppedItems(
			fakeActor({ insanity: 45, held: [{ acquiredSeverity: "Minor" }] }),
			source,
		);
		expect(
			(payloads[0].system as { acquiredSeverity: string }).acquiredSeverity,
		).toBe("");
	});
});

// --- Ravaged Body end-to-end (pack + card + recursion) ----------------------

describe("Ravaged Body drop (beads kam1 / yxpk)", () => {
	test("rolls 1d5 times on the pack table, posts the card, and clones each grant", async () => {
		// 1d5 → 2 mutations; d100s → Ravaged Body (1-5) and Skeptic (6-100).
		wireDice([
			{ formula: "1d5", total: 2 },
			{ formula: "1d100", total: 3 },
			{ formula: "1d100", total: 50 },
		]);
		const actor = fakeActor();
		const source = droppedItem({ procedure: "ravaged-body", effects: [] });
		const payloads = await prepareDroppedItems(actor, source);

		// Dropped item first, then the two granted mutations in roll order.
		expect(payloads).toHaveLength(3);
		expect((payloads[0].system as { procedure?: string }).procedure).toBe("");
		const names = payloads
			.slice(1)
			.map((p) => (p.name as string | undefined) ?? "");
		expect(names).toEqual(["Ravaged Body", "Skeptic"]);

		// A granted clone is a NEW owned Item: the pack document's _id must go.
		const [rbClone, skepticClone] = payloads.slice(1);
		expect(rbClone._id).toBeUndefined();
		// A re-rolled Ravaged Body is granted WITHOUT re-running its table.
		expect((rbClone.system as { procedure?: string }).procedure).toBe("");
		expect(skepticClone._id).toBeUndefined();
		expect((skepticClone.system as { procedure?: string }).procedure).toBe(
			"",
		);

		// The audit card: once, with both d100s and their rows.
		expect(postedCards).toHaveLength(1);
		expect(postedCards[0].template).toContain("mutation-roll.hbs");
		expect(postedCards[0].vars.results).toEqual([
			{ roll: 3, name: "Ravaged Body" },
			{ roll: 50, name: "Skeptic" },
		]);

		// The pack was read through the (stubbed) compendium, filtered to
		// mutation Items: the madnessentry stub row must never surface as a row.
		expect(rollCalls).toEqual(["1d5", "1d100", "1d100"]);
	});

	test("a grant missing from the pack warns and is skipped, not thrown", async () => {
		// The row exists on the TABLE read but is gone by the by-name resolve
		// (pack changed under the drop): the band 50-100 rolls "Missing
		// Mutation", which the resolve pass then cannot find.
		let packReads = 0;
		MUTATION_PACK_STORE["rogue-trader.afflictions"] = {
			getDocuments: async () => {
				packReads++;
				if (packReads === 1) {
					return [
						mutation("Ravaged Body", 1, 5, "doc-rb"),
						{
							name: "Missing Mutation",
							type: "mutation",
							system: {
								tableKey: "mutations",
								rollMin: 50,
								rollMax: 100,
							},
							toObject: () => ({}),
						},
					] as unknown[];
				}
				return [mutation("Ravaged Body", 1, 5, "doc-rb")] as unknown[];
			},
		};
		wireDice([
			{ formula: "1d5", total: 1 },
			{ formula: "1d100", total: 60 },
		]);
		const warnings: unknown[] = [];
		const originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args);
			return undefined;
		};
		try {
			const payloads = await prepareDroppedItems(
				fakeActor(),
				droppedItem({ procedure: "ravaged-body", effects: [] }),
			);
			// The miss is skipped, not thrown: only the dropped item survives.
			expect(payloads).toHaveLength(1);
			expect(
				warnings.some((arg) =>
					String((arg as unknown[]).join(" ")).includes(
						"not in rogue-trader.afflictions",
					),
				),
			).toBe(true);
		} finally {
			console.warn = originalWarn;
			MUTATION_PACK_STORE["rogue-trader.afflictions"] = {
				getDocuments: async () =>
					[
						mutation("Ravaged Body", 1, 5, "doc-rb"),
						mutation("Skeptic", 6, 100, "doc-skept"),
						{ name: "Disorder stub", type: "madnessentry", system: {} },
					] as unknown[],
			};
		}
	});
});

// --- resolveMutationByName ---------------------------------------------------

describe("resolveMutationByName (beads 38io / yxpk)", () => {
	test("resolves case-insensitively from the afflictions pack", async () => {
		const resolved = await resolveMutationByName("skeptic");
		expect(resolved !== null).toBe(true);
		expect((resolved as unknown as { name?: string }).name).toBe("Skeptic");
	});

	test("a miss returns null (the caller owns the warn)", async () => {
		expect(await resolveMutationByName("Not A Mutation")).toBeNull();
	});
});
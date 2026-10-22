/**
 * Initiative parity (bead zl6e): the tracker path (the model's
 * `initiativeBonus` getter, the @initiativeBonus placeholder resolver) and
 * the funnel button path (rollInitiativeAction's dialog contributors) drive
 * the SAME shared collector (rules/initiative-rows.ts) over the SAME fixture
 * actor — structured key matching and one guard policy.
 *
 * The two rows that broke the old duplication are pinned here:
 * • a GUARDED row — counts on NEITHER path without its condition flag (the
 *   funnel's existing policy; the tracker adopted it);
 * • a WILDCARD row whose LABEL is the string "initiative" — the old
 *   id-substring filter (`mod.id.includes(":initiative:")`) let exactly this
 *   shape leak into the funnel's row set; a structured testKey match never
 *   selects it.
 */
import { afterAll, describe, expect, test } from "bun:test";

// Shared foundry-global handling — captured and restored, as in
// initiative.test.ts. `foundry` needs BOTH faces before the Foundry-coupled
// imports below: the schema stub's field classes (the data model) are
// installed with ??= semantics, then the dialog machinery's keys are merged
// on top. All module imports stay dynamic so the globals exist first.
const foundryGlobal = globalThis as Record<string, unknown>;
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = foundryGlobal[key];
}
foundryGlobal.game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};
await import("../../test-helpers/foundry-schema-stub");
const baseFoundry = (foundryGlobal.foundry ?? {}) as Record<string, unknown>;
foundryGlobal.foundry = {
	...baseFoundry,
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	utils: { fromUuidSync: () => null },
};

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete foundryGlobal[key];
		else foundryGlobal[key] = value;
	}
});

const { collectInitiativeRows, sumInitiativeRows } = await import(
	"./initiative-rows"
);
const { rollInitiativeAction } = await import("./adapter");
const { Character } = await import("../data/actor/character");
const { foundryPorts, setPorts } = await import(
	"../../test-helpers/ports"
);
const { TestDialog } = await import("./test-dialog");
const { runRoll } = await import("../presentation/rolls/orchestrator");

// --- Fixture ----------------------------------------------------------------

const AG_BONUS = 4;

/** The fixture effects: one actor's owned-item initiative shapes. */
function fixtureItems(): Array<Record<string, unknown>> {
	return [
		// Unguarded explicit row — counts on BOTH paths.
		{
			id: "t1",
			name: "Swift Initiate",
			type: "talent",
			system: {
				effects: [
					{
						kind: "test-modifier",
						testKey: "initiative",
						value: 5,
						label: "Quick Draw",
					},
				],
			},
		},
		// GUARDED explicit row — neither path without the flag.
		{
			id: "t2",
			name: "Charger",
			type: "talent",
			system: {
				effects: [
					{
						kind: "test-modifier",
						testKey: "initiative",
						value: 2,
						label: "Off the mark",
						condition: "charging",
					},
				],
			},
		},
		// WILDCARD row whose LABEL is the string "initiative" — the old
		// id-substring filter leaked exactly this shape (id `any:initiative:any`).
		{
			id: "t3",
			name: "Odd Talent",
			type: "talent",
			system: {
				effects: [
					{
						kind: "test-modifier",
						testKey: null,
						value: 7,
						label: "initiative",
					},
				],
			},
		},
		// Wrong kind (attack-only) — structured kind gate excludes it.
		{
			id: "t4",
			name: "Berserk Charge",
			type: "talent",
			system: {
				effects: [
					{
						kind: "attack-modifier",
						testKey: "initiative",
						value: 9,
						label: "Rage",
					},
				],
			},
		},
		// Stowed gear — the liveness gate excludes it.
		{
			id: "g0",
			name: "Crate",
			type: "gear",
			system: {
				equipState: "stowed",
				effects: [
					{
						kind: "test-modifier",
						testKey: "initiative",
						value: 6,
						label: "Stowed",
					},
				],
			},
		},
		// Carried gear raw-shape row — counts on BOTH paths (the getter's walk
		// carried the equip-state check; the collector reproduces it).
		{
			id: "g1",
			name: "Reflex Augment",
			type: "gear",
			system: {
				equipState: "carried",
				effects: [
					{ kind: "test-modifier", testKey: "initiative", value: 10, label: "Aug" },
				],
			},
		},
		// Zero-value row — never contributes (parity with the old getters).
		{
			id: "t5",
			name: "Inert",
			type: "talent",
			system: {
				effects: [
					{ kind: "test-modifier", testKey: "initiative", value: 0, label: "Zero" },
				],
			},
		},
	];
}

function actorFixture() {
	return {
		id: "a1",
		name: "Explorer",
		type: "explorer",
		// Bead 77r1: the roll routes through the pipeline's ownership gate.
		isOwner: true,
		system: {
			characteristics: { ag: { value: AG_BONUS * 10, unnatural: 1 } },
			characteristicBonus: (key: string) => (key === "ag" ? AG_BONUS : 0),
		},
		items: fixtureItems(),
	};
}

/** The tracker path: a live model shape over the SAME fixture items. */
function modelFixture() {
	const c = Object.create(
		(Character as unknown as { prototype: object }).prototype,
	);
	const characteristics = { ag: { value: AG_BONUS * 10, unnatural: 1 } };
	(c as unknown as { characteristics: typeof characteristics }).characteristics =
		characteristics;
	(c as unknown as { parent: { items: unknown[] } }).parent = {
		items: fixtureItems(),
	};
	return c as { initiativeBonus: number };
}

// --- Funnel harness ---------------------------------------------------------

let dialogRequests: Array<Record<string, unknown>> = [];
let dialogResult: { modifiers: unknown[] } | null = { modifiers: [] };
let restoreDialog: (() => void) | null = null;

/** Wire ports and patch the dialog; restored in afterAll. */
function wirePaths(): void {
	setPorts({
		...foundryPorts,
		dice: {
			roll: async (formula: string) => ({
				total: 1,
				dice: [],
				terms: [],
				formula,
			}),
		},
		chat: {
			async post() {
				return { id: "msg-1" };
			},
			async postHtml() {
				return { id: "msg-1" };
			},
			async update() {
				await Promise.resolve();
			},
		},
		notify: {
			warn: () => undefined,
			info: () => undefined,
			error: () => undefined,
		},
	});
	dialogRequests = [];
	const original = TestDialog.show as unknown as (request: object) => unknown;
	TestDialog.show = (async (request: object) => {
		dialogRequests.push(request as Record<string, unknown>);
		return dialogResult as never;
	}) as never;
	restoreDialog = () => {
		TestDialog.show = original as never;
		restoreDialog = null;
	};
}

afterAll(() => {
	restoreDialog?.();
});

// --- Tests -------------------------------------------------------------------

describe("initiative parity (bead zl6e)", () => {
	test("BOTH paths fold the same rows over the same fixture actor", async () => {
		wirePaths();
		try {
			await rollInitiativeAction(actorFixture() as never);
			const request = dialogRequests[0] as Record<string, unknown>;
			expect(request).toBeDefined();
			const rows = request.contributors as Array<Record<string, unknown>>;

			// The funnel path: the base row + the shared collector's rows.
			const base = rows.find((r) => r.id === "initiative-base:agility");
			expect(base?.value).toBe(AG_BONUS);
			const funnelRows = rows.filter(
				(r) => r.id !== "initiative-base:agility",
			) as never as Array<{ id: string; value: number }>;
			// Same collector, same set — structural equality with a direct call.
			expect(funnelRows as never).toEqual(
				collectInitiativeRows(actorFixture().items ?? []) as never,
			);

			// The tracker path: the getter's bonus = Agility + the same rows.
			const getter = (modelFixture() as unknown as { initiativeBonus: number })
				.initiativeBonus;
			expect(getter).toBe(AG_BONUS + sumInitiativeRows(funnelRows as never));

			// Unguarded rows only: Swift Initiate (+5) and the carried augment (+10).
			expect(funnelRows.map((r) => r.value)).toEqual([5, 10]);
		} finally {
			restoreDialog?.();
		}
	});

	test("a guarded row counts on NEITHER path without its flag (funnel policy adopted)", () => {
		const items = fixtureItems();
		const noFlags = collectInitiativeRows(items);
		expect(noFlags.some((r) => r.value === 2)).toBe(false);
		// The getter agrees with the same no-flag set (both use this collector).
		expect(
			(modelFixture() as unknown as { initiativeBonus: number }).initiativeBonus,
		).toBe(AG_BONUS + sumInitiativeRows(noFlags));

		// With the condition flag set, the row counts — the funnel's documented
		// guard policy ("only when its condition holds"); both paths read this
		// exact collector, so setting flags applies to both routes at once.
		const withFlag = collectInitiativeRows(items, { charging: true });
		expect(withFlag.some((r) => r.value === 2)).toBe(true);
	});

	test("a wildcard row labelled 'initiative' leaks nowhere (regression for the id-substring filter)", () => {
		const items = fixtureItems();
		expect(collectInitiativeRows(items).some((r) => r.value === 7)).toBe(false);
		expect(
			(modelFixture() as unknown as { initiativeBonus: number }).initiativeBonus,
		).toBe(AG_BONUS + 15); // 5 + 10; the wildcard's 7 never folds
	});

	// Bead 4tx6: the prepare-only condition-toggle suppression is STRUCTURAL
	// in the orchestrator — a prepare-only kind gets NO generic toggles, no
	// matter what its handler sets (or omits) in handledConditionFlags. The
	// fixture actor carries the guarded "charging" Charger row, so the scope
	// WOULD offer that toggle if the suppression ever drifted.
	test("a prepare-only handler receives no condition toggles even with an empty handledConditionFlags", async () => {
		wirePaths();
		const infos: Array<Record<string, unknown> | undefined> = [];
		const handler = {
			prepare: async () => ({
				title: "T",
				baseTarget: 10,
				testKind: "characteristic",
				testKey: "initiative", // matches the guarded Charger fixture row
				initialModifiers: [],
				weapon: null,
				context: {},
				prepareOnly: true,
				// Deliberately empty: any key-list coverage scheme would offer
				// a toggle exactly when this list stopped mirroring the scope.
				handledConditionFlags: [],
			}),
			after: async (
				...args: unknown[]
			) => {
				infos.push(args[4] as Record<string, unknown>);
			},
		};
		const result = await runRoll(
			{ kind: "initiative", actor: actorFixture() } as never,
			handler as never,
		);
		expect(result).toBeNull(); // prepare-only: no kernel outcome
		const request = dialogRequests[0] as Record<string, unknown>;
		expect(request).toBeDefined();
		expect(request.conditions).toBeUndefined();
		expect(request.collectForConditions).toBeUndefined();
		// The after-hook contract holds: info carries the dialog rows.
		expect((infos[0]?.modifiers as unknown[]) ?? []).toEqual([]);
	});

	// The suppression is prepare-only-SCOPED, not global: an ordinary kind
	// over the same fixture still gets its toggles (the dialog returns null
	// so no shared test runs — only the offered request shape is pinned).
	test("an ordinary kind over the same fixture still receives the condition toggles", async () => {
		wirePaths();
		dialogResult = null;
		const handler = {
			prepare: async () => ({
				title: "T",
				baseTarget: 30,
				testKind: "characteristic",
				testKey: "initiative",
				initialModifiers: [],
				weapon: null,
				context: {},
			}),
		};
		const result = await runRoll(
			{ kind: "initiative", actor: actorFixture() } as never,
			handler as never,
		);
		expect(result).toBeNull(); // the dialog refused — runTest never ran
		const request = dialogRequests[0] as Record<string, unknown>;
		expect(request).toBeDefined();
		expect(request.conditions).toEqual(["charging"]);
	});
});
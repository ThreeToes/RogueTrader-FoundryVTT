/**
 * Ship Strategic Turn boundary + crew-loss memory adapter tests (bead 6ddz,
 * Core Rulebook pp214-218): the wiring the capable final review flagged —
 * expireTurnFlags/rotateLastTurnLosses/sustainedCrewLosses gain PRODUCTION
 * call sites through presentation/ship-turn-boundary.ts's updateCombat
 * drive, and Triage/Hold Fast! become functional through the rotated
 * lastTurnLosses memory.
 *
 * Adapter-level (the ports + document shapes), in the
 * ship-boarding.test.ts stub pattern: the Foundry globals stubbed BEFORE
 * the dynamic imports (ship-extended.ts loads through test-dialog).
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string) => key,
	},
	system: { id: "rogue-trader" },
	userId: "tester-1",
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
			DialogV2: { wait: async () => null, input: async () => null },
		},
	},
};
/** The one updateCombat listener captured at registration. */
const hookHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
(globalThis as Record<string, unknown>).Hooks = {
	on: (name: string, fn: (...args: unknown[]) => void) => {
		(hookHandlers[name] ??= []).push(fn);
	},
};

const { applyShipTurnStart, registerShipTurnBoundaryHook } = await import(
	"./ship-turn-boundary"
);
const { resetPorts, setPorts, getPorts } = await import(
	"../../ffg/infrastructure/foundry/ports"
);
const { extendedRowHandlers } = await import("./rolls/ship-extended");
const { shipActionHandler } = await import("./rolls/ship-action");
const { shipRepairHandler } = await import("./rolls/ship");

import { afterAll, describe, expect, it } from "bun:test";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

// ------------------------------------------------------------------ helpers

interface Spy {
	updates: Array<Record<string, unknown>>;
	cards: string[];
}

/** Ship stub: only the fields the maintained write path reads. */
function shipStub(
	system: Record<string, unknown>,
	options: { itemId?: string; item?: unknown } = {},
): unknown {
	const ownedId = options.itemId;
	const owned = options.item;
	// Array-backed + .get: the RowLike item collection both readers need.
	const items = Object.assign([] as unknown[], {
		get: undefined,
	}) as unknown as unknown[] & {
		get(id: string): unknown;
	};
	items.get = (id: string) =>
		ownedId !== undefined && id === ownedId ? owned : undefined;
	return {
		name: "Test Ship",
		type: "starship",
		system,
		items,
	};
}

/** Install ports that capture the actor writes and the posted cards. */
function spyPorts(): Spy {
	const spy: Spy = { updates: [], cards: [] };
	setPorts({
		...getPorts(),
		actors: {
			...getPorts().actors,
			update: async (_doc: unknown, data: Record<string, unknown>) => {
				spy.updates.push(data);
			},
		},
		chat: {
			...getPorts().chat,
			postHtml: async (_actor: unknown, html: string) => {
				spy.cards.push(html);
			},
		},
	} as never);
	return spy;
}

// -------------------------------------------------------------------- tests

/** A ship-action item stub the resolver reads off the ship's items. */
const actionItem = {
	type: "ship-action",
	name: "Test Manoeuvre Row",
	system: {
		roll: { test: "pilot-space-craft+manoeuvrability", difficulty: "" },
	},
};

const aidFlag = {
	id: "aid-machine-spirit:manoeuvrability",
	key: "aid-machine-spirit",
	value: 5,
	target: "manoeuvrability",
	expiresAtTurn: null,
	persistent: false,
};

describe("the Strategic Turn boundary maintenance (bead 6ddz)", () => {
	it("writes the expired flags, the rotated losses and the new snapshot", async () => {
		const spy = spyPorts();
		try {
			await applyShipTurnStart(
				shipStub({
					crewPopulation: 85,
					crewMorale: 55,
					turnFlags: [
						{
							id: "ev",
							key: "evasive",
							value: -10,
							target: "all",
							expiresAtTurn: null,
							persistent: false,
						},
						{
							id: "repel",
							key: "repel-boarders",
							value: 10,
							target: "all",
							expiresAtTurn: null,
							persistent: true,
						},
					],
					lastTurnLosses: { population: 3, morale: 2 },
					turnStartCrew: { population: 90, morale: 60 },
				}),
				4,
			);
			// ONE write carries all three rotated values:
			expect(spy.updates).toHaveLength(1);
			const system = spy.updates[0]?.system as Record<string, unknown>;
			// Evasive expired at the own turn; persistent repel survives.
			const flags = system.turnFlags as Array<{ id: string }>;
			expect(flags.map((flag) => flag.id)).toEqual(["repel"]);
			// The turn now closing lost 5/5 — the memory Triage/Hold Fast read.
			expect(system.lastTurnLosses).toEqual({ population: 5, morale: 5 });
			expect(system.turnStartCrew).toEqual({ population: 85, morale: 55 });
		} finally {
			resetPorts();
		}
	});

	it("seeds the snapshot without touching the memory when none exists", async () => {
		const spy = spyPorts();
		try {
			await applyShipTurnStart(
				shipStub({
					crewPopulation: 97,
					crewMorale: 88,
					turnFlags: [],
					lastTurnLosses: { population: 4, morale: 1 },
					turnStartCrew: null,
				}),
				2,
			);
			const system = spy.updates[0]?.system as Record<string, unknown>;
			expect(system.lastTurnLosses).toEqual({ population: 4, morale: 1 });
			expect(system.turnStartCrew).toEqual({ population: 97, morale: 88 });
		} finally {
			resetPorts();
		}
	});

	// Bead wp6o: worlds that ran the pre-fix schema stored the truthy legacy
	// default {population: null, morale: null} — it must count as NO snapshot
	// (seeding, memory untouched), never rotate the memory against 0/0.
	it("a legacy nullish-children snapshot counts as none and seeds", async () => {
		const spy = spyPorts();
		try {
			await applyShipTurnStart(
				shipStub({
					crewPopulation: 97,
					crewMorale: 88,
					turnFlags: [],
					lastTurnLosses: { population: 4, morale: 1 },
					turnStartCrew: { population: null, morale: null },
				}),
				2,
			);
			const system = spy.updates[0]?.system as Record<string, unknown>;
			expect(system.lastTurnLosses).toEqual({ population: 4, morale: 1 });
			expect(system.turnStartCrew).toEqual({ population: 97, morale: 88 });
		} finally {
			resetPorts();
		}
	});

	it("the updateCombat hook drives the ACTIVE starship combatant's turn", async () => {
		registerShipTurnBoundaryHook();
		expect(hookHandlers.updateCombat).toHaveLength(1);
		const spy = spyPorts();
		try {
			// A boundary diff (turn advanced) — the ship's turn starts.
			await hookHandlers.updateCombat[0]!(
				{ round: 3, combatant: { actor: shipStub({}) } },
				{ turn: 2 },
				{},
				"tester-1",
			);
			expect(spy.updates).toHaveLength(1);
		} finally {
			resetPorts();
		}
	});

	it("non-boundary updates and foreign users write NOTHING", async () => {
		registerShipTurnBoundaryHook();
		const spy = spyPorts();
		try {
			const handler = hookHandlers.updateCombat.at(-1)!;
			const combat = { round: 3, combatant: { actor: shipStub({}) } };
			// A flags-only update diff: no turn, no round.
			await handler(combat, { flags: {} }, {}, "tester-1");
			await handler(combat, { turn: 2 }, {}, "someone-else");
			// A non-starship combatant at the boundary.
			await handler(
				{ round: 3, combatant: { actor: { name: "Bob", type: "explorer" } } },
				{ turn: 0 },
				{},
				"tester-1",
			);
			expect(spy.updates).toEqual([]);
		} finally {
			resetPorts();
		}
	});
});

describe("Triage + Hold Fast! read the rotated memory (bead 6ddz, p218)", () => {
	const successful = (degrees: number) =>
		({ success: true, degrees, roll: 20 }) as never;

	it("Triage cancels previous-turn Crew Population damage", async () => {
		const spy = spyPorts();
		try {
			const ship = shipStub({
				crewPopulation: 94,
				lastTurnLosses: { population: 6, morale: 3 },
			});
			const handler = extendedRowHandlers.Triage;
			expect(handler?.after).toBeDefined();
			await handler!.after?.(
				{ kind: "ship-action", actor: ship, itemId: "t1" } as never,
				{ kindData: { name: "Triage" } } as never,
				successful(2),
				{ target: 40, modifiers: [] },
			);
			// 1 + 2 degrees = 3 cancelled of the 6 the memory recorded.
			const system = spy.updates[0]?.system as Record<string, unknown>;
			expect(system.crewPopulation).toBe(97);
			expect(spy.cards).toHaveLength(1);
		} finally {
			resetPorts();
		}
	});

	it("Triage cancels nothing when the memory is empty (the clamped read)", async () => {
		const spy = spyPorts();
		try {
			const ship = shipStub({
				crewPopulation: 90,
				lastTurnLosses: { population: 0, morale: 0 },
			});
			const handler = extendedRowHandlers.Triage;
			expect(handler?.after).toBeDefined();
			await handler!.after?.(
				{ kind: "ship-action", actor: ship, itemId: "t1" } as never,
				{ kindData: { name: "Triage" } } as never,
				successful(3),
				{ target: 40, modifiers: [] },
			);
			expect(spy.updates).toEqual([]);
			// The LOUD note card: 'nothing to cancel'.
			expect(spy.cards).toHaveLength(1);
		} finally {
			resetPorts();
		}
	});

	it("Hold Fast! cancels previous-turn Morale damage", async () => {
		const spy = spyPorts();
		try {
			const ship = shipStub({
				crewMorale: 91,
				lastTurnLosses: { population: 0, morale: 4 },
			});
			const handler = extendedRowHandlers["Hold Fast!"];
			expect(handler?.after).toBeDefined();
			await handler!.after?.(
				{ kind: "ship-action", actor: ship, itemId: "h1" } as never,
				{ kindData: { name: "Hold Fast!" } } as never,
				successful(1),
				{ target: 40, modifiers: [] },
			);
			// 1 + 1 degree = 2 cancelled of the 4 the memory records.
			const system = spy.updates[0]?.system as Record<string, unknown>;
			expect(system.crewMorale).toBe(93);
		} finally {
			resetPorts();
		}
	});

	it("Put Your Backs Into It! applies fire-fighting as a MANUAL note, no flag", async () => {
		const spy = spyPorts();
		// The firefighting pick is ACTUALLY taken (round-3 review): the BACKS
		// choice dialog answers "firefighting" on the first pick (degrees
		// 3 → pickCount 2; the second pick cancels). The card must carry the
		// manual-only note and NO turn-flag write may happen at all.
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: unknown } };
		};
		const original = foundryGlobal.applications.api.DialogV2 as {
			input: unknown;
		};
		let inputIndex = 0;
		foundryGlobal.applications.api.DialogV2 = {
			...original,
			input: (async () =>
				inputIndex++ === 0 ? { choice: "firefighting" } : null) as never,
		} as typeof original;
		try {
			const ship = shipStub({
				turnFlags: [],
			});
			const handler = extendedRowHandlers["Put Your Backs Into It!"];
			expect(handler?.after).toBeDefined();
			await handler!.after?.(
				{ kind: "ship-action", actor: ship, itemId: "b1" } as never,
				{ kindData: { name: "Put Your Backs Into It!" } } as never,
				successful(3),
				{ target: 40, modifiers: [] },
				);
			// The firefighting pick upserts NO flag — the actor write never
			// happens.
			expect(spy.updates).toEqual([]);
			// The LOUD manual-only note rides the card instead.
			expect(spy.cards).toHaveLength(1);
			expect(spy.cards[0]).toContain("SHIP_ACTION.BACKS_FIRE_MANUAL");
			// and the manual-only note stands alone — no flag-backing
			// "this turn" note claims automation for it.
			expect(spy.cards[0]).not.toContain("SHIP_ACTION.BACKS_NOTE");
		} finally {
			foundryGlobal.applications.api.DialogV2 = original;
			resetPorts();
		}
	});
});
describe("the write-only flags read at their roll points (bead 6ddz)", () => {
	it("Aid the Machine Spirit rides the combined test as a VISIBLE row", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: shipStub(
				{
					manoeuvrability: 25,
					crewQuality: "competent",
					turnFlags: [aidFlag],
				},
				{ itemId: "a1", item: actionItem },
			),
			itemId: "a1",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string; value: number }> })
				.initialModifiers ?? [];
		// The aid rides beside the ship-ability row — never folded silently.
		expect(
			rows.find((row) => row.id === "ship:aid-machine-spirit:manoeuvrability")
				?.value,
		).toBe(5);
		expect(rows.find((row) => row.id === "ship:manoeuvrability")?.value).toBe(
			25,
		);
	});

	it("an aid flag for a DIFFERENT stat contributes no row", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: shipStub(
				{
					manoeuvrability: 25,
					crewQuality: "competent",
					turnFlags: [{ ...aidFlag, target: "detection" }],
				},
				{ itemId: "a1", item: actionItem },
			),
			itemId: "a1",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string }> })
				.initialModifiers ?? [];
		expect(
			rows.some((row) => row.id.startsWith("ship:aid-machine-spirit")),
		).toBe(false);
	});

	it("Put Your Backs Into It! rides the Emergency Repairs roll as a VISIBLE row", async () => {
		const repairItem = {
			type: "ship-weapon-component",
			name: "Prow Augur",
			system: { state: "damaged" },
		};
		const prepared = await shipRepairHandler.prepare({
			kind: "ship-repair",
			actor: shipStub(
				{
					crewQuality: "competent",
					turnFlags: [
						{
							id: "backs-into-it:emergency-repairs",
							key: "backs-into-it",
							value: 5,
							target: "emergency-repairs",
							expiresAtTurn: null,
							persistent: false,
						},
					],
				},
				{ itemId: "r1", item: repairItem },
			),
			itemId: "r1",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string; value: number }> })
				.initialModifiers ?? [];
		expect(
			rows.find((row) => row.id === "ship:backs-into-it:emergency-repairs")
				?.value,
		).toBe(5);
		// The Difficult (-10) row is still there beside it.
		expect(rows.find((row) => row.id === "repair:difficult")?.value).toBe(-10);
	});

	it("a repair WITHOUT the backs flag carries no +5 row", async () => {
		const repairItem = {
			type: "ship-weapon-component",
			name: "Prow Augur",
			system: { state: "damaged" },
		};
		const prepared = await shipRepairHandler.prepare({
			kind: "ship-repair",
			actor: shipStub(
				{ crewQuality: "competent", turnFlags: [] },
				{ itemId: "r1", item: repairItem },
			),
			itemId: "r1",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string }> })
				.initialModifiers ?? [];
		expect(rows.some((row) => row.id.startsWith("ship:backs-into-it"))).toBe(
			false,
		);
	});
});

describe("Put Your Backs Into It! rides the BS salvo path (bead 6ddz, p218)", () => {
	const salvoWeapon = {
		id: "sw1",
		type: "ship-weapon-component",
		name: "Dorsal Sunsear Laser Battery",
		system: {
			componentType: "macrobattery",
			strength: 4,
			damage: "1d10+2",
			critRating: 4,
		},
	};

	it("the named component's salvo carries the +5 as a VISIBLE row", async () => {
		const { shipWeaponHandler } = await import("./rolls/ship");
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipStub(
				{
					crewQuality: "competent",
					armour: 18,
					voidShields: 1,
					turnFlags: [
						{
							id: "backs-into-it:sw1",
							key: "backs-into-it",
							value: 5,
							target: "sw1",
							expiresAtTurn: null,
							persistent: false,
						},
					],
				},
				{ itemId: "sw1", item: salvoWeapon },
			),
			itemId: "sw1",
			rangeBand: "normal",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string; value: number }> })
				.initialModifiers ?? [];
		expect(
			rows.find((row) => row.id === "ship:flag:firing:backs-into-it")?.value,
		).toBe(5);
	});

	it("a backs flag naming ANOTHER component contributes no salvo row", async () => {
		const { shipWeaponHandler } = await import("./rolls/ship");
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipStub(
				{
					crewQuality: "competent",
					armour: 18,
					voidShields: 1,
					turnFlags: [
						{
							id: "backs-into-it:sw2",
							key: "backs-into-it",
							value: 5,
							target: "sw2",
							expiresAtTurn: null,
							persistent: false,
						},
					],
				},
				{ itemId: "sw1", item: salvoWeapon },
			),
			itemId: "sw1",
			rangeBand: "normal",
		} as never);
		const rows =
			(prepared as { initialModifiers?: Array<{ id: string }> })
				.initialModifiers ?? [];
		expect(
			rows.some((row) => row.id === "ship:flag:firing:backs-into-it"),
		).toBe(false);
	});
});

/**
 * Ship-ordnance row handlers (epic necp child S9, bead a413): the machinery
 * rows enter through the SHARED ship-action kind (the ship-boarding.ts
 * precedent). This suite pins the dispatch vocabulary (the
 * ship-boarding.test.ts mirror) and the STATE-BOOKKEEPING wiring through the
 * roll-pipeline fake-ports pattern (roll-pipeline.test.ts's
 * captureEffectPorts idiom): the launch's store decrement + salvo/turn-flag
 * writes, the run's spend/retire bookkeeping, the fighter eliminations.
 * The printed-table maths itself is pinned in rules-engine/
 * ship-ordnance.test.ts.
 */

// Module-load stubs — MERGE over the shared schema-stub floor, never
// clobber it: this suite REPLACED the global with opts-less field classes
// and left them on globalThis, poisoning every later schema suite in the
// same bun process (the packless-CI failure class, 2026-10-20). The shared
// StubField classes carry opts; applications/utils/game/ui ride on top;
// afterAll restores what was installed before this suite ran — the stale
// stub classes are no longer left on the global (the CI-poison fix).
/* eslint-disable */
import {
	MINIMAL_FOUNDRY,
} from "../../../test-helpers/foundry-schema-stub";

const globalThisRecord = globalThis as Record<string, unknown>;
const foundryGlobal = (globalThisRecord.foundry = {
	...MINIMAL_FOUNDRY,
	applications: {
		...(MINIMAL_FOUNDRY.applications as object),
		api: {
			...((MINIMAL_FOUNDRY.applications as Record<string, unknown>).api as object),
			DialogV2: { wait: async () => null, input: async () => null },
		},
	},
	utils: { fromUuidSync: () => null },
}) as Record<string, unknown>;
globalThisRecord.game = {
	i18n: { localize: (key: string) => key, format: (key: string) => key },
	system: { id: "rogue-trader" },
};
globalThisRecord.ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
import { afterAll, afterEach, describe, expect, it } from "bun:test";

// Restore the process-global stubs this suite replaced: the foundry floor
// stays valid (never deleted), the game/ui stubs go back to whatever ran
// before (the deleted-global poison class, 2026-10-20).
const priorFoundry = globalThisRecord.foundry as Record<string, unknown>;
const priorGame = globalThisRecord.game;
const priorUi = globalThisRecord.ui;
afterAll(() => {
	globalThisRecord.foundry = priorFoundry ?? MINIMAL_FOUNDRY;
	if (priorGame === undefined) delete globalThisRecord.game;
	else globalThisRecord.game = priorGame;
	if (priorUi === undefined) delete globalThisRecord.ui;
	else globalThisRecord.ui = priorUi;
});
import {
	getPorts,
	resetPorts,
	setPorts,
} from "../../infrastructure/foundry/ports";
import { ordnanceRowHandlers } from "./ship-ordnance";
import { boardingRowKey } from "./ship-boarding";

// ------------------------------------------------------------- fixtures

/** Minimal ship fixture (the structural items list the rows filter). */
function shipFixture(
	items: unknown[],
	system: Record<string, unknown> = {},
): unknown {
	return {
		name: "Test Ship",
		uuid: "Actor.test-ship",
		system: {
			crewQuality: "competent",
			crewPopulation: 100,
			crewMorale: 100,
			hullIntegrity: { value: 40, max: 40 },
			armour: 20,
			turretRating: 0,
			turnFlags: [],
			torpedoSalvos: [],
			...system,
		},
		items: items as never,
	};
}

const tube = {
	id: "tube-1",
	name: "Mars Pattern Torpedo Tubes",
	type: "ship-weapon-component",
	uuid: "Item.tube-1",
	update: async () => undefined,
	system: {
		componentType: "torpedo-tube",
		state: "intact",
		strength: 6,
	},
};

const plasmaStore = {
	id: "store-1",
	name: "Plasma Torpedo",
	type: "ship-ordnance",
	uuid: "Item.store-1",
	update: async () => undefined,
	system: {
		kind: "torpedo",
		ordKey: "plasma",
		availability: "rare",
		speed: 10,
		damage: "2d10+14",
		critRating: 10,
		range: 60,
		terminalPenetration: 3,
		torpedoRating: 20,
		quantity: 8,
	},
};

const launchAction = {
	id: "act-1",
	name: "Launch Torpedoes",
	type: "ship-action",
	uuid: "Item.act-1",
	system: {
		actionCost: "Shooting Action",
		shortDescription: "no test at launch",
	},
};

const plasmaSalvo = {
	id: "salvo-1",
	warhead: "plasma",
	name: "Plasma Torpedo",
	guidance: "standard",
	damage: "2d10+14",
	critRating: 10,
	terminalPenetration: 3,
	torRating: 20,
	speed: 10,
	range: 60,
	remaining: 3,
	travelled: 30,
	launchTurn: 0,
	wide: false,
	tubeId: "tube-1",
};

/** The printed Table 1-1 Melta row as a launched salvo (BFK printed p8). */
const meltaSalvo = {
	...plasmaSalvo,
	warhead: "melta",
	name: "Melta Torpedo",
	damage: "2d10+15",
	critRating: 9,
	terminalPenetration: 4,
};

/** Dialog prompt queue: sequential wait/input responses. */
function cueDialog(
	waitResponses: unknown[],
	inputResponses: unknown[],
	override: { wait?: unknown[]; input?: unknown[] } = {},
): { waits: unknown[]; inputs: unknown[] } {
	const api = (
		foundryGlobal.applications as { api: { DialogV2: Record<string, never> } }
	).api.DialogV2;
	const waits = [...(override.wait ?? waitResponses)];
	const inputs = [...(override.input ?? inputResponses)];
	api.wait = (async () => waits.shift() ?? null) as never;
	api.input = (async () => inputs.shift() ?? null) as never;
	return { waits, inputs };
}

/** Capture the port traffic (the captureEffectPorts idiom, extended).
 * `diceFormula` may carry per-die payloads (`dice`) for the damage rolls,
 * and `clockRound` overrides the clock's round (the run's travelled cap
 * derives from it). */
function capturePorts(
	diceFormula: (formula: string) => {
		total: number;
		dice?: Array<{ result: number }>;
	},
	targetActor: unknown = null,
	clockRound = 3,
) {
	const shipUpdates: Array<Record<string, unknown>> = [];
	const itemUpdates: Array<Record<string, unknown>> = [];
	const posts: Array<Record<string, unknown>> = [];
	const rolled: string[] = [];
	setPorts({
		...getPorts(),
		dice: {
			roll: async (formula: string) => {
				rolled.push(formula);
				const value = diceFormula(formula);
				return {
					total: value.total,
					dice: value.dice ?? [],
					terms: [],
					rolls: [],
					formula,
				};
			},
		},
		actors: {
			...getPorts().actors,
			update: async (_doc: unknown, data: Record<string, unknown>) => {
				shipUpdates.push(data);
			},
		},
		items: {
			...getPorts().items,
			update: async (_doc: unknown, data: Record<string, unknown>) => {
				itemUpdates.push(data);
			},
		},
		targets: {
			...getPorts().targets,
			actor: () => targetActor,
		},
		clock: { round: () => clockRound },
		chat: {
			...getPorts().chat,
			post: async (_actor: unknown, _t: string, vars: unknown) => {
				posts.push(vars as never);
				return { id: "m" };
			},
		},
	} as never);
	return { shipUpdates, itemUpdates, posts, rolled };
}

afterEach(() => resetPorts());

// ------------------------------------------------------------- dispatch

describe("ordnance row dispatch vocabulary (bead a413)", () => {
	it("normalises the canonical printed row names to the ordnance map", () => {
		expect(boardingRowKey("Launch Torpedoes")).toBe("launch-torpedoes");
		expect(boardingRowKey("Torpedo Run")).toBe("torpedo-run");
		expect(boardingRowKey("Reload Torpedo Tubes")).toBe("reload-torpedo-tubes");
		expect(boardingRowKey("Bombing Run")).toBe("bombing-run");
		expect(boardingRowKey("Assault Boat Run")).toBe("assault-boat-run");
		expect(boardingRowKey("Attack with Fighters")).toBe("attack-with-fighters");
		for (const key of [
			"launch-torpedoes",
			"torpedo-run",
			"reload-torpedo-tubes",
			"bombing-run",
			"assault-boat-run",
			"attack-with-fighters",
		]) {
			expect(ordnanceRowHandlers[key], `row ${key}`).toBeTruthy();
			expect(typeof ordnanceRowHandlers[key]!.prepare).toBe("function");
		}
	});

	it("a renamed row falls through to the standard path (no dispatch)", () => {
		expect(boardingRowKey("Launch the Salvo!")).toBe("launch-the-salvo");
		expect(
			ordnanceRowHandlers[boardingRowKey("Launch the Salvo!")],
		).toBeUndefined();
	});
});

// ------------------------------------------------------- Launch Torpedoes

describe("Launch Torpedoes gates (Battlefleet Koronus printed pp6-7)", () => {
	it("refuses when the ship carries no intact torpedo tube", async () => {
		const warnings: string[] = [];
		const ship = shipFixture([plasmaStore]);
		setPorts({
			...getPorts(),
			notify: {
				...getPorts().notify,
				warn: (key: string) => {
					warnings.push(key);
				},
			},
		} as never);
		const prepared = await ordnanceRowHandlers["launch-torpedoes"]!.prepare(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			launchAction,
		);
		expect(prepared).toBeNull();
		expect(warnings).toContain("SHIP_ORDNANCE.NO_TUBES");
	});

	it("refuses on empty stores", async () => {
		const warnings: string[] = [];
		const store = {
			...plasmaStore,
			system: { ...plasmaStore.system, quantity: 0 },
		};
		const ship = shipFixture([tube, store]);
		setPorts({
			...getPorts(),
			notify: {
				...getPorts().notify,
				warn: (key: string) => {
					warnings.push(key);
				},
			},
		} as never);
		const prepared = await ordnanceRowHandlers["launch-torpedoes"]!.prepare(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			launchAction,
		);
		expect(prepared).toBeNull();
		expect(warnings).toContain("SHIP_ORDNANCE.NO_STORES");
	});

	it("refuses on a boarded ship (the launch rides the Shooting Action)", async () => {
		const warnings: string[] = [];
		const ship = shipFixture([tube, plasmaStore], {
			boardedWith: { uuid: "Actor.ork" },
		});
		setPorts({
			...getPorts(),
			notify: {
				...getPorts().notify,
				warn: (key: string) => {
					warnings.push(key);
				},
			},
		} as never);
		const prepared = await ordnanceRowHandlers["launch-torpedoes"]!.prepare(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			launchAction,
		);
		expect(prepared).toBeNull();
		expect(warnings).toContain("SHIP_ORDNANCE.BOARDED_NO_LAUNCH");
	});
});

describe("Launch Torpedoes bookkeeping (Battlefleet Koronus printed pp6-9)", () => {
	it("decrements the stores through the ONE helper and books the salvo + run flag", async () => {
		cueDialog([], [{ size: "6" }], { wait: ["narrow", "standard"] });
		const { shipUpdates, itemUpdates, posts } = capturePorts(() => ({
			total: 10,
		}));
		const ship = shipFixture([tube, plasmaStore]);
		await ordnanceRowHandlers["launch-torpedoes"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Launch Torpedoes",
				kindData: {
					itemId: "act-1",
					uuid: "Item.act-1",
					name: "Launch Torpedoes",
					actionCost: "",
					description: "",
					testKey: "",
					difficulty: "",
					difficultyKind: "none",
					crewFallback: true,
					shipMod: 0,
					combinedTarget: 0,
					extra: { ordnanceStep: "launch", launchTurn: 3 },
				},
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// The store decrement (the single helper's write): 8 − 6 = 2.
		expect(itemUpdates).toEqual([{ system: { quantity: 2 } }]);
		// One ship write: the salvo record + the S2 flag + the silent-running
		// reveal.
		expect(shipUpdates).toHaveLength(1);
		const written = shipUpdates[0]!.system as {
			torpedoSalvos: Array<Record<string, unknown>>;
			turnFlags: Array<Record<string, unknown>>;
			silentRunning: boolean;
		};
		expect(written.silentRunning).toBe(false);
		expect(written.torpedoSalvos).toHaveLength(1);
		const salvo = written.torpedoSalvos[0]!;
		expect(salvo).toMatchObject({
			warhead: "plasma",
			remaining: 6,
			travelled: 0,
			launchTurn: 3,
			torRating: 20,
			speed: 10,
			range: 60,
			wide: false,
			tubeId: "tube-1",
		});
		expect(written.turnFlags).toHaveLength(1);
		expect(written.turnFlags[0]!).toMatchObject({
			id: salvo.id,
			key: "torpedo-run",
			value: 6,
			// Range 60 / Speed 10 = 6 turns; expiry at launch 3 + 6 + 1.
			expiresAtTurn: 10,
			persistent: false,
		});
		expect((posts[0] as { mode?: string }).mode).toBe("launch");
	});
});

// ------------------------------------------------------------- Torpedo Run

describe("Torpedo Run bookkeeping (Battlefleet Koronus printed pp6-9)", () => {
	it("books one turn's travel and retires a spent salvo + flag", async () => {
		// One live salvo on the ship; this resolution moves it past range.
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...plasmaSalvo, travelled: 55 }],
			turnFlags: [
				{
					id: "salvo-1",
					key: "torpedo-run",
					value: 3,
					target: "all",
					expiresAtTurn: 10,
					persistent: false,
				},
			],
		});
		// Travel input: 10 VU this turn; the distance prompt (0 → no attack —
		// the salvo is out past range anyway 55+10 = 65 ≥ 60). The clock reads
		// turn 8: the kernel's travelled cap (min(Range, 8 × Speed 10) = 60)
		// leaves 5 VU of headroom over the 55 already booked, so the input is
		// capped there and the salvo still retires past its Range.
		cueDialog([], [{ distance: "10" }, { distance: "3" }]);
		const { shipUpdates, posts } = capturePorts(() => ({ total: 10 }), null, 8);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: {
					itemId: "act-1",
					uuid: "Item.act-1",
					name: "Torpedo Run",
					actionCost: "",
					description: "",
					testKey: "torpedo-run",
					difficulty: "",
					difficultyKind: "none",
					crewFallback: true,
					shipMod: 0,
					combinedTarget: 0,
				},
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// The salvo is spent (65 ≥ 60): BOTH the record and the flag retire.
		expect(shipUpdates).toHaveLength(1);
		const written = shipUpdates[0]!.system as {
			torpedoSalvos: unknown[];
			turnFlags: unknown[];
		};
		expect(written.torpedoSalvos).toEqual([]);
		expect(written.turnFlags).toEqual([]);
		const post = posts[0] as { mode?: string; spent?: boolean };
		expect(post.mode).toBe("run");
		expect(post.spent).toBe(true);
	});

	it("no active run: the prepare refuses loudly", async () => {
		const warnings: string[] = [];
		const ship = shipFixture([]);
		setPorts({
			...getPorts(),
			notify: {
				...getPorts().notify,
				warn: (key: string) => {
					warnings.push(key);
				},
			},
		} as never);
		const prepared = await ordnanceRowHandlers["torpedo-run"]!.prepare(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{ name: "Torpedo Run", uuid: "Item.act-1", system: {} },
		);
		expect(prepared).toBeNull();
		expect(warnings).toContain("SHIP_ORDNANCE.NO_ACTIVE_RUNS");
	});
});

// ---------------------------------------------------- Attack with Fighters

describe("Attack with Fighters eliminations (Battlefleet Koronus printed p12)", () => {
	it("eliminates the LOSER's torpedo runs per degree and retires their flags", async () => {
		// The FIGHTERS belong to THIS ship; the enemy's runs live on the
		// target — but the fixture target is null here, so exercise the OTHER
		// branch: this ship lost (the enemy's fighters beat our escort) and
		// the elimination lands on OUR salvo.
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...plasmaSalvo }],
			turnFlags: [
				{
					id: "salvo-1",
					key: "torpedo-run",
					value: 3,
					target: "all",
					expiresAtTurn: 10,
					persistent: false,
				},
			],
		});
		cueDialog(["target"], [{ degrees: "2" }]);
		const { shipUpdates, posts } = capturePorts(() => ({ total: 10 }), {
			name: "Enemy Ship",
			uuid: "Actor.enemy",
		});
		await ordnanceRowHandlers["attack-with-fighters"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Attack with Fighters",
				kindData: {
					itemId: "act-1",
					uuid: "Item.act-1",
					name: "Attack with Fighters",
					actionCost: "",
					description: "",
					testKey: "fighter-attack",
					difficulty: "",
					difficultyKind: "none",
					crewFallback: true,
					shipMod: 0,
					combinedTarget: 0,
				},
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// The target won by 2 degrees → OUR salvo loses 2 torpedoes; 1
		// remains, so the record and the flag survive.
		const written = shipUpdates[0]!.system as {
			torpedoSalvos: Array<{ remaining: number }>;
			turnFlags: Array<{ value: number }>;
		};
		expect(written.torpedoSalvos[0]!.remaining).toBe(1);
		expect(written.turnFlags[0]!.value).toBe(1);
		const post = posts[0] as {
			mode?: string;
			salvoRows?: Array<{ display: string }>;
		};
		expect(post.mode).toBe("fighters");
		expect(post.salvoRows?.[0]!.display).toBe("-2");
	});
});

// ------------------------------------------------------ the strike rows

describe("strike-run rows: Bombing Run (Battlefleet Koronus printed p13)", () => {
	it("carries the Craft Rating + squadron rows as visible modifiers", async () => {
		cueDialog([], [{ rating: "10" }, { squadrons: "3" }]);
		const prepared = await ordnanceRowHandlers["bombing-run"]!.prepare(
			{
				kind: "ship-action",
				actor: shipFixture([]) as never,
				itemId: "act-1",
			} as never,
			{
				name: "Bombing Run",
				type: "ship-action",
				uuid: "Item.act-1",
				system: {
					actionCost: "Extended Action",
					shortDescription: "",
					roll: { test: "command", difficulty: "Challenging (+0)" },
				},
			},
		);
		expect(prepared).toMatchObject({ baseTarget: 30 }); // crew skill 30
		const rows = prepared!.initialModifiers as Array<{ id?: string }>;
		const ids = rows.map((row) => row.id);
		expect(ids).toContain("ship-ordnance:craft-rating");
		expect(ids).toContain("ship-ordnance:squadron-bonus");
		const combined = (prepared!.kindData as { combinedTarget?: number })
			.combinedTarget;
		// Command 30 + Craft Rating 10 + (+5 × 2 extra squadrons) = 50.
		expect(combined).toBe(50);
	});
});

// -------------------------------------------------Torpedo Run: attack maths

describe("Torpedo Run attack maths (bead brex, Battlefleet Koronus printed p7)", () => {
	const runKindData = {
		itemId: "act-1",
		uuid: "Item.act-1",
		name: "Torpedo Run",
		actionCost: "",
		description: "",
		testKey: "torpedo-run",
		difficulty: "",
		difficultyKind: "none",
		crewFallback: true,
		shipMod: 0,
		combinedTarget: 0,
	};
	const flagFor = (value: number) => ({
		id: "salvo-1",
		key: "torpedo-run",
		value,
		target: "all",
		expiresAtTurn: 10,
		persistent: false,
	});

	it("a FAILED attack scores NO hits and burns no torpedoes (printed p7)", async () => {
		// Travel 10 VU, then close within 1 VU — the BS + Torpedo Rating test
		// FAILS (roll 100): the salvo keeps its 3 torpedoes and the target
		// takes nothing.
		const target = shipFixture([], {
			armour: 20,
			turretRating: 0,
			hullIntegrity: { value: 40, max: 40 },
		});
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...plasmaSalvo, travelled: 0 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "10" }, { distance: "0" }]);
		const { shipUpdates, posts, rolled } = capturePorts(
			() => ({ total: 100 }),
			target,
		);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: false, degrees: 0 } as never,
			"",
		);
		// The attack rolled ONCE (the d100); NO damage dice followed.
		expect(rolled).toEqual(["1d100"]);
		// The salvo survives intact AND books its travel; the run flag stays.
		expect(shipUpdates).toHaveLength(1);
		const written = shipUpdates[0]!.system as {
			torpedoSalvos: Array<{ remaining: number; travelled: number }>;
			turnFlags: Array<{ value: number }>;
		};
		expect(written.torpedoSalvos[0]!.remaining).toBe(3);
		expect(written.torpedoSalvos[0]!.travelled).toBe(10);
		expect(written.turnFlags[0]!.value).toBe(3);
		// The card shows the failed attack: no hits, no hull damage.
		const post = posts[0] as {
			mode?: string;
			attempted?: boolean;
			hits?: number;
			hullDamage?: number;
			spent?: boolean;
		};
		expect(post.mode).toBe("run");
		expect(post.attempted).toBe(true);
		expect(post.hits).toBe(0);
		expect(post.hullDamage).toBe(0);
		expect(post.spent).toBe(false);
	});

	it("caps the travel input by Speed × the elapsed turns (nit 11)", async () => {
		// Launched on turn 1, clock reads 3: the salvo may only have moved
		// 2 turns × Speed 10 = 20 VU total, however far the prompt asks.
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...plasmaSalvo, travelled: 0, launchTurn: 1 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "60" }, { distance: "5" }]);
		const { shipUpdates, posts } = capturePorts(() => ({ total: 100 }), null); // distance 5 > cover 1 → no attack
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: false, degrees: 0 } as never,
			"",
		);
		const written = shipUpdates[0]!.system as {
			torpedoSalvos: Array<{ travelled: number }>;
		};
		expect(written.torpedoSalvos[0]!.travelled).toBe(20);
		const post = posts[0] as { attempted?: boolean };
		expect(post.attempted).toBe(false);
	});

	it("accumulates the per-hit Hull damage and writes the HI + crew loss once", async () => {
		// Three torpedoes hit (5 degrees, salvo of 3); each rolls 4+5 = 9 dice
		// + 14 bonus = 23 raw, vs Armour 20 → 3 Hull per hit, 9 in total — the
		// write sums the ACCUMULATED values, not re-parsed display strings.
		const target = shipFixture([], {
			armour: 20,
			turretRating: 0,
			hullIntegrity: { value: 40, max: 40 },
			crewPopulation: 100,
			crewMorale: 100,
		});
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...plasmaSalvo, travelled: 0 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "10" }, { distance: "0" }]);
		const { shipUpdates, posts, rolled } = capturePorts(
			(formula) =>
				formula === "1d100"
					? { total: 1 }
					: { total: 9, dice: [{ result: 4 }, { result: 5 }] },
			target,
		);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// 1d100 attack + THREE 2d10 damage rolls, no Terminal-Penetration
		// re-rolls (4/5 > TP 3) and no critical (dice < Crit Rating 10).
		expect(rolled).toEqual(["1d100", "2d10", "2d10", "2d10"]);
		// FIRST write: the TARGET takes the accumulated 9 (HI 40→31, crew/morale
		// −9 via crewLossFromHullDamage); SECOND write books the salvo (all 3
		// fired → spent → retired).
		expect(shipUpdates).toHaveLength(2);
		expect(shipUpdates[0]!.system).toMatchObject({
			hullIntegrity: { value: 31 },
			crewPopulation: 91,
			crewMorale: 91,
		});
		expect(shipUpdates[1]!.system).toMatchObject({ torpedoSalvos: [] });
		const post = posts[0] as {
			hits?: number;
			hullDamage?: number;
			spent?: boolean;
		};
		expect(post.hits).toBe(3);
		expect(post.hullDamage).toBe(9);
		expect(post.spent).toBe(true);
	});

	it("a MELTA hit that deals damage stacks the automatic Fire! critical (printed p9)", async () => {
		// One Melta torpedo hits: dice 5+6 = 11 + 15 bonus = 26 raw vs Armour
		// 20 → 6 Hull. The dice MISS the Crit Rating 9 (no chart roll fires),
		// but the warhead rule stacks the AUTOMATIC Fire! Critical on any
		// damage-dealing hit, in addition to any other Crits (BFK printed p9).
		const target = shipFixture([], {
			armour: 20,
			turretRating: 0,
			hullIntegrity: { value: 40, max: 40 },
			crewPopulation: 100,
			crewMorale: 100,
		});
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...meltaSalvo, travelled: 0 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "10" }, { distance: "0" }]);
		const { posts, rolled } = capturePorts(
			(formula) =>
				formula === "1d100"
					? { total: 1 }
					: { total: 11, dice: [{ result: 5 }, { result: 6 }] },
			target,
		);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// No chart roll fired (the dice miss Crit Rating 9) — Fire! rides the
		// per-hit row alone, off the warhead rule. THREE torpedoes hit (the
		// attack degree roll capped by the salvo of 3).
		expect(rolled).toEqual(["1d100", "2d10", "2d10", "2d10"]);
		const post = posts[0] as {
			critNote?: string;
			attackRows?: Array<{ id: string; label?: string; display?: string }>;
			hullDamage?: number;
		};
		expect(post.hullDamage).toBe(18);
		expect(post.critNote).toContain("SHIP_CRITICALS.fire");
		const fireRow = post.attackRows?.find(
			(row) => row.id === "ord:melta-fire",
		);
		expect(fireRow?.display).toContain("SHIP_CRITICALS.fire");
	});

	it("a criticaling-but-absorbed MELTA hit deals the 1-point floor and still stacks Fire! (printed pp8-9)", async () => {
		// One die (10) MEETS the Crit Rating 9 → the hit CRITICALS, but raw
		// 27 ≤ Armour 30 → the Armour absorbs it all. The kernel still grants
		// a criticaling hit a FLOOR of 1 Hull point (printed p8), so the hit
		// DOES deal Hull damage — the automatic Fire! stacks with the chart
		// roll's own critical (BFK printed p9).
		const target = shipFixture([], {
			armour: 30,
			turretRating: 0,
			hullIntegrity: { value: 40, max: 40 },
			crewPopulation: 100,
			crewMorale: 100,
		});
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...meltaSalvo, travelled: 0 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "10" }, { distance: "0" }]);
		const { posts, rolled } = capturePorts(
			(formula) =>
				formula === "1d100"
					? { total: 1 }
					: { total: 12, dice: [{ result: 2 }, { result: 10 }] },
			target,
		);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// All THREE hits critical, absorb into the Armour and land the 1-point
		// floor — each rolls its Terminal-Penetration re-roll (the 2 die is ≤
		// TP 4), takes its 1d5 chart roll, and stacks the Fire!.
		expect(rolled).toEqual([
			"1d100",
			"2d10",
			"1d10",
			"1d5",
			"2d10",
			"1d10",
			"1d5",
			"2d10",
			"1d10",
			"1d5",
		]);
		const post = posts[0] as {
			critNote?: string;
			attackRows?: Array<{ id: string; display?: string }>;
			hullDamage?: number;
		};
		expect(post.hullDamage).toBe(3);
		const fireRows = (post.attackRows ?? []).filter(
			(row) => row.id === "ord:melta-fire",
		);
		expect(fireRows).toHaveLength(3);
		expect(fireRows[0]?.display).toContain("SHIP_CRITICALS.fire");
		// The chart crit and the warhead Fire! ride the crit note TOGETHER.
		expect(post.critNote).toContain("SHIP_CRITICALS.fire");
	});

	it("a Melta hit that deals NO damage causes no Fire! critical (printed p9)", async () => {
		// The Melta hit absorbs into the target's Armour (raw 26 ≤ Armour 30):
		// no damage dealt, so the automatic Fire! Critical never fires.
		const target = shipFixture([], {
			armour: 30,
			turretRating: 0,
			hullIntegrity: { value: 40, max: 40 },
			crewPopulation: 100,
			crewMorale: 100,
		});
		const ship = shipFixture([], {
			torpedoSalvos: [{ ...meltaSalvo, travelled: 0 }],
			turnFlags: [flagFor(3)],
		});
		cueDialog([], [{ distance: "10" }, { distance: "0" }]);
		const { posts, rolled } = capturePorts(
			(formula) =>
				formula === "1d100"
					? { total: 1 }
					: { total: 11, dice: [{ result: 5 }, { result: 6 }] },
			target,
		);
		await ordnanceRowHandlers["torpedo-run"]!.after?.(
			{ kind: "ship-action", actor: ship as never, itemId: "act-1" } as never,
			{
				title: "Test Ship — Torpedo Run",
				kindData: runKindData,
				baseTarget: 0,
			} as never,
			{ success: true, degrees: 0 } as never,
			"",
		);
		// The Melta hits absorb into the target's Armour (raw 26 ≤ Armour 30):
		// no damage dealt on ANY hit, so the automatic Fire! Critical never
		// fires — the salvo still rolls its THREE 2d10 damage rolls.
		expect(rolled).toEqual(["1d100", "2d10", "2d10", "2d10"]);
		const post = posts[0] as {
			critNote?: string;
			attackRows?: Array<{ id: string }>;
			hullDamage?: number;
		};
		expect(post.hullDamage).toBe(0);
		expect(post.critNote).toBe("");
		expect(
			post.attackRows?.some((row) => row.id === "ord:melta-fire"),
		).toBe(false);
	});
});

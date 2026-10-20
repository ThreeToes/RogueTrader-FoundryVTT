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

// Module-load stubs first (the ship-boarding.test.ts pattern): the
// presentation chain touches test-dialog and the ports at load.
const globalThisRecord = globalThis as Record<string, unknown>;
const foundryGlobal = (globalThisRecord.foundry = {
	abstract: { TypeDataModel: class {} },
	data: {
		fields: {
			SchemaField: class {
				fields: Record<string, unknown>;
				constructor(fields: object) {
					this.fields = fields as never;
				}
			},
			ArrayField: class {},
			NumberField: class {},
			StringField: class {},
			BooleanField: class {},
			HTMLField: class {},
		},
	},
	applications: {
		api: { DialogV2: { wait: async () => null, input: async () => null } },
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

import { afterEach, describe, expect, it } from "bun:test";
import { getPorts, resetPorts, setPorts } from "../../infrastructure/foundry/ports";
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

/** Capture the port traffic (the captureEffectPorts idiom, extended). */
function capturePorts(
	diceFormula: (formula: string) => { total: number },
	targetActor: unknown = null,
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
					dice: [],
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
		clock: { round: () => 3 },
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
		const { shipUpdates, itemUpdates, posts } = capturePorts(
			() => ({ total: 10 }),
		);
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
		expect(
			(posts[0] as { mode?: string }).mode,
		).toBe("launch");
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
		// the salvo is out past range anyway, 55+10 = 65 ≥ 60).
		cueDialog([], [{ distance: "10" }, { distance: "3" }]);
		const { shipUpdates, posts } = capturePorts(() => ({ total: 10 }));
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
			{ kind: "ship-action", actor: shipFixture([]) as never, itemId: "act-1" } as never,
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
		const combined = (
			prepared!.kindData as { combinedTarget?: number }
		).combinedTarget;
		// Command 30 + Craft Rating 10 + (+5 × 2 extra squadrons) = 50.
		expect(combined).toBe(50);
	});
});
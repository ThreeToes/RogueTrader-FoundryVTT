/**
 * Righteous Fury resolution (bead 8ssh, Core Rulebook pp249-250).
 *
 * Adapter-level tests via the roll-pipeline fake-ports harness (the
 * adapter-ammo-consume.test.ts pattern): Foundry globals are stubbed before
 * the dynamic import, then setPorts() swaps the dice/chat/config fakes in.
 *
 * Owner decisions (2026-10-21, on the bead): a natural 10 on a damage die
 * rolls ONE extra damage die (1d10 per the weapon), looping while the NEW
 * die is a natural 10; the added total joins BEFORE resolveDamage so it
 * soaks against Armour/Toughness normally; the confirming second attack
 * roll is GM-CALLED (no auto-confirm is built); the vehicle path (Core
 * Rulebook p218, 1d5 on the Vehicle Critical Hit Chart) is OUT OF SCOPE;
 * the damage.righteousFury knob is truthful — off suppresses everything.
 */

const postedCards: string[] = [];
let lastCardVars: Record<string, unknown> | null = null;
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
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
// applications.api is needed because the adapter transitively loads
// test-dialog (which destructures it at module load).
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	utils: { fromUuidSync: (uuid: string) => documentIndex.get(uuid) ?? null },
};

const documentIndex = new Map<string, unknown>();

const { rollDamageForCard } = await import("./adapter");
const { foundryPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { actorFixture } = await import("../../test-helpers/actor-fixture");
// The config port's profile() must return the RT SYSTEM profile (the
// homebrew seam validates its rule fields); the knob scenario overrides
// only the righteousFury leaf on top of it.
const rtCoreSystemProfile = (
	await import("../../ffg/domain/system-profile")
).rtCore;

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
	lastCardVars = null;
	rollCalls.length = 0;
});

// --- Fixtures -------------------------------------------------------------

interface RollScript {
	total: number;
	terms: Array<{ faces: number; results: number[] }>;
}

/** One missile-ammunition document (2d10 damage, pen 4). */
const ordnance = {
	id: "a1",
	name: "Frag Missile",
	type: "ammunition",
	uuid: "Actor.a.Item.a1",
	system: {
		quantity: 6,
		ordnance: {
			kind: "missile",
			damage: "2d10",
			damageType: "Explosive",
			penetration: 4,
		},
	},
};

const launcher = {
	id: "la",
	type: "ranged-weapon",
	name: "Missile Launcher (Locke)",
	uuid: "Actor.a.Item.la",
	actor: null as unknown,
	system: {
		weaponFamily: "launcher",
		class: "heavy",
		acceptsAmmo: "missile",
		loadedAmmoId: "a1",
		equipState: "carried",
		damage: "—",
		damageType: "Impact",
		rateOfFire: { singleShot: true, burst: 0, fullAuto: 0 },
	},
};

function buildWorld(): void {
	const attacker = actorFixture({
		items: [launcher, ordnance],
		isOwner: true,
		system: {
			// postWeaponDamage reads the Toughness bonus through the Character
			// system model; 40 => TB 4, so the fixture's damage numbers soak 4.
			effectiveCharacteristicValue: () => 40,
			skills: {},
		},
	});
	const ownedLauncher = (attacker as unknown as {
		items: { get(id: string): unknown };
	}).items.get("la") as { actor: unknown };
	ownedLauncher.actor = attacker;
	documentIndex.clear();
	documentIndex.set("Actor.a", attacker);
	documentIndex.set("Actor.a.Item.la", ownedLauncher);
	documentIndex.set("Actor.a.Item.a1", ordnance);
}

const cardFlag = () =>
	({
		attackerUuid: "Actor.a",
		weaponUuid: "Actor.a.Item.la",
		hitRoll: 30, // a location roll, NOT a damage die
		critical: false,
	}) as never;

// --- Harness --------------------------------------------------------------

function wireFuryPorts(config: {
	righteousFuryEnabled: boolean;
	script: RollScript[];
}): void {
	setPorts({
		...foundryPorts,
		dice: {
			roll: async (formula: string) => {
				rollCalls.push(formula);
				const next = config.script.shift();
				if (!next)
					throw new Error(`unexpected extra roll: ${formula}`);
				return {
					total: next.total,
					dice: [],
					terms: next.terms.map((term) => ({ ...term })),
					formula,
				};
			},
		},
		chat: {
			async post(
				_actor: unknown,
				_template: string,
				vars: Record<string, unknown>,
			) {
				lastCardVars = vars;
				postedCards.push("card");
				return { id: "msg-1" };
			},
			async postHtml() {
				postedCards.push("html");
				return { id: "msg-1" };
			},
			async update() {
				// chat amendments are not exercised by these scenarios.
			},
		},
		notify: {
			warn: () => undefined,
			error: () => undefined,
			info: () => undefined,
		},
		config: {
			...foundryPorts.config,
			homebrew: () => null,
			// The knob-off scenario swaps the ONE profile binding — the same
			// seam a sibling system's rules view-model turns off.
			profile: () => ({
				...rtCoreSystemProfile,
				righteousFury: {
					enabled: config.righteousFuryEnabled,
					trigger: "damaging-hit",
				},
			}),
		},
	});
}

const damageRoll = (results: number[]): RollScript => ({
	total: results.reduce((sum, r) => sum + r, 0),
	terms: [{ faces: 10, results }],
});
const furyDie = (result: number): RollScript => ({
	total: result,
	terms: [{ faces: 10, results: [result] }],
});

interface DamageCardVars {
	damage?: { righteousFury?: boolean; rawRoll?: number; wounds?: number };
	damageContributors?: Array<{ id?: string; label?: string; value?: number }>;
	qualityNotes?: string[];
}

const vars = (): DamageCardVars => lastCardVars as DamageCardVars;

// --- The bead's pins -------------------------------------------------------

describe("Righteous Fury resolution (bead 8ssh)", () => {
	test("a natural 10 on a damage die adds the extra 1d10 (looping while it stays 10) into the total before soak", async () => {
		buildWorld();
		wireFuryPorts({
			righteousFuryEnabled: true,
			// Damage 10+3 = 13 (triggers), TB 4 soaks, then extra dice:
			// 10 (natural 10 -> the chain continues), then 7 (stops).
			script: [damageRoll([10, 3]), furyDie(10), furyDie(7)],
		});
		await rollDamageForCard(cardFlag());
		// The extra dice really rolled: damage formula then the 1d10 chain.
		expect(rollCalls).toEqual(["2d10", "1d10", "1d10"]);
		const card = vars();
		expect(card.damage?.righteousFury).toBe(true);
		// 13 + 10 + 7 = 30 joins the total BEFORE resolveDamage, so soak
		// (armour 0 + TB 4) applies to the full amount: wounds 26.
		expect(card.damage?.rawRoll).toBe(30);
		expect(card.damage?.wounds).toBe(26);
	});

	test("the extra dice appear as a visible contributor row and the GM-called confirm note rides the card", async () => {
		buildWorld();
		wireFuryPorts({
			righteousFuryEnabled: true,
			script: [damageRoll([10, 3]), furyDie(10), furyDie(7)],
		});
		await rollDamageForCard(cardFlag());
		const card = vars();
		const furyRow = card.damageContributors?.find(
			(mod) => mod.id === "righteous-fury",
		);
		expect(furyRow?.value).toBe(17);
		expect(furyRow?.label).toBe("CHAT.RIGHTEOUS_FURY");
		// Owner decision 3: the card states the confirming second attack roll
		// is GM-called (Core Rulebook p249); no second-roll mechanic is built.
		expect(card.qualityNotes).toContain("CHAT.RIGHTEOUS_FURY_GM_CALLED");
	});

	test("without a natural 10 on a damage die nothing is added", async () => {
		buildWorld();
		wireFuryPorts({
			righteousFuryEnabled: true,
			script: [damageRoll([4, 3])],
		});
		await rollDamageForCard(cardFlag());
		expect(rollCalls).toEqual(["2d10"]);
		const card = vars();
		expect(card.damage?.righteousFury).toBe(false);
		expect(card.damage?.rawRoll).toBe(7);
		expect(
			card.damageContributors?.some((mod) => mod.id === "righteous-fury"),
		).toBe(false);
		expect(
			(card.qualityNotes ?? []).some((note) =>
				note.includes("CHAT.RIGHTEOUS_FURY"),
			),
		).toBe(false);
	});

	test("the damage.righteousFury knob OFF suppresses the whole effect (truthful knob)", async () => {
		buildWorld();
		wireFuryPorts({
			righteousFuryEnabled: false,
			// The natural 10 IS on the die — the knob suppresses it anyway.
			script: [damageRoll([10, 3])],
		});
		await rollDamageForCard(cardFlag());
		// No extra die rolled, no banner, no contributor, no GM note.
		expect(rollCalls).toEqual(["2d10"]);
		const card = vars();
		expect(card.damage?.righteousFury).toBe(false);
		expect(card.damage?.rawRoll).toBe(13);
		expect(
			card.damageContributors?.some((mod) => mod.id === "righteous-fury"),
		).toBe(false);
		expect(card.qualityNotes ?? []).not.toContain(
			"CHAT.RIGHTEOUS_FURY_GM_CALLED",
		);
	});
});
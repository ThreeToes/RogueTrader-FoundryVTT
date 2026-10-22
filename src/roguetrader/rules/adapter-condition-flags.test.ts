/**
 * Condition-flag plumbing into the damage channel (bead gqz2).
 *
 * Adapter-level tests via the roll-pipeline fake-ports harness (the
 * adapter-ammo-consume.test.ts pattern). Before the bead, postWeaponDamage
 * called collectTalentDamageEffects WITHOUT `flags`, so guardPasses saw
 * `ctx.flags?.[condition] === false` on the damage channel and a guarded
 * damage-flat row (e.g. "Crushing Blow while charging") was silently inert.
 *
 * The owner decision (2026-10-21, AC1): the to-hit dialog's condition flags
 * ride the damageRoll flag (weapon handler after-hook) into postWeaponDamage
 * → collectAttackerTalentDamage → collectTalentDamageEffects. AC2 (stripping
 * `condition` from the damage grammar) was REJECTED.
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

// A guarded damage-flat talent (the bead's shape: "Crushing Blow while
// charging"). The condition key rides the talentConditions registry guard;
// wildcard testKey so it applies to any weapon attack.
const guardedTalent = {
	id: "t1",
	name: "Crushing Blow",
	type: "talent",
	system: {
		effects: [
			{
				kind: "damage-flat",
				testKey: "",
				value: 3,
				label: "Crushing Blow",
				condition: "charging",
			},
		],
	},
};

const guardedTalentUnknownCondition = {
	id: "t2",
	name: "Unregistered Guard",
	type: "talent",
	system: {
		effects: [
			{
				kind: "damage-flat",
				testKey: "",
				value: 2,
				label: "Unregistered Guard",
				condition: "made-up-condition",
			},
		],
	},
};

/** One missile-ammunition document (2d10 damage — no natural 10 possible in the fake). */
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

function buildWorld(extraItems: unknown[] = []): void {
	const attacker = actorFixture({
		items: [launcher, ordnance, guardedTalent, ...extraItems],
		isOwner: true,
		system: {
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

const cardFlag = (extra: Record<string, unknown> = {}) =>
	({
		attackerUuid: "Actor.a",
		weaponUuid: "Actor.a.Item.la",
		hitRoll: 30,
		critical: false,
		...extra,
	}) as never;

// --- Harness --------------------------------------------------------------

function wireDamagePorts(): void {
	setPorts({
		...foundryPorts,
		dice: {
			// 2d10 = 3 + 3, no natural 10: the fury never fires and the only
			// contributor variable in these scenarios is the guarded row.
			roll: async (formula: string) => {
				rollCalls.push(formula);
				return {
					total: 6,
					dice: [],
					terms: [{ faces: 10, results: [3, 3] }],
					formula,
				};
			},
		},
		// Bead 0u0o: the damage card resolves guarded rows' condition slugs
		// through the talentConditions registry seam (CONDITION.CHARGING etc.)
		// then localizes — pin the translated label, not the raw key.
		i18n: {
			t: (key: string) =>
				key === "CONDITION.CHARGING" ? "Charging" : key,
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
	});
}

interface DamageCardVars {
	damage?: {
		flatDamage?: number;
		rawRoll?: number;
		wounds?: number;
		righteousFury?: boolean;
	};
	damageContributors?: Array<{
		id?: string;
		label?: string;
		value?: number;
		condition?: string;
	}>;
	damageTypeLabelKey?: string;
}

const vars = (): DamageCardVars => lastCardVars as DamageCardVars;

// --- The bead's pins -------------------------------------------------------

describe("condition flags reach the damage channel (bead gqz2)", () => {
	test("a guarded damage-flat row APPLIES when its condition flag is set on the damageRoll flag", async () => {
		buildWorld();
		wireDamagePorts();
		await rollDamageForCard(cardFlag({ flags: { charging: true } }));
		const card = vars();
		const guarded = card.damageContributors?.find(
			(mod) => mod.label === "Crushing Blow",
		);
		expect(guarded?.value).toBe(3);
		// Bead 0u0o: the card resolves the condition through the
		// talentConditions registry seam and localizes it — the card shows a
		// human-readable label ("Charging"), never the raw machine slug.
		expect(guarded?.condition).toBe("Charging");
		// The flat damage joined the total before soak: 6 rolled + 3 flat.
		expect(card.damage?.flatDamage).toBe(3);
		// rawRoll echoes the DICE total only; the flat row joins in the kernel
		// (roll + flatDamage = 9, minus soak 4 => wounds 5).
		expect(card.damage?.rawRoll).toBe(6);
		expect(card.damage?.wounds).toBe(5);
	});

	test("the card's condition label falls back visibly for an unregistered slug (bead 0u0o)", async () => {
		// A slug NOT in the talentConditions registry resolves to itself —
		// the fallback keeps unknown keys visible rather than vanishing them.
		buildWorld([guardedTalentUnknownCondition]);
		wireDamagePorts();
		await rollDamageForCard(cardFlag({ flags: { "made-up-condition": true } }));
		const card = vars();
		const guarded = card.damageContributors?.find(
			(mod) => mod.label === "Unregistered Guard",
		);
		expect(guarded?.condition).toBe("made-up-condition");
	});

	test("the guarded row does NOT apply when the flag is absent (the silent-inert bug stays a hard off)", async () => {
		buildWorld();
		wireDamagePorts();
		await rollDamageForCard(cardFlag());
		const card = vars();
		expect(
			card.damageContributors?.some((mod) => mod.label === "Crushing Blow"),
		).toBe(false);
		expect(card.damage?.flatDamage).toBe(0);
		expect(card.damage?.rawRoll).toBe(6);
	});

	test("a flag the row does not guard on keeps the row off", async () => {
		buildWorld();
		wireDamagePorts();
		await rollDamageForCard(cardFlag({ flags: { frenzied: true } }));
		const card = vars();
		expect(
			card.damageContributors?.some((mod) => mod.label === "Crushing Blow"),
		).toBe(false);
		expect(card.damage?.rawRoll).toBe(6);
	});
});
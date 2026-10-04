/**
 * Ammo auto-consume funnel application (epic ui4b, bead 65sq).
 *
 * Adapter-level tests via the roll-pipeline fake-ports harness (the
 * pack-less.test.ts pattern): Foundry globals are stubbed before the dynamic
 * import, then setPorts() swaps the dice/chat/notify/config fakes in. The
 * foundry `items` port is used UNFAKED so the loud-failure contract (bead
 * c9s3) is exercised for real — a document without update() throws.
 *
 * The fire path under test is rollDamageForCard → postWeaponDamage, where the
 * fired-ordnance stamp (bead 4obp) already rides the profile. Every pack
 * launcher profile is S/–/– (one attack = one shot), so a shot spent is a
 * single −1 per damage roll.
 */

const postedCards: string[] = [];
let lastCardVars: Record<string, unknown> | null = null;
const rollCalls: string[] = [];
const warnings: Array<[string, Record<string, unknown> | undefined]> = [];
const infos: Array<[string, Record<string, unknown> | undefined]> = [];

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
	notifications: { warn: () => undefined, error: () => undefined, info: () => undefined },
};
// fromUuidSync is the ONLY Foundry entry the card path takes for uuids (the
// adapter's documentFromUuid boundary). setDocumentIndex() fills the map per
// scenario. applications.api is needed because the adapter transitively loads
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

const { rollDamageForCard, rollWeaponDamage } = await import("./adapter");
const { foundryPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { actorFixture } = await import("../../test-helpers/actor-fixture");

import { afterAll, afterEach, describe, expect, test } from "bun:test";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

afterEach(() => {
	resetPorts();
	postedCards.length = 0;
	lastCardVars = null;
	rollCalls.length = 0;
	warnings.length = 0;
	infos.length = 0;
});

// --- Fixtures -------------------------------------------------------------

/** One missile-ammunition document; records its update patches. */
const ordnance = (quantity: number | string): QuantityFixtureDoc => {
	const patches: Array<Record<string, unknown>> = [];
	const doc = {
		id: "a1",
		name: "Frag Missile",
		type: "ammunition",
		uuid: "Actor.a.Item.a1",
		system: {
			quantity,
			ordnance: {
				kind: "missile",
				damage: "2d10",
				damageType: "Explosive",
				penetration: 4,
			},
		},
		update: async (patch: object) => {
			const p = patch as { system?: { quantity?: number } };
			// Mirror the real write: Foundry merges the patch, so the fixture's
			// system must move too (the next shot reads the new quantity).
			if (p.system) Object.assign(doc.system, p.system);
			patches.push(patch as Record<string, unknown>);
		},
		patches,
	};
	return doc;
};

/**
 * Structural shape both ordnance fixtures return (the "ammunition" and the
 * grenade "ranged-weapon" documents differ in system shape, not behaviour).
 */
interface QuantityFixtureDoc {
	id: string;
	name: string;
	type: string;
	uuid: string;
	system: Record<string, unknown>;
	update: (patch: object) => Promise<void>;
	patches: Array<Record<string, unknown>>;
}

/**
 * One hand-thrown GRENADE weapon document (bead 9b95 F4): grenades stay
 * "ranged-weapon" items in the thrown family and ARE writable ordnance
 * (Weapon extends Gear, Gear carries quantity) — the auto-consume branch is
 * untested without one, because every other fixture is "ammunition"-typed.
 */
const grenade = (quantity: number): QuantityFixtureDoc => {
	const patches: Array<Record<string, unknown>> = [];
	const doc = {
		id: "g1",
		name: "Frag Grenade",
		type: "ranged-weapon",
		uuid: "Actor.a.Item.g1",
		system: {
			// Core Rulebook Table 5-6: the grenade rows sit in the thrown family
			// with their own weapon fields (the launcher reads those, bead 4obp).
			class: "thrown",
			weaponFamily: "thrown",
			damage: "3d10",
			damageType: "Explosive",
			penetration: 4,
			quantity,
		},
		update: async (patch: object) => {
			const p = patch as { system?: { quantity?: number } };
			if (p.system) Object.assign(doc.system, p.system);
			patches.push(patch as Record<string, unknown>);
		},
		patches,
	};
	return doc;
};

const launcherThrough = (
	attacker: unknown,
	loadedAmmoId: string,
	rateOfFire: Record<string, unknown> = { singleShot: true, burst: 0, fullAuto: 0 },
) => ({
	id: "la",
	type: "ranged-weapon",
	name: "Missile Launcher (Locke)",
	uuid: "Actor.a.Item.la",
	actor: attacker,
	// Core Rulebook p119: the launcher's own damage is "—" and RoF is S/–/–;
	// the fire profile derives from the loaded ordnance (bead 4obp).
	system: {
		weaponFamily: "launcher",
		class: "heavy",
		acceptsAmmo: "missile",
		loadedAmmoId,
		// The sheet quick-damage path (rollWeaponDamage) gates on carried.
		equipState: "carried",
		damage: "—",
		damageType: "Impact",
		rateOfFire,
	},
});

const attackerThrough = (
	items: unknown[],
	options: { isOwner?: boolean } = {},
) =>
	actorFixture({
		items,
		isOwner: options.isOwner ?? true,
		system: {
			// postWeaponDamage reads the Toughness bonus through the Character
			// system model; the fixture answers directly.
			effectiveCharacteristicValue: () => 40,
			skills: {},
		},
	});

// --- Harness --------------------------------------------------------------

function wirePorts(homebrew: unknown): void {
	setPorts({
		...foundryPorts,
		dice: {
			roll: async (formula: string) => {
				rollCalls.push(formula);
				return { total: 7, dice: [], terms: [], formula };
			},
		},
		chat: {
			async post(_actor: unknown, _template: string, vars: Record<string, unknown>) {
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
			warn: (key: string, vars?: Record<string, unknown>) => {
				warnings.push([key, vars]);
			},
			info: (key: string, vars?: Record<string, unknown>) => {
				infos.push([key, vars]);
			},
			error: () => undefined,
		},
		config: {
			...foundryPorts.config,
			homebrew: () => homebrew,
		},
	});
}

/** A launcher + ordnance pair embedded in one fixture actor, uuid-indexed. */
function buildWorld(
	ord: QuantityFixtureDoc,
	options: {
		launcher?: ReturnType<typeof launcherThrough>;
		isOwner?: boolean;
		ammoId?: string;
	} = {},
) {
	const ammoId = options.ammoId ?? ord.id;
	const attacker = attackerThrough(
		[options.launcher ?? launcherThrough(null, ammoId), ord],
		{ isOwner: options.isOwner },
	);
	const launcher = (
		attacker as unknown as { items: { get(id: string): { actor?: unknown } } }
	).items.get("la") as { actor: unknown };
	launcher.actor = attacker;
	documentIndex.clear();
	documentIndex.set("Actor.a", attacker);
	documentIndex.set("Actor.a.Item.la", launcher);
	documentIndex.set("Actor.a.Item.a1", ord);
	documentIndex.set("Actor.a.Item.g1", ord);
	return { attacker, launcher };
}

const cardFlag = (extra: Record<string, unknown> = {}) =>
	({
		attackerUuid: "Actor.a",
		weaponUuid: "Actor.a.Item.la",
		hitRoll: 30,
		critical: false,
		...extra,
	}) as never;

describe("ammo auto-consume funnel application (bead 65sq)", () => {
	test("toggle ON: firing decrements the loaded ordnance by the shots spent (launchers are S/–/–: one per attack)", async () => {
		const ord = ordnance(6);
		buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		// One shot, one decrement: 6 → 5, written through the items port.
		expect(ord.patches).toEqual([{ system: { quantity: 5 } }]);
		// The damage card still posted — the consume does not eat the hit.
		expect(postedCards).toEqual(["card"]);
	});

	test("toggle ON: the card's usage chip shows the post-consume remainder", async () => {
		const ord = ordnance(3);
		buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		expect(infos).toEqual([
			["CHAT.AMMO_SPENT", { name: "Frag Missile", quantity: 2 }],
		]);
		// profile.fired feeds the chip: it moved with the write, so the card
		// shows 2 remaining, not the stale pre-shot 3.
		expect(
			(lastCardVars as { fired?: { name: string; quantity: number } })
				?.fired,
		).toEqual({ name: "Frag Missile", quantity: 2, uuid: "Actor.a.Item.a1" });
	});

	test("toggle ON at quantity 1: the shot is spent and the NEXT shot refuses loudly", async () => {
		const ord = ordnance(1);
		buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		expect(ord.patches).toEqual([{ system: { quantity: 0 } }]);
		// Next shot: the exhausted ordnance takes the SAME warn-and-refuse
		// path an unloaded launcher takes (ROLL.LAUNCHER_UNLOADED) — no card,
		// no further write.
		postedCards.length = 0;
		await rollDamageForCard(cardFlag());
		expect(warnings).toContainEqual([
			"ROLL.LAUNCHER_UNLOADED",
			{ weapon: "Missile Launcher (Locke)" },
		]);
		expect(postedCards).toEqual([]);
		expect(ord.patches).toEqual([{ system: { quantity: 0 } }]);
	});

	test("toggle OFF never writes quantity (manual −1 chip behaviour, bead 8uc7)", async () => {
		const ord = ordnance(6);
		buildWorld(ord);
		wirePorts({ id: "house" });
		await rollDamageForCard(cardFlag());
		expect(ord.patches).toEqual([]);
		expect(postedCards).toEqual(["card"]);
		// A profile whose flag is explicitly false behaves identically.
		wirePorts({ id: "house", ammoAutoConsume: false });
		await rollDamageForCard(cardFlag());
		expect(ord.patches).toEqual([]);
		expect(warnings).toEqual([]);
	});

	test("toggle OFF at quantity 0 still fires (manual tracking is untouched)", async () => {
		const ord = ordnance(0);
		buildWorld(ord);
		wirePorts({ id: "house" });
		await rollDamageForCard(cardFlag());
		expect(ord.patches).toEqual([]);
		expect(postedCards).toEqual(["card"]);
		expect(warnings).toEqual([]);
	});

	test("a failed item write throws loudly (the ports loud-failure convention)", async () => {
		const dry = {
			id: "a1",
			name: "Frag Missile",
			type: "ammunition",
			uuid: "Actor.a.Item.a1",
			// A usable ordnance block: the profile must RESOLVE here (an unusable
			// load refuses upstream and never reaches the write); the MISSING
			// update method is what must throw.
			system: {
				quantity: 3,
				ordnance: {
					kind: "missile",
					damage: "2d10",
					damageType: "Explosive",
					penetration: 4,
				},
			},
		};
		const attacker = attackerThrough([launcherThrough(null, "a1"), dry]);
		const launcher = (
			attacker as unknown as {
				items: { get(id: string): { actor?: unknown } };
			}
		).items.get("la") as { actor: unknown };
		launcher.actor = attacker;
		documentIndex.clear();
		documentIndex.set("Actor.a", attacker);
		documentIndex.set("Actor.a.Item.la", launcher);
		documentIndex.set("Actor.a.Item.a1", dry);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await expect(rollDamageForCard(cardFlag())).rejects.toThrow(
			/consumeFiredOrdnance — fired item .* did not resolve to an updatable document/,
		);
		// Nothing posted, nothing half-written.
		expect(postedCards).toEqual([]);
	});

	test("the items port itself throws when the write target cannot be written", async () => {
		await expect(foundryPorts.items.update(null, {})).rejects.toThrow(
			/items\.update — document is missing or has no update/,
		);
		const written: object[] = [];
		await foundryPorts.items.update(
			{
				update: async (p: object) => {
					written.push(p);
				},
			},
			{ system: { quantity: 4 } },
		);
		expect(written).toEqual([{ system: { quantity: 4 } }]);
	});

	// --- Review round 1 (bead 9b95) ------------------------------------------

	test("F4: a loaded RANGED-WEAPON grenade writes EXACTLY ONE quantity patch", async () => {
		const ord = grenade(4);
		// The launcher accepts grenades, not missile ammunition.
		const launcher = launcherThrough(null, ord.id, {
			singleShot: true,
			burst: 0,
			fullAuto: 0,
		});
		(launcher.system as Record<string, unknown>).acceptsAmmo = "grenade";
		buildWorld(ord, { launcher, isOwner: true });
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		// Exactly one write: 4 -> 3. No clamp double-write, no extra patch.
		expect(ord.patches).toEqual([{ system: { quantity: 3 } }]);
		expect(infos).toEqual([
			["CHAT.AMMO_SPENT", { name: "Frag Grenade", quantity: 3 }],
		]);
		expect(postedCards).toEqual(["card"]);
	});

	test("F4: a corrupted non-finite quantity REFUSES with ROLL.LAUNCHER_UNLOADED and writes NOTHING", async () => {
		const ord = ordnance("abc");
		buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		// Corrupt bookkeeping is never "fixed" by a spend: same warn-and-
		// refuse path an empty launcher takes, zero writes, no card.
		expect(warnings).toContainEqual([
			"ROLL.LAUNCHER_UNLOADED",
			{ weapon: "Missile Launcher (Locke)" },
		]);
		expect(ord.patches).toEqual([]);
		expect(infos).toEqual([]);
		expect(postedCards).toEqual([]);
	});

	test("F5: a NON-OWNER firing still posts the card but SKIPS the consume", async () => {
		const ord = ordnance(6);
		buildWorld(ord, { isOwner: false });
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag());
		// No write (the write would throw for a non-owner and kill the card),
		// but the damage card itself still posts — today's non-owner behaviour
		// is preserved, minus the dead card.
		expect(ord.patches).toEqual([]);
		expect(infos).toEqual([]);
		expect(postedCards).toEqual(["card"]);
	});

	test("F6: a burst launcher with the dialog's fire mode consumes the printed burst RoF", async () => {
		const ord = ordnance(6);
		buildWorld(ord, {
			launcher: launcherThrough(null, ord.id, {
				singleShot: true,
				burst: 3,
				fullAuto: 10,
			}),
		});
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag({ fireMode: "burst" }));
		// One attack in burst mode = the launcher's printed burst value (3),
		// not the single-shot hardcoded 1.
		expect(ord.patches).toEqual([{ system: { quantity: 3 } }]);
		expect(postedCards).toEqual(["card"]);
	});

	test("F6: full auto consumes the printed full RoF, clamping at empty stock", async () => {
		const ord = ordnance(6);
		buildWorld(ord, {
			launcher: launcherThrough(null, ord.id, {
				singleShot: true,
				burst: 3,
				fullAuto: 10,
			}),
		});
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollDamageForCard(cardFlag({ fireMode: "full" }));
		// 6 rounds left, 10 spent: the write clamps at 0 rather than going
		// negative (never corrupt bookkeeping).
		expect(ord.patches).toEqual([{ system: { quantity: 0 } }]);
	});

	test("F6: a burst-capable launcher with NO fire mode available refuses the consume LOUDLY", async () => {
		const ord = ordnance(6);
		buildWorld(ord, {
			launcher: launcherThrough(null, ord.id, {
				singleShot: true,
				burst: 3,
				fullAuto: 10,
			}),
		});
		wirePorts({ id: "house", ammoAutoConsume: true });
		// No fireMode on the flag (a fast-forwarded to-hit): "one damage roll =
		// one shot" is NOT book-true for a burst launcher, so the consume is
		// refused loudly — a warn, NO write, and the damage still posts.
		await rollDamageForCard(cardFlag());
		expect(warnings).toContainEqual([
			"ROLL.AMMO_ROF_UNRESOLVED",
			{ weapon: "Missile Launcher (Locke)" },
		]);
		expect(ord.patches).toEqual([]);
		expect(postedCards).toEqual(["card"]);
	});

	test("F6: a single-shot launcher with NO fire mode available still consumes 1", async () => {
		const ord = ordnance(6);
		buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		// S/–/–: with no dialog mode available, 1 is book-accurate.
		await rollDamageForCard(cardFlag());
		expect(ord.patches).toEqual([{ system: { quantity: 5 } }]);
	});

	test("F7: an exhausted launcher REFUSES before the throwaway location die (sheet quick damage)", async () => {
		const ord = ordnance(0);
		const { attacker } = buildWorld(ord);
		wirePorts({ id: "house", ammoAutoConsume: true });
		await rollWeaponDamage(attacker as never, "la");
		// The consume/refuse happens BEFORE the throwaway 1d100 location die:
		// no die burned on a hit that never resolves.
		expect(rollCalls).toEqual([]);
		expect(warnings).toContainEqual([
			"ROLL.LAUNCHER_UNLOADED",
			{ weapon: "Missile Launcher (Locke)" },
		]);
		expect(postedCards).toEqual([]);
	});
});
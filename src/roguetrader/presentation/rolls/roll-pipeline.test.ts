/**
 * Roll pipeline unit tests (bead mvu2): dispatch exhaustiveness, handler
 * preparation per kind, post-dialog modifier rows and the dialog-skip path.
 *
 * Re-homed from rules/roll-system.test.ts (bead nkwa): that file was named
 * after the module which is now a 67-line re-export shim, and importing
 * THROUGH the shim meant a broken re-export could pass the suite. These now
 * import the real modules; the shim's compatibility surface is pinned
 * separately in rules/roll-system.test.ts.
 *
 * The pipeline loads through test-dialog (which touches foundry.applications
 * at module load), so the Foundry globals are stubbed BEFORE the dynamic
 * imports; the stubs are minimal but enough for the pipeline to run.
 */

// --- Foundry/global stubs (must precede the dynamic import) ---------------
const rollCalls: unknown[] = [];
const warnings: string[] = [];
let dialogShowCalls = 0;

// Save originals so afterAll can restore them.
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
		warn: (msg: string) => warnings.push(msg),
		error: (msg: string) => warnings.push(msg),
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
		handlebars: { renderTemplate: async () => "<div>card</div>" },
	},
	dice: {
		Roll: class {
			total = 55;
			async evaluate(): Promise<this> {
				rollCalls.push("1d100");
				return this;
			}
		},
	},
	documents: {
		ChatMessage: {
			create: async () => ({ id: "msg-1" }),
			getSpeaker: () => ({}),
			get: () => undefined,
		},
	},
	utils: { fromUuidSync: () => null },
};

const { performRoll, rollHandlers } = await import("./perform");
const { characteristicHandler, skillHandler } = await import(
	"./characteristic-skill"
);
const { weaponHandler } = await import("./weapon");
const { navigatorHandler } = await import("./navigator");
const { psychicHandler } = await import("./psychic");
const { shipRepairHandler, shipWeaponHandler } = await import("./ship");
const { resolveEvasion } = await import("./evasion");
const { TestDialog } = await import("../../rules/test-dialog");

// The stubs above must not leak into other test files in the same bun
// process: modules like data/actor/vehicle.ts define classes as
// `extends foundry.abstract.TypeDataModel` at import time and expect the
// global to be untouched.
afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, describe, expect, it } from "bun:test";

// --- Fixtures -------------------------------------------------------------

function fixtureActor(items: unknown[] = []) {
	// `items` must be iterable (the funnel's item-effects contributor iterates
	// it) AND support .get(id) like a Foundry Collection.
	const collection = Object.assign([...items], {
		get: (id: string) => items.find((i) => (i as { id?: string }).id === id),
	});
	return {
		name: "Tester",
		type: "explorer",
		uuid: "Actor.test",
		items: collection,
		system: {
			characteristics: {
				ws: { value: 40, unnatural: 1 },
				bs: { value: 50, unnatural: 1 },
				wp: { value: 45, unnatural: 1 },
				ag: { value: 35, unnatural: 1 },
				per: { value: 30, unnatural: 1 },
				fel: { value: 30, unnatural: 1 },
				int: { value: 55, unnatural: 1 },
				t: { value: 40, unnatural: 1 },
			},
			wounds: { value: 0, max: 14 },
		},
	} as never;
}

const weaponItem = {
	id: "w1",
	type: "ranged-weapon",
	name: "Lasgun",
	uuid: "Item.w1",
	system: { special: [], equipState: "carried" },
};

function resetSpies() {
	warnings.length = 0;
	rollCalls.length = 0;
	dialogShowCalls = 0;
}

// --- Tests ----------------------------------------------------------------

describe("handler registry (bead mvu2)", () => {
	it("is exhaustive over the RollKind union", () => {
		expect(Object.keys(rollHandlers).sort()).toEqual(
			[
				"characteristic",
				"fear",
				"navigator",
				"psychic",
				"ship-repair",
				"ship-weapon",
				"skill",
				"weapon",
			].sort(),
		);
	});
});

describe("characteristic handler", () => {
	it("prepares target and title", async () => {
		resetSpies();
		const prepared = await characteristicHandler.prepare({
			kind: "characteristic",
			actor: fixtureActor(),
			key: "ws",
		});
		expect(prepared).toMatchObject({
			title: "Tester — CHARACTERISTIC.WS",
			baseTarget: 40,
			testKind: "characteristic",
			testKey: "ws",
		});
	});

	it("warns on unknown characteristics", async () => {
		resetSpies();
		const prepared = await characteristicHandler.prepare({
			kind: "characteristic",
			actor: fixtureActor(),
			key: "xx",
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("ROLL.UNKNOWN_CHARACTERISTIC");
	});
});

describe("skill handler", () => {
	it("trained: baseTarget includes the ladder bonus and skillName context", async () => {
		resetSpies();
		const item = {
			id: "s1",
			type: "skill",
			name: "Dodge",
			system: { characteristic: "ag", ladder: 2 },
		};
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor([item]),
			itemId: "s1",
		});
		expect(prepared).toMatchObject({
			baseTarget: 45, // 35 + (2-1)*10
			testKind: "skill",
			testKey: "ag",
			context: { skillName: "dodge" },
		});
	});

	it("untrained: raw -10 modifier and characteristic target", async () => {
		resetSpies();
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor(),
			characteristicKey: "ws",
			label: "Parry",
		});
		expect(prepared?.baseTarget).toBe(40);
		expect(prepared?.initialModifiers).toEqual([
			{ id: "untrained", source: { type: "skill", label: "Skill" }, label: "ROLL.UNTRAINED", value: -10 },
		]);
	});
});

describe("weapon handler", () => {
	it("gates on the equip state (stowed = not ready)", async () => {
		resetSpies();
		const stowed = { ...weaponItem, system: { special: [], equipState: "stowed" } };
		const prepared = await weaponHandler.prepare({
			kind: "weapon",
			actor: fixtureActor([stowed]),
			itemId: "w1",
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("ROLL.NOT_CARRIED");
	});

	it("prepares the attack test with the weapon funnel shape", async () => {
		resetSpies();
		const prepared = await weaponHandler.prepare({
			kind: "weapon",
			actor: fixtureActor([weaponItem]),
			itemId: "w1",
		});
		expect(prepared).toMatchObject({
			baseTarget: 50, // bs for ranged
			testKind: "attack",
			testKey: "bs",
			templateVars: { showDamageButton: true },
			weapon: { type: "ranged-weapon", special: [] },
		});
	});

	it("post-dialog Aim rows: half +10, full +20", () => {
		resetSpies();
		const prepared = {
			weapon: { type: "ranged-weapon", special: [] },
		} as never;
		const half = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: { aimed: true, aimFull: false } },
		);
		expect(half).toEqual([
			{ id: "attack:aim", source: { type: "dialog", label: "ROLL.AIM" }, label: "Aim (Half)", value: 10 },
		]);
		const full = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: { aimed: true, aimFull: true } },
		);
		expect(full?.[0]).toMatchObject({ label: "Aim (Full)", value: 20 });
	});

	it("post-dialog Inaccurate: explicit 0-value row", () => {
		resetSpies();
		const prepared = {
			weapon: { type: "ranged-weapon", special: ["inaccurate"] },
		} as never;
		const rows = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: { aimed: true, aimFull: false } },
		);
		expect(rows).toEqual([
			{ id: "attack:aim-inaccurate", source: { type: "dialog", label: "WEAPON.SPECIAL" }, label: "Inaccurate (no Aim bonus)", value: 0 },
		]);
	});

	it("no aim taken = no post-dialog rows", () => {
		resetSpies();
		const prepared = { weapon: { type: "ranged-weapon", special: [] } } as never;
		const rows = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: {} },
		);
		expect(rows).toEqual([]);
	});

	it("testContext carries the dialog attack selection", () => {
		resetSpies();
		const prepared = {} as never;
		const context = weaponHandler.testContext?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: { aimed: true, fireMode: "full", flags: { charge: true } } },
		);
		expect(context).toEqual({
			aimed: true,
			fireMode: "full",
			flags: { charge: true },
		});
	});
});

describe("navigator handler", () => {
	it("adds the mastery bonus as a pre-dialog modifier", async () => {
		resetSpies();
		const item = {
			id: "n1",
			type: "navigatorpower",
			name: "Warp Sense",
			system: { characteristic: "per", mastery: "adept", masteryBonusValue: 10 },
		};
		const prepared = await navigatorHandler.prepare({
			kind: "navigator",
			actor: fixtureActor([item]),
			itemId: "n1",
		});
		expect(prepared?.testKind).toBe("characteristic");
		expect(prepared?.testKey).toBe("per");
		expect(prepared?.initialModifiers).toHaveLength(1);
		expect(prepared?.initialModifiers[0]).toMatchObject({
			id: "navigator-mastery",
			value: 10,
		});
	});
});

describe("performRoll dialog-skip path", () => {
	it("runs the pipeline without opening the dialog", async () => {
		resetSpies();
		const originalShow = TestDialog.show;
		TestDialog.show = (async () => {
			dialogShowCalls += 1;
			return { modifiers: [] };
		}) as typeof TestDialog.show;
		try {
			await performRoll({
				kind: "characteristic",
				actor: fixtureActor(),
				key: "wp",
				skipDialog: true,
			});
		} finally {
			TestDialog.show = originalShow;
		}
		expect(dialogShowCalls).toBe(0);
		// One 1d100 roll (the test roll), and a card was posted.
		expect(rollCalls).toHaveLength(1);
	});

	it("opens the dialog when not skipped", async () => {
		resetSpies();
		const originalShow = TestDialog.show;
		TestDialog.show = (async () => {
			dialogShowCalls += 1;
			return { modifiers: [] };
		}) as typeof TestDialog.show;
		try {
			await performRoll({
				kind: "characteristic",
				actor: fixtureActor(),
				key: "wp",
			});
		} finally {
			TestDialog.show = originalShow;
		}
		expect(dialogShowCalls).toBe(1);
		expect(rollCalls).toHaveLength(1);
	});

	it("dialog cancel (null) aborts before the roll", async () => {
		resetSpies();
		const originalShow = TestDialog.show;
		TestDialog.show = (async () => {
			dialogShowCalls += 1;
			return null;
		}) as typeof TestDialog.show;
		try {
			await performRoll({
				kind: "characteristic",
				actor: fixtureActor(),
				key: "wp",
			});
		} finally {
			TestDialog.show = originalShow;
		}
		expect(dialogShowCalls).toBe(1);
		expect(rollCalls).toHaveLength(0);
	});

	// Bead wqt3: a difficulty (or any dialog-contributed) modifier must reach
	// the funnel — visible in the card breakdown and applied to the target.
	it("pipes dialog-contributed modifiers into the funnel and target", async () => {
		resetSpies();
		const originalShow = TestDialog.show;
		TestDialog.show = (async () => {
			dialogShowCalls += 1;
			return {
				modifiers: [
					{
						id: "difficulty",
						source: { type: "dialog", label: "ROLL.DIALOG" },
						label: "Trivial",
						value: 60,
					},
				],
			};
		}) as typeof TestDialog.show;
		const captured: Array<Record<string, unknown>> = [];
		const originalRender = foundry.applications.handlebars.renderTemplate;
		foundry.applications.handlebars.renderTemplate = (async (
			_template: string,
			vars: Record<string, unknown>,
		) => {
			captured.push(vars);
			return "<div>card</div>";
		}) as typeof originalRender;
		try {
			await performRoll({
				kind: "characteristic",
				actor: fixtureActor(),
				key: "wp",
			});
		} finally {
			TestDialog.show = originalShow;
			foundry.applications.handlebars.renderTemplate = originalRender;
		}
		expect(captured).toHaveLength(1);
		// wp is 45; the dialog's +60 difficulty must land on the clamped target.
		expect(captured[0].target).toBe(100);
		const analysis = captured[0].analysis as Array<{ label: string; value: number }>;
		expect(analysis.some((m) => m.label === "Trivial" && m.value === 60)).toBe(true);
	});
});

describe("psychic handler wiring", () => {
	it("bails for non-psykers", async () => {
		resetSpies();
		const item = {
			id: "p1",
			type: "psychicpower",
			name: "Smite",
			system: { focusTest: "Willpower", subtype: "attack", damage: "1d5" },
		};
		const prepared = await psychicHandler.prepare({
			kind: "psychic",
			actor: fixtureActor([item]),
			itemId: "p1",
			skipDialog: true,
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("PSYCHIC_POWER.NOT_PSYKER");
	});

	it("skipDialog uses Unfettered and wires the 91+ auto-fail profile", async () => {
		resetSpies();
		const item = {
			id: "p1",
			type: "psychicpower",
			name: "Smite",
			system: { focusTest: "Willpower", subtype: "attack", damage: "1d5" },
		};
		const actor = fixtureActor([item]) as {
			system: Record<string, unknown>;
		} as never;
		(actor as { system: Record<string, unknown> }).system.psyker = true;
		const prepared = await psychicHandler.prepare({
			kind: "psychic",
			actor,
			itemId: "p1",
			skipDialog: true,
		});
		expect(prepared?.testKind).toBe("focus-power");
		expect(prepared?.testKey).toBe("wp");
		expect(prepared?.autoFailRoll).toBe(91);
		expect(prepared?.kindData).toMatchObject({
			strength: "unfettered",
			pushLevels: 0,
		});
	});

	it("casts as a sorcerer: Intelligence test, Int-Bonus Psy Rating, Corruption carries", async () => {
		resetSpies();
		const item = {
			id: "p1",
			type: "psychicpower",
			name: "Warpfire",
			system: { focusTest: "Willpower", focusTime: "Half Action", subtype: "focus" },
		};
		const actor = fixtureActor([item]) as unknown as {
			system: Record<string, unknown>;
		};
		actor.system.psyker = false;
		actor.system.psyRating = 0;
		actor.system.sorceryRank = "sorcerer";
		actor.system.corruption = 42;
		const prepared = await psychicHandler.prepare({
			kind: "psychic",
			actor: actor as never,
			itemId: "p1",
			skipDialog: true,
		});
		expect(prepared?.testKey).toBe("int");
		expect(prepared?.kindData).toMatchObject({ mode: "sorcery", corruption: 42 });
		// Int 55 -> bonus 5 -> Sorcerer half = ceil(2.5) = 3; Focus Power +5/PR.
		const psy = (
			(prepared?.initialModifiers as Array<{ id: string; value: number }>) ?? []
		).find((mod) => mod.id === "psy-rating");
		expect(psy?.value).toBe(15);
	});

	it("refuses a Free Action power cast through Sorcery (EA p86)", async () => {
		resetSpies();
		const item = {
			id: "p1",
			type: "psychicpower",
			name: "Foreshadow",
			system: { focusTest: "Willpower", focusTime: "Free Action", subtype: "focus" },
		};
		const actor = fixtureActor([item]) as unknown as {
			system: Record<string, unknown>;
		};
		actor.system.sorceryRank = "sorcerer";
		const prepared = await psychicHandler.prepare({
			kind: "psychic",
			actor: actor as never,
			itemId: "p1",
			skipDialog: true,
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("PSYCHIC_POWER.SORCERY_FREE_ACTION");
	});
});

// --- Ship combat handlers (bead xfta) ------------------------------------

function shipFixture(items: unknown[], crewQuality = "competent") {
	return {
		name: "Sabre",
		type: "starship",
		uuid: "Actor.sabre",
		items: Object.assign([...items], {
			get: (id: string) => items.find((i) => (i as { id?: string }).id === id),
		}),
		system: {
			crewQuality,
			armour: 18,
			voidShields: 1,
			hullIntegrity: { value: 33, max: 33 },
			crewPopulation: 100,
			crewMorale: 100,
		},
	} as never;
}

const lasBattery = {
	id: "sw1",
	type: "ship-weapon-component",
	name: "Dorsal Sunsear Laser Battery",
	uuid: "Item.sw1",
	system: {
		strength: 4,
		damage: "1d10+2",
		critRating: 4,
		range: 9,
		slot: "dorsal",
		state: "intact",
	},
};

describe("ship-weapon handler (bead xfta)", () => {
	it("prepares a crew-skill BS test with weapon stats", async () => {
		resetSpies();
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([lasBattery]),
			itemId: "sw1",
			rangeBand: "normal",
		} as never);
		expect(prepared).toMatchObject({
			title: "Sabre — Dorsal Sunsear Laser Battery (SHIP_COMBAT.MACROBATTERY)",
			baseTarget: 30, // competent crew skill (book p193)
			testKind: "characteristic",
			testKey: "bs",
		});
		expect(prepared?.kindData).toMatchObject({
			weaponKind: "macrobattery",
			strength: 4,
			damage: "1d10+2",
			critRating: 4,
		});
	});

	it("classifies lance weapons by name", async () => {
		resetSpies();
		const lance = {
			...lasBattery,
			id: "sw2",
			name: "Prow Titanforge Lance Weapon",
		};
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([lance]),
			itemId: "sw2",
			rangeBand: "normal",
		} as never);
		expect(prepared?.kindData?.weaponKind).toBe("lance");
	});

	it("gates on non-functional components (book p223)", async () => {
		resetSpies();
		const damaged = {
			...lasBattery,
			system: { ...lasBattery.system, state: "damaged" },
		};
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([damaged]),
			itemId: "sw1",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings.some((w) => w.includes("SHIP_COMBAT.COMPONENT_NONFUNCTIONAL"))).toBe(true);
	});

	it("contributes the range-band row (book p220)", () => {
		resetSpies();
		const half = shipWeaponHandler.postDialogModifiers?.(
			{ kind: "ship-weapon", actor: shipFixture([]), itemId: "sw1", rangeBand: "half" } as never,
			{} as never,
			{ modifiers: [] },
		);
		expect(half).toEqual([
			{
				id: "ship:range",
				source: { type: "dialog", label: "SHIP_COMBAT.RANGE" },
				label: "SHIP_COMBAT.RANGE_HALF",
				value: 10,
			},
		]);
		const normal = shipWeaponHandler.postDialogModifiers?.(
			{ kind: "ship-weapon", actor: shipFixture([]), itemId: "sw1", rangeBand: "normal" } as never,
			{} as never,
			{ modifiers: [] },
		);
		expect(normal).toEqual([]);
	});

	it("rolls variable Strength (ork Dorsal Gunz, book p209)", async () => {
		resetSpies();
		const gunz = {
			...lasBattery,
			id: "sw3",
			name: "Dorsal Gunz",
			system: {
				strength: 0,
				strengthRoll: "1d5",
				damage: "1d10+4",
				critRating: 6,
				range: 4,
				state: "intact",
			},
		};
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([gunz]),
			itemId: "sw3",
			rangeBand: "normal",
		} as never);
		expect(prepared?.kindData?.weaponKind).toBe("macrobattery");
		expect(prepared?.kindData?.strength).toBeGreaterThanOrEqual(1);
	});
});

describe("ship-repair handler (bead xfta)", () => {
	it("prepares the Difficult (-10) crew test (book p218)", async () => {
		resetSpies();
		const damaged = {
			...lasBattery,
			system: { ...lasBattery.system, state: "damaged" },
		};
		const prepared = await shipRepairHandler.prepare({
			kind: "ship-repair",
			actor: shipFixture([damaged]),
			itemId: "sw1",
		} as never);
		expect(prepared?.baseTarget).toBe(30);
		expect(prepared?.initialModifiers).toHaveLength(1);
		expect(prepared?.initialModifiers[0]).toMatchObject({ value: -10 });
	});

	it("refuses destroyed components (book p218/p224)", async () => {
		resetSpies();
		const destroyed = {
			...lasBattery,
			system: { ...lasBattery.system, state: "destroyed" },
		};
		const prepared = await shipRepairHandler.prepare({
			kind: "ship-repair",
			actor: shipFixture([destroyed]),
			itemId: "sw1",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings.some((w) => w.includes("SHIP_COMBAT.REPAIR_INELIGIBLE"))).toBe(true);
	});

	it("refuses intact components (nothing to repair)", async () => {
		resetSpies();
		const prepared = await shipRepairHandler.prepare({
			kind: "ship-repair",
			actor: shipFixture([lasBattery]),
			itemId: "sw1",
		} as never);
		expect(prepared).toBeNull();
	});
});

// --- Phase-4 extraction coverage (bead nkwa) ------------------------------

/**
 * The weapon after-hook writes the damageRoll flag through the Chat port.
 * This is the only caller of `chat.update` in the tree, and the flag is what
 * makes the to-hit card's "Roll Damage" button work — so the field set matters.
 */
describe("weapon handler after-hook (bead nkwa)", () => {
	it("attaches the damageRoll flag to the to-hit card", async () => {
		resetSpies();
		const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			documents: { ChatMessage: { get: (id: string) => unknown } };
		};
		const originalGet = foundryGlobal.documents.ChatMessage.get;
		foundryGlobal.documents.ChatMessage.get = (id: string) => ({
			update: async (data: Record<string, unknown>) => {
				updates.push({ id, data });
			},
		});
		try {
			await weaponHandler.after?.(
				{
					kind: "weapon",
					actor: fixtureActor([weaponItem]),
					itemId: "w1",
				} as never,
				{ title: "Tester — Lasgun" } as never,
				{ success: true, roll: 23, degrees: 3, critical: true } as never,
				"msg-1",
			);
		} finally {
			foundryGlobal.documents.ChatMessage.get = originalGet;
		}
		expect(updates).toHaveLength(1);
		expect(updates[0].id).toBe("msg-1");
		const flag = (
			updates[0].data as {
				flags: { "rogue-trader": { damageRoll: Record<string, unknown> } };
			}
		).flags["rogue-trader"].damageRoll;
		expect(flag).toMatchObject({
			attackerUuid: "Actor.test",
			weaponUuid: "Item.w1",
			targetUuid: null,
			hitRoll: 23,
			critical: true,
			rolled: false,
		});
	});

	it("does not touch the card on a miss", async () => {
		resetSpies();
		const updates: unknown[] = [];
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			documents: { ChatMessage: { get: (id: string) => unknown } };
		};
		const originalGet = foundryGlobal.documents.ChatMessage.get;
		foundryGlobal.documents.ChatMessage.get = () => ({
			update: async (data: unknown) => {
				updates.push(data);
			},
		});
		try {
			await weaponHandler.after?.(
				{
					kind: "weapon",
					actor: fixtureActor([weaponItem]),
					itemId: "w1",
				} as never,
				{ title: "Tester — Lasgun" } as never,
				{ success: false, roll: 88, degrees: 0, critical: false } as never,
				"msg-1",
			);
		} finally {
			foundryGlobal.documents.ChatMessage.get = originalGet;
		}
		expect(updates).toHaveLength(0);
	});
});

/**
 * resolveEvasion re-enters the pipeline through a LAZY `await import("./perform")`
 * — the documented cycle-breaker between perform -> handlers -> weapon ->
 * evasion -> perform. A lazy import fails at RUNTIME, not compile time, so if
 * the path or the export name ever drifts nothing else in the suite notices.
 */
describe("evasion reaction (bead nkwa)", () => {
	it("rolls the defender's reaction through the lazy performRoll import", async () => {
		resetSpies();
		const posted: unknown[] = [];
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: { wait: unknown } } };
			documents: { ChatMessage: { create: (d: unknown) => Promise<unknown> } };
		};
		const originalWait = foundryGlobal.applications.api.DialogV2.wait;
		const originalCreate = foundryGlobal.documents.ChatMessage.create;
		const originalShow = TestDialog.show;
		foundryGlobal.applications.api.DialogV2.wait = async () => "react";
		foundryGlobal.documents.ChatMessage.create = async (data: unknown) => {
			posted.push(data);
			return { id: "msg-evasion" };
		};
		TestDialog.show = (async () => ({ modifiers: [] })) as typeof TestDialog.show;
		try {
			await resolveEvasion(fixtureActor() as never, {
				kind: "weapon",
				itemId: "w1",
				actor: fixtureActor([weaponItem]) as never,
			} as never);
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
			foundryGlobal.documents.ChatMessage.create = originalCreate;
			TestDialog.show = originalShow;
		}
		// The lazy import resolved: the Dodge reaction test ran (one 1d100) and
		// posted its card.
		expect(rollCalls).toHaveLength(1);
		expect(posted).toHaveLength(1);
	});

	it("does nothing when the defender declines", async () => {
		resetSpies();
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: { wait: unknown } } };
		};
		const originalWait = foundryGlobal.applications.api.DialogV2.wait;
		foundryGlobal.applications.api.DialogV2.wait = async () => "nothing";
		try {
			await resolveEvasion(fixtureActor() as never, {
				kind: "weapon",
				itemId: "w1",
				actor: fixtureActor([weaponItem]) as never,
			} as never);
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
		}
		expect(rollCalls).toHaveLength(0);
	});
});
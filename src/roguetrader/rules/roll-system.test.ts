/**
 * Roll-system unit tests (bead mvu2): dispatch exhaustiveness, handler
 * preparation per kind, post-dialog modifier rows and the dialog-skip path.
 *
 * roll-system loads through test-dialog (which touches foundry.applications
 * at module load), so the Foundry globals are stubbed BEFORE the dynamic
 * import; the stubs are minimal but enough for the pipeline to run.
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

const {
	performRoll,
	rollHandlers,
	characteristicHandler,
	skillHandler,
	weaponHandler,
	navigatorHandler,
	psychicHandler,
} = await import("./roll-system");
const { TestDialog } = await import("./test-dialog");

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
			["characteristic", "navigator", "psychic", "skill", "weapon"].sort(),
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
});
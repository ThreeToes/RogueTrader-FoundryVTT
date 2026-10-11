/**
 * Shared creator helpers (beads 71gm and nxok): pin the characteristic dice
 * formula (`2d10+base[key]`, previously repeated three times in
 * #onRollOne/#onReroll/#onRollAll) and the collapsible-group toggle both
 * creators share.
 *
 * Lives next to creators.test.ts because the helpers are exported from
 * character-creator.ts and that import chain hits the Foundry globals at
 * module scope — same globals shim, dynamic import after, restore afterAll.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { Dice } from "../../../ffg/application/ports";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = {
	i18n: { localize: (key: string) => key, format: (key: string) => key },
	system: { id: "rogue-trader" },
};
globals.ui = {
	notifications: { warn: () => undefined, info: () => undefined },
};
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				render(): Promise<unknown> {
					return Promise.resolve();
				}
			},
			DialogV2: { wait: async () => null, input: async () => null },
			handlebars: {
				renderTemplate: async () => "",
				getTemplate: async () => () => "",
			},
		},
		handlebars: {
			renderTemplate: async () => "",
			getTemplate: async () => () => "",
		},
		documents: {
			Item: class {},
			Actor: class {},
			ChatMessage: { get: () => undefined },
		},
		utils: { mergeObject: () => undefined },
	},
};

const {
	rollCharacteristic,
	rollAllCharacteristics,
	toggleCollapse,
} = await import("./character-creator");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

// --- Mock dice port: records the formula, returns a fixed total -------------

const calls: string[] = [];
const dice: Dice = {
	async roll(formula: string) {
		calls.push(formula);
		return { total: 42, dice: [], terms: [], formula };
	},
};

const HUMAN_BASE: Record<string, number> = {
	ws: 25,
	bs: 25,
	s: 25,
	t: 25,
	ag: 25,
	int: 25,
	per: 25,
	wp: 25,
	fel: 25,
};

// The helper's own order (character-creator's CHARACTERISTIC_ORDER).
const CHARACTERISTIC_ORDER: string[] = [
	"ws",
	"bs",
	"s",
	"t",
	"ag",
	"int",
	"per",
	"wp",
	"fel",
];

describe("rollCharacteristic (bead 71gm)", () => {
	test("rolls 2d10 + the species base for the key", async () => {
		calls.length = 0;
		const total = await rollCharacteristic(dice, {
			base: HUMAN_BASE as never,
		}, "fel");
		expect(total).toBe(42);
		expect(calls).toEqual(["2d10+25"]);
	});

	test("the base rides the formula, so a species base is honoured", async () => {
		calls.length = 0;
		await rollCharacteristic(dice, { base: { ...HUMAN_BASE, ag: 23 } as never }, "ag");
		expect(calls).toEqual(["2d10+23"]);
	});

	test("a dice port that misses total degenerates to 0, like roll()", async () => {
		const blank = {
			async roll() {
				return { dice: [], terms: [], formula: "2d10+25" };
			},
		} as unknown as Dice;
		expect(await rollCharacteristic(blank, { base: HUMAN_BASE as never }, "ws")).toBe(0);
	});
});

describe("rollAllCharacteristics (bead 71gm)", () => {
	test("rolls every characteristic once, in book order", async () => {
		calls.length = 0;
		const rolled = await rollAllCharacteristics(dice, {
			base: HUMAN_BASE as never,
		});
		expect(rolled).toEqual(
			Object.fromEntries(
				CHARACTERISTIC_ORDER.map((key: string) => [key, 42]),
			),
		);
		expect(calls).toEqual(
			CHARACTERISTIC_ORDER.map((key: string) => `2d10+${HUMAN_BASE[key]}`),
		);
	});
});

describe("toggleCollapse (bead nxok)", () => {
	test("collapsed -> delete the key (open)", () => {
		const state: Record<string, Record<string, boolean>> = {
			collapsed: { essential: true },
		};
		toggleCollapse(state, "collapsed", "essential");
		expect(state.collapsed.essential).toBeUndefined();
	});

	test("open -> set the key (collapsed)", () => {
		const state: Record<string, Record<string, boolean>> = { collapsed: {} };
		toggleCollapse(state, "collapsed", "supplemental");
		expect(state.collapsed.supplemental).toBe(true);
	});

	test("works on whatever field name the caller keeps", () => {
		const state: Record<string, Record<string, boolean>> = {
			acqCollapsed: { weapons: true },
		};
		toggleCollapse(state, "acqCollapsed", "weapons");
		toggleCollapse(state, "acqCollapsed", "armour");
		expect(state.acqCollapsed).toEqual({ armour: true });
	});

	test("a missing field or key is a safe no-op", () => {
		const state: Record<string, Record<string, boolean>> = {};
		expect(() => toggleCollapse(state, "collapsed", "gear")).not.toThrow();
		expect(toggleCollapse({ collapsed: {} }, "collapsed", "gear")).toBeUndefined();
		expect(state.collapsed).toBeUndefined();
	});
});
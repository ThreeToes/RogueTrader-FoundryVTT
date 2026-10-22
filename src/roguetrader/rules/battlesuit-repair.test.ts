/**
 * Battlesuit repair driver (bead ks3k; translations via the i18n port —
 * bead ap2j).
 *
 * The rule text pins the pipeline contract on top of a fake port set: the
 * module-local modifier label comes from getPorts().i18n.t (NOT a Foundry
 * global), the no-skill refusal warns through the notify port, and the
 * owner-gated happy path rolls through rollSkillOutcome. Foundry globals are
 * stubbed before the dynamic import because roll-system loads test-dialog
 * (which touches foundry.applications at module load) — the pack-less.test.ts
 * pattern.
 */

const tCalls: string[] = [];
const warnings: string[] = [];
const infos: string[] = [];
const rollCalls: string[] = [];
const posted: string[] = [];
const postedVars: Record<string, unknown>[] = [];

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
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	utils: { fromUuidSync: () => null },
};

const { REPAIR_TEST_MODIFIER, rollBattlesuitRepair } = await import(
	"./battlesuit-repair"
);
const {
	foundryPorts,
	setPorts,
	resetPorts,
} = await import("../../test-helpers/ports");
const { rtCore } = await import("../../ffg/domain/system-profile");
const { NO_CONTENT_PORT } = await import(
	"../../ffg/application/ports"
);
const { actorFixture } = await import("../../test-helpers/actor-fixture");

import type {
	ConfigPort,
	I18n,
	Notify,
	Ports,
} from "../../ffg/application/ports";
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
	tCalls.length = 0;
	warnings.length = 0;
	infos.length = 0;
	rollCalls.length = 0;
	posted.length = 0;
	postedVars.length = 0;
});

const techUseSkill = {
	id: "tu1",
	type: "skill",
	name: "Tech-Use",
	uuid: "Item.tu1",
	system: { characteristic: "int", ladder: 1 },
};

/**
 * Bead x4ly: the driver's notify/i18n/config ports are caller-bound, so these
 * doubles are threaded straight into `rollBattlesuitRepair` (the setPorts
 * swap stays only for the roll pipeline the driver re-enters through
 * rollSkillOutcome → performRoll → runTest, which still reads the global).
 *
 * `repairBattlesuitCriticals` in criticals.test.ts covers the actor-write path;
 * these keep the driver-level assertions (tCalls/warnings/infos) pinned to the
 * PORT-bound stubs.
 */
type RepairPorts = {
	notify: Notify;
	i18n: I18n;
	config: ConfigPort;
};
function repairPorts(): RepairPorts {
	return {
		notify: {
			warn: (key: string) => {
				warnings.push(key);
			},
			info: (key: string) => {
				infos.push(key);
			},
			error: () => undefined,
		},
		i18n: {
			t: (key: string) => {
				tCalls.push(key);
				return `[i18n] ${key}`;
			},
		},
		config: {
			homebrew: () => null,
			profile: () => rtCore,
			originTraits: () => [],
			packIds: () => ({ rolltables: null }),
		},
	};
}

function setup() {
	setPorts({
		...foundryPorts,
		content: NO_CONTENT_PORT,
		dice: {
			roll: async (formula: string) => {
				rollCalls.push(formula);
				return {
					total: 10,
					dice: [{ result: 10, faces: 100 }],
					terms: [{ class: "Die", faces: 100, results: [10] }],
					formula,
				} as never;
			},
		} as unknown as Ports["dice"],
		// The fake I18n port the acceptance names: the label must resolve
		// through the port, and every resolved KEY is recorded.
		i18n: {
			t: (key: string) => {
				tCalls.push(key);
				return `[i18n] ${key}`;
			},
		} as unknown as Ports["i18n"],
		notify: {
			warn: (key: string) => {
				warnings.push(key);
			},
			info: (key: string) => {
				infos.push(key);
			},
			error: () => undefined,
		} as unknown as Ports["notify"],
		chat: {
			...foundryPorts.chat,
			post: async (
				_a: unknown,
				template: string,
				vars: Record<string, unknown>,
			) => {
				posted.push(template);
				postedVars.push(vars);
				return { id: `msg-${posted.length} `, vars };
			},
		} as unknown as Ports["chat"],
	});
}

describe("rollBattlesuitRepair (bead ks3k / Tau Character Guide p31)", () => {
	test("the repair Test label resolves through the i18n port, not a global", async () => {
		setup();
		const actor = actorFixture({
			items: [techUseSkill],
			writable: true,
		});
		const result = await rollBattlesuitRepair(actor, repairPorts());
		if (!result) throw new Error("repair returned null in the fixture");
		// The dice rolled and a card went out.
		expect(rollCalls).toEqual(["1d100"]);
		expect(posted.length).toBeGreaterThan(0);
		expect(infos).toContain("CRITICAL.REPAIRED");
		// THE PORT PATH: both modifier label spots resolve CRITICAL.
		// REPAIR_MODIFIER through getPorts().i18n.t — the funnel may fold the
		// duplicated label into one contributor, so "at least once" is the
		// honest pin here.
		expect(tCalls).toContain("CRITICAL.REPAIR_MODIFIER");
		// The −20 is a real funnel modifier, not a silent one: the card's
		// breakdown row carries it (value −20) like any other contributor.
		const analysis = (postedVars[0]?.analysis ?? []) as Array<{
			id: string;
			value: number;
		}>;
		expect(
			analysis.some(
				(row) =>
					row.id === "battlesuit-repair-hard" && row.value === -20,
			),
		).toBe(true);
		expect(result?.removed).toBe(0);
		expect(result?.remaining).toBe(0);
	});

	test("a repaired outcome reports the removed effects", async () => {
		setup();
		const actor = actorFixture({
			items: [techUseSkill],
			writable: true,
		}) as unknown as {
			system: Record<string, unknown>;
		};
		actor.system.criticalEffects = [
			{
				location: "body",
				severity: 2,
				source: "battlesuit",
				text: "Weapon servos seize.",
			},
			{
				location: "head",
				severity: 1,
				source: "core",
				text: "A real wound.",
			},
		];
		const result = await rollBattlesuitRepair(actor, repairPorts());
		// The stubbed d100 is 10 and the Hard (−20) is in the funnel
		// (asserted above), so target 55 − 20 = 35 → 25 margin → 3 Degrees
		// of Success. 1 + degrees effects removable, but only the battlesuit
		// one is repairable: the core critical injury stays.
		expect(result?.removed).toBe(1);
		expect(result?.remaining).toBe(1);
	});

	test("without a repair skill it refuses through notify.warn", async () => {
		setup();
		const result = await rollBattlesuitRepair(
			actorFixture({ items: [], writable: true }),
			repairPorts(),
		);
		expect(warnings).toEqual(["CRITICAL.REPAIR_NO_SKILL"]);
		expect(result).toBeNull();
	});
});

// Bead wxut.1: the modifier is now PROFILE DATA (SystemProfile
// .repairTestModifier) as well as this module's constant. Domain may not
// import the rules layer, so the two values are separate declarations and
// this is the drift guard that keeps them equal. The constant stays the
// source; the consumer switch happens in a later bead.
describe("REPAIR_TEST_MODIFIER as profile data", () => {
	test("the profile field carries the module constant", async () => {
		const { rtCore } = await import("../../ffg/domain/system-profile");
		expect(rtCore.repairTestModifier).toBe(REPAIR_TEST_MODIFIER);
		expect(rtCore.repairTestModifier).toBe(-20);
	});
});
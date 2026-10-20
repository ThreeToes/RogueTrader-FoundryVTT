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

const { performRoll, rollHandlers, rollSnapOut } = await import("./perform");
const { snapOutHandler } = await import("./snap-out");
const { characteristicHandler, skillHandler } = await import(
	"./characteristic-skill"
);
const { weaponHandler } = await import("./weapon");
const { navigatorHandler } = await import("./navigator");
const { psychicHandler } = await import("./psychic");
const { shipRepairHandler, shipWeaponHandler } = await import("./ship");
const { actionHandler } = await import("./action");
const { setActionCatalog, actionDifficulty } = await import(
	"../../rules/actions"
);
const { combatActionChipAction } = await import(
	"../../sheet/actor/actions-view"
);
const { resolveEvasion } = await import("./evasion");
const { TestDialog } = await import("../../rules/test-dialog");

// The stubs above must not leak into other test files in the same bun
// process: modules like data/actor/vehicle.ts define classes as
// `extends foundry.abstract.TypeDataModel` at import time and expect the
// global to be untouched.
afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { collectConditionKeys, collectTestModifiers } from "../../../ffg/application/funnel";
import { buildActorView } from "../../../ffg/domain/model/build";
import {
	getPorts,
	localizeLabel,
	resetPorts,
	setConfigOverrides,
	setPorts,
} from "../../../ffg/infrastructure/foundry/ports";
import { actorFixture } from "../../../test-helpers/actor-fixture";
import type { ActionEntry } from "../../rules/actions";

// --- Fixtures -------------------------------------------------------------

const fixtureActor = (items: unknown[] = []) => actorFixture({ items });

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
				"action",
				"characteristic",
				"fear",
				"initiative",
				"navigator",
				"psychic",
				"ship-repair",
				"ship-weapon",
				"snap-out",
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

	it("untrained: target is HALF the characteristic, no penalty row (Core Rulebook p74 / p244)", async () => {
		resetSpies();
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor(),
			characteristicKey: "ws",
			label: "Parry",
		});
		// ws 40 untrained → 20 (half, round down). Bead tval: the halves is
		// baked into the target, so the breakdown has no -10 row.
		expect(prepared?.baseTarget).toBe(20);
		expect(prepared?.initialModifiers).toEqual([]);
	});

	it("untrained: odd values round DOWN (Ag 31 → 15)", async () => {
		resetSpies();
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor(),
			characteristicKey: "ag",
			label: "Dodge",
		});
		expect(prepared?.baseTarget).toBe(17); // floor(35 / 2)
	});

	/**
	 * An Ag-keyed mutation (bead 3swn's motivating shape): a characteristic-
	 * modifier row the funnel applies to every test keyed on that
	 * characteristic (innate item type: always live).
	 */
	const agMutation = {
		id: "m1",
		type: "mutation",
		name: "Shaky Grip",
		system: {
			effects: [
				{
					kind: "characteristic-modifier",
					testKey: "ag",
					value: -15,
					label: "Baleful Tremor",
				},
			],
		},
	};

	const trainedDodge = {
		id: "s1",
		type: "skill",
		name: "Dodge",
		system: { characteristic: "ag", ladder: 2 },
	};

	it("untrained (3swn): the half folds the characteristic rows in — floor(effective/2)", async () => {
		resetSpies();
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor([agMutation]),
			characteristicKey: "ag",
			label: "Dodge",
		});
		// ag 35 with the −15 Ag-keyed mutation → effective 20 → floor(20/2) = 10
		// (NOT floor(35/2) − 15 = 2: the delta must not compound the halving).
		// The fold is baked into the target: no separate characteristic-modifier
		// row, and the prepared funnel key is the surrogate that keeps the row
		// out of the post-prepare funnel collections (no double application).
		expect(prepared?.baseTarget).toBe(10);
		expect(prepared?.initialModifiers).toEqual([]);
		expect(prepared?.testKey).toBe("untrained:ag");
	});

	it("trained (3swn): the same rows ride the funnel — effective value + ladder", async () => {
		resetSpies();
		const actor = fixtureActor([agMutation, trainedDodge]);
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor,
			itemId: "s1",
		});
		// The trained path keeps the raw base (value + ladder); the mutation
		// ride is the funnel's job — the exact mirror of the pipeline's shared
		// test step (same view, kind and key). (The "Custom" filter skips
		// funnel.test.ts's global test-only leak when the full suite runs.)
		const rows = collectTestModifiers(buildActorView(actor), {
			kind: "skill",
			key: "ag",
			skillName: "dodge",
		}).filter((mod) => mod.id !== "custom");
		expect(rows.some((mod) => mod.label === "Baleful Tremor")).toBe(true);
		const total =
			(prepared?.baseTarget ?? 0) +
			rows.reduce((sum, mod) => sum + mod.value, 0);
		// effective 20 + the ladder 10 = 30.
		expect(total).toBe(30);
	});

	it("e2e (3swn): untrained folds the mutation in, no −15 row reaches the card", async () => {
		resetSpies();
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
				kind: "skill",
				actor: fixtureActor([agMutation]),
				characteristicKey: "ag",
				label: "Dodge",
				skipDialog: true,
			});
		} finally {
			foundry.applications.handlebars.renderTemplate = originalRender;
		}
		expect(captured).toHaveLength(1);
		const analysis = captured[0].analysis as Array<{
			label: string;
			value: number;
			id?: string;
		}>;
		// The characteristic-keyed mutation is INSIDE the halved base (10), not
		// a breakdown row — and a surrogate testKey keeps the funnel from
		// applying it twice. The target assertion is relative to the card's own
		// rows (minus the "Custom" test-only leak, full suite only) so file
		// order cannot flip it.
		expect(analysis.some((mod) => mod.label === "Baleful Tremor")).toBe(false);
		// Target relative to the card's OWN rows (funnel.test.ts's global
		// "Custom" test-only leak included, so file order cannot flip it).
		const sum = analysis.reduce((total, mod) => total + mod.value, 0);
		expect(captured[0].target).toBe(Math.min(100, Math.max(1, 10 + sum)));
	});

	// --- Bead rbap: condition-guarded, characteristic-keyed rows --------------

	/**
	 * rbap's motivating shape: a characteristic-keyed row WITH a condition
	 * guard (authored "+10 Ag tests while frenzied") met on the Ag-keyed
	 * half-characteristic path. At prepare the fold reads only UNGUARDED rows
	 * (the guard flag is unset) and post-prepare the `untrained:ag` surrogate
	 * key can never match the row's `ag` characteristic key — so the row is
	 * neither folded nor offered/applyable. Latent only: shipped packs author
	 * condition rows as wildcards (test-modifier, no testKey), so no current
	 * actor hits this. Owner decision 2026-10-08 (bead rbap): pin the
	 * limitation rather than extend the machinery.
	 */
	const guardedAgRow = {
		id: "t1",
		type: "mutation",
		name: "Warp Frenzy",
		system: {
			effects: [
				{
					kind: "characteristic-modifier",
					testKey: "ag",
					value: 10,
					label: "Warp Frenzy",
					condition: "frenzying",
				},
			],
		},
	};

	it("untrained (rbap): a condition-guarded Ag-keyed row is NOT folded, NOT offered, target unchanged", async () => {
		resetSpies();
		const prepared = await skillHandler.prepare({
			kind: "skill",
			actor: fixtureActor([guardedAgRow]),
			characteristicKey: "ag",
			label: "Dodge",
		});
		// The guard (flag unset) drops the row at prepare, so the fold is the
		// plain unguarded one — identical to an actor WITHOUT the row: ag 35 → 17.
		expect(prepared?.baseTarget).toBe(17);
		expect(prepared?.initialModifiers).toEqual([]);
		// The surrogate key keeps the keyed row out of the post-prepare
		// collections too (it can never match `untrained:ag`).
		expect(prepared?.testKey).toBe("untrained:ag");
	});

	it("untrained (rbap): the guarded row's condition toggle is NOT offered by the dialog", () => {
		resetSpies();
		const keys = collectConditionKeys(
			buildActorView(fixtureActor([guardedAgRow])),
			{
				kind: "skill",
				key: "untrained:ag",
			},
		);
		// Post-prepare, the surrogate testKey never matches the row's `ag`
		// characteristic key — the dialog has nothing to offer on the untrained
		// path, even with ignoreGuards.
		expect(keys).not.toContain("frenzying");
	});

	it("trained (rbap) contrast: the SAME guarded row's toggle IS offered", () => {
		resetSpies();
		const keys = collectConditionKeys(
			buildActorView(fixtureActor([guardedAgRow, trainedDodge])),
			{
				kind: "skill",
				key: "ag",
				skillName: "dodge",
			},
		);
		// Trained tests key on the real characteristic, so the guarded row's
		// condition IS offered as a pre-roll toggle (bead xu83 machinery).
		expect(keys).toContain("frenzying");
	});

	it("e2e (3swn): trained keeps the mutation as a funnel row on the effective base", async () => {
		resetSpies();
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
				kind: "skill",
				actor: fixtureActor([agMutation, trainedDodge]),
				itemId: "s1",
				skipDialog: true,
			});
		} finally {
			foundry.applications.handlebars.renderTemplate = originalRender;
		}
		expect(captured).toHaveLength(1);
		const analysis = captured[0].analysis as Array<{
			label: string;
			value: number;
			id?: string;
		}>;
		// Trained: the −15 mutation IS a visible row on top of the raw
		// 45 base; target relative to the card's own rows (leak included).
		expect(analysis.some((mod) => mod.label === "Baleful Tremor")).toBe(true);
		const sum = analysis.reduce((total, mod) => total + mod.value, 0);
		expect(captured[0].target).toBe(Math.min(100, Math.max(1, 45 + sum)));
	});
});

describe("weapon handler", () => {
	it("gates on the equip state (stowed = not ready)", async () => {
		resetSpies();
		const stowed = {
			...weaponItem,
			system: { special: [], equipState: "stowed" },
		};
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
			{
				id: "attack:aim",
				source: { type: "dialog", label: "ROLL.AIM" },
				label: "ROLL.AIM_HALF",
				value: 10,
			},
		]);
		const full = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: { aimed: true, aimFull: true } },
		);
		expect(full?.[0]).toMatchObject({ label: "ROLL.AIM_FULL", value: 20 });
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
			{
				id: "attack:aim-inaccurate",
				source: { type: "dialog", label: "WEAPON.SPECIAL" },
				label: "ROLL.AIM_INACCURATE",
				value: 0,
			},
		]);
	});

	it("no aim taken = no post-dialog rows", () => {
		resetSpies();
		const prepared = {
			weapon: { type: "ranged-weapon", special: [] },
		} as never;
		const rows = weaponHandler.postDialogModifiers?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{ modifiers: [], attack: {} },
		);
		expect(rows).toEqual([]);
	});

	// Bead 4hwl: the dialog's option bonus labels are resolved data, not
	// literals — a GM-tuned homebrew profile renders its own values.
	it("dialogConfig resolves fire-mode bonuses through the homebrew seam (4hwl)", () => {
		resetSpies();
		const request = {
			kind: "weapon",
			actor: fixtureActor(),
			itemId: "w1",
		} as never;
		const prepared = {
			weapon: { type: "ranged-weapon", special: [] },
		} as never;
		const core = weaponHandler.dialogConfig?.(request, prepared) as
			| {
					attackContext?: Record<string, unknown>;
			  }
			| undefined;
		expect(core?.attackContext).toMatchObject({
			burstBonus: 10, // core p237
			fullBonus: 20,
			aimHalf: 10,
			aimFull: 20,
		});
		setConfigOverrides({
			homebrew: () => ({
				"combat.fireModeBonus.burst": 5,
				"combat.fireModeBonus.full": 15,
			}),
		});
		try {
			const tuned = weaponHandler.dialogConfig?.(request, prepared) as
				| {
						attackContext?: Record<string, unknown>;
				  }
				| undefined;
			expect(tuned?.attackContext).toMatchObject({
				burstBonus: 5,
				fullBonus: 15,
				aimHalf: 10, // aim bonuses are not homebrew-tuned
				aimFull: 20,
			});
		} finally {
			setConfigOverrides({}); // restore the core default
		}
	});

	// Bead 4hwl grep-guard: the template renders the homebrew-resolved
	// numbers from attackContext — no hardcoded (+10)/(+20) may creep back.
	it("the attack-context template carries no bare bonus literals (4hwl)", () => {
		const template = readFileSync("template/dialog/test-dialog.hbs", "utf8");
		expect(template).not.toMatch(/\(\+10\)|\(\+20\)/);
		for (const field of ["burstBonus", "fullBonus", "aimHalf", "aimFull"]) {
			expect(template).toContain(`{{attackContext.${field}}}`);
		}
	});

	// Bead dfdv: labels built in homebrew/weapon/funnel contributors must be
	// localized in a non-en client — an attack with a burst fire mode and an
	// Accurate weapon shows translated labels, never a raw slug or en literal.
	it("breakdown labels localize in a fake non-en client (dfdv)", () => {
		const fakeEs: Record<string, string> = {
			"ROLL.FIRE_MODE_BURST": "Ráfaga semi-automática",
			"ROLL.AIM_HALF": "Apuntar (media acción)",
			"ROLL.AIM_FULL": "Apuntar (acción completa)",
			"ROLL.AIM_INACCURATE": "Imprecisa (sin bonificación por Apuntar)",
			"QUALITY.ACCURATE": "Precisa",
		};
		const gameStub = (globalThis as Record<string, unknown>).game as {
			i18n: {
				localize: (key: string) => string;
				format: (key: string) => string;
			};
		};
		const saved = gameStub.i18n;
		gameStub.i18n = {
			localize: (key: string) => fakeEs[key] ?? `untranslated: ${key}`,
			format: saved.format,
		};
		try {
			// Post-dialog aim row localizes at build time (ports.i18n.t).
			const prepared = {
				weapon: { type: "ranged-weapon", special: [] },
			} as never;
			const half = weaponHandler.postDialogModifiers?.(
				{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
				prepared,
				{ modifiers: [], attack: { aimed: true, aimFull: false } },
			);
			expect(half?.[0]?.label).toBe(fakeEs["ROLL.AIM_HALF"]);

			// Funnel contributors: fire-mode label localized at build; the
			// quality contributor emits the QUALITY.<SLUG> KEY and the display
			// seams (localizeLabel) localize it.
			const collected = collectTestModifiers(buildActorView({ items: [] }), {
				kind: "attack",
				key: "bs",
				weapon: { type: "ranged-weapon", special: ["accurate"] },
				aimed: true,
				fireMode: "burst",
			});
			expect(
				collected.find((m) => m.id === "attack:fire-mode:burst")?.label,
			).toBe(fakeEs["ROLL.FIRE_MODE_BURST"]);
			const quality = collected.find((m) => m.id === "quality:accurate");
			expect(quality?.label).toBe("QUALITY.ACCURATE");
			// No raw slug anywhere in the breakdown.
			expect(collected.map((m) => m.label)).not.toContain("accurate");
			// The shared display seam turns the KEY into the translation.
			expect(localizeLabel("QUALITY.ACCURATE")).toBe(
				fakeEs["QUALITY.ACCURATE"],
			);
			// And free text passes through untouched.
			expect(localizeLabel("Aim (Half)")).toBe("Aim (Half)");
		} finally {
			gameStub.i18n = saved;
		}
	});

	it("testContext carries the dialog attack selection", () => {
		resetSpies();
		const prepared = {} as never;
		const context = weaponHandler.testContext?.(
			{ kind: "weapon", actor: fixtureActor(), itemId: "w1" },
			prepared,
			{
				modifiers: [],
				attack: { aimed: true, fireMode: "full", flags: { charge: true } },
			},
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
			system: {
				characteristic: "per",
				mastery: "adept",
				masteryBonusValue: 10,
			},
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
		const analysis = captured[0].analysis as Array<{
			label: string;
			value: number;
		}>;
		expect(analysis.some((m) => m.label === "Trivial" && m.value === 60)).toBe(
			true,
		);
	});

	// Bead s1lv: the composed outcome label comes from ONE interpolated i18n
	// key (ROLL.SUCCESS_WITH_DEGREES + {degrees}) — no English scaffolding in
	// code, so other languages can reorder the sentence.
	it("composes the outcome label from ROLL.SUCCESS_WITH_DEGREES with the degrees var", async () => {
		resetSpies();
		const formats: Array<[string, unknown]> = [];
		const gameStub = (globalThis as Record<string, unknown>).game as {
			i18n: {
				localize: (key: string) => string;
				format: (key: string, vars?: Record<string, unknown>) => string;
			};
		};
		const saved = gameStub.i18n;
		gameStub.i18n = {
			localize: saved.localize,
			format: (key: string, vars?: Record<string, unknown>) => {
				formats.push([key, vars]);
				return saved.format(key, vars);
			},
		};
		const originalShow = TestDialog.show;
		TestDialog.show = (async () => ({
			modifiers: [],
		})) as typeof TestDialog.show;
		try {
			await performRoll({
				kind: "characteristic",
				actor: fixtureActor(),
				key: "int", // stubbed roll 55 → hits the target 55
				skipDialog: true,
			});
		} finally {
			gameStub.i18n = saved;
			TestDialog.show = originalShow;
		}
		expect(formats).toContainEqual([
			"ROLL.SUCCESS_WITH_DEGREES",
			{ degrees: expect.any(Number) },
		]);
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
			system: {
				focusTest: "Willpower",
				focusTime: "Half Action",
				subtype: "focus",
			},
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
		expect(prepared?.kindData).toMatchObject({
			mode: "sorcery",
			corruption: 42,
		});
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
			system: {
				focusTest: "Willpower",
				focusTime: "Free Action",
				subtype: "focus",
			},
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

// --- Snap-out handler (bead n0tp) ----------------------------------------

/**
 * A carried snap-out-capable condition: a system-status effect whose
 * rt-namespace flags carry snapOut (the shared read, bead pwn0).
 */
const snapOutEffect = {
	id: "fx1",
	statuses: ["shaken"],
	flags: { "rogue-trader": { snapOut: true } },
};

function snapOutActor() {
	const actor = actorFixture({ writable: true }) as unknown as {
		effects: unknown[];
	};
	actor.effects = [snapOutEffect];
	return actor as never;
}

describe("snap-out handler (bead n0tp)", () => {
	it("refuses when no condition can be snapped out of", async () => {
		resetSpies();
		const prepared = await snapOutHandler.prepare({
			kind: "snap-out",
			actor: fixtureActor(),
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("FEAR.SNAP_OUT_NONE");
	});

	it("prepares a Willpower test with the snapOut context flag", async () => {
		resetSpies();
		const prepared = await snapOutHandler.prepare({
			kind: "snap-out",
			actor: snapOutActor(),
		});
		expect(prepared).toMatchObject({
			baseTarget: 45, // wp
			testKind: "characteristic",
			testKey: "wp",
		});
		expect(prepared?.context.flags).toEqual({ snapOut: true });
	});

	it("a successful test deletes the snap-out-capable effects", async () => {
		const deleted: string[] = [];
		const actor = actorFixture({ writable: true }) as unknown as {
			effects: unknown[];
			deleteEmbeddedDocuments: (
				type: string,
				ids: string[],
			) => Promise<unknown>;
		};
		actor.effects = [snapOutEffect];
		actor.deleteEmbeddedDocuments = async (_type: string, ids: string[]) => {
			deleted.push(...ids);
			return [];
		};
		await snapOutHandler.after?.(
			{ kind: "snap-out", actor } as never,
			{ title: "Tester — FEAR.SNAP_OUT" } as never,
			{ success: true, roll: 23, degrees: 2, critical: false } as never,
			null,
		);
		expect(deleted).toEqual(["fx1"]);
	});

	it("routes through the wrapper: the ownership gate applies", async () => {
		resetSpies();
		const actor = snapOutActor() as unknown as { isOwner: boolean };
		actor.isOwner = false;
		await rollSnapOut(actor as never);
		expect(rollCalls).toHaveLength(0);
		expect(warnings).toContain("ROLL.NOT_OWNER");
	});
});

function shipFixture(items: unknown[], crewQuality = "competent") {
	return {
		name: "Sabre",
		type: "starship",
		uuid: "Actor.sabre",
		// Owned (bead qiuo): the roll pipeline refuses a non-owner and the port
		// fails closed.
		isOwner: true,
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
		expect(
			warnings.some((w) => w.includes("SHIP_COMBAT.COMPONENT_NONFUNCTIONAL")),
		).toBe(true);
	});

	it("contributes the range-band row (book p220)", () => {
		resetSpies();
		const half = shipWeaponHandler.postDialogModifiers?.(
			{
				kind: "ship-weapon",
				actor: shipFixture([]),
				itemId: "sw1",
				rangeBand: "half",
			} as never,
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
			{
				kind: "ship-weapon",
				actor: shipFixture([]),
				itemId: "sw1",
				rangeBand: "normal",
			} as never,
			{} as never,
			{ modifiers: [] },
		);
		expect(normal).toEqual([]);
		// The out-of-range band is refused in prepare() before the dialog, so
		// this branch should be unreachable — pinned as a defensive no-op.
		const outOfRange = shipWeaponHandler.postDialogModifiers?.(
			{
				kind: "ship-weapon",
				actor: shipFixture([]),
				itemId: "sw1",
				rangeBand: "out-of-range",
			} as never,
			{} as never,
			{ modifiers: [] },
		);
		expect(outOfRange).toEqual([]);
	});

	it("refuses an out-of-range band before any dice (bead 3ba1)", async () => {
		resetSpies();
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([lasBattery]),
			itemId: "sw1",
			rangeBand: "out-of-range",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings.some((w) => w.includes("SHIP_COMBAT.OUT_OF_RANGE"))).toBe(
			true,
		);
		// Refusal happens before any dice are rolled.
		expect(rollCalls).toEqual([]);
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

/** A target ship snapshot for salvo-resolution after() runs (armour 18 absorbs everything). */
const salvoTarget = {
	name: "Dauntless",
	system: {
		armour: 18,
		voidShields: 1,
		hullIntegrity: { value: 33, max: 33 },
		crewPopulation: 100,
		crewMorale: 100,
		crewQuality: "competent",
	},
};

/**
 * Deterministic damage-dice parse for the salvo dice fake (bead rhij): the
 * composed formula is EVALUATED, not answered with a constant — every die
 * rolls its minimum, any flat part adds as written. This keeps the class of
 * bug bead rhij fixes ("21d10+2" composed from `${through}${damage}`)
 * invisible to a constant fake from hiding here again.
 */
const fakeDamageRollTotal = (formula: string): number => {
	const match = /^(\d+)d(\d+)([+-]\d+)?$/.exec(formula.replaceAll(/\s+/g, ""));
	if (!match) return 0;
	const dice = Number.parseInt(match[1], 10);
	const flat = match[3] ? Number.parseInt(match[3], 10) : 0;
	return dice + flat;
};

describe("ship-weapon salvo actor write (bead 6l68: one payload, not two)", () => {
	/** Run after() for a successful salvo with a controlled dice fake; returns the actor updates and the requested formulas. */
	const runSalvo = async (
		outcome: { degrees: number },
		weapon: unknown = lasBattery,
	) => {
		resetSpies();
		const updates: Array<Record<string, unknown>> = [];
		const rolled: string[] = [];
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([weapon] as never),
			itemId: (weapon as { id: string }).id,
			rangeBand: "normal",
		} as never);
		setPorts({
			...getPorts(),
			// Bead rhij: the fake PARSES the requested salvo formula so the
			// composed string controls the total; assert on the formulas too.
			dice: {
				roll: async (formula: string) => {
					rolled.push(formula);
					return {
						total: fakeDamageRollTotal(formula),
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
					updates.push(data);
				},
			},
			targets: {
				...getPorts().targets,
				actor: () => salvoTarget,
			},
			chat: {
				...getPorts().chat,
				post: async () => ({ id: "msg-1" }),
			},
		} as never);
		try {
			await shipWeaponHandler.after?.(
				{
					kind: "ship-weapon",
					actor: shipFixture([]),
					itemId: (weapon as { id: string }).id,
				} as never,
				prepared as never,
				{ success: true, degrees: outcome.degrees, roll: 10 } as never,
				"",
			);
		} finally {
			resetPorts();
		}
		return { updates, rolled };
	};

	it("folds the critical auto-loss into ONE update on a critical with no Hull damage (p220)", async () => {
		// 4 degrees vs Crit Rating 4 = critical (p221 example); Strength 4
		// caps the hits at 4, the shield eats 1, and the 3 through hit for
		// "3d10+6" — the fake rolls every die at its minimum (3) + the scaled
		// flat (6), so the 18 armour absorbs all 9: hull damage 0, but the
		// critical still takes 1 HI automatically.
		const { updates, rolled } = await runSalvo({ degrees: 4 });
		// Bead rhij: the salvo damage formula must compose hits-scaled dice
		// and flat parts ("3d10+6"), never "31d10+2"-style concatenation.
		expect(rolled).toContain("3d10+6");
		expect(rolled).not.toContain("31d10+2");
		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({
			system: {
				hullIntegrity: { value: 32 }, // 33 — 1 automatic critical point
				crewPopulation: 100,
				crewMorale: 100,
			},
		});
	});

	it("writes one payload on an ordinary salvo without the critical fold", async () => {
		// 1 degree vs Crit Rating 4: no critical; 2 hits (1 + 1 per degree,
		// p220), the shield eats 1, the surviving hit rolls "1d10+2" (fake
		// total 3) and 18 armour absorbs it — HI stands, still exactly ONE
		// write.
		const { updates, rolled } = await runSalvo({ degrees: 1 });
		expect(rolled).toEqual(["1d10+2"]);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({
			system: {
				hullIntegrity: { value: 33 },
				crewPopulation: 100,
				crewMorale: 100,
			},
		});
	});

	it("composes multi-die formulas hits-scaled (bead rhij)", async () => {
		const gunz = {
			...lasBattery,
			id: "sw4",
			name: "Dorsal Gunz",
			system: { ...lasBattery.system, damage: "2d5+1" },
		};
		// 2 degrees vs Crit Rating 4 = no critical; 3 hits (strength cap 4),
		// shield eats 1, 2 through: "2d5+1" per hit composes "4d5+2".
		const { updates, rolled } = await runSalvo({ degrees: 2 }, gunz);
		expect(rolled).toContain("4d5+2");
		// Fake total 4*1+2 = 6, absorbed by 18 armour — HI stands.
		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({
			system: {
				hullIntegrity: { value: 33 },
				crewPopulation: 100,
				crewMorale: 100,
			},
		});
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
		expect(
			warnings.some((w) => w.includes("SHIP_COMBAT.REPAIR_INELIGIBLE")),
		).toBe(true);
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

	it("consumes the repair-time 1d5 die (bead 5lnc)", async () => {
		resetSpies();
		const rolled: string[] = [];
		const componentUpdates: Array<Record<string, unknown>> = [];
		const cardVars: Array<Record<string, unknown>> = [];
		const damaged = {
			...lasBattery,
			id: "component-1",
			system: { ...lasBattery.system, state: "damaged" },
		};
		setPorts({
			...getPorts(),
			dice: {
				roll: async (formula: string) => {
					rolled.push(formula);
					// The stubbed 1d5 lands on 2.
					return { total: 2, dice: [], terms: [], formula };
				},
			},
			actors: {
				...getPorts().actors,
				update: async (_doc: unknown, data: Record<string, unknown>) => {
					componentUpdates.push(data);
				},
			},
			chat: {
				...getPorts().chat,
				post: async (
					_actor: unknown,
					_template: string,
					vars: Record<string, unknown>,
				) => {
					cardVars.push(vars);
					return { id: "msg-1" };
				},
			},
		} as never);
		try {
			await shipRepairHandler.after?.(
				{
					kind: "ship-repair",
					actor: shipFixture([damaged]),
					itemId: "component-1",
				} as never,
				{
					title: "repair",
					kindData: {
						itemId: "component-1",
						componentId: "component-1",
					},
				} as never,
				{ success: true, degrees: 1 } as never,
				"",
			);
		} finally {
			resetPorts();
		}
		// The d5 IS rolled (bead 5lnc: the die is consumed, not hard-coded 5).
		expect(rolled).toContain("1d5");
		// d5=2, 1 degree of success -> 1 Strategic Turn (min 1, book p218).
		expect(cardVars[0]?.turns).toBe(1);
		expect(componentUpdates[0]).toEqual({
			system: { state: "intact", depressurised: false },
		});
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
 * resolveEvasion re-enters the pipeline STATICALLY: perform -> orchestrator
 * core (handler-agnostic runRoll) once carried a lazy `await
 * import("./perform")` here, because perform -> handlers -> weapon ->
 * evasion -> perform was a cycle; bead 1uai moved the registry out of the
 * orchestrator so the graph is acyclic and evasion imports it statically —
 * the drift protection this test gives (a broken path would fail here, in
 * suite, not at runtime) still applies.
 */
describe("evasion reaction (bead nkwa)", () => {
	it("rolls the defender's reaction through the orchestrator re-entry", async () => {
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
		TestDialog.show = (async () => ({
			modifiers: [],
		})) as typeof TestDialog.show;
		try {
			await resolveEvasion(
				fixtureActor() as never,
				{
					kind: "weapon",
					itemId: "w1",
					actor: fixtureActor([weaponItem]) as never,
				} as never,
			);
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
			foundryGlobal.documents.ChatMessage.create = originalCreate;
			TestDialog.show = originalShow;
		}
		// The re-entry resolved: the Dodge reaction test ran (one 1d100) and
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
			await resolveEvasion(
				fixtureActor() as never,
				{
					kind: "weapon",
					itemId: "w1",
					actor: fixtureActor([weaponItem]) as never,
				} as never,
			);
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
		}
		expect(rollCalls).toHaveLength(0);
	});
});

/*
 * Ownership gate (bead ly52): resolveEvasion fires AUTOMATICALLY on a hit,
 * on the CLICKING client, for whatever ports.targets.actor() returns. A player
 * attacking a GM-owned NPC cannot roll for the defender (permissions fail
 * closed), so the after-hook must not open a prompt the inner runRoll would
 * then refuse — it posts a "the defender may react" note and stops instead.
 */
describe("evasion ownership gate (bead ly52)", () => {
	const afterArgs = (attacker: unknown) =>
		[
			{
				kind: "weapon",
				actor: attacker,
				itemId: "w1",
			} as never,
			{ title: "Tester — Lasgun" } as never,
			{ success: true, roll: 20, degrees: 1, critical: false } as never,
			// No messageId: the damage-flag update is a separate concern (it
			// throws loudly in the default stub), and the evasion gate runs on
			// outcome alone.
			"",
		] as const;

	it("does NOT open the defender's prompt when this client cannot roll for them", async () => {
		resetSpies();
		const dialogCalls: unknown[] = [];
		const notes: string[] = [];
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: { wait: unknown } } };
		};
		const originalWait = foundryGlobal.applications.api.DialogV2.wait;
		foundryGlobal.applications.api.DialogV2.wait = async (
			...args: unknown[]
		) => {
			dialogCalls.push(args);
			return "react";
		};
		setPorts({
			...getPorts(),
			targets: {
				...getPorts().targets,
				actor: () => fixtureActor(),
			},
			permissions: { canRoll: () => false },
			chat: {
				...getPorts().chat,
				postHtml: async (_actor: unknown, content: string) => {
					notes.push(content);
					return { id: "note-1" };
				},
			},
		} as never);
		try {
			await weaponHandler.after?.(...afterArgs(fixtureActor([weaponItem])));
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
			resetPorts();
		}
		// The prompt was never opened for a client that cannot roll the
		// defender, and a note says the reaction is still owed.
		expect(dialogCalls).toHaveLength(0);
		expect(notes).toHaveLength(1);
		expect(notes[0] as string).toContain("EVASION.DEFENDER_MAY_REACT");
		expect(rollCalls).toHaveLength(0);
	});

	it("escapes a markup-laden defender name in the ownership-gate note (bead oeal)", async () => {
		resetSpies();
		const formats: Array<[string, unknown]> = [];
		const notes: string[] = [];
		const gameStub = (globalThis as Record<string, unknown>).game as {
			i18n: {
				localize: (key: string) => string;
				format: (key: string, vars?: Record<string, unknown>) => string;
			};
		};
		const savedI18n = gameStub.i18n;
		// The default stub drops the vars; interpolate {name} like the real
		// Foundry format does so the pin sees what ships to the clients.
		gameStub.i18n = {
			localize: savedI18n.localize,
			format: (key: string, vars?: Record<string, unknown>) => {
				formats.push([key, vars]);
				const rendered = savedI18n.format(key, vars);
				// The saved stub returns the key verbatim (tests have no
				// translations); interpolate the name inline so the pin sees
				// what a real translation with {name} would ship.
				return vars?.name !== undefined
					? `${rendered}|${vars.name}|`
					: rendered;
			},
		};
		setPorts({
			...getPorts(),
			targets: {
				...getPorts().targets,
				// The target's name is document data (user/pack-authored) and
				// reaches the note via i18n interpolation into RAW chat HTML —
				// it must be escaped BEFORE the interpolation.
				actor: () => ({
					...(fixtureActor() as unknown as Record<string, unknown>),
					name: `Bob "the" <Vat> & Sons`,
				}),
			},
			permissions: { canRoll: () => false },
			chat: {
				...getPorts().chat,
				postHtml: async (_actor: unknown, content: string) => {
					notes.push(content);
					return { id: "note-1" };
				},
			},
		} as never);
		try {
			await weaponHandler.after?.(...afterArgs(fixtureActor([weaponItem])));
		} finally {
			gameStub.i18n = savedI18n;
			resetPorts();
		}
		// The name escapes at the interpolation point...
		const evasionFormat = formats.find(([k]) => k === "EVASION.DEFENDER_MAY_REACT");
		expect(evasionFormat?.[1]).toEqual({
			name: "Bob &quot;the&quot; &lt;Vat&gt; &amp; Sons",
		});
		// ...and no raw markup survives into the posted HTML.
		const note = notes[0] as string;
		expect(note).toContain(
			"Bob &quot;the&quot; &lt;Vat&gt; &amp; Sons",
		);
		expect(note).not.toContain(`<Vat>`);
		expect(note).not.toContain(`"the"`);
		expect(rollCalls).toHaveLength(0);
	});

	it("still fires the prompt and the reaction roll when this client CAN roll for the defender", async () => {
		resetSpies();
		const dialogCalls: unknown[] = [];
		const posted: unknown[] = [];
		const foundryGlobal = (globalThis as Record<string, unknown>).foundry as {
			applications: { api: { DialogV2: { wait: unknown } } };
			documents: {
				ChatMessage: { create: (d: unknown) => Promise<unknown> };
			};
		};
		const originalWait = foundryGlobal.applications.api.DialogV2.wait;
		const originalCreate = foundryGlobal.documents.ChatMessage.create;
		const originalShow = TestDialog.show;
		foundryGlobal.applications.api.DialogV2.wait = async (
			...args: unknown[]
		) => {
			dialogCalls.push(args);
			return "react";
		};
		foundryGlobal.documents.ChatMessage.create = async (data: unknown) => {
			posted.push(data);
			return { id: "msg-evasion" };
		};
		TestDialog.show = (async () => ({
			modifiers: [],
		})) as typeof TestDialog.show;
		setPorts({
			...getPorts(),
			targets: {
				...getPorts().targets,
				actor: () => fixtureActor(),
			},
		} as never);
		try {
			await weaponHandler.after?.(...afterArgs(fixtureActor([weaponItem])));
		} finally {
			foundryGlobal.applications.api.DialogV2.wait = originalWait;
			foundryGlobal.documents.ChatMessage.create = originalCreate;
			TestDialog.show = originalShow;
			resetPorts();
		}
		// Same contract as the direct resolveEvasion tests above, reached
		// through the after-hook gate.
		expect(dialogCalls).toHaveLength(1);
		expect(rollCalls).toHaveLength(1);
		expect(posted).toHaveLength(1);
	});
});

// --- Action rolls (bead et5a, epic moew) ----------------------------------

/**
 * One warmed action entry with the machine difficulty classified (the
 * actions-rules mapper's contract — prerollKind's twin for difficulty).
 */
function actionEntry(
	name: string,
	rollTest: string,
	rollDifficulty = "",
): ActionEntry {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	return {
		key: slug,
		name,
		uuid: `Compendium.rogue-trader.actions.Item.${slug}`,
		actionCost: "Full",
		actionNote: "",
		subtypes: "Attack",
		prerequisites: "",
		shortDescription: `Terse line for ${name}.`,
		rollTest,
		rollDifficulty,
		difficulty: actionDifficulty(rollDifficulty),
		prereqKind: "none",
	};
}

/**
 * The fixture's characteristics carry no Strength entry; the strength route
 * needs one (the characteristic handler refuses unknown keys). Replacing
 * `system.characteristics` wholesale is the fixture's override semantics.
 */
const strengthActor = actorFixture({
	system: {
		characteristics: {
			ws: { value: 40, unnatural: 1 },
			bs: { value: 50, unnatural: 1 },
			s: { value: 45, unnatural: 1 },
			wp: { value: 45, unnatural: 1 },
			ag: { value: 35, unnatural: 1 },
		},
	},
});

const dodgeSkill = {
	id: "d1",
	type: "skill",
	name: "Dodge",
	system: { characteristic: "ag", ladder: 2 },
};

describe("action handler (bead et5a) — roll-vocabulary routing", () => {
	it("routes weapon-skill onto the Weapon Skill characteristic", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("All Out Attack", "weapon-skill"),
		});
		expect(prepared).toMatchObject({
			title: "Tester — All Out Attack",
			baseTarget: 40, // ws
			testKind: "characteristic",
			testKey: "ws",
		});
		expect(prepared?.initialModifiers).toEqual([]);
	});

	it("routes ballistic-skill onto the Ballistic Skill characteristic", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Full Auto Burst", "ballistic-skill"),
		});
		expect(prepared).toMatchObject({
			baseTarget: 50, // bs
			testKind: "characteristic",
			testKey: "bs",
		});
	});

	it("routes strength onto the Strength characteristic", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: strengthActor,
			entry: actionEntry("Grapple", "strength", "Opposed"),
		});
		expect(prepared).toMatchObject({
			baseTarget: 45, // s
			testKind: "characteristic",
			testKey: "s",
		});
		// Opposed: NO numeric difficulty row (manual resolution, owner ruling).
		expect(prepared?.initialModifiers).toEqual([]);
		expect(prepared?.kindData).toMatchObject({ opposed: true });
	});

	it("lands the printed difficulty as a pre-dialog modifier row", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Called Shot", "weapon-skill", "Hard (–20)"),
		});
		expect(prepared?.initialModifiers).toHaveLength(1);
		expect(prepared?.initialModifiers[0]).toMatchObject({
			id: "action:difficulty",
			label: "Hard (–20)",
			value: -20,
		});
	});

	it("lands a +0 printed difficulty as an explicit 0-value row", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Parry", "weapon-skill", "Challenging (+0)"),
		});
		expect(prepared?.initialModifiers).toHaveLength(1);
		expect(prepared?.initialModifiers[0]).toMatchObject({
			id: "action:difficulty",
			value: 0,
		});
	});

	it("routes dodge onto the trained Dodge skill when owned", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor([dodgeSkill]),
			entry: actionEntry("Dodge", "dodge"),
		});
		expect(prepared).toMatchObject({
			baseTarget: 45, // ag 35 + (2 - 1) * 10
			testKind: "skill",
			testKey: "ag",
		});
		// The trained path's skillName context rides along (skill:Dodge effects).
		expect(prepared?.context).toMatchObject({ skillName: "dodge" });
		expect(prepared?.initialModifiers).toEqual([]);
	});

	it("falls back to the untrained Agility path when Dodge is not owned", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Dodge", "dodge"),
		});
		// Bead tval (Core Rulebook p244: Ag 30 untrained → target 15): the
		// untrained route halves the characteristic (ag 35 → 17), no -10 row.
		expect(prepared?.baseTarget).toBe(17);
		expect(prepared?.initialModifiers).toEqual([]);
	});

	it("refuses an unmapped printed test loudly (warn, no silent no-op)", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Focus Power", "varies"),
		});
		expect(prepared).toBeNull();
		expect(warnings).toContain("ACTION.ROLL_UNKNOWN");
	});

	it("stamps the pack-doc titleDoc so the roll card names the action", async () => {
		resetSpies();
		const prepared = await actionHandler.prepare({
			kind: "action",
			actor: fixtureActor(),
			entry: actionEntry("Called Shot", "weapon-skill", "Hard (–20)"),
		});
		expect(prepared?.templateVars?.titleDoc).toMatchObject({
			link: {
				uuid: "Compendium.rogue-trader.actions.Item.called-shot",
				name: "Called Shot",
			},
		});
	});
});

describe("action after-hook (bead et5a)", () => {
	/** Capture + stub the card renderer for the block's duration. */
	async function captureCards(): Promise<Array<Record<string, unknown>>> {
		const captured: Array<Record<string, unknown>> = [];
		const originalRender = foundry.applications.handlebars.renderTemplate;
		foundry.applications.handlebars.renderTemplate = (async (
			_template: string,
			vars: Record<string, unknown>,
		) => {
			captured.push(vars);
			return "<div>card</div>";
		}) as typeof originalRender;
		return captured;
	}

	it("posts the action card with the lookup anatomy + roll result", async () => {
		resetSpies();
		const entry = actionEntry("Called Shot", "weapon-skill", "Hard (–20)");
		// Bead obbp pin: the card's outcome label renders through the SAME
		// interpolated i18n key the shared pipeline uses (bead s1lv's
		// ROLL.SUCCESS_WITH_DEGREES path) — not hand-concatenated English.
		const formats: Array<[string, unknown]> = [];
		const gameStub = (globalThis as Record<string, unknown>).game as {
			i18n: {
				localize: (key: string) => string;
				format: (key: string, vars?: Record<string, unknown>) => string;
			};
		};
		const savedI18n = gameStub.i18n;
		gameStub.i18n = {
			localize: savedI18n.localize,
			format: (key: string, vars?: Record<string, unknown>) => {
				formats.push([key, vars]);
				return savedI18n.format(key, vars);
			},
		};
		const captured = await captureCards();
		try {
			await actionHandler.after?.(
				{ kind: "action", actor: fixtureActor(), entry },
				{ kindData: { entry, opposed: false } } as never,
				{ success: true, roll: 23, degrees: 3, critical: false } as never,
				"msg-1",
				{ target: 20, modifiers: [] },
			);
		} finally {
			const render = foundry.applications.handlebars;
			render.renderTemplate = async () => "<div>card</div>";
			gameStub.i18n = savedI18n;
		}
		expect(captured).toHaveLength(1);
		expect(captured[0].titleDoc).toMatchObject({
			link: { uuid: entry.uuid, name: "Called Shot" },
		});
		expect(captured[0].cost).toBe("Full");
		expect(captured[0].target).toBe(20);
		expect(captured[0].roll).toBe(23);
		// The stubbed Foundry format() echoes the key, so the label EQUALS the
		// key only when it went through the shared interpolated key — a
		// concatenation like "ROLL.SUCCESS (+3 ROLL.DEGREES)" would fail this.
		expect(captured[0].outcomeLabel).toBe("ROLL.SUCCESS_WITH_DEGREES");
		expect(formats).toContainEqual(["ROLL.SUCCESS_WITH_DEGREES", { degrees: 3 }]);
		expect(captured[0].opposedNote).toBe("");
	});

	it("opposed result cards carry the manual-resolution note", async () => {
		resetSpies();
		const entry = actionEntry("Grapple", "strength", "Opposed");
		const captured: Array<Record<string, unknown>> = [];
		const originalRender = foundry.applications.handlebars.renderTemplate;
		try {
			foundry.applications.handlebars.renderTemplate = (async (
				_template: string,
				vars: Record<string, unknown>,
			) => {
				captured.push(vars);
				return "<div>card</div>";
			}) as typeof originalRender;
			await actionHandler.after?.(
				{ kind: "action", actor: fixtureActor(), entry },
				{ kindData: { entry, opposed: true } } as never,
				{ success: false, roll: 88, degrees: 0, critical: false } as never,
				"msg-1",
				{ target: 45, modifiers: [] },
			);
		} finally {
			foundry.applications.handlebars.renderTemplate = originalRender;
		}
		expect(captured).toHaveLength(1);
		expect(captured[0].outcomeLabel).toBe("ROLL.FAILURE");
		expect(captured[0].opposedNote).toBe("ACTION.OPPOSED_MANUAL");
	});
});

// --- Actions-tab chip wiring (bead et5a) -----------------------------------

describe("actions-tab chip wiring (bead et5a)", () => {
	it("routes a roll-spec chip through the pipeline (the stub is gone)", async () => {
		resetSpies();
		setActionCatalog([
			actionEntry("Called Shot", "weapon-skill", "Hard (–20)"),
		]);
		const originalShow = TestDialog.show;
		// The dialog returns its contributor rows (the real dialog returns the
		// fixed rows incl. the difficulty row); stubbing THAT keeps the test
		// honest about the pre-dialog row reaching the funnel.
		TestDialog.show = (async (request: { contributors?: Array<unknown> }) => ({
			modifiers: request.contributors ?? [],
		})) as typeof TestDialog.show;
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
			await combatActionChipAction.call({ actor: fixtureActor() }, {}, {
				dataset: { hasRoll: "true", actionName: "Called Shot" },
			} as unknown as HTMLElement);
		} finally {
			TestDialog.show = originalShow;
			foundry.applications.handlebars.renderTemplate = originalRender;
			setActionCatalog([]);
		}
		// One test roll; TWO cards — the inline roll card + the action card.
		expect(rollCalls).toHaveLength(1);
		expect(captured).toHaveLength(2);
		// The action card is the RESULT card: doc link + the resolved target
		// (ws 40 + the Hard (–20) row). Its target is asserted RELATIVE to the
		// card's own breakdown: another test file registers a global funnel
		// contributor (funnel.test.ts's "test-only" +5 leak), so an absolute
		// number would depend on file order in the full suite.
		expect(captured[1].titleDoc).toMatchObject({
			link: { name: "Called Shot" },
		});
		const analysis = captured[0].analysis as Array<{
			label: string;
			value: number;
		}>;
		expect(
			analysis.some((mod) => mod.label === "Hard (–20)" && mod.value === -20),
		).toBe(true);
		const sum = analysis.reduce((total, mod) => total + mod.value, 0);
		expect(captured[1].target).toBe(Math.min(100, Math.max(1, 40 + sum)));
	});
});

describe("grep-guard: no hand-rolled dialog+test sequences (bead n0tp)", () => {
	it("TestDialog.show + runTest appear only in the roll pipeline modules", () => {
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = `${dir}/${entry.name}`;
				if (entry.isDirectory()) {
					walk(path);
					continue;
				}
				if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
					continue;
				}
				if (
					readFileSync(path, "utf8").includes("TestDialog.show") &&
					readFileSync(path, "utf8").includes("runTest(")
				) {
					offenders.push(path);
				}
			}
		};
		walk("src");
		// The orchestrator core owns the sequence (and the gate); perform.ts
		// delegates to it (bead 1uai extracted the handler-agnostic core).
		expect(offenders).toContain(
			"src/roguetrader/presentation/rolls/orchestrator.ts",
		);
		// Everything else carrying the pair must be a roll-flow module — the
		// rolls directories where performRoll and its handlers live. A new
		// TestDialog+runTest dance anywhere else fails here, not in review.
		const strays = offenders.filter(
			(path) =>
				!path.startsWith("src/roguetrader/presentation/rolls/") &&
				!path.startsWith("src/ffg/presentation/rolls/"),
		);
		expect(strays).toEqual([]);
	});
});

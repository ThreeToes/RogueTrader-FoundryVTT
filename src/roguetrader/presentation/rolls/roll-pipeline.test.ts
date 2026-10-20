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
				"ship-action",
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

	// Bead kxbz: torpedo tubes / nova cannon / landing bays are Extended
	// Actions (Core Rulebook p218, bead a413/S9), not salvoes — their shipped
	// damage cells are the book's "—" ("0"), which cannot compose a salvo
	// formula at all. The refusal must happen in prepare(), BEFORE the roll:
	// after() writes state (the silent-running reveal) even on the way to a
	// crash, so refusing late would leave partial writes behind.
	it("refuses a torpedo tube LOUDLY before any roll or write (bead kxbz)", async () => {
		resetSpies();
		const updates: Array<Record<string, unknown>> = [];
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				update: async (_doc: unknown, data: Record<string, unknown>) => {
					updates.push(data);
				},
			},
		} as never);
		try {
			const tube = {
				...lasBattery,
				id: "sw4",
				name: "Prow Torpedo Tubes",
				system: {
					...lasBattery.system,
					componentType: "torpedo-tube",
					damage: "0", // the book's "—" cell
				},
			};
			const prepared = await shipWeaponHandler.prepare({
				kind: "ship-weapon",
				actor: shipFixture([tube]),
				itemId: "sw4",
				rangeBand: "normal",
			} as never);
			expect(prepared).toBeNull();
			expect(
				warnings.some((w) =>
					w.includes("SHIP_COMBAT.NOT_A_SALVO_WEAPON"),
				),
			).toBe(true);
			// No dice rolled and NO state write — the silent-running reveal
			// in after() is unreachable from here.
			expect(rollCalls).toEqual([]);
			expect(updates).toEqual([]);
		} finally {
			resetPorts();
		}
	});

	it("still classifies component-typed salvo weapons", async () => {
		resetSpies();
		const lance = {
			...lasBattery,
			id: "sw5",
			name: "Prow Sunstorm Lance",
			system: { ...lasBattery.system, componentType: "lance" },
		};
		const prepared = await shipWeaponHandler.prepare({
			kind: "ship-weapon",
			actor: shipFixture([lance]),
			itemId: "sw5",
			rangeBand: "normal",
		} as never);
		expect(prepared?.kindData?.weaponKind).toBe("lance");
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

// --- Ship-action handler (epic necp bead oumh) ----------------------------

const { shipActionHandler, parseShipActionTestKey } = await import(
	"./ship-action"
);

/** A ship-action Item fixture: Table 8-10 "Adjust Bearing" with the combined
 * manoeuvre test key (the pack bead authors the real rows). */
const shipActionItem = {
	id: "sa1",
	type: "ship-action",
	name: "Adjust Bearing",
	uuid: "Item.sa1",
	system: {
		actionCost: "Half Action",
		roll: {
			test: "pilot-space-craft+manoeuvrability",
			difficulty: "Challenging (+0)",
		},
		shortDescription: "Turn the ship on its axis.",
		description: "<p>Full prose.</p>",
	},
};

const pilotSpec = {
	id: "ps1",
	type: "skill",
	name: "Pilot (Space Craft)",
	system: { characteristic: "ag", ladder: 2 },
};
const pilotBare = {
	id: "p1",
	type: "skill",
	name: "Pilot",
	system: { characteristic: "ag", ladder: 2 },
};

function actionShipFixture(items: unknown[], crewQuality = "veteran") {
	return {
		name: "Sabre",
		type: "starship",
		uuid: "Actor.sabre",
		isOwner: true,
		items: Object.assign([...items], {
			get: (id: string) =>
				items.find((i) => (i as { id?: string }).id === id),
		}),
		system: {
			crewQuality,
			manoeuvrability: 30,
			detection: 12,
		},
	} as never;
}

describe("ship-action test-key vocabulary (bead oumh)", () => {
	it("splits a combined key into skill route + ship stat", () => {
		const parsed = parseShipActionTestKey(
			"pilot-space-craft+manoeuvrability",
		);
		expect(parsed).toMatchObject({
			routeKey: "pilot-space-craft",
			skillRoute: { skill: "Pilot (Space Craft)", bare: "Pilot" },
			shipStat: "manoeuvrability",
		});
	});

	it("accepts a bare skill key with no ship ability", () => {
		expect(parseShipActionTestKey("tech-use")).toMatchObject({
			routeKey: "tech-use",
			shipStat: undefined,
		});
	});

	it("accepts Scrutiny + Detection (Active Augury, book p216-218)", () => {
		expect(parseShipActionTestKey("scrutiny+detection")).toMatchObject({
			routeKey: "scrutiny",
			shipStat: "detection",
		});
	});

	it("refuses unknown parts and double fills loudly", () => {
		expect(parseShipActionTestKey("unknown-skill")).toBeNull();
		expect(parseShipActionTestKey("dodge")).toBeNull();
		expect(
			parseShipActionTestKey(
				"pilot-space-craft+manoeuvrability+detection",
			),
		).toBeNull();
	});
});

describe("ship-action handler (epic necp bead oumh)", () => {
	it("crew fallback: the crew-quality skill substitutes (Table 8-9, book p214)", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([shipActionItem]),
			itemId: "sa1",
		} as never);
		// Veteran crew = 50 (Table 8-9); no performer, so the Ag ladder never
		// applies.
		expect(prepared).toMatchObject({
			title: "Sabre — Adjust Bearing",
			baseTarget: 50,
			testKind: "characteristic",
			testKey: "pilot-space-craft",
		});
		const rows = prepared?.initialModifiers as Array<{
			id: string;
			value: number;
		}>;
		// The ship half rides as a visible row and the kindData fold (p212);
		// "Challenging (+0)" contributes its printed 0 row, visible like any.
		expect(rows.map((mod) => ({ id: mod.id, value: mod.value }))).toEqual([
			{ id: "ship:manoeuvrability", value: 30 },
			{ id: "ship-action:difficulty", value: 0 },
		]);
		expect(prepared?.kindData).toMatchObject({
			crewFallback: true,
			shipMod: 30,
			combinedTarget: 80,
		});
	});

	it("helmsman: the owned Pilot (Space Craft) item wins (decision 10)", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([shipActionItem]),
			itemId: "sa1",
			performer: fixtureActor([pilotSpec]) as never,
		} as never);
		// Ag 35 + one +10 ladder step = 45; +30 Manoeuvrability → 75 combined.
		expect(prepared).toMatchObject({
			baseTarget: 45,
			testKind: "skill",
			testKey: "ag",
		});
		expect(prepared?.context.skillName).toBe("pilot (space craft)");
		expect(prepared?.kindData).toMatchObject({
			crewFallback: false,
			combinedTarget: 75,
		});
		const rows = prepared?.initialModifiers as Array<{
			id?: string;
			value: number;
		}>;
		// No penalty row on the specialised path.
		expect(
			rows.some((mod) => mod.id === "ship:untrained-specialisation"),
		).toBe(false);
	});

	it("helmsman: trained bare Pilot stands in with the VISIBLE p75 -10 row", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([shipActionItem]),
			itemId: "sa1",
			performer: fixtureActor([pilotBare]) as never,
		} as never);
		expect(prepared?.baseTarget).toBe(45);
		const rows = prepared?.initialModifiers as Array<{
			id?: string;
			value: number;
		}>;
		// BOTH rows visible: the ship ability and the untrained specialisation.
		expect(
			rows.find((mod) => mod.id === "ship:manoeuvrability"),
		).toMatchObject({ value: 30 });
		expect(
			rows.find((mod) => mod.id === "ship:untrained-specialisation"),
		).toMatchObject({ value: -10 });
	});

	it("refuses an unresolvable performer LOUDLY", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([shipActionItem]),
			itemId: "sa1",
			performer: fixtureActor([]) as never,
		} as never);
		expect(prepared).toBeNull();
		expect(
			warnings.some((w) => w.includes("SHIP_ACTION.PERFORMER_UNRESOLVED")),
		).toBe(true);
	});

	it("refuses an unknown printed test key LOUDLY", async () => {
		resetSpies();
		const broken = {
			...shipActionItem,
			system: {
				...shipActionItem.system,
				roll: { test: "charm+love", difficulty: "" },
			},
		};
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([broken]),
			itemId: "sa1",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings.some((w) => w.includes("SHIP_ACTION.UNKNOWN_TEST"))).toBe(
			true,
		);
	});

	it("refuses an unknown item id", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([]),
			itemId: "missing",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings).toContain("ROLL.UNKNOWN_ITEM");
	});

	it("refuses a difficulty token with no printed value (a broken pack row)", async () => {
		resetSpies();
		const broken = {
			...shipActionItem,
			system: {
				...shipActionItem.system,
				// The actionDifficulty ladder maps "(+/-N)" parenthesised tokens;
				// a bare word with no value resolves to NO machine kind — the
				// loud refusal, never a silently-dropped difficulty.
				roll: { test: "pilot-space-craft", difficulty: "Brutal" },
			},
		};
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([broken]),
			itemId: "sa1",
		} as never);
		expect(prepared).toBeNull();
		expect(
			warnings.some((w) => w.includes("SHIP_ACTION.UNKNOWN_DIFFICULTY")),
		).toBe(true);
	});

	it("rolls as ONE combined target through the pipeline (p212)", async () => {
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
				kind: "ship-action",
				actor: actionShipFixture([shipActionItem]),
				itemId: "sa1",
				skipDialog: true,
			} as never);
		} finally {
			foundry.applications.handlebars.renderTemplate = originalRender;
		}
		// One 1d100 + TWO cards: the inline roll card + the action card.
		expect(rollCalls).toHaveLength(1);
		expect(captured).toHaveLength(2);
		// The inline card's target = the crew-side 50 + the folded rows
		// (Manoeuvrability +30, Challenging +0), asserted RELATIVE to the
		// card's own rows (the funnel.test.ts "Custom" global leak must not
		// flip it in the full suite).
		const analysis = captured[0].analysis as Array<{
			id?: string;
			label: string;
			value: number;
		}>;
		expect(
			analysis.find((m) => m.id === "ship:manoeuvrability"),
		).toMatchObject({ value: 30 });
		const sum = analysis.reduce((total, mod) => total + mod.value, 0);
		expect(captured[0].target).toBe(Math.min(100, Math.max(1, 50 + sum)));
		// The action card carries the p212 combined number + the crew note.
		expect(captured[1].combinedTarget).toBe(80);
		expect(captured[1].crewNote).toBe("SHIP_ACTION.CREW_FALLBACK");
	});

	it("opposed difficulties post the manual-resolution note", async () => {
		resetSpies();
		const item = {
			...shipActionItem,
			system: {
				...shipActionItem.system,
				roll: {
					test: "pilot-space-craft+manoeuvrability",
					difficulty: "Opposed",
				},
			},
		};
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: actionShipFixture([item]),
			itemId: "sa1",
		} as never);
		const rows = prepared?.initialModifiers as Array<{ id?: string }>;
		// No numeric difficulty row for an opposed token; the card note says so.
		expect(
			rows.every((mod) => mod.id !== "ship-action:difficulty"),
		).toBe(true);
		expect(prepared?.kindData).toMatchObject({ difficultyKind: "opposed" });
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

// ===========================================================================
// bead z697 (epic necp S6): Table 8-11 extended-action row handlers
// (Active/Focused Augury, Aid the Machine Spirit, Disinformation, Flank
// Speed, Hail the Enemy, Hit and Run, Hold Fast!, Jam Communications, Lock
// on Target, Prepare to Repel Boarders!, Put Your Backs Into It!, Triage).
// Appended at a distinct end per the file-ownership contract.
// ===========================================================================

const { promptTargetComponent } = await import("../roll-prompts");

/** A Foundry-Collection-shaped items list (iterable + `.get`). */
const itemsCollection = (items: unknown[]) =>
	Object.assign([...items] as unknown[], {
		get: (id: string) =>
			items.find((i) => (i as { id?: string }).id === id) ?? null,
	});

/** A Table 8-11 row item fixture with the pack's machine test key. */
const rowItem = (
	name: string,
	test: string,
	difficulty = "Challenging (+0)",
) => ({
	id: "sa9",
	type: "ship-action",
	name,
	uuid: "Item.sa9",
	system: {
		actionCost: "Strategic Turn",
		roll: { test, difficulty },
		shortDescription: "Row.",
		description: "<p>Row prose.</p>",
	},
});

/** A character fixture that also carries the Strength characteristic
 * (Intimidate tests it — Table 3-1, Core Rulebook p75). */
const characterWithStrength = (items: unknown[] = []) =>
	actorFixture({
		items,
		system: {
			characteristics: {
				ws: { value: 40, unnatural: 1 },
				wp: { value: 45, unnatural: 1 },
				fel: { value: 30, unnatural: 1 },
				per: { value: 30, unnatural: 1 },
				ag: { value: 35, unnatural: 1 },
				s: { value: 40, unnatural: 1 },
			},
		},
	});

/** A starship fixture with the turn-state fields the row handlers read. */
function extendedShip(
	items: unknown[],
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "Sabre",
		type: "starship",
		uuid: "Actor.sabre",
		isOwner: true,
		items: Object.assign([...items] as unknown[], {
			get: (id: string) =>
				items.find((i) => (i as { id?: string }).id === id) ?? null,
		}),
		system: {
			crewQuality: "veteran",
			manoeuvrability: 30,
			detection: 12,
			crewPopulation: 100,
			crewMorale: 90,
			turnFlags: [],
			revealedComponents: [],
			lastTurnLosses: { population: 0, morale: 0 },
			...overrides,
		},
	} as never;
}

/**
 * Temporarily stub DialogV2 (wait/input) for prompt-driven rows; restored
 * after the run (the renderTemplate override pattern above).
 */
async function withDialogStubs(
	stubs: {
		wait?: (opts: Record<string, unknown>) => Promise<unknown>;
		input?: (opts: Record<string, unknown>) => Promise<unknown>;
	},
	run: () => Promise<void>,
): Promise<void> {
	const api = foundry.applications.api as unknown as {
		DialogV2: { wait: unknown; input: unknown };
	};
	const original = { wait: api.DialogV2.wait, input: api.DialogV2.input };
	try {
		if (stubs.wait) api.DialogV2.wait = stubs.wait as never;
		if (stubs.input) api.DialogV2.input = stubs.input as never;
		await run();
	} finally {
		api.DialogV2.wait = original.wait;
		api.DialogV2.input = original.input;
	}
}

/** The row after() effects need the writes + note cards captured. */
function captureEffectPorts(overrides: Partial<Record<string, unknown>> = {}) {
	const updates: Array<Record<string, unknown>> = [];
	const posts: string[] = [];
	const rolled: string[] = [];
	return {
		updates,
		posts,
		rolled,
		ports: {
			...getPorts(),
			...(overrides.dice
				? { dice: overrides.dice }
				: {
						dice: {
							roll: async (formula: string) => {
								rolled.push(formula);
								const total = formula === "1d100" ? 10 : 3;
								return { total, dice: [], terms: [], rolls: [], formula };
							},
						},
					}),
			actors: {
				...getPorts().actors,
				update: async (_doc: unknown, data: Record<string, unknown>) => {
					updates.push(data);
				},
			},
			chat: {
				...getPorts().chat,
				post: async () => ({ id: "msg-1" }),
				postHtml: async (_actor: unknown, content: string) => {
					posts.push(content);
					return { id: "msg-1" };
				},
			},
			...(overrides.targets ? { targets: overrides.targets } : {}),
		} as never,
	};
}

describe("extended-action test-key vocabulary (bead z697)", () => {
	it("parses the Willpower characteristic route (Hold Fast!)", () => {
		expect(parseShipActionTestKey("willpower")).toMatchObject({
			routeKey: "willpower",
		});
	});

	it("parses the Interaction-skill class route (Hail the Enemy)", () => {
		expect(parseShipActionTestKey("interaction-skill")).toMatchObject({
			routeKey: "interaction-skill",
		});
	});
});

describe("extended rows: Hold Fast! (bead z697, printed p218)", () => {
	const holdFast = rowItem("Hold Fast!", "willpower");
	const airOfAuthority = {
		id: "t1",
		type: "talent",
		name: "Air of Authority",
	};

	it("refuses without an assigned Explorer (the crew cannot take Willpower)", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: extendedShip([holdFast]),
			itemId: "sa9",
		} as never);
		expect(prepared).toBeNull();
		expect(
			warnings.some((w) => w.includes("SHIP_ACTION.ROW_REQUIRES_PERFORMER")),
		).toBe(true);
	});

	it("refuses loudly without the Air of Authority talent", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: extendedShip([holdFast]),
			itemId: "sa9",
			performer: fixtureActor([]) as never,
		} as never);
		expect(prepared).toBeNull();
		expect(
			warnings.some((w) => w.includes("SHIP_ACTION.HOLD_FAST_AUTHORITY")),
		).toBe(true);
	});

	it("resolves a Willpower CHARACTERISTIC test on the performer (no ship rows)", async () => {
		resetSpies();
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: extendedShip([holdFast]),
			itemId: "sa9",
			performer: fixtureActor([airOfAuthority]) as never,
		} as never);
		// wp 45 (actorFixture) — a characteristic test, not a skill item.
		expect(prepared).toMatchObject({
			baseTarget: 45,
			testKind: "characteristic",
			testKey: "wp",
		});
		const rows = prepared?.initialModifiers as Array<{ id?: string }>;
		expect(rows.every((mod) => mod.id !== "ship:manoeuvrability")).toBe(true);
	});

	it("cancels 1 + 1 per degree from the PREVIOUS turn's morale losses", async () => {
		resetSpies();
		const ship = extendedShip([holdFast], {
			crewMorale: 90,
			lastTurnLosses: { population: 0, morale: 5 },
		});
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
			performer: fixtureActor([airOfAuthority]) as never,
		} as never);
		const { updates, posts, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			// 3 degrees → cancel 4 of the previous turn's 5.
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 3, roll: 10 } as never,
				"",
				{ target: 45, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		expect(updates).toEqual([{ system: { crewMorale: 94 } }]); // 90 + 4
		expect(posts.join(" ")).toContain("SHIP_ACTION.HOLD_FAST_NOTE");
	});

	it("clamps to the damage lastTurnLosses actually records", async () => {
		resetSpies();
		const ship = extendedShip([holdFast], {
			crewMorale: 90,
			lastTurnLosses: { population: 0, morale: 1 },
		});
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
			performer: fixtureActor([airOfAuthority]) as never,
		} as never);
		const { updates, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 4, roll: 10 } as never,
				"",
				{ target: 45, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		// Minimum-1 cancellation, clamped to the recorded 1 — never 5.
		expect(updates).toEqual([{ system: { crewMorale: 91 } }]);
	});

	it("cancels nothing when the previous turn took no morale damage", async () => {
		resetSpies();
		const ship = extendedShip([holdFast], {
			crewMorale: 90,
			lastTurnLosses: { population: 3, morale: 0 },
		});
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
			performer: fixtureActor([airOfAuthority]) as never,
		} as never);
		const { updates, posts, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 2, roll: 10 } as never,
				"",
				{ target: 45, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		expect(updates).toEqual([]);
		expect(posts.join(" ")).toContain("SHIP_ACTION.HOLD_FAST_NONE");
	});
});

describe("extended rows: Triage (bead z697, printed p218)", () => {
	const triage = rowItem("Triage", "medicae", "Difficult (–10)");

	const triageAfter = async (
		degrees: number,
		losses: { population: number; morale: number },
	) => {
		const ship = extendedShip([triage], {
			crewPopulation: 88,
			lastTurnLosses: losses,
		});
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { updates, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees, roll: 10 } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		return updates;
	};

	it("cancels 1 + 1 per degree from the previous turn's population losses", async () => {
		resetSpies();
		// 2 degrees → cancel 3 of the previous turn's 5 (no performer: crew
		// quality substitutes, as for every non-prompted row).
		expect(await triageAfter(2, { population: 5, morale: 10 })).toEqual([
			{ system: { crewPopulation: 91 } },
		]);
	});

	it("clamps to the previous turn's recorded damage", async () => {
		resetSpies();
		expect(await triageAfter(5, { population: 2, morale: 0 })).toEqual([
			{ system: { crewPopulation: 90 } }, // 2 cancelled, not 6
		]);
	});
});

describe("extended rows: Prepare to Repel Boarders! (bead z697, printed p218)", () => {
	const repel = rowItem("Prepare to Repel Boarders!", "command");

	it("writes the PERSISTENT +10 (+5 per degree) repel-boarders flag", async () => {
		resetSpies();
		const ship = extendedShip([repel]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { updates, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 2, roll: 10 } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		// p218: +10 on success, +5 per degree of success → 20, PERSISTENT.
		expect(updates).toHaveLength(1);
		const flags = (
			updates[0] as {
				system: {
					turnFlags: Array<{
						key: string;
						value: number;
						persistent: boolean;
						expiresAtTurn: number | null;
					}>;
				};
			}
		).system.turnFlags;
		expect(flags).toEqual([
			{
				id: "repel-boarders",
				key: "repel-boarders",
				value: 20,
				target: "all",
				expiresAtTurn: null,
				persistent: true,
			},
		]);
	});
});

describe("extended rows: the augury pair (bead z697, printed pp216-217)", () => {
	const activeAugury = rowItem("Active Augury", "scrutiny+detection");
	const focusedAugury = rowItem("Focused Augury", "scrutiny+detection");

	const auguryTarget = () => ({
		name: "Dauntless",
		system: {},
		items: itemsCollection([
			{
				id: "c1",
				name: "Plasma Drives",
				type: "ship-component",
				system: {
					category: "essential",
					componentType: "plasma-drive",
					state: "intact",
				},
			},
			{
				id: "c2",
				name: "Void Shield Array",
				type: "ship-component",
				system: {
					category: "essential",
					componentType: "void-shield",
					state: "intact",
				},
			},
			{
				id: "c3",
				name: "Augur Array",
				type: "ship-component",
				system: {
					category: "essential",
					componentType: "augur-array",
					state: "intact",
				},
			},
			{
				id: "c4",
				name: "Sunstorm Lance Battery",
				type: "ship-weapon-component",
				system: {
					category: "supplemental",
					componentType: "lance",
					state: "intact",
				},
			},
			{
				id: "c5",
				name: "Main Cargo Hold",
				type: "ship-component",
				system: {
					category: "supplemental",
					componentType: "supplemental",
					state: "intact",
				},
			},
		]),
	});

	const focusedRun = async (degrees: number) => {
		resetSpies();
		const ship = extendedShip([focusedAugury]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { updates, ports } = captureEffectPorts({
			targets: { ...getPorts().targets, actor: auguryTarget },
		});
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees, roll: 10 } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		return (updates[0] as { system: { revealedComponents: string[] } }).system
			.revealedComponents;
	};

	it("Focused Augury degree 1: essentials-minus-auger/shields + weapons", async () => {
		expect(await focusedRun(1)).toEqual(["c1", "c4"]);
	});

	it("Focused Augury degree 2 adds auger + shields", async () => {
		expect(await focusedRun(2)).toEqual(["c1", "c2", "c3", "c4"]);
	});

	it("Focused Augury degree 3 is everything", async () => {
		expect(await focusedRun(3)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
	});

	it("Active Augury flags Silent Running within the scan (degree range note)", async () => {
		resetSpies();
		const ship = extendedShip([activeAugury]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { posts, ports } = captureEffectPorts({
			targets: {
				...getPorts().targets,
				actor: () => ({ name: "Silent Ship", system: { silentRunning: true } }),
			},
		});
		setPorts(ports);
		try {
			// 2 degrees of success — the range note is the p216 formula.
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 2, roll: 10 } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		const html = posts.join(" ");
		expect(html).toContain("SHIP_ACTION.AUGURY_RANGE_NOTE");
		expect(html).toContain("SHIP_ACTION.AUGURY_SILENT_DETECTED");
	});

	it("Active Augury posts no detection note without a silent target", async () => {
		resetSpies();
		const ship = extendedShip([activeAugury]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { posts, ports } = captureEffectPorts({
			targets: {
				...getPorts().targets,
				actor: () => ({ name: "Loud Ship", system: {} }),
			},
		});
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: true, degrees: 0, roll: 10 } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		const html = posts.join(" ");
		expect(html).toContain("SHIP_ACTION.AUGURY_RANGE_NOTE");
		expect(html).not.toContain("SHIP_ACTION.AUGURY_SILENT_DETECTED");
	});
});

describe("extended rows: the prompt-routed skill rows (bead z697)", () => {
	const hail = rowItem("Hail the Enemy", "interaction-skill", "");
	const disinfo = rowItem("Disinformation", "deceive", "Difficult (–10)");
	const trainCharm = {
		id: "ch1",
		type: "skill",
		name: "Charm",
		system: { characteristic: "fel", ladder: 2 },
	};
	const trainBlather = {
		id: "bl1",
		type: "skill",
		name: "Blather",
		system: { characteristic: "fel", ladder: 2 },
	};
	const trainIntimidate = {
		id: "in1",
		type: "skill",
		name: "Intimidate",
		system: { characteristic: "s", ladder: 1 },
	};

	it("Hail the Enemy delegates to the CHARACTER's owned skill (no ship rows)", async () => {
		resetSpies();
		// Charm is the only candidate (owned; the other four unowned: Blather
		// is advanced, Command/Deceive/Intimidate offer untrained attempts too,
		// so this prompt opens) — pick Charm.
		await withDialogStubs(
			{ input: async () => ({ choice: "Charm" }) },
			async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: extendedShip([hail]),
					itemId: "sa9",
					performer: characterWithStrength([trainCharm]) as never,
				} as never);
				// The delegated trained skill: fel 30 + one ladder step = 40.
				expect(prepared).toMatchObject({
					baseTarget: 40,
					testKind: "skill",
					testKey: "fel",
				});
				const rows = prepared?.initialModifiers as Array<{ id?: string }>;
				// Hail the Enemy rides NO ship ability and no difficulty row.
				expect(rows.every((mod) => !mod.id?.startsWith("ship:"))).toBe(true);
			},
		);
	});

	it("an unowned interaction skill is attempted UNTRAINED at half characteristic (p74)", async () => {
		resetSpies();
		await withDialogStubs(
			{ input: async () => ({ choice: "Command" }) },
			async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: extendedShip([hail]),
					itemId: "sa9",
					performer: characterWithStrength([]) as never,
				} as never);
				// fel 30 untrained → 15 (half, round down).
				expect(prepared).toMatchObject({ baseTarget: 15 });
				expect(warnings).toEqual([]);
			},
		);
	});

	it("an untrained Intimidate resolves to STRENGTH, not Fellowship (bead tueu)", async () => {
		resetSpies();
		await withDialogStubs(
			{ input: async () => ({ choice: "Intimidate" }) },
			async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: extendedShip([hail]),
					itemId: "sa9",
					performer: characterWithStrength([]) as never,
				} as never);
				// Intimidate's printed characteristic is Strength (Table 3-1,
				// Core Rulebook p81): s 40 untrained → 20 (half), testKey
				// `untrained:s` — NOT the fel 15 the old fallback gave.
				expect(prepared).toMatchObject({
					baseTarget: 20,
					testKey: "untrained:s",
				});
				expect(warnings).toEqual([]);
			},
		);
	});

	it("Disinformation: the printed 'or Blather' alternative routes by prompt", async () => {
		resetSpies();
		await withDialogStubs(
			{ input: async () => ({ choice: "Blather" }) },
			async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: extendedShip([disinfo]),
					itemId: "sa9",
					performer: characterWithStrength([trainBlather]) as never,
				} as never);
				expect(prepared).toMatchObject({
					// The prompt-CHOSEN trained Blather (fel 30 + ladder 10).
					baseTarget: 40,
					testKind: "skill",
					testKey: "fel",
				});
			},
		);
	});

	it("Disinformation posts the MANUAL morale note on success", async () => {
		resetSpies();
		const ship = extendedShip([disinfo]);
		const { posts, ports } = captureEffectPorts();
		setPorts(ports);
		let prepared = null;
		try {
			await withDialogStubs(
				{ input: async () => ({ choice: "Blather" }) },
				async () => {
					prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: ship,
						itemId: "sa9",
						performer: characterWithStrength([trainBlather]) as never,
					} as never);
					await shipActionHandler.after?.(
						{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
						prepared as never,
						{ success: true, degrees: 2, roll: 10 } as never,
						"",
						{ target: 40, modifiers: [] },
					);
				},
			);
		} finally {
			resetPorts();
		}
		// Manual book call (bead z697): nothing auto-writes the Morale track —
		// the card carries the printed rule as a loud note instead.
		expect(posts.join(" ")).toContain("SHIP_ACTION.DISINFORMATION_NOTE");
	});

	it("Hail the Enemy notes the book's GM discretion (any outcome)", async () => {
		resetSpies();
		const ship = extendedShip([hail]);
		const { posts, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await withDialogStubs(
				{ input: async () => ({ choice: "Charm" }) },
				async () => {
					const prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: ship,
						itemId: "sa9",
						performer: characterWithStrength([trainCharm]) as never,
					} as never);
					await shipActionHandler.after?.(
						{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
						prepared as never,
						{ success: false, degrees: 0, roll: 90 } as never,
						"",
						{ target: 40, modifiers: [] },
					);
				},
			);
		} finally {
			resetPorts();
		}
		expect(posts.join(" ")).toContain("SHIP_ACTION.HAIL_NOTE");
	});

	it("Put Your Backs Into It! writes +5 per chosen target (+1 per 3 degrees)", async () => {
		resetSpies();
		const weapon = {
			id: "w9",
			type: "ship-weapon-component",
			name: "Prow Sunstorm Lance",
			system: {
				category: "supplemental",
				componentType: "lance",
				state: "intact",
			},
		};
		const backs = rowItem("Put Your Backs Into It!", "intimidate");
		const ship = extendedShip([backs, weapon]);
		const { updates, posts, ports } = captureEffectPorts();
		setPorts(ports);
		let pick = 0;
		try {
			await withDialogStubs(
				{
					// Prompt 1-3: the either-skill prompt (Intimidate trained),
					// then per-degree picks (bs → its weapon prompt, repairs).
					input: async () => {
						pick += 1;
						if (pick === 1) return { choice: "Intimidate" };
						if (pick === 2) return { choice: "bs" };
						if (pick === 3) return { choice: "w9" };
						return { choice: "emergency-repairs" };
					},
				},
				async () => {
					const prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: ship,
						itemId: "sa9",
						performer: characterWithStrength([trainIntimidate]) as never,
					} as never);
					// Intimidate owned: s 40 + ladder 0 = 40, testKey s.
					expect(prepared).toMatchObject({ baseTarget: 40, testKey: "s" });
					// 3 degrees → 1 + floor(3/3) = 2 aided actions.
					await shipActionHandler.after?.(
						{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
						prepared as never,
						{ success: true, degrees: 3, roll: 10 } as never,
						"",
						{ target: 40, modifiers: [] },
					);
				},
			);
		} finally {
			resetPorts();
		}
		// Each upsert writes the FULL flag array; the LAST write carries both.
		const flags = (
			updates.at(-1) as {
				system: {
					turnFlags: Array<{
						id: string;
						key: string;
						value: number;
						target: string;
						persistent: boolean;
					}>;
				};
			}
		).system.turnFlags;
		expect(flags).toEqual([
			{
				id: "backs-into-it:w9",
				key: "backs-into-it",
				value: 5,
				target: "w9",
				expiresAtTurn: null,
				persistent: false,
			},
			{
				id: "backs-into-it:emergency-repairs",
				key: "backs-into-it",
				value: 5,
				target: "emergency-repairs",
				expiresAtTurn: null,
				persistent: false,
			},
		]);
		expect(posts.join(" ")).toContain("SHIP_ACTION.BACKS_NOTE");
	});
});

describe("extended rows: Flank Speed + Lock on Target (bead z697, printed p217-218)", () => {
	const flank = rowItem("Flank Speed", "tech-use");
	const lock = rowItem("Lock on Target", "scrutiny+detection");

	const runRowAfter = async (
		row: { name?: string },
		outcome: { success: boolean; degrees: number; roll: number },
		dialogs?: {
			wait?: (opts: Record<string, unknown>) => Promise<unknown>;
			input?: (opts: Record<string, unknown>) => Promise<unknown>;
		},
	) => {
		const ship = extendedShip([row]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { posts, ports, rolled } = captureEffectPorts();
		setPorts(ports);
		try {
			if (dialogs) {
				await withDialogStubs(dialogs, async () => {
					await shipActionHandler.after?.(
						{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
						prepared as never,
						outcome as never,
						"",
						{ target: 50, modifiers: [] },
					);
				});
			} else {
				await shipActionHandler.after?.(
					{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
					prepared as never,
					outcome as never,
					"",
					{ target: 50, modifiers: [] },
				);
			}
		} finally {
			resetPorts();
		}
		return { posts, rolled };
	};

	it("Flank Speed success notes the +1 VU per degree movement", async () => {
		resetSpies();
		const { posts } = await runRowAfter(flank, {
			success: true,
			degrees: 2,
			roll: 10,
		});
		expect(posts.join(" ")).toContain("SHIP_ACTION.FLANK_SPEED_NOTE");
	});

	it("Flank Speed hard-fail (2+ degrees of failure) posts the Engines Crippled (6) critical", async () => {
		resetSpies();
		const { posts } = await runRowAfter(
			flank,
			// roll 85 vs target 50 → floor(35/10)+1 = 4 degrees of failure.
			{ success: false, degrees: 0, roll: 85 },
		);
		const html = posts.join(" ");
		expect(html).toContain("SHIP_ACTION.FLANK_SPEED_CRIPPLED");
	});

	it("Flank Speed failing by 1 degree: no cripple, no note", async () => {
		resetSpies();
		const { posts } = await runRowAfter(flank, {
			success: false,
			degrees: 0,
			roll: 55, // 1 degree of failure
		});
		expect(posts).toEqual([]);
	});

	it("Lock on Target writes the flag naming ONE weapon component (+5, +5 per 2 degrees)", async () => {
		resetSpies();
		const weapon = {
			id: "w9",
			type: "ship-weapon-component",
			name: "Prow Sunstorm Lance",
			system: {
				category: "supplemental",
				componentType: "lance",
				state: "intact",
			},
		};
		const ship = extendedShip([lock, weapon]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { updates, posts, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await withDialogStubs(
				{ input: async () => ({ choice: "w9" }) },
				async () => {
					// 2 degrees → 5 + 5 = 10.
					await shipActionHandler.after?.(
						{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
						prepared as never,
						{ success: true, degrees: 2, roll: 10 } as never,
						"",
						{ target: 50, modifiers: [] },
					);
				},
			);
		} finally {
			resetPorts();
		}
		const flags = (
			updates[0] as {
				system: {
					turnFlags: Array<{
						id: string;
						key: string;
						value: number;
						target: string;
						persistent: boolean;
					}>;
				};
			}
		).system.turnFlags;
		expect(flags).toEqual([
			{
				id: "lock-on-target:w9",
				key: "lock-on-target",
				value: 10,
				target: "w9",
				expiresAtTurn: null,
				persistent: false,
			},
		]);
		expect(posts.join(" ")).toContain("SHIP_ACTION.LOCK_ON_TARGET_NOTE");
	});
});

describe("extended rows: Hit and Run (bead z697, printed p218)", () => {
	const hitAndRun = rowItem("Hit and Run", "pilot-space-craft");
	const enemyShip = () => ({
		name: "Ork Freighter",
		system: {
			turretRating: 2,
			hullIntegrity: { value: 33, max: 33 },
			crewPopulation: 100,
			crewMorale: 80,
		},
		items: itemsCollection([
			{
				id: "e1",
				name: "Ork Drive Tubes",
				type: "ship-component",
				system: {
					category: "essential",
					componentType: "plasma-drive",
					state: "intact",
				},
			},
		]),
	});

	it("rides the target's Turret Rating as a VISIBLE −10/point row", async () => {
		resetSpies();
		setPorts({
			...getPorts(),
			targets: { ...getPorts().targets, actor: enemyShip },
		} as never);
		try {
			const prepared = await shipActionHandler.prepare({
				kind: "ship-action",
				actor: extendedShip([hitAndRun]),
				itemId: "sa9",
			} as never);
			expect(prepared).toMatchObject({
				baseTarget: 50,
				testKind: "characteristic",
			});
			const rows = prepared?.initialModifiers as Array<{
				id?: string;
				value: number;
			}>;
			expect(
				rows.find((mod) => mod.id === "ship-action:turret-rating"),
			).toMatchObject({ value: -20 });
		} finally {
			resetPorts();
		}
	});

	const runFailure = async (roll: number) => {
		const ship = extendedShip([hitAndRun]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { posts, ports } = captureEffectPorts();
		setPorts(ports);
		try {
			await shipActionHandler.after?.(
				{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
				prepared as never,
				{ success: false, degrees: 0, roll } as never,
				"",
				{ target: 50, modifiers: [] },
			);
		} finally {
			resetPorts();
		}
		return posts;
	};

	it("failure by 4+ degrees: the craft is shot down (card note)", async () => {
		resetSpies();
		const html = (await runFailure(85)).join(" "); // 4 degrees of failure
		expect(html).toContain("SHIP_ACTION.MANUAL_RANGE_HIT_RUN");
		expect(html).toContain("SHIP_ACTION.HIT_RUN_SHOT_DOWN");
		expect(html).not.toContain("SHIP_ACTION.HIT_RUN_RETURN");
	});

	it("a milder failure: forced to return", async () => {
		resetSpies();
		const html = (await runFailure(55)).join(" "); // 1 degree of failure
		expect(html).toContain("SHIP_ACTION.HIT_RUN_RETURN");
		expect(html).not.toContain("SHIP_ACTION.HIT_RUN_SHOT_DOWN");
	});

	const runManualWin = async (
		dialogs: {
			wait?: (opts: Record<string, unknown>) => Promise<unknown>;
			input?: (opts: Record<string, unknown>) => Promise<unknown>;
		},
		withTarget = true,
	) => {
		const ship = extendedShip([hitAndRun]);
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: ship,
			itemId: "sa9",
		} as never);
		const { posts, ports, rolled, updates } = captureEffectPorts(
			withTarget
				? { targets: { ...getPorts().targets, actor: enemyShip } as never }
				: {},
		);
		setPorts(ports);
		try {
			await withDialogStubs(dialogs, async () => {
				await shipActionHandler.after?.(
					{ kind: "ship-action", actor: ship, itemId: "sa9" } as never,
					prepared as never,
					{ success: true, degrees: 1, roll: 10 } as never,
					"",
					{ target: 50, modifiers: [] },
				);
			});
		} finally {
			resetPorts();
		}
		return { posts, rolled, updates };
	};

	it("a manual win: 1d5 twice on the critical chart, pick one, HI/degree applied", async () => {
		resetSpies();
		const { posts, rolled, updates } = await runManualWin({
			// The manual opposed Command: WON.
			wait: async () => "won",
			input: async (opts: Record<string, unknown>) => {
				const content = typeof opts.content === "string" ? opts.content : "";
				// The degrees prompt, the component pick (name="component"), then
				// the critical pick-one.
				if (content.includes('name="degrees"')) return { degrees: "2" };
				if (content.includes('name="component"')) return { component: "e1" };
				return { choice: "3 — Fire!" };
			},
		});
		// Two 1d5 chart rolls.
		expect(rolled.filter((formula) => formula === "1d5")).toHaveLength(2);
		// HI −2 (the manual win's degrees) and the crew loss follows (p221).
		const shipUpdate = updates.filter(
			(update) =>
				(update as { system: { hullIntegrity?: unknown } }).system
					?.hullIntegrity !== undefined,
		)[0] as {
			system: {
				hullIntegrity: { value: number };
				crewPopulation: number;
				crewMorale: number;
			};
		};
		expect(shipUpdate).toMatchObject({
			system: {
				hullIntegrity: { value: 31 },
				crewPopulation: 98,
				crewMorale: 78,
			},
		});
		// The picked critical damaged a component — the raiders are ABOARD, so
		// this pick is NOT reveal-gated (decision 11 gates ship.ts's ranged
		// critical path only).
		expect(
			updates.some(
				(update) =>
					(update as { system: { state?: string } }).system?.state ===
					"damaged",
			),
		).toBe(true);
		const html = posts.join(" ");
		expect(html).toContain("SHIP_ACTION.HIT_RUN_CRIT_PICK");
		expect(html).toContain("SHIP_ACTION.HIT_RUN_APPLIED");
	});

	it("a manual loss (or cancel): the raid retreats, no writes", async () => {
		resetSpies();
		const { posts, updates } = await runManualWin({
			wait: async () => "failed",
		});
		expect(updates).toEqual([]);
		expect(posts.join(" ")).toContain("SHIP_ACTION.HIT_RUN_RAID_LOST");
	});
});

describe("decision 11: promptTargetComponent reveal gating (bead z697)", () => {
	const gatedTarget = (revealed: string[]) => ({
		name: "Dauntless",
		system: { revealedComponents: revealed },
		items: itemsCollection([
			{
				id: "r1",
				name: "Revealed Drives",
				type: "ship-component",
				system: { state: "intact" },
			},
			{
				id: "r2",
				name: "Hidden Bridge",
				type: "ship-component",
				system: { state: "intact" },
			},
		]),
	});

	it("lists ONLY revealed components (un-revealed picks refused)", async () => {
		resetSpies();
		const captured: string[] = [];
		await withDialogStubs(
			{
				input: async (opts: { content?: string }) => {
					captured.push(opts.content ?? "");
					return { component: "r1" };
				},
			},
			async () => {
				const component = await promptTargetComponent(gatedTarget(["r1"]), {
					revealGated: true,
				});
				expect(component).toMatchObject({ id: "r1" });
			},
		);
		expect(captured[0]).toContain("Revealed Drives");
		expect(captured[0]).not.toContain("Hidden Bridge");
	});

	it("nothing revealed: the prompt refuses loudly and opens nothing", async () => {
		resetSpies();
		let prompted = false;
		await withDialogStubs(
			{
				input: async () => {
					prompted = true;
					return { component: "r1" };
				},
			},
			async () => {
				const component = await promptTargetComponent(gatedTarget([]), {
					revealGated: true,
				});
				expect(component).toBeNull();
			},
		);
		expect(prompted).toBe(false);
		expect(
			warnings.some((w) => w.includes("SHIP_COMBAT.COMPONENTS_NOT_REVEALED")),
		).toBe(true);
	});

	it("ungated prompts (own-ship/aboard knowledge) list all installed components", async () => {
		resetSpies();
		const captured: string[] = [];
		await withDialogStubs(
			{
				input: async (opts: { content?: string }) => {
					captured.push(opts.content ?? "");
					return { component: "r2" };
				},
			},
			async () => {
				const component = await promptTargetComponent(gatedTarget([]));
				expect(component).toMatchObject({ id: "r2" });
			},
		);
		expect(captured[0]).toContain("Hidden Bridge");
	});
});

// --- Boarding-machinery rows (epic necp bead w98s, Core Rulebook p215) ----

const { boardingRowHandlers } = await import("./ship-boarding");

/** A machinery-row item fixture: the canonical name carries the routing. */
const boardingItem = (
	id: string,
	name: string,
	overrides: Record<string, unknown> = {},
) => ({
	id,
	type: "ship-action",
	name,
	uuid: `Item.${id}`,
	system: {
		actionCost: "Manoeuvre + Shooting",
		roll: {
			test: "pilot-space-craft+manoeuvrability",
			difficulty: "Hard (–20)",
		},
		shortDescription: "Boarding machinery.",
		description: "<p>Book prose.</p>",
		...overrides,
	},
});

const rammingItem = boardingItem("ram1", "Ramming");
/** A LOCKED ship fixture (boardedWith pair state per S2). */
function boardedShipFixture(
	items: unknown[],
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "Sabre",
		type: "starship",
		uuid: "Actor.sabre",
		items: Object.assign([...items], {
			get: (id: string) => items.find((i) => (i as { id?: string }).id === id),
		}),
		system: {
			crewQuality: "veteran",
			manoeuvrability: 30,
			detection: 12,
			hullClass: "frigate",
			armour: 16,
			voidShields: 2,
			hullIntegrity: { value: 33, max: 33 },
			crewPopulation: 100,
			crewMorale: 100,
			turretRating: 1,
			boardedWith: { uuid: "", breakFreeFailedThisTurn: false },
			...overrides,
		},
	} as never;
}
/** The boarding/ramming target fixture. */
const boardingTarget = {
	name: "Dauntless",
	type: "starship",
	uuid: "Actor.dauntless",
	system: {
		hullClass: "frigate",
		armour: 18,
		voidShields: 2,
		hullIntegrity: { value: 33, max: 33 },
		crewPopulation: 100,
		crewMorale: 100,
		turretRating: 1,
		boardedWith: { uuid: "", breakFreeFailedThisTurn: false },
	},
};

/** Dialog queue stubs: `DialogV2.input` answers in order (then nulls), so
 * does `DialogV2.wait`'s button callbacks. */
async function withDialogs(
	inputs: Array<Record<string, string>>,
	waits: Array<string | null>,
	run: () => Promise<void>,
): Promise<void> {
	const globalFoundry = (globalThis as Record<string, unknown>).foundry as {
		applications: { api: { DialogV2: unknown } };
	};
	const original = globalFoundry.applications.api.DialogV2 as {
		input: unknown;
		wait: unknown;
	};
	let inputIndex = 0;
	let waitIndex = 0;
	// REPLACE the global (a clone) instead of mutating the shared stub object:
	// the queues stay per-call and the restore puts the original back.
	globalFoundry.applications.api.DialogV2 = {
		...original,
		input: (async () => inputs[inputIndex++] ?? null) as unknown,
		wait: (async () => waits[waitIndex++] ?? null) as unknown,
	} as typeof original;
	try {
		await run();
	} finally {
		globalFoundry.applications.api.DialogV2 = original;
	}
}

/** A per-formula dice fake for the boarding machinery's mixed rolls. */
function boardingDice(byFormula: Record<string, number>) {
	const Rolled: string[] = [];
	return {
		Rolled,
		roll: async (formula: string) => {
			Rolled.push(formula);
			return {
				total: byFormula[formula] ?? 0,
				dice: [],
				terms: [],
				rolls: [],
				formula,
			};
		},
	};
}

interface BoardingDiceFake {
	Rolled?: string[];
	roll: (formula: string) => Promise<{
		total: number;
		dice: never[];
		terms: never[];
		rolls: never[];
		formula: string;
	}>;
}

/** Wire the fake ports for a row's after() outcome machinery; returns the
 * captured updates + card vars, restoring the ports in the finally. */
async function withRowPorts(
	dice: BoardingDiceFake,
	run: () => Promise<void>,
	target: unknown = boardingTarget,
): Promise<{
	updates: Record<string, unknown>[];
	cards: Array<Record<string, unknown>>;
}> {
	resetSpies();
	const updates: Array<Record<string, unknown>> = [];
	const cards: Array<Record<string, unknown>> = [];
	setPorts({
		...getPorts(),
		dice,
		actors: {
			...getPorts().actors,
			update: async (_doc: unknown, data: Record<string, unknown>) => {
				updates.push(data);
			},
		},
		targets: {
			...getPorts().targets,
			actor: () => target,
		},
		chat: {
			...getPorts().chat,
			post: async (
				_actor: unknown,
				template: string,
				vars: Record<string, unknown>,
			) => {
				cards.push({ template, ...vars });
				return { id: "msg-1" };
			},
		},
	} as never);
	try {
		await run();
	} finally {
		resetPorts();
	}
	return { updates, cards };
}

/** Point the target port at the boarding target for the duration of run. */
async function withTarget(run: () => Promise<void>): Promise<void> {
	setPorts({
		...getPorts(),
		targets: {
			...getPorts().targets,
			actor: () => boardingTarget,
		},
	} as never);
	try {
		await run();
	} finally {
		resetPorts();
	}
}

describe("boarding rows: ramming (bead w98s, Core Rulebook p215)", () => {
	it("prepares the Hard (–20) combined test with the manual distance gate", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			await withTarget(async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: boardedShipFixture([rammingItem]),
					itemId: "ram1",
				} as never);
				// The same combined-test anatomy the standard path builds.
				expect(prepared).toMatchObject({
					baseTarget: 50, // veteran crew fallback
					testKind: "characteristic",
					testKey: "pilot-space-craft",
				});
				expect(prepared?.kindData).toMatchObject({
					combinedTarget: 80,
					crewFallback: true,
				});
			});
		});
	});

	it("refuses the ram when the ship is LOCKED (no manoeuvre actions)", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			const prepared = await shipActionHandler.prepare({
				kind: "ship-action",
				actor: boardedShipFixture([rammingItem], {
					boardedWith: { uuid: "Actor.ork", breakFreeFailedThisTurn: false },
				}),
				itemId: "ram1",
			} as never);
			expect(prepared).toBeNull();
		});
	});

	// Nit 17 (bead tueu, Core Rulebook p218): the −10 Silent Running step is
	// "all related Skill Tests" — the ram/boarding/break-free combined tests
	// carry the SAME visible row the manoeuvre overlay adds.
	it("the ram's combined test carries the visible Silent Running −10 row", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			await withTarget(async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: boardedShipFixture([rammingItem], { silentRunning: true }),
					itemId: "ram1",
				} as never);
				const rows = (prepared?.initialModifiers ?? []) as Array<{
					id?: string;
					value?: number;
				}>;
				expect(rows).toContainEqual(
					expect.objectContaining({ id: "ship:silent-running", value: -10 }),
				);
			});
		});
	});

	it("refuses the ram beyond the book's 1 VU (manual distance entry)", async () => {
		await withDialogs([{ distance: "3" }], [], async () => {
			await withTarget(async () => {
				const prepared = await shipActionHandler.prepare({
					kind: "ship-action",
					actor: boardedShipFixture([rammingItem]),
					itemId: "ram1",
				} as never);
				expect(prepared).toBeNull();
				expect(
					warnings.some((w) => w.includes("SHIP_BOARDING.OUT_OF_RANGE")),
				).toBe(true);
			});
		});
	});

	it("applies BOTH damage applications and bypasses void shields (p215)", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			let prepared: Awaited<ReturnType<typeof shipActionHandler.prepare>> =
				null;
			const { updates, cards } = await withRowPorts(
				boardingDice({ "1d10": 7, "1d5": 3 }),
				async () => {
					prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: boardedShipFixture([rammingItem]),
						itemId: "ram1",
					} as never);
					// Frigate ram die 1d10 -> 7; + prow armour 16 = 23 vs
					// Armour 18.
					await shipActionHandler.after?.(
						{
							kind: "ship-action",
							actor: boardedShipFixture([rammingItem]),
							itemId: "ram1",
						} as never,
						prepared as never,
						{ success: true, roll: 12, degrees: 1, critical: false } as never,
						"msg-1",
					);
				},
			);
			// EXACTLY two rolls: the ram die and the 1d5 backlash — the
			// damage NEVER enters the salvo's void-shield prompt (no extra
			// absorb step; the target's shields are not consulted at all).
			expect(updates).toHaveLength(2);
			// The DEFENDER's payload first (die + rammer armour, armour soaks,
			// shields untouched); Crew follows the p221 1:1 hull loss.
			expect(updates[0]).toEqual({
				system: {
					hullIntegrity: { value: 28 }, // 33 - (23 - 18)
					crewPopulation: 95,
					crewMorale: 95,
				},
			});
			// The RAMMER's payload: defender Armour 18 + 1d5 3 = 21, own
			// Armour 16 absorbs its share.
			expect(updates[1]).toEqual({
				system: {
					hullIntegrity: { value: 28 }, // 33 - (21 - 16)
					crewPopulation: 95,
					crewMorale: 95,
				},
			});
			expect(cards[0]).toMatchObject({
				ramHullDamage: 5,
				backHullDamage: 5,
				success: true,
			});
		});
	});

	it("posts a no-damage card on a failed ram test", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			let prepared: Awaited<ReturnType<typeof shipActionHandler.prepare>> =
				null;
			const { updates, cards } = await withRowPorts(
				boardingDice({}),
				async () => {
					prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: boardedShipFixture([rammingItem]),
						itemId: "ram1",
					} as never);
					await shipActionHandler.after?.(
						{
							kind: "ship-action",
							actor: boardedShipFixture([rammingItem]),
							itemId: "ram1",
						} as never,
						prepared as never,
						{ success: false, roll: 88, degrees: 0, critical: false } as never,
						"msg-1",
					);
				},
			);
			expect(updates).toEqual([]); // no damage on a failed ram
			expect(cards).toHaveLength(1);
		});
	});
});

describe("boarding rows: the lock (bead w98s, Core Rulebook p215)", () => {
	it("writes the boardedWith pair onto BOTH ships on success", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			let prepared: Awaited<ReturnType<typeof shipActionHandler.prepare>> =
				null;
			const { updates, cards } = await withRowPorts(
				boardingDice({}),
				async () => {
					prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: boardedShipFixture([boardingItem("brd1", "Boarding")]),
						itemId: "brd1",
					} as never);
					await shipActionHandler.after?.(
						{
							kind: "ship-action",
							actor: boardedShipFixture([boardingItem("brd1", "Boarding")]),
							itemId: "brd1",
						} as never,
						prepared as never,
						{ success: true, roll: 10, degrees: 1, critical: false } as never,
						"msg-1",
					);
				},
			);
			// BOTH ships hold the pair (each uuid pointing at the other); the
			// lock gate then denies Manoeuvre/Shooting both sides.
			expect(updates).toEqual([
				{
					system: {
						boardedWith: {
							uuid: "Actor.dauntless",
							breakFreeFailedThisTurn: false,
						},
					},
				},
				{
					system: {
						boardedWith: {
							uuid: "Actor.sabre",
							breakFreeFailedThisTurn: false,
						},
					},
				},
			]);
			// The locked card carries the opposed-Command manual reminder with
			// the computed (here zero) bonus rows.
			expect(cards[0]).toMatchObject({
				locked: true,
			});
			expect((cards[0].commandRows as unknown[]).length).toBe(5);
		});
	});

	it("writes NOTHING on a failed lock", async () => {
		await withDialogs([{ distance: "1" }], [], async () => {
			let prepared: Awaited<ReturnType<typeof shipActionHandler.prepare>> =
				null;
			const { updates, cards } = await withRowPorts(
				boardingDice({}),
				async () => {
					prepared = await shipActionHandler.prepare({
						kind: "ship-action",
						actor: boardedShipFixture([boardingItem("brd1", "Boarding")]),
						itemId: "brd1",
					} as never);
					await shipActionHandler.after?.(
						{
							kind: "ship-action",
							actor: boardedShipFixture([boardingItem("brd1", "Boarding")]),
							itemId: "brd1",
						} as never,
						prepared as never,
						{ success: false, roll: 92, degrees: 0, critical: false } as never,
						"msg-1",
					);
				},
			);
			expect(updates).toEqual([]);
			expect(cards[0]).toMatchObject({ locked: false });
		});
	});
});

describe("boarding rows: break-free (bead w98s, Core Rulebook p215)", () => {
	const breakFreeItem2 = boardingItem("bf1", "Break Free");
	const lockedShip = () =>
		boardedShipFixture([breakFreeItem2], {
			boardedWith: { uuid: "Actor.dauntless", breakFreeFailedThisTurn: false },
		});

	it("refuses break-free on a ship that is NOT boarded", async () => {
		await withDialogs([], [], async () => {
			const prepared = await shipActionHandler.prepare({
				kind: "ship-action",
				actor: boardedShipFixture([breakFreeItem2]),
				itemId: "bf1",
			} as never);
			expect(prepared).toBeNull();
			expect(
				warnings.some((w) => w.includes("SHIP_BOARDING.NOT_BOARDED")),
			).toBe(true);
		});
	});

	it("clears the pair on BOTH ships when the test succeeds", async () => {
		await withDialogs([], [], async () => {
			const prepared = await shipActionHandler.prepare({
				kind: "ship-action",
				actor: lockedShip(),
				itemId: "bf1",
			} as never);
			const partner = { name: "Dauntless", uuid: "Actor.dauntless" };
			const utils = (
				(globalThis as Record<string, unknown>).foundry as {
					utils: { fromUuidSync: (uuid: string) => unknown };
				}
			).utils;
			const original = utils.fromUuidSync;
			utils.fromUuidSync = (uuid: string) =>
				uuid === "Actor.dauntless" ? partner : null;
			try {
				const { updates, cards } = await withRowPorts(
					boardingDice({}),
					async () => {
						await shipActionHandler.after?.(
							{
								kind: "ship-action",
								actor: lockedShip(),
								itemId: "bf1",
							} as never,
							prepared as never,
							{ success: true, roll: 10, degrees: 1, critical: false } as never,
							"msg-1",
						);
					},
				);
				// Own state cleared, then the partner's.
				expect(updates).toEqual([
					{
						system: {
							boardedWith: { uuid: "", breakFreeFailedThisTurn: false },
						},
					},
					{
						system: {
							boardedWith: { uuid: "", breakFreeFailedThisTurn: false },
						},
					},
				]);
				expect(cards[0]).toMatchObject({ brokeFree: true, locked: false });
			} finally {
				utils.fromUuidSync = original;
			}
		});
	});

	it("keeps the lock and sets the −20 opposed-Command flag on failure", async () => {
		await withDialogs([], [], async () => {
			const prepared = await shipActionHandler.prepare({
				kind: "ship-action",
				actor: lockedShip(),
				itemId: "bf1",
			} as never);
			const { updates, cards } = await withRowPorts(
				boardingDice({}),
				async () => {
					await shipActionHandler.after?.(
						{
							kind: "ship-action",
							actor: lockedShip(),
							itemId: "bf1",
						} as never,
						prepared as never,
						{ success: false, roll: 95, degrees: 0, critical: false } as never,
						"msg-1",
					);
				},
			);
			// ONE write: only the failed ship's own state (its subsequent
			// opposed Command suffers −20, Core Rulebook p215) — the partner's
			// pair state is untouched.
			expect(updates).toEqual([
				{
					system: {
						boardedWith: {
							uuid: "Actor.dauntless",
							breakFreeFailedThisTurn: true,
						},
					},
				},
			]);
			expect(cards[0]).toMatchObject({ breakFreePenalty: 20, locked: true });
		});
	});
});

describe("boarding rows: the rout roll (bead w98s, Core Rulebook p215)", () => {
	const routItem = boardingItem("rt1", "Rout");

	it("refuses the rout outside a boarding lock (book p215)", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: boardedShipFixture([routItem]),
			itemId: "rt1",
		} as never);
		expect(prepared).toBeNull();
		expect(warnings.some((w) => w.includes("SHIP_BOARDING.NOT_BOARDED"))).toBe(
			true,
		);
	});

	it("prepares a prepare-only roll displaying the current Morale", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: boardedShipFixture([routItem], {
				boardedWith: {
					uuid: "Actor.dauntless",
					breakFreeFailedThisTurn: false,
				},
			}),
			itemId: "rt1",
		} as never);
		expect(prepared?.prepareOnly).toBe(true);
		expect(prepared?.baseTarget).toBe(100);
		expect(prepared?.kindData).toMatchObject({ name: "Rout" });
	});

	it("resolves the manual Command, the per-degree pick, and the rout branch (surrender)", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: boardedShipFixture([routItem], {
				boardedWith: {
					uuid: "Actor.dauntless",
					breakFreeFailedThisTurn: false,
				},
			}),
			itemId: "rt1",
		} as never);
		const loser = {
			...boardingTarget,
			uuid: "Actor.dauntless2",
			system: { ...boardingTarget.system, crewMorale: 60 },
		};
		const { cards } = await withRowPorts(
			boardingDice({ "2d5": 4, "1d100": 90 }),
			async () => {
				await withDialogs(
					[{ degrees: "2" }],
					["ship", "crew", "npc"],
					async () => {
						await boardingRowHandlers.rout.after?.(
							{
								kind: "ship-action",
								actor: boardedShipFixture([routItem], {
									boardedWith: {
										uuid: "Actor.dauntless",
										breakFreeFailedThisTurn: false,
									},
								}),
								itemId: "rt1",
							} as never,
							prepared as never,
							{ success: false, roll: 0, degrees: 0, critical: false } as never,
							"msg-1",
						);
					},
				);
			},
			loser,
		);
		// This ship won by 2 degrees; the crew-damage pick (2 × 1d5 + 1d5)
		// lands on the LOSER, then the loser's rout d100 (90) exceeds its
		// current Morale (56): the NPC branch → SURRENDER card.
		expect(cards[0]).toMatchObject({
			winnerName: "Sabre",
			loserName: "Dauntless",
			degrees: 2,
			populationLoss: 4,
			moraleLoss: 4,
			routRoll: 90,
			routMorale: 56,
			routed: true,
			surrender: true,
		});
	});

	it("posts the explorers' grim-choice card on the explorers' branch", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: boardedShipFixture([routItem], {
				boardedWith: {
					uuid: "Actor.dauntless",
					breakFreeFailedThisTurn: false,
				},
				crewMorale: 60, // the LOSER (this ship) tests at 58 after the pick
			}),
			itemId: "rt1",
		} as never);
		const loser = {
			...boardingTarget,
			uuid: "Actor.dauntless2",
			system: { ...boardingTarget.system, crewMorale: 60 },
		};
		const { cards } = await withRowPorts(
			boardingDice({ "2d5": 4, "1d100": 90 }),
			async () => {
				await withDialogs(
					[{ degrees: "2" }],
					["target", "hull", "explorers"],
					async () => {
						await boardingRowHandlers.rout.after?.(
							{
								kind: "ship-action",
								actor: boardedShipFixture([routItem], {
									boardedWith: {
										uuid: "Actor.dauntless",
										breakFreeFailedThisTurn: false,
									},
									crewMorale: 60,
								}),
								itemId: "rt1",
							} as never,
							prepared as never,
							{ success: false, roll: 0, degrees: 0, critical: false } as never,
							"msg-1",
						);
					},
				);
			},
			loser,
		);
		// The TARGET won by 2 degrees and picked 2 Hull Integrity — which
		// then drags the loser's (this ship's) Crew/Morale 1:1 (p221) — and
		// the LOSER (this ship) routed on 90 vs its CURRENT Morale (58).
		expect(cards[0]).toMatchObject({
			winnerName: "Dauntless",
			loserName: "Sabre",
			degrees: 2,
			hullDamage: 2,
			populationLoss: 2,
			moraleLoss: 2,
			routMorale: 58,
			grimChoice: true,
			surrender: false,
		});
	});

	it("keeps fighting when the rout roll does not exceed current Morale", async () => {
		const prepared = await shipActionHandler.prepare({
			kind: "ship-action",
			actor: boardedShipFixture([routItem], {
				boardedWith: {
					uuid: "Actor.dauntless",
					breakFreeFailedThisTurn: false,
				},
			}),
			itemId: "rt1",
		} as never);
		const loser = {
			...boardingTarget,
			uuid: "Actor.dauntless2",
			system: { ...boardingTarget.system, crewMorale: 60 },
		};
		const { cards } = await withRowPorts(
			boardingDice({ "2d5": 4, "1d100": 30 }),
			async () => {
				await withDialogs([{ degrees: "2" }], ["ship", "crew"], async () => {
					await boardingRowHandlers.rout.after?.(
						{
							kind: "ship-action",
							actor: boardedShipFixture([routItem], {
								boardedWith: {
									uuid: "Actor.dauntless",
									breakFreeFailedThisTurn: false,
								},
							}),
							itemId: "rt1",
						} as never,
						prepared as never,
						{ success: false, roll: 0, degrees: 0, critical: false } as never,
						"msg-1",
					);
				});
			},
			loser,
		);
		// 30 never exceeds the (post-damage) Morale 56: the fight continues,
		// NO branch prompt (the waits list carries exactly the Command + pick).
		expect(cards[0]).toMatchObject({ routed: false });
	});
});

/**
 * Initiative roll action (epic wjpi, bead dt8t).
 *
 * The roll goes through Foundry's DEFAULT CombatTracker: the adapter action
 * (rules/adapter.ts rollInitiativeAction) is a thin wrapper over the core
 * document method Actor#rollInitiative({createCombatants, rerollInitiative,
 * initiativeOptions.formula}) — combat creation/combatant JOINING/turn
 * bookkeeping are all core behaviour (verified against the installed core,
 * v14.366 foundry.mjs), so the unit test pins only OUR wiring:
 *   • the formula (1d10 + the derived initiative bonus) is passed explicitly —
 *     game.system.initiative is unset for RT, so core can't derive it;
 *   • combatant creation + reroll flags;
 *   • the fail-closed gate for non-character systems (no initiativeBonus).
 *
 * The dice convention follows the roll pipeline tests: foundry.dice.Roll is
 * NOT exercised here — core Combatant#getInitiativeRoll consumes the formula
 * string; our contract is the formula STRING reaching the core call.
 *
 * Adapter-level tests via the fake-globals harness (adapter-ammo-consume
 * / roll-pipeline pattern): Foundry globals are stubbed BEFORE the dynamic
 * import. Plus the template/action-map/context-menu source-scan guards.
 */

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
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	utils: { fromUuidSync: () => null },
};

const { rollInitiativeAction } = await import("./adapter");
		const { initiativeFormula, INITIATIVE_FORMULA } = await import(
			"./derived"
		);

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

	/** A faked character-shaped actor recording the core rollInitiative call. */
	function actorFixture(
		bonus: number,
		options: { withModel?: boolean; valueShape?: "getter" | "method" } = {},
	) {
		// Bead jpt3: the live model exposes initiativeBonus as a (getter-valued)
		// NUMBER property; legacy stubs are function-valued. The adapter's gate
		// must accept both. "getter" exercises the number shape.
		const system = options.withModel === false ? { psyker: false } : (
			options.valueShape === "getter"
				? { initiativeBonus: bonus }
				: { initiativeBonus: () => bonus }
		);
		const calls: Array<Record<string, unknown>> = [];
		return {
			system,
			rollInitiative: (opts: Record<string, unknown>) => {
				calls.push(opts);
				return Promise.resolve(null);
			},
			calls,
		};
	}

	describe("initiative formula (bead dt8t)", () => {
		test("the shared shape is the @placeholder form (bead jpt3)", () => {
			expect(INITIATIVE_FORMULA).toBe("1d10 + @initiativeBonus");
		});

		test("1d10 + the derived bonus", () => {
			expect(initiativeFormula(6)).toBe("1d10 + 6");
		});

		test("zero bonus stays a valid formula", () => {
			expect(initiativeFormula(0)).toBe("1d10 + 0");
		});

		// Belt (bead nt34 F4): a NaN model value would interpolate into "1d10
		// + NaN", which core's Roll.create would throw on — degrade to the
		// unmodified roll instead.
		test("a NaN bonus degrades to the unmodified roll, not '1d10 + NaN'", () => {
			expect(initiativeFormula(Number.NaN)).toBe("1d10 + 0");
		});
	});

	describe("rollInitiativeAction wiring (bead dt8t)", () => {
		test("calls the core Actor#rollInitiative with the RT formula and both flags", async () => {
			const actor = actorFixture(6);
			await rollInitiativeAction(actor as never);
			expect(actor.calls).toHaveLength(1);
			expect(actor.calls[0]).toEqual({
				createCombatants: true,
				rerollInitiative: true,
				initiativeOptions: { formula: "1d10 + 6" },
			});
		});

		test("passes each actor's own derived bonus (npc + explorer fixtures)", async () => {
			const low = actorFixture(3);
			const high = actorFixture(9);
			await rollInitiativeAction(low as never);
			await rollInitiativeAction(high as never);
			expect(low.calls[0].initiativeOptions).toEqual({ formula: "1d10 + 3" });
			expect(high.calls[0].initiativeOptions).toEqual({ formula: "1d10 + 9" });
		});

		test("fails closed for a non-character system (no initiativeBonus)", async () => {
			const actor = actorFixture(5, { withModel: false });
			await rollInitiativeAction(actor as never);
			expect(actor.calls).toHaveLength(0);
		});

		// Bead jpt3: the live model exposes the getter as a NUMBER on the
		// system instance (what getRollData() hands core); the adapter must
		// accept that shape, not only function-valued stubs.
		test("accepts a getter-shaped (number-valued) system like the live roll-data face", async () => {
			const actor = actorFixture(6, { valueShape: "getter" });
			await rollInitiativeAction(actor as never);
			expect(actor.calls[0]?.initiativeOptions).toEqual({
				formula: "1d10 + 6",
			});
		});

		test("a NaN getter value degrades to the unmodified roll", async () => {
			const calls: Array<Record<string, unknown>> = [];
			const actor = {
				system: { initiativeBonus: Number.NaN },
				rollInitiative: (opts: Record<string, unknown>) => {
					calls.push(opts);
					return Promise.resolve(null);
				},
			};
			await rollInitiativeAction(actor as never);
			expect(calls[0]?.initiativeOptions).toEqual({ formula: "1d10 + 0" });
		});
	});

// --- Source guards ---------------------------------------------------------

const sheetSource = readFileSync(
	"src/roguetrader/sheet/actor/character-sheet.ts",
	"utf8",
);
const statsTemplate = readFileSync(
	"template/sheet/actor/tabs/stats.hbs",
	"utf8",
);
const hooksSource = readFileSync(
	"src/roguetrader/bootstrap/hooks.ts",
	"utf8",
);
const menusSource = readFileSync(
	"src/roguetrader/presentation/token-menus.ts",
	"utf8",
);

describe("initiative wiring guards (bead dt8t)", () => {
	test("the sheet renders the button with its data-action", () => {
		expect(statsTemplate).toContain('data-action="rollInitiative"');
		expect(statsTemplate).toContain('localize "COMBAT.ROLL_INITIATIVE"');
	});

	test("the sheet maps the data-action to the adapter call", () => {
		expect(sheetSource).toContain(
			"rollInitiative: CharacterSheet.#onRollInitiative",
		);
		expect(sheetSource).toContain("await rollInitiativeAction(this.actor)");
	});

	test(
		"bootstrap registers the token context-menu module",
		() => {
			expect(hooksSource).toContain("registerTokenContextMenus()");
		},
	);

	test("the token menu targets the core Tokens-tab context hook", () => {
		// v14 core: PlaceableTab fires get<Token>PlaceableContextOptions for the
		// Scene-Navigation Tokens tab (the only core token context menu — canvas
		// right-click opens the Token HUD). See token-menus.ts header.
		expect(menusSource).toContain('"getTokenPlaceableContextOptions"');
		expect(menusSource).toContain("rollInitiativeAction");
		// v14 ContextMenuEntry field (creator-menus.test.ts precedent).
		expect(menusSource).toContain("visible: (element) => canRollToken(element)");
		expect(menusSource).not.toMatch(/\bcondition\??\s*:/);
	});

	// Bead nt34 F1: the menu entry must be gated MORE than ownership — the
	// adapter (rules/adapter.ts rollInitiativeAction) only accepts
	// character-shaped systems that carry an initiativeBonus (a getter on the
	// Character model, bead jpt3), so an owned vehicle/starship token must not
	// see a dead entry whose click silently no-ops. Source-scan guard: the
	// visible() gate mirrors the adapter's shape gate.
	test("the token menu gate mirrors the adapter's initiativeBonus shape gate", () => {
		expect(menusSource).toContain(
			'if (!token?.actor?.isOwner) return false;',
		);
		expect(menusSource).toContain(
			'"initiativeBonus" in system',
		);
	});

	// Bead jpt3: the two consumption routes read the ONE canonical formula —
	// the adapter interpolates it with the literal bonus (initiativeFormula is
	// a .replace on the constant) and the tracker reads it from
	// CONFIG.Combat.initiative.formula (set by bootstrap/combat-tracker.ts —
	// pinned over there). Guard here that the sheet path derives from the
	// shared constant, so the routes cannot diverge.
	test("initiativeFormula derives from the shared INITIATIVE_FORMULA", () => {
		const derivedSource = readFileSync(
			"src/roguetrader/rules/derived.ts",
			"utf8",
		);
		expect(derivedSource).toContain('INITIATIVE_FORMULA = "1d10 + @initiativeBonus"');
		expect(derivedSource).toContain(
			'INITIATIVE_FORMULA.replace(\n\t\t"@initiativeBonus",',
		);
	});

	// Bead nt34 F11: the v14 ContextMenuEntry option shape lives in ONE place,
	// consumed by both menu modules (creator-menus' triple-hook registration
	// stays its own deliberate divergence).
	test("the menu option type is shared via context-menu-entry.ts", () => {
		const shared = readFileSync(
			"src/roguetrader/presentation/context-menu-entry.ts",
			"utf8",
		);
		expect(shared).toContain("export type ContextMenuEntryOption");
		expect(menusSource).not.toMatch(/\btype\s+\w*EntryOption\s*=/);
		const creatorSource = readFileSync(
			"src/roguetrader/presentation/creator-menus.ts",
			"utf8",
		);
		expect(creatorSource).not.toMatch(/\btype\s+\w*EntryOption\s*=/);
	});
});
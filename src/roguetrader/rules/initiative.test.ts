/**
 * Initiative roll action (bead dt8t rework → bead yxm5 funnel).
 *
 * The sheet/token-menu button is FUNNEL-DRIVEN now (owner: same roll funnel
 * as other rollable skills — talents/items modify initiative with a visible
 * breakdown): contributors = the Agility-Bonus base row + the live
 * `initiative`-keyed owned-item modifiers, the TestDialog shows them (no
 * difficulty ladder, no pass/fail), then d10 + total, assigned to the
 * combatant when the actor is on the active tracker.
 *
 * The combat-tracker bulk path stays core: "1d10 + @initiativeBonus" with the
 * placeholder resolving through the model's initiativeBonus getter (which
 * folds the same explicit rows), so both routes count that set exactly once.
 *
 * The funnel dialog is patched per test (TestDialog.show static); ports fakes
 * cover dice/chat/notify (the adapter-ammo-consume pattern).
 *
 * Adapter-level tests via the fake-globals harness: Foundry globals are
 * stubbed BEFORE the dynamic import. Plus the template/action-map/context-menu
 * source-scan guards.
 */
let dialogRequests: Array<Record<string, unknown>> = [];
let dialogResult: { modifiers: unknown[] } | null = { modifiers: [] };

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
const { INITIATIVE_FORMULA } = await import("./derived");
const { foundryPorts, setPorts } = await import(
	"../../ffg/infrastructure/foundry/ports"
);
const { TestDialog } = await import("./test-dialog");

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

// --- Harness ----------------------------------------------------------------

const rollCalls: string[] = [];
const postedCards: string[] = [];
let lastCardVars: Record<string, unknown> | null = null;
let warnings: string[] = [];

function wirePorts(d10Total = 4): void {
	rollCalls.length = 0;
	postedCards.length = 0;
	lastCardVars = null;
	warnings = [];
	setPorts({
		...foundryPorts,
		dice: {
			roll: async (formula: string) => {
				rollCalls.push(formula);
				return { total: d10Total, dice: [], terms: [], formula };
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
			// chat amendments are not exercised here — keep the contract explicit.
			async update() {
				await Promise.resolve();
			},
		},
		notify: {
			warn: (key: string) => {
				warnings.push(key);
			},
			info: () => undefined,
			error: () => undefined,
		},
	});
}

/** Patch the test dialog: record the request, answer with `dialogResult`. */
function wireDialog(): () => void {
	dialogRequests = [];
	const original = TestDialog.show;
	TestDialog.show = (async (request: object) => {
		dialogRequests.push(request as Record<string, unknown>);
		return dialogResult as never;
	}) as never;
	return () => {
		TestDialog.show = original as never;
	};
}

/** A character-shaped fixture: Character model's bonus + an empty inventory. */
function actorFixture(agBonus: number) {
	return {
		id: "a1",
		name: "Explorer",
		type: "explorer",
		system: {
			characteristics: { ag: { value: agBonus * 10, unnatural: 1 } },
			characteristicBonus: (key: string) => (key === "ag" ? agBonus : 0),
		},
		items: [],
	};
}

// --- Tests -------------------------------------------------------------------

describe("initiative formula (bead dt8t)", () => {
	// The tracker's bulk path stays the placeholder formula; the placeholder
	// resolves through the model's initiativeBonus getter (which folds the
	// same explicit "initiative" rows the funnel dialog shows).
	test("the shared shape is the @placeholder form (bead jpt3)", () => {
		expect(INITIATIVE_FORMULA).toBe("1d10 + @initiativeBonus");
	});
});

describe("rollInitiativeAction funnel flow (bead yxm5)", () => {
	test("opens the funnel dialog with the agility base + collected rows, rolls d10 + total, assigns, posts the card", async () => {
		wirePorts(4);
		const restore = wireDialog();
		try {
			const actor = actorFixture(5);
			const value = await rollInitiativeAction(actor as never);
			// d10(4) + agility(5)
			expect(value).toBe(9);
			expect(rollCalls).toEqual(["1d10"]);
			// The dialog request: d10 cap as baseTarget, no difficulty ladder.
			expect(dialogRequests).toHaveLength(1);
			expect(dialogRequests[0].baseTarget).toBe(10);
			expect(dialogRequests[0].difficultyLadder).toEqual([]);
			const rows = dialogRequests[0].contributors as Array<Record<string, unknown>>;
			expect(rows).toEqual([
				{
					id: "initiative-base:agility",
					label: "ROLL.INITIATIVE_AGILITY_BONUS",
					source: { type: "item", label: "ROLL.BASE" },
					value: 5,
				},
			]);
			// The card carries the full breakdown + the assigned note.
			expect(postedCards).toEqual(["card"]);
			expect(lastCardVars?.value).toBe(9);
			const analysis = lastCardVars?.analysis as Array<Record<string, unknown>>;
			expect(analysis).toEqual([
				{ label: "ROLL.INITIATIVE_AGILITY_BONUS", value: 5 },
			]);
			expect(lastCardVars?.assigned).toBe(false); // game.combat unset
		} finally {
			restore();
		}
	});

	test("a dialogue custom row joins the roll (same funnel as skills)", async () => {
		wirePorts(2);
		const restore = wireDialog();
		try {
			dialogResult = {
				modifiers: [
					{
						id: "dialog:custom:alert",
						source: { type: "item", label: "X" },
						label: "Alert",
						value: 3,
					},
				],
			};
			const actor = actorFixture(4);
			const value = await rollInitiativeAction(actor as never);
			// d10(2) + base(4) + custom(+3)
			expect(value).toBe(9);
			const analysis = (
				lastCardVars?.analysis ?? []
			) as unknown[];
			expect(analysis.length).toBe(2);
		} finally {
			restore();
			dialogResult = { modifiers: [] };
		}
	});

	test("a dialog cancel rolls and posts nothing", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			dialogResult = null;
			const value = await rollInitiativeAction(actorFixture(5) as never);
			expect(value).toBe(undefined);
			expect(rollCalls).toEqual([]);
			expect(postedCards).toEqual([]);
		} finally {
			restore();
			dialogResult = { modifiers: [] };
		}
	});

	test("assigns to the combatant when the actor is on the tracker", async () => {
		wirePorts(4);
		const restore = wireDialog();
		const combatantUpdates: unknown[] = [];
		const savedCombat = (game as { combat?: unknown }).combat;
		try {
			(game as { combat?: unknown }).combat = {
				combatants: [
					{
						actorId: "other",
						update: () => Promise.resolve(),
					},
					{
						actorId: "a1",
						update: (data: object) => {
							combatantUpdates.push(data);
							return Promise.resolve();
						},
					},
				],
			};
			await rollInitiativeAction(actorFixture(5) as never);
			expect(combatantUpdates).toEqual([{ initiative: 9 }]);
			expect(lastCardVars?.assigned).toBe(true);
		} finally {
			restore();
			(game as { combat?: unknown }).combat = savedCombat;
		}
	});

	test("fails closed for a non-character system (no characteristicBonus)", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			const vehicle = {
				id: "v1",
				name: "Lander",
				type: "vehicle",
				system: { size: "huge" },
				items: [],
			};
			const value = await rollInitiativeAction(vehicle as never);
			expect(value).toBe(undefined);
			expect(dialogRequests).toHaveLength(0);
		} finally {
			restore();
		}
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
	// character-shaped systems that carry the Character model's
	// characteristicBonus (and thus initiativeBonus, bead jpt3), so an owned
	// vehicle/starship token must not see a dead entry whose click silently
	// no-ops. Source-scan guard: the visible() gate mirrors the adapter's gate.
	test("the token menu gate mirrors the adapter's initiativeBonus shape gate", () => {
		expect(menusSource).toContain(
			'if (!token?.actor?.isOwner) return false;',
		);
		expect(menusSource).toContain(
			'"initiativeBonus" in system',
		);
	});

	// Bead jpt3: the two consumption routes read the ONE canonical formula —
	// the model getter is the placeholder's resolver and the tracker reads it
	// from CONFIG.Combat.initiative.formula (set by bootstrap/combat-tracker.ts
	// — pinned over there). Guard here that the formula shape stays the shared
	// constant, so the routes cannot diverge.
	test("the formula is the shared INITIATIVE_FORMULA constant", () => {
		const derivedSource = readFileSync(
			"src/roguetrader/rules/derived.ts",
			"utf8",
		);
		expect(derivedSource).toContain('INITIATIVE_FORMULA = "1d10 + @initiativeBonus"');
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
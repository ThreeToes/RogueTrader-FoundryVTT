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
const { shipDetectionBonus, shipBoarded } = await import(
	"../presentation/rolls/initiative"
);
const { foundryPorts, resetPorts, setPorts } = await import(
	"../../ffg/infrastructure/foundry/ports"
);
const { TestDialog } = await import("./test-dialog");

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Restore EVERYTHING this file replaces, so nothing leaks into whichever suite
 * bun schedules next (all suites run in ONE process).
 *
 * Bead vtce: the ports set by wirePorts() are process-global setPorts()
 * overrides — without resetPorts() the initiative dice/chat/notify spies keep
 * receiving roll-pipeline.test.ts's calls, emptying that suite's roll,
 * warning and card-render assertions (13 failures in the pair; either suite
 * alone is green).
 */
afterAll(() => {
	resetPorts();
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

// --- Harness ----------------------------------------------------------------

const rollCalls: string[] = [];
const postedCards: string[] = [];
let lastCardVars: Record<string, unknown> | null = null;
let warnings: string[] = [];
let errors: string[] = [];

function wirePorts(d10Total = 4): void {
	rollCalls.length = 0;
	postedCards.length = 0;
	lastCardVars = null;
	warnings = [];
	errors = [];
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
			error: (key: string) => {
				errors.push(key);
			},
		},
	});
}

/** Patch the test dialog: record the request, answer with `dialogResult`.
 * (Ports set here are torn down in afterAll — vtce ordering dependency.) */
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

/** A character-shaped fixture: Character model's bonus + an empty inventory.
 * `isOwner: true` clears the pipeline's ownership gate (bead qiuo) — bead 77r1
 * routes the roll through runRoll, so non-owners are refused before any
 * dialog. */
function actorFixture(agBonus: number) {
	return {
		id: "a1",
		name: "Explorer",
		type: "explorer",
		isOwner: true,
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
			// Bead 77r1: the wrapper now returns the pipeline's result (null for
			// prepare-only kinds — no kernel outcome); the TOTAL is asserted on
			// the card below, where it was always meant to come from.
			const value = await rollInitiativeAction(actor as never);
			expect(value).toBeNull();
			// d10(4) + agility(5)
			expect(rollCalls).toEqual(["1d10"]);
			// The dialog request: d10 cap as baseTarget, no difficulty ladder.
			expect(dialogRequests).toHaveLength(1);
			expect(dialogRequests[0].baseTarget).toBe(10);
			expect(dialogRequests[0].difficultyLadder).toEqual([]);
			const rows = dialogRequests[0].contributors as Array<
				Record<string, unknown>
			>;
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
			await rollInitiativeAction(actor as never);
			// d10(2) + base(4) + custom(+3) — on the card's breakdown/total.
			expect(lastCardVars?.value).toBe(9);
			const analysis = (lastCardVars?.analysis ?? []) as unknown[];
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
			expect(value).toBeNull();
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

	// Bead 77r1: routing through the pipeline adds the ownership gate every
	// other kind gets — a non-owner is refused loudly before any dialog.
	test("a non-owner is refused by the pipeline's ownership gate (bead 77r1)", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			const actor = { ...actorFixture(5), isOwner: false };
			const value = await rollInitiativeAction(actor as never);
			expect(value).toBeNull();
			expect(dialogRequests).toHaveLength(0);
			expect(rollCalls).toEqual([]);
			expect(postedCards).toEqual([]);
			expect(warnings).toEqual(["ROLL.NOT_OWNER"]);
		} finally {
			restore();
		}
	});

	// Flipped for the starship path (bead qkq1): the non-character fail-closed
	// gate now covers only actors that carry NEITHER shape — the vehicle. A
	// owned STARSHIP token gets the explicit ship path (the describe below),
	// so the old "vehicles/starships lack characteristicBonus" wording is dead.
	test("fails closed for a non-character system (no characteristicBonus)", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			const vehicle = {
				id: "v1",
				name: "Lander",
				type: "vehicle",
				// Owned, so the refusal below is the HANDLER's shape gate, not
				// the ownership gate — the fail-closed gate must stay meaningful.
				isOwner: true,
				system: { size: "huge" },
				items: [],
			};
			const value = await rollInitiativeAction(vehicle as never);
			expect(value).toBeNull();
			expect(dialogRequests).toHaveLength(0);
			expect(warnings).toEqual([]); // silent, like the old shape gate
		} finally {
			restore();
		}
	});
});

// --- Starship path (bead qkq1, Core Rulebook p212-213) ---------------------

/** A starship-shaped fixture: the StarshipActor statline's Detection. */
function starshipFixture(
	detection?: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: "s1",
		name: "Sword-class Frigate",
		type: "starship",
		// Ownership-clears the pipeline gate (bead qiuo), as in actorFixture.
		isOwner: true,
		system: {
			...(detection === undefined ? {} : { detection }),
			...overrides,
		},
		items: [],
	};
}

describe("starship initiative (bead qkq1)", () => {
	// The arithmetic the bead pins: Math.floor(detection / 10) across the
	// boundaries — 0/9 are a zero tens digit, 10/100 step it up.
	test("the Detection tens digit at the boundaries 0/9/10/100", () => {
		expect(shipDetectionBonus(0)).toBe(0);
		expect(shipDetectionBonus(9)).toBe(0);
		expect(shipDetectionBonus(10)).toBe(1);
		expect(shipDetectionBonus(100)).toBe(10);
		expect(shipDetectionBonus(44)).toBe(4);
	});

	test("rolls 1d10 + the Detection tens digit, assigns, posts the visible breakdown", async () => {
		wirePorts(4);
		const restore = wireDialog();
		const combatantUpdates: unknown[] = [];
		const savedCombat = (game as { combat?: unknown }).combat;
		(game as { combat?: unknown }).combat = {
			combatants: [
				{
					actorId: "s1",
					update: (data: object) => {
						combatantUpdates.push(data);
						return Promise.resolve();
					},
				},
			],
		};
		try {
			await rollInitiativeAction(starshipFixture(44) as never);
			// d10(4) + floor(44/10)=4
			expect(rollCalls).toEqual(["1d10"]);
			expect(lastCardVars?.value).toBe(8);
			// The card's analysis rows are the breakdown's (label + value) shape.
			const analysis = lastCardVars?.analysis as Array<Record<string, unknown>>;
			expect(analysis).toEqual([
				{
					label: "ROLL.INITIATIVE_DETECTION",
					value: 4,
				},
			]);
			expect(combatantUpdates).toEqual([{ initiative: 8 }]);
			expect(lastCardVars?.assigned).toBe(true);
			// No owned-item collection: character initiative bonuses do not apply
			// to ships, so the dialog sees ONLY the Detection row.
			expect(dialogRequests).toHaveLength(1);
			expect(dialogRequests[0].contributors).toEqual([
				{
					id: "initiative-base:detection",
					label: "ROLL.INITIATIVE_DETECTION",
					source: { type: "item", label: "ROLL.BASE" },
					value: 4,
				},
			]);
		} finally {
			restore();
			(game as { combat?: unknown }).combat = savedCombat;
		}
	});

	// The bead's gate: a ship WITHOUT the Detection field (corrupt data) must
	// fail LOUDLY, not silently like the character path's shape gate. The
	// schema always casts Detection (NumberField, initial 0), so a missing
	// read is exactly the broken-data case.
	test("fails LOUDLY on a missing Detection field", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			const value = await rollInitiativeAction(starshipFixture() as never);
			expect(value).toBeNull();
			expect(dialogRequests).toHaveLength(0);
			expect(rollCalls).toEqual([]);
			expect(postedCards).toEqual([]);
			expect(errors).toEqual(["ROLL.INITIATIVE_NO_DETECTION"]);
		} finally {
			restore();
		}
	});

	// The two combat-start manual rulings (Core Rulebook p213 + p213-214,
	// Table 8-9) render on the ship card as note lines — visibility only.
	test("the card carries the two combat-start note lines", async () => {
		wirePorts(1);
		const restore = wireDialog();
		try {
			await rollInitiativeAction(starshipFixture(30) as never);
			expect(lastCardVars?.notes).toEqual([
				"ROLL.INITIATIVE_NOTE_SURPRISE",
				"ROLL.INITIATIVE_NOTE_NPC_ACTIONS",
			]);
		} finally {
			restore();
		}
	});

	// Boarded pair (Core Rulebook p215; S2's boardedWith OBJECT — the
	// { uuid, breakFreeFailedThisTurn } pair state, bead tueu): the banner
	// rides the card; the tracker reorder stays GM-manual.
	test("a boarded ship's card carries the Boarding banner", async () => {
		wirePorts(1);
		const restore = wireDialog();
		try {
			await rollInitiativeAction(
				starshipFixture(25, {
					boardedWith: { uuid: "Actor.x9", breakFreeFailedThisTurn: false },
				}) as never,
			);
			expect(lastCardVars?.boarded).toBe(true);
		} finally {
			restore();
		}
	});

	test("an unboarded ship's card carries no Boarding banner", async () => {
		wirePorts(1);
		const restore = wireDialog();
		try {
			await rollInitiativeAction(starshipFixture(25) as never);
			expect(lastCardVars?.boarded).toBeUndefined();
		} finally {
			restore();
		}
	});

	// The S2 PAIR-state shape ({ uuid, breakFreeFailedThisTurn }, bead tueu):
	// only a non-empty uuid inside the pair counts; the S2-preceding shape
	// (a bare uuid STRING) is NOT boarded — the old test pinned it green.
	test("the shipBoarded read treats a missing field as unset", () => {
		expect(shipBoarded({})).toBe(false);
		expect(shipBoarded({ boardedWith: null })).toBe(false);
		expect(shipBoarded({ boardedWith: undefined })).toBe(false);
		expect(shipBoarded({ boardedWith: {} })).toBe(false);
		expect(
			shipBoarded({ boardedWith: { uuid: "", breakFreeFailedThisTurn: false } }),
		).toBe(false);
		expect(
			shipBoarded({ boardedWith: { uuid: "Actor.x9", breakFreeFailedThisTurn: false } }),
		).toBe(true);
		// A stale uuid STRING (the pre-S2 shape) never reads as boarded.
		expect(shipBoarded({ boardedWith: "Actor.x9" })).toBe(false);
		expect(shipBoarded(undefined)).toBe(false);
	});

	// The ownership gate stays the pipeline's (bead qiuo): a non-owner ship is
	// refused loud and before any dialog — including the ship path.
	test("a non-owner ship is refused by the pipeline's ownership gate", async () => {
		wirePorts();
		const restore = wireDialog();
		try {
			const value = await rollInitiativeAction({
				...starshipFixture(44),
				isOwner: false,
			} as never);
			expect(value).toBeNull();
			expect(dialogRequests).toHaveLength(0);
			expect(rollCalls).toEqual([]);
			expect(postedCards).toEqual([]);
			expect(warnings).toEqual(["ROLL.NOT_OWNER"]);
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
const initiativeTemplate = readFileSync(
	"template/chat/initiative.hbs",
	"utf8",
);
const shipCombatTemplate = readFileSync(
	"template/sheet/actor/tabs/ship-combat.hbs",
	"utf8",
);
const shipSheetSource = readFileSync(
	"src/roguetrader/sheet/actor/ship-sheet.ts",
	"utf8",
);
const hooksSource = readFileSync("src/roguetrader/bootstrap/hooks.ts", "utf8");
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

	test("bootstrap registers the token context-menu module", () => {
		expect(hooksSource).toContain("registerTokenContextMenus()");
	});

	test("the token menu targets the core Tokens-tab context hook", () => {
		// v14 core: PlaceableTab fires get<Token>PlaceableContextOptions for the
		// Scene-Navigation Tokens tab (the only core token context menu — canvas
		// right-click opens the Token HUD). See token-menus.ts header.
		expect(menusSource).toContain('"getTokenPlaceableContextOptions"');
		expect(menusSource).toContain("rollInitiativeAction");
		// v14 ContextMenuEntry field (creator-menus.test.ts precedent).
		expect(menusSource).toContain(
			"visible: (element) => canRollToken(element)",
		);
		expect(menusSource).not.toMatch(/\bcondition\??\s*:/);
	});

	// Bead qkq1: the ship card's note lines + boarding banner render, and the
	// ship sheet's Combat tab exposes the button (sibling of the character
	// path's stats.hbs button, pinned above).
	test("the initiative template renders the notes and the Boarding banner", () => {
		expect(initiativeTemplate).toContain("{{#each notes as |note|}}");
		expect(initiativeTemplate).toContain("{{localize note}}");
		expect(initiativeTemplate).toContain('localize "ROLL.INITIATIVE_BOARDING"');
	});

	test("the ship sheet maps the rollInitiative action to the adapter call", () => {
		expect(shipCombatTemplate).toContain('data-action="rollInitiative"');
		expect(shipCombatTemplate).toContain('localize "COMBAT.ROLL_INITIATIVE"');
		expect(shipSheetSource).toContain(
			"rollInitiative: ShipSheet.#onRollInitiative",
		);
		expect(shipSheetSource).toContain(
			"await rollInitiativeAction(this.document)",
		);
	});

	// Bead nt34 F1: the menu entry must be gated MORE than ownership — the
	// adapter (rules/adapter.ts rollInitiativeAction) only accepts
	// character-shaped systems that carry the Character model's
	// characteristicBonus (and thus initiativeBonus, bead jpt3), so an owned
	// vehicle/starship token must not see a dead entry whose click silently
	// no-ops. Source-scan guard: the visible() gate mirrors the adapter's gate.
	test("the token menu gate mirrors the adapter's initiativeBonus shape gate", () => {
		expect(menusSource).toContain("if (!token?.actor?.isOwner) return false;");
		expect(menusSource).toContain('"initiativeBonus" in system');
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
		expect(derivedSource).toContain(
			'INITIATIVE_FORMULA = "1d10 + @initiativeBonus"',
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

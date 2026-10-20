/**
 * SHIP COMBAT tab guards (epic necp bead 7gcm). Three families:
 * 1. TAB ANATOMY — ShipSheet declares the combat part + nav tab (the
 *    actions-tab test's convention) and the bead's click actions + the
 *    resizable window.
 * 2. THE TAB TEMPLATE — compiled against a fabricated combat context: the
 *    ship-action chips (grouped Manoeuvre / Machinery / Extended), the
 *    boarded banner + break-free button + opposed-Command rows, the
 *    helmsman picker options INCLUDING the crew fallback row, the
 *    turn-flag chips and the silent-running toggle.
 * 3. THE CHIP/VIEW-MODEL pieces — ship-combat-view.ts (pure, localiser
 *    injected): grouping follows the S5/S7 dispatch tables (no parallel
 *    name lists), the bare-Pilot annotation and the boarded rows come from
 *    the S7 kernel (no second maths).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import {
	boardingBanner,
	helmsmanOptions,
	shipActionChipRow,
	shipActionGroupsContext,
	turnFlagChips,
	type ShipActionDoc,
} from "./ship-combat-view";
import { boardingRowKey } from "../../presentation/rolls/ship-boarding";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import {
	resolveShipActionItem as _resolveShipActionItem,
	shipActionHandler,
} from "../../presentation/rolls/ship-action";
const resolveShipActionItem = _resolveShipActionItem;

beforeAll(() => {
	// The template's Foundry-built helpers, stubbed like verify-templates does
	// (the actions-tab suite registers the same set minimum, extended here for
	// the helpers THIS tab template composes with).
	Handlebars.registerHelper("localize", (key: string) => String(key));
	Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
	Handlebars.registerHelper("ne", (a: unknown, b: unknown) => a !== b);
	Handlebars.registerHelper("not", (v: unknown) => !v);
	Handlebars.registerHelper("lt", (a: number, b: number) => a < b);
	// The component-roster partial (unused with the empty rosters this suite
	// renders, but registered so a stray row never throws).
	Handlebars.registerPartial("rt/ship-component-row", "ROW");
});

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "Hooks", "CONFIG", "Handlebars"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
globals.game = { i18n: { localize: (key: string) => key } };
globals.Handlebars = { registerPartial: () => undefined };
// The FULL shared foundry stub FIRST (installs once via ??= — it carries
// data.fields that OTHER test files need), then per-key extension with the
// application bits the sheet class reads at load. See actions-tab.test.ts's
// note: never overwrite the whole foundry global here.
await import("../../../test-helpers/foundry-schema-stub");
const foundryRef = globals.foundry as unknown as Record<string, unknown>;
for (const key of ["applications", "documents", "utils"] as const) {
	originalGlobals[`foundry.${key}`] = foundryRef[key];
}
foundryRef.applications ??= {
	api: {
		HandlebarsApplicationMixin: (base: unknown) => base,
		ApplicationV2: class {},
		DialogV2: class {},
	},
	sheets: { ActorSheetV2: class {} },
};
foundryRef.documents ??= { Item: class {}, Actor: class {} };
foundryRef.utils ??= { fromUuidSync: () => null };

const { ShipSheet } = await import("./ship-sheet");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (key.startsWith("foundry.")) {
			const record = globals.foundry as unknown as Record<string, unknown>;
			const slot = key.slice("foundry.".length);
			if (value === undefined) delete record[slot];
			else record[slot] = value;
		} else if (value === undefined) {
			delete globals[key];
		} else {
			globals[key] = value;
		}
	}
});

// --- the context pieces the template needs ----------------------------------

/** The vitals/status pieces the salvo sections and the state surfaces
 * render — minimal but covering EVERY `combat.` reference the tab makes. */
function baseCombatContext(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		hullIntegrity: { value: 50, max: 60 },
		crewPopulation: 95,
		crewMorale: 88,
		voidShields: 2,
		voidShieldPips: [1, 2],
		crewSkill: 50,
		crippled: { crippled: false },
		weapons: [],
		roster: [],
		weaponRoster: [],
		componentStates: { intact: "Intact" },
		...overrides,
	};
}

function templateContext(combat: Record<string, unknown>): {
	tabs: { combat: { cssClass: string } };
	combat: Record<string, unknown>;
} {
	return { tabs: { combat: { cssClass: "" } }, combat };
}

const compiled = () =>
	Handlebars.compile(
		readFileSync("template/sheet/actor/tabs/ship-combat.hbs", "utf8"),
	);

describe("ShipSheet combat-tab anatomy", () => {
	const parts = ShipSheet.PARTS as unknown as Record<
		string,
		{ template?: string }
	>;
	test("the combat part is the ship-combat template", () => {
		expect(parts.combat?.template).toBe(
			`${TEMPLATE_ROOT}sheet/actor/tabs/ship-combat.hbs`,
		);
	});

	test("the nav carries the combat tab", () => {
		const tabs = (
			ShipSheet.TABS as unknown as {
				primary: { tabs: Array<{ id: string; label: string }> };
			}
		).primary.tabs;
		const tab = tabs.find((t) => t.id === "combat");
		expect(tab).toBeDefined();
		expect(tab?.label).toBe("STARSHIP.TAB_COMBAT");
	});

	test("the bead's click actions are registered", () => {
		const actions = (
			ShipSheet.DEFAULT_OPTIONS as unknown as {
				actions: Record<string, unknown>;
			}
		).actions;
		expect(actions.shipActionChip).toBeDefined();
		expect(actions.setHelmsman).toBeDefined();
		expect(actions.toggleSilentRunning).toBeDefined();
		expect(actions.defaultManoeuvre).toBeDefined();
	});

	test("the window stays resizable", () => {
		const window = (
			ShipSheet.DEFAULT_OPTIONS as unknown as {
				window: { resizable?: boolean };
			}
		).window;
		expect(window.resizable).toBe(true);
	});
});

describe("the ship-combat tab template render", () => {
	test("renders the ship-action groups + chips (pack data, no hardcoded lists)", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					shipActionGroups: [
						{
							key: "manoeuvre",
							labelKey: "SHIP_COMBAT.ACTION_GROUP_MANOEUVRE",
							rows: [
								{
									name: "Adjust Bearing",
									uuid: "Compendium.rogue-trader.starship-actions.Item.1",
									testLabel:
										"Pilot (Space Craft) + SHIP_COMBAT.STAT_MANOEUVRABILITY",
									difficulty: "Challenging (+0)",
									skipDialog: false,
									tooltip:
										"Half Action — Turn the ship. — SHIP_ACTION.DIFFICULTY: Challenging (+0)",
								},
							],
						},
						{
							key: "extended",
							labelKey: "SHIP_COMBAT.ACTION_GROUP_EXTENDED",
							rows: [
								{
									name: "Hail the Enemy",
									uuid: "Compendium.rogue-trader.starship-actions.Item.9",
									testLabel: "SHIP_COMBAT.TEST_INTERACTION_ANY",
									difficulty: "",
									skipDialog: false,
									tooltip: "Full Action — Hail. — Click to roll",
								},
							],
						},
					],
					shipActionGroupsEmpty: false,
					boarding: { locked: false, rows: [], enemyRows: [] },
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
				}),
			),
		);
		expect(html).toContain('data-action="shipActionChip"');
		expect(html.match(/data-action="shipActionChip"/g)?.length).toBe(2);
		expect(html).toContain("SHIP_COMBAT.ACTION_GROUP_MANOEUVRE");
		expect(html).toContain("SHIP_COMBAT.ACTION_GROUP_EXTENDED");
		// The chips carry the pack doc uuid + the printed test/difficulty label.
		expect(html).toContain(
			'data-item-id="Compendium.rogue-trader.starship-actions.Item.1"',
		);
		expect(html).toContain(
			"Pilot (Space Craft) + SHIP_COMBAT.STAT_MANOEUVRABILITY",
		);
		expect(html).toContain("Challenging (+0)");
		// Non-machinery rows never carry the skip-dialog override.
		expect(html).not.toContain('data-skip-dialog="true"');
	});

	test("machinery rows ride skipDialog (Break Free / Rout, bead w98s)", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					shipActionGroups: [
						{
							key: "machinery",
							labelKey: "SHIP_COMBAT.ACTION_GROUP_MACHINERY",
							rows: [
								{
									name: "Break Free",
									uuid: "Compendium.rogue-trader.starship-actions.Item.17",
									testLabel:
										"Pilot (Space Craft) + SHIP_COMBAT.STAT_MANOEUVRABILITY",
									difficulty: "Hard (-20)",
									skipDialog: true,
									tooltip: "t",
								},
								{
									name: "Rout",
									uuid: "Compendium.rogue-trader.starship-actions.Item.18",
									testLabel: "Rout",
									difficulty: "",
									skipDialog: true,
									tooltip: "t",
								},
							],
						},
					],
					shipActionGroupsEmpty: false,
					boarding: { locked: false, rows: [], enemyRows: [] },
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
				}),
			),
		);
		expect(html.match(/data-skip-dialog="true"/g)?.length).toBe(2);
	});

	test("an empty pack degrades to the loud empty-state hint", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
					boarding: { locked: false },
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
				}),
			),
		);
		expect(html).toContain("SHIP_COMBAT.NO_SHIP_ACTIONS");
		expect(html).not.toContain('data-action="shipActionChip"');
	});

	test("the boarded banner: lock label, penalty note, break-free button, command rows", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					boarding: {
						locked: true,
						bannerLabel: "Locked with Ork Terror Ship",
						partnerName: "Ork Terror Ship",
						penalty: true,
						penaltyLabel: "SHIP_BOARDING.BREAK_FREE_PENALTY",
						breakFreeRowUuid:
							"Compendium.rogue-trader.starship-actions.Item.17",
						reminderLabel: "manual opposed Command",
						rowsLabel: "SHIP_BOARDING.COMMAND_ROWS",
						enemyRowsLabel: "SHIP_BOARDING.COMMAND_ROWS_ENEMY",
						rows: [
							{
								id: "bon:turret",
								label: "SHIP_BOARDING.COMMAND_BONUS_TURRET",
								display: "+20",
							},
						],
						enemyRows: [
							{
								id: "bon:turret",
								label: "SHIP_BOARDING.COMMAND_BONUS_TURRET",
								display: "+10",
							},
						],
					},
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(html).toContain("Locked with Ork Terror Ship");
		expect(html).toContain("SHIP_BOARDING.BREAK_FREE_PENALTY");
		expect(html).toContain("SHIP_BOARDING.BREAK_FREE");
		expect(html).toContain(
			'data-item-id="Compendium.rogue-trader.starship-actions.Item.17"',
		);
		expect(html).toContain('data-skip-dialog="true"');
		// The manual reminder + the S7 kernel's computed rows, both directions.
		expect(html).toContain("manual opposed Command");
		expect(html).toContain("SHIP_BOARDING.COMMAND_BONUS_TURRET");
		expect(html).toContain("+20");
		expect(html).toContain("+10");
	});

	test("no boarding pair renders no banner and no break-free button", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					boarding: { locked: false, bannerLabel: "", rows: [], enemyRows: [] },
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(html).not.toContain("sc-boarded");
		expect(html).not.toContain("SHIP_BOARDING.BREAK_FREE");
	});

	test("the helmsman picker: fallback row + explorer options with the bare-Pilot note", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					helmsman: {
						uuid: "Actor.helm2",
						options: [
							{
								uuid: "Actor.helm1",
								name: "Alderic",
								label: "Alderic",
								selected: false,
							},
							{
								uuid: "Actor.helm2",
								name: "Vess",
								label: "Vess (SHIP_COMBAT.HELMSMAN_BARE_PILOT)",
								selected: true,
							},
						],
					},
					turnFlags: [],
					turnFlagsEmpty: true,
					silentRunning: false,
					boarding: { locked: false },
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(html).toContain('data-action="setHelmsman"');
		// The fallback row (crew quality, Table 8-9) is the empty option.
		expect(html).toContain('value=""');
		expect(html).toContain("SHIP_COMBAT.HELMSMAN_NONE");
		expect(html).toContain("SHIP_COMBAT.HELMSMAN_BARE_PILOT");
		const selected = html.match(/value="Actor\.helm2" selected/);
		expect(selected, "the picked helmsman renders selected").not.toBeNull();
	});

	test("turn-flag chips: bonus/penalty classes, value + expiry tooltip", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					turnFlagsEmpty: false,
					turnFlags: [
						{
							id: "flag:evasive",
							key: "evasive",
							label: "SHIP_COMBAT.TURN_FLAG_EVASIVE_CHIP",
							display: "-10",
							kind: "penalty",
							persistent: false,
							tooltip: "t — SHIP_COMBAT.TURN_FLAG_EXPIRY",
						},
						{
							id: "flag:repel",
							key: "repel-boarders",
							label: "SHIP_COMBAT.TURN_FLAG_REPEL_BOARDERS_CHIP",
							display: "+5",
							kind: "bonus",
							persistent: true,
							tooltip: "t — SHIP_COMBAT.TURN_FLAG_PERSISTENT",
						},
					],
					helmsman: { uuid: "", options: [] },
					silentRunning: false,
					boarding: { locked: false },
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(html.match(/class="sc-flag-chip penalty/g)?.length).toBe(1);
		expect(html).toContain("persistent");
		expect(html).toContain("SHIP_COMBAT.TURN_FLAG_EXPIRY");
		expect(html).toContain("SHIP_COMBAT.TURN_FLAG_PERSISTENT");
	});

	test("the silent-running toggle renders engaged state by the flag", () => {
		const on = compiled()(
			templateContext(
				baseCombatContext({
					silentRunning: true,
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					boarding: { locked: false },
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(on).toContain('data-action="toggleSilentRunning"');
		expect(on).toContain("engaged");
		const off = compiled()(
			templateContext(
				baseCombatContext({
					silentRunning: false,
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					boarding: { locked: false },
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
				}),
			),
		);
		expect(off).toContain('aria-pressed="false"');
	});

	test("the default manoeuvre button is present", () => {
		const html = compiled()(
			templateContext(
				baseCombatContext({
					helmsman: { uuid: "", options: [] },
					turnFlags: [],
					turnFlagsEmpty: true,
					boarding: { locked: false },
					shipActionGroups: [],
					shipActionGroupsEmpty: true,
					silentRunning: false,
				}),
			),
		);
		expect(html).toContain('data-action="defaultManoeuvre"');
	});
});

// --- the view model ---------------------------------------------------------

const localizeStub = (key: string) => key;

/** commandBonusRows (ship-boarding.ts) localises through the ports — a fake
 * ports i18n here (the roll-pipeline fake-ports pattern); restored after. */
import {
	setPorts,
	resetPorts,
	getPorts,
} from "../../../ffg/infrastructure/foundry/ports";

beforeAll(() => {
	setPorts({
		...getPorts(),
		i18n: {
			...getPorts().i18n,
			t: (key: string, vars?: Record<string, unknown>) =>
				vars ? `${key}(${Object.values(vars).join(",")})` : key,
		},
	} as never);
});

afterAll(() => {
	resetPorts();
});

describe("the ship-actions view model (bead 7gcm)", () => {
	test("#shipActionTestLabel resolves the combined vocabulary", () => {
		const label = shipActionChipRow(
			{
				name: "Adjust Bearing",
				uuid: "u1",
				system: {
					actionCost: "Half Action",
					roll: { test: "pilot-space-craft+manoeuvrability" },
					shortDescription: "Turn the ship.",
				},
			},
			"manoeuvre",
			localizeStub,
		);
		expect(label.testLabel).toBe(
			"Pilot (Space Craft) + SHIP_COMBAT.STAT_MANOEUVRABILITY",
		);
	});

	test("the willpower characteristic route labels through CHAR key", () => {
		const chip = shipActionChipRow(
			{
				name: "Hold Fast!",
				uuid: "u2",
				system: { roll: { test: "willpower" } },
			},
			"extended",
			localizeStub,
		);
		expect(chip.testLabel).toBe("CHARACTERISTIC.WP");
	});

	test("grouping follows the dispatch TABLES, never a name list", () => {
		const docs: ShipActionDoc[] = [
			{ type: "ship-action", name: "Adjust Bearing", uuid: "u1", system: {} },
			{
				type: "ship-action",
				name: "Evasive Manoeuvres",
				uuid: "u2",
				system: {},
			},
			{ type: "ship-action", name: "Break Free", uuid: "u3", system: {} },
			{ type: "ship-action", name: "Rout", uuid: "u4", system: {} },
			{
				type: "ship-action",
				name: "Hail the Enemy",
				uuid: "u5",
				system: {},
			},
			// An unknown row still RENDERS — grouping is the extended default.
			{
				type: "ship-action",
				name: "Emergency Repairs stand-in",
				uuid: "u6",
				system: {},
			},
		];
		const context = shipActionGroupsContext(docs, localizeStub);
		expect(context.groups.map((g) => g.key)).toEqual([
			"manoeuvre",
			"machinery",
			"extended",
		]);
		expect(context.groups[0].rows.map((r) => r.name)).toEqual([
			"Adjust Bearing",
			"Evasive Manoeuvres",
		]);
		expect(context.groups[1].rows.map((r) => r.name)).toEqual([
			"Break Free",
			"Rout",
		]);
		// The banner's break-free row rides the machinery dispatch key.
		expect(boardingRowKey("Break Free")).toBe("break-free");
		expect(context.breakFreeRowUuid).toBe("u3");
	});

	test("only the S7 prompt-owning machinery rows ride skipDialog", () => {
		const chip = (name: string, group: string) =>
			shipActionChipRow(
				{ name, uuid: name, system: { roll: { test: "tech-use" } } },
				group as never,
				localizeStub,
			).skipDialog;
		expect(chip("Break Free", "machinery")).toBe(true);
		expect(chip("Rout", "machinery")).toBe(true);
		expect(chip("Ramming", "machinery")).toBe(false);
		expect(chip("Boarding", "machinery")).toBe(false);
		expect(chip("Break Free-ish", "machinery")).toBe(false);
	});

	test("helmsman options annotate the bare Pilot (decision 10) and flag the pick", () => {
		const options = helmsmanOptions(
			[
				{
					type: "explorer",
					uuid: "Actor.spec",
					name: "With Spec",
					items: { contents: [{ type: "skill", name: "Pilot (Space Craft)" }] },
				},
				{
					type: "explorer",
					uuid: "Actor.bare",
					name: "Bare Pilot",
					items: { contents: [{ type: "skill", name: "Pilot" }] },
				},
				{ type: "npc", uuid: "Actor.ork", name: "Ork ship" },
			],
			"Actor.bare",
			localizeStub,
		);
		expect(options).toHaveLength(2);
		expect(options[0]).toMatchObject({
			uuid: "Actor.spec",
			label: "With Spec",
			selected: false,
		});
		expect(options[1]).toMatchObject({
			uuid: "Actor.bare",
			selected: true,
		});
		expect(options[1].label).toContain("SHIP_COMBAT.HELMSMAN_BARE_PILOT");
	});

	test("the boarding banner reuses the S7 kernel rows (no second maths)", () => {
		const banner = boardingBanner(
			{
				boardedWith: { uuid: "Actor.ork", breakFreeFailedThisTurn: true },
				crewPopulation: 70,
				hullIntegrity: { value: 40 },
				turretRating: 1,
				turnFlags: [],
			},
			{
				name: "Ork Terror Ship",
				system: {
					crewPopulation: 100,
					hullIntegrity: { value: 60 },
					turretRating: 2,
					turnFlags: [],
				},
			},
			localizeStub,
			(key, vars) => `${key}:${vars ? JSON.stringify(vars) : ""}`,
			"u:break-free",
		);
		expect(banner.locked).toBe(true);
		expect(banner.bannerLabel).toContain("SHIP_BOARDING.BOARDED_WITH");
		expect(banner.bannerLabel).toContain("Ork Terror Ship");
		// The kernel numbers (Core Rulebook p215): population −30 (three full
		// 10-point steps), hull −20, turret +10 vs −20 (p220).
		expect(banner.rows.map((r) => r.display)).toEqual([
			"SHIP_BOARDING.COMMAND_ROW_MINUS(30)",
			"SHIP_BOARDING.COMMAND_ROW_MINUS(20)",
			"SHIP_BOARDING.COMMAND_ROW_PLUS(10)",
			"SHIP_BOARDING.COMMAND_ROW_MINUS(20)",
			"SHIP_BOARDING.COMMAND_ROW_PLUS(0)",
		]);
		expect(banner.enemyRows.map((r) => r.display)).toEqual([
			"SHIP_BOARDING.COMMAND_ROW_PLUS(30)",
			"SHIP_BOARDING.COMMAND_ROW_PLUS(20)",
			"SHIP_BOARDING.COMMAND_ROW_PLUS(20)",
			"SHIP_BOARDING.COMMAND_ROW_MINUS(10)",
			"SHIP_BOARDING.COMMAND_ROW_PLUS(0)",
		]);
		expect(banner.penalty).toBe(true);
		expect(banner.penaltyLabel).toBe("SHIP_BOARDING.BREAK_FREE_PENALTY");
		expect(banner.breakFreeRowUuid).toBe("u:break-free");
	});

	test("an unboarded ship renders no boarding context", () => {
		const banner = boardingBanner(
			{ boardedWith: { uuid: "", breakFreeFailedThisTurn: false } },
			null,
			localizeStub,
			(key) => key,
		);
		expect(banner.locked).toBe(false);
	});

	test("turn-flag chips carry value + expiry, and persistent for repel-boarders", () => {
		const chips = turnFlagChips(
			[
				{
					id: "flag:evasive",
					key: "evasive",
					value: -10,
					target: "all",
					expiresAtTurn: null,
					persistent: false,
				},
				{
					id: "flag:repel",
					key: "repel-boarders",
					value: 5,
					target: "all",
					expiresAtTurn: null,
					persistent: true,
				},
				{
					id: "flag:lock",
					key: "lock-on-target",
					value: 5,
					target: "w1",
					expiresAtTurn: null,
					persistent: false,
				},
			],
			(itemId) => (itemId === "w1" ? "Sunsear Lance" : ""),
			localizeStub,
		);
		expect(chips[0].tooltip).toContain("SHIP_COMBAT.TURN_FLAG_EXPIRY");
		expect(chips[0].display).toBe("-10");
		expect(chips[1].persistent).toBe(true);
		expect(chips[1].tooltip).toContain("SHIP_COMBAT.TURN_FLAG_PERSISTENT");
		// The named-component flag names its component (Lock on Target).
		expect(chips[2].tooltip).toContain("Sunsear Lance");
	});
});

// --- the ship-action handler's pack-uuid seam (bead 7gcm) -------------------

describe("resolveShipActionItem (the chips' pack-uuid fallback)", () => {

	const packRow = {
		type: "ship-action",
		name: "Adjust Bearing",
		uuid: "Compendium.rogue-trader.starship-actions.Item.1",
		system: {
			roll: { test: "pilot-space-craft+manoeuvrability", difficulty: "" },
		},
	};

	function ship(withOwned = false): unknown {
		const items = withOwned
			? [
					{
						type: "ship-action",
						name: "Adjust Bearing",
						id: "own1",
						uuid: "Item.own1",
						system: {},
					},
				]
			: [];
		return {
			name: "Sabre",
			uuid: "Actor.sabre",
			isOwner: true,
			items: Object.assign([...items], {
				get: (id: string) =>
					items.find((i) => (i as { id?: string }).id === id),
			}),
			system: { crewQuality: "veteran", manoeuvrability: 30 },
		};
	}

	test("an owned item id resolves first; a non-uuid miss stays null", async () => {
		const res = await resolveShipActionItem(ship(true) as never, "own1");
		expect(res?.type).toBe("ship-action");
		expect(await resolveShipActionItem(ship(), "own1")).toBeNull();
	});

	test("a pack uuid resolves through the ContentPort (the sheet chips)", async () => {
		const calls: string[] = [];
		setPorts({
			...getPorts(),
			i18n: {
				...getPorts().i18n,
				t: (key: string) => key,
			},
			content: {
				...getPorts().content,
				document: async (uuid: string) => {
					calls.push(uuid);
					return packRow;
				},
			},
		} as never);
		try {
			const res = await resolveShipActionItem(
				ship() as never,
				packRow.uuid as string,
			);
			expect(res?.name).toBe("Adjust Bearing");
			expect(calls).toEqual([packRow.uuid]);
			// And prepare() runs the SAME handler over the resolved doc (a
			// pack row enters the kind, the crew fallback for the performer).
			const prepared = (await shipActionHandler.prepare({
				kind: "ship-action",
				actor: ship(),
				itemId: packRow.uuid,
			})) as { title?: string; kindData?: { crewFallback?: boolean } };
			expect(prepared?.kindData?.crewFallback).toBe(true);
		} finally {
			resetPorts();
		}
	});
});

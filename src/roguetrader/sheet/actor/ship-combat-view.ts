/**
 * SHIP COMBAT tab view model (epic necp bead 7gcm) — the sheet-side surface
 * over the S1/S5/S7 ship-action machinery, mirroring actions-view.ts's
 * separation: every function here is PURE (the localiser is a parameter, no
 * Foundry globals), so the tab's view model unit-tests without Foundry; the
 * sheet (ship-sheet.ts) owns only the document reads — the pack fetch, the
 * game.actors listing and the uuid resolutions — and delegates to these.
 *
 * - `shipActionGroupsContext` — the starship-actions pack rows grouped
 *   Manoeuvre (Table 8-10) / Machinery (the p215 prose rows) / Ordnance (the
 *   ships-pack Battlefleet Koronus rows, bead brex blocker 1) / Extended
 *   (Table 8-11), keyed through the row dispatch TABLES themselves
 *   (manoeuvreRow / boardingRowHandlers / ordnanceRowHandlers — no hardcoded
 *   name lists; the groups follow the data wherever the pack carries a row).
 * - `shipActionChipRow` — one roll chip (printed test + difficulty label +
 *   composed tooltip); Break Free / Rout ride skipDialog (S7's rows own
 *   their own prompts).
 * - `helmsmanOptions` — the picker's explorer options with the decision-10
 *   Pilot annotation (the trained BARE parent stands in at the p75
 *   untrained-specialisation penalty) and the always-present crew-fallback
 *   row rendered by the template as the empty option.
 * - `turnFlagChips` — the S2 turn flags as bonus/penalty chips with the
 *   expiry ("next own turn") / persistent notes.
 * - `boardingBanner` — the locked-pair banner: the S7 kernel's computed
 *   opposed-Command bonus rows (boardingCommandBonus + ship-boarding's own
 *   row helpers — the SAME numbers the boarding cards read, no second
 *   maths), the −20 failed-break-free penalty and the break-free row uuid.
 */
import {
	boardingCommandBonus,
	SHIP_TURN_FLAG_TARGET_ALL,
	type ShipBoardingState,
	type ShipTurnFlag,
	shipIsBoarded,
} from "../../../rules-engine/index";
import {
	parseShipActionTestKey,
	SHIP_ACTION_SHIP_STATS,
} from "../../presentation/rolls/ship-action";
import {
	boardingRowHandlers,
	boardingRowKey,
	boardingSide,
	commandBonusRows,
	type StarshipSystem,
} from "../../presentation/rolls/ship-boarding";
import { manoeuvreRow } from "../../presentation/rolls/ship-manoeuvre";
import {
	ORDNANCE_PROMPT_ONLY_ROWS,
	ordnanceRowHandlers,
} from "../../presentation/rolls/ship-ordnance";
// Bead iktx: the ONE characteristic-label composition seam (labels.ts).
import { characteristicLabelKey } from "../../rules/labels";

/** The starship-actions concept pack (bead ca3x/S4) — the chip source. */
export const STARSHIP_ACTIONS_PACK = "rogue-trader.starship-actions";

/** Ship-action pack doc shape the chips read (the ShipAction Item schema). */
export interface ShipActionDoc {
	type?: string;
	name?: string;
	uuid?: string;
	system?: {
		actionCost?: string;
		shortDescription?: string;
		roll?: { test?: string; difficulty?: string };
	};
}

/** One chip row on the combat tab's SHIP ACTIONS lists. */
export interface ShipActionChipRow {
	name: string;
	/** The pack doc uuid — the chip click rolls THROUGH the ship-action kind. */
	uuid: string;
	/** The printed test, localised (skill + " + " ship ability). */
	testLabel: string;
	/** The verbatim printed difficulty token ("Hard (-20)"). */
	difficulty: string;
	/** Break Free / Rout run skipDialog — S7's rows own their own prompts. */
	skipDialog: boolean;
	tooltip: string;
}

/** The combat tab's SHIP ACTIONS group labels, keyed by dispatch class. */
export const SHIP_ACTION_GROUP_KEYS: Record<ShipActionGroupKey, string> = {
	manoeuvre: "SHIP_COMBAT.ACTION_GROUP_MANOEUVRE",
	machinery: "SHIP_COMBAT.ACTION_GROUP_MACHINERY",
	ordnance: "SHIP_COMBAT.ACTION_GROUP_ORDNANCE",
	extended: "SHIP_COMBAT.ACTION_GROUP_EXTENDED",
};

/** Group order: Table 8-10, then the p215 machinery rows, then the ships
 * pack's BFK ordnance rows, then 8-11. */
export const SHIP_ACTION_GROUP_ORDER = [
	"manoeuvre",
	"machinery",
	"ordnance",
	"extended",
] as const;

export type ShipActionGroupKey = (typeof SHIP_ACTION_GROUP_ORDER)[number];

/** The groups + the break-free row uuid the boarding banner points at. */
export interface ShipActionsContext {
	groups: Array<{
		key: ShipActionGroupKey;
		labelKey: string;
		rows: ShipActionChipRow[];
	}>;
	breakFreeRowUuid: string;
}

/** The row's dispatch class (S5's manoeuvre map → S7's machinery map → the
 * S9 ordnance map → the Table 8-11 extended default). */
export function shipActionGroupFor(name: string): ShipActionGroupKey {
	return manoeuvreRow(name)
		? "manoeuvre"
		: boardingRowHandlers[boardingRowKey(name)]
			? "machinery"
			: ordnanceRowHandlers[boardingRowKey(name)]
				? "ordnance"
				: "extended";
}

/** The machine test key as the printed-test label (authored skill names
 * verbatim, characteristics/interaction through their label keys). The
 * NOTE-ONLY machinery rows (nit 16: their `roll.test` is a machine token,
 * never a printed test) label as the manual machinery they are instead of
 * flashing the raw key; any other unmapped key keeps the raw input — a
 * new row falls through VISIBLY, never blank. */
export const SHIP_ACTION_NOTE_ONLY_TEST_LABELS: Readonly<
	Record<string, string>
> = {
	// Rout: prepare-only boarding machinery (the opposed Command is
	// GM-resolved, the d100-vs-Morale runs in the row's own prompts) —
	// Core Rulebook p215.
	rout: "SHIP_COMBAT.TEST_NOTE_ONLY",
};

export function shipActionTestLabel(
	test: string,
	localize: (key: string) => string,
): string {
	const parsed = parseShipActionTestKey(test);
	if (!parsed) {
		const noteOnly = SHIP_ACTION_NOTE_ONLY_TEST_LABELS[test];
		return noteOnly ? localize(noteOnly) : test;
	}
	const route = parsed.skillRoute;
	const parts: string[] = [];
	if (route.skill) parts.push(route.skill);
	else if (route.characteristic)
		parts.push(localize(characteristicLabelKey(route.characteristic)));
	else if (route.interaction)
		parts.push(localize("SHIP_COMBAT.TEST_INTERACTION_ANY"));
	if (parsed.shipStat)
		parts.push(localize(`SHIP_COMBAT.STAT_${parsed.shipStat.toUpperCase()}`));
	return parts.join(" + ") || test;
}

/** The groups + the break-free row uuid for the boarding banner. A missing
 * pack degrades to no groups (the template shows its empty-state hint);
 * empty groups drop out. Book order preserved: the pack stores the table's
 * row order (the tab is the table's sheet face, actions-tab convention). */
export function shipActionGroupsContext(
	docs: ShipActionDoc[],
	localize: (key: string) => string,
): ShipActionsContext {
	const keyed = docs
		.filter((doc) => (doc.type ?? "") === "ship-action")
		.map((doc) => ({
			doc,
			group: shipActionGroupFor(doc.name ?? ""),
		}));
	const groups = SHIP_ACTION_GROUP_ORDER.map((key) => ({
		key,
		labelKey: SHIP_ACTION_GROUP_KEYS[key],
		rows: keyed
			.filter((row) => row.group === key)
			.map((row) => shipActionChipRow(row.doc, key, localize)),
	})).filter((group) => group.rows.length > 0);
	const breakFreeRowUuid =
		keyed.find((row) => boardingRowKey(row.doc.name ?? "") === "break-free")
			?.doc.uuid ?? "";
	return { groups, breakFreeRowUuid };
}

/**
 * The item types the ship refit drop accepts (bead brex blocker 2): the two
 * component families install as refit; `ship-ordnance` items install as
 * STORES — the BFK run rows read them as the ship's torpedo/attack-craft
 * stock, so deleting them (the old behaviour) left the launch rows
 * permanently unreachable.
 */
export const SHIP_REFIT_TYPES: readonly string[] = [
	"ship-component",
	"ship-weapon-component",
	"ship-ordnance",
];

/** One chip row: printed test + difficulty label + composed tooltip
 * (the actions-tab tooltip anatomy: cost — terse line — difficulty). */
export function shipActionChipRow(
	doc: ShipActionDoc,
	group: ShipActionGroupKey,
	localize: (key: string) => string,
): ShipActionChipRow {
	const name = doc.name ?? "";
	const data = doc.system ?? {};
	const difficulty = (data.roll?.difficulty ?? "").trim();
	const cost = data.actionCost ?? "";
	// Own-prompt rows skip the dialog: the machinery rows with their OWN
	// prompts (bead w98s/S7 — Break Free is the turn-start break; Rout is
	// prepare-only d100 vs Morale + the winner prompts) and the prepare-only
	// ordnance rows (launch/run/fighter own their prompts, so a dialog over a
	// target-less test adds nothing — the S9 row modules own the dice).
	const rowKey = boardingRowKey(name);
	const skipDialog =
		(group === "machinery" && (rowKey === "break-free" || rowKey === "rout")) ||
		(group === "ordnance" && ORDNANCE_PROMPT_ONLY_ROWS.has(rowKey));
	const testLabel = shipActionTestLabel(data.roll?.test ?? "", localize);
	// Roll spec (owner ask, 2026-10-20): the test label + printed difficulty
	// live IN THE TOOLTIP, not on the visible chip row — the row shows only
	// the dice mark + the action name. Without a test the actions-tab fallback
	// line still applies (difficulty alone, or the roll-click hint).
	const rollSpec = testLabel
		? `${testLabel}${difficulty ? ` ${difficulty}` : ""}`
		: difficulty
			? `${localize("ACTION.DIFFICULTY")}: ${difficulty}`
			: "";
	return {
		name,
		uuid: doc.uuid ?? "",
		testLabel,
		difficulty,
		skipDialog,
		tooltip:
			`${cost} — ${data.shortDescription ?? ""}` +
			(rollSpec ? ` — ${rollSpec}` : ` — ${localize("ACTION.ROLL_CLICK")}`),
	};
}

// ----------------------------------------------------------- helmsman picker

/** The world explorer shape #helmsmanContext passes in (structurally from
 * the Foundry Actor). */
export interface HelmsmanCandidate {
	type?: string;
	uuid: string;
	name?: string;
	/** The owned skill items' names/types, annotated bare per decision 10. */
	items?: { contents?: Array<{ name?: string; type?: string }> };
}

export interface HelmsmanOption {
	uuid: string;
	name: string;
	label: string;
	selected: boolean;
}

/** The picker options (decision 1 / decision 10): the world's explorers;
 * the trained BARE Pilot notes its untrained-stand-in, the owned
 * "Pilot (Space Craft)" renders plain. The always-present crew fallback
 * row is the template's empty option. */
export function helmsmanOptions(
	explorers: HelmsmanCandidate[],
	pickedUuid: string,
	localize: (key: string) => string,
): HelmsmanOption[] {
	return explorers
		.filter((actor) => actor.type === "explorer")
		.map((actor) => {
			const skills = actor.items?.contents ?? [];
			const spec = skills.some(
				(s) => s.type === "skill" && s.name === "Pilot (Space Craft)",
			);
			const bare =
				!spec && skills.some((s) => s.type === "skill" && s.name === "Pilot");
			const bareLabel = bare ? localize("SHIP_COMBAT.HELMSMAN_BARE_PILOT") : "";
			return {
				uuid: actor.uuid,
				name: actor.name ?? "",
				label: bareLabel
					? `${actor.name ?? ""} (${bareLabel})`
					: (actor.name ?? ""),
				selected: actor.uuid === pickedUuid,
			};
		});
}

// ------------------------------------------------------------ turn-flag chips

/** The stat-token fallback for the aid-machine-spirit targets (nit 15):
 * those flags target a stat token ("manoeuvrability"/"detection"), not a
 * component item — the item lookup misses and the tooltip would dangle a
 * bare " — ". The SHIP_ACTION_SHIP_STATS vocabulary's label renders
 * instead; an unknown token stays "" (the chip DROPS the " — " tail, it
 * never renders an empty name). */
function statTargetLabel(
	target: string,
	localize: (key: string) => string,
): string {
	const stat = SHIP_ACTION_SHIP_STATS[target];
	return stat ? localize(stat.label) : "";
}

/** One active turn-flag chip: label + signed value + the expiry note. */
export interface ShipFlagChip {
	id: string;
	key: string;
	label: string;
	/** The signed value ("+5" / "-10"). */
	display: string;
	/** The chip class ("bonus" | "penalty"). */
	kind: "bonus" | "penalty";
	persistent: boolean;
	tooltip: string;
}

/** The S2 turn flags as chips (read-only surface): the expiry note is
 * "next own turn" (decision 3) except the PERSISTENT Repel Boarders row
 * (Core Rulebook p218). A named-component flag names its component; an
 * aid-machine-spirit flag names its stat (nit 15's vocabulary fallback). */
export function turnFlagChips(
	flags: readonly ShipTurnFlag[],
	targetNameFor: (itemId: string) => string,
	localize: (key: string) => string,
): ShipFlagChip[] {
	return flags.map((flag) => {
		const label = localize(
			`SHIP_COMBAT.TURN_FLAG_${flag.key.replaceAll("-", "_").toUpperCase()}_CHIP`,
		);
		const display = flag.value >= 0 ? `+${flag.value}` : `${flag.value}`;
		const expiry = flag.persistent
			? localize("SHIP_COMBAT.TURN_FLAG_PERSISTENT")
			: localize("SHIP_COMBAT.TURN_FLAG_EXPIRY");
		const targetName =
			flag.target === SHIP_TURN_FLAG_TARGET_ALL
				? ""
				: targetNameFor(flag.target) || statTargetLabel(flag.target, localize);
		const target = targetName ? ` — ${targetName}` : "";
		return {
			id: flag.id,
			key: flag.key,
			label,
			display,
			kind: flag.value < 0 ? ("penalty" as const) : ("bonus" as const),
			persistent: flag.persistent === true,
			tooltip: `${label} ${display} — ${expiry}${target}`,
		};
	});
}

// ----------------------------------------------------------- boarding banner

/** The starship system fields the boarding banner reads (schema-first; the
 * StarshipActor fields). */
export interface ShipCombatState {
	turnFlags?: ShipTurnFlag[];
	boardedWith?: ShipBoardingState;
	/** The partner ship's statline rides the same shape. */
	crewPopulation?: number;
	crewMorale?: number;
	hullIntegrity?: { value?: number };
	turretRating?: number;
	silentRunning?: boolean;
}

/** The boarded banner's rendered rows (ship-boarding's BonusCardRow). */
export interface BoardedBannerRow {
	id: string;
	label: string;
	display: string;
}

/** The banner context: locked pair label, penalty, break-free row and the
 * computed opposed-Command rows BOTH directions (S7 kernel, no second
 * maths). An unboarded ship gets the locked:false stub. */
export function boardingBanner(
	starship: Partial<ShipCombatState> | undefined,
	partner: { name?: string; system?: Partial<ShipCombatState> } | null,
	localize: (key: string) => string,
	/** Interpolating localiser for the {target} banner label. */
	format: (key: string, vars?: Record<string, unknown>) => string,
	breakFreeRowUuid = "",
): {
	locked: boolean;
	bannerLabel: string;
	partnerName: string;
	penalty: boolean;
	penaltyLabel: string;
	breakFreeRowUuid: string;
	reminderLabel: string;
	rowsLabel: string;
	enemyRowsLabel: string;
	rows: BoardedBannerRow[];
	enemyRows: BoardedBannerRow[];
} {
	const state = starship?.boardedWith;
	if (!shipIsBoarded(state)) {
		return {
			locked: false,
			bannerLabel: "",
			partnerName: "",
			penalty: false,
			penaltyLabel: "",
			breakFreeRowUuid: "",
			reminderLabel: "",
			rowsLabel: "",
			enemyRowsLabel: "",
			rows: [],
			enemyRows: [],
		};
	}
	const own = boardingSide(starship as StarshipSystem);
	const opponent = boardingSide((partner?.system ?? {}) as StarshipSystem);
	return {
		locked: true,
		partnerName: partner?.name ?? "",
		bannerLabel: format("SHIP_BOARDING.BOARDED_WITH", {
			target: partner?.name ?? "—",
		}),
		penalty: state?.breakFreeFailedThisTurn === true,
		penaltyLabel: localize("SHIP_BOARDING.BREAK_FREE_PENALTY"),
		breakFreeRowUuid,
		reminderLabel: localize("SHIP_BOARDING.OPPOSED_COMMAND_NOTE"),
		rowsLabel: localize("SHIP_BOARDING.COMMAND_ROWS"),
		enemyRowsLabel: localize("SHIP_BOARDING.COMMAND_ROWS_ENEMY"),
		rows: commandBonusRows(boardingCommandBonus(own, opponent)),
		enemyRows: commandBonusRows(boardingCommandBonus(opponent, own)),
	};
}

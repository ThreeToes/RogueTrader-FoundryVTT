/**
 * Boarding-machinery row handlers (epic necp bead w98s, Core Rulebook p215):
 * the p215 prose subsections — Ramming, Boarding Actions, break-free and the
 * rout roll — entered through the SHARED `ship-action` roll kind (owner
 * decision 2: no parallel roll path; the dispatch merge lives in
 * ship-action.ts's prepare/after and routes by the item's row key).
 *
 * The shared plumbing stays in ship-action.ts: the combined test (Core
 * Rulebook p212 — the character's skill + the ship's ability), the crew
 * fallback (Table 8-9) and the printed difficulty rows are the standard
 * preparation; these rows layer their own gates and after-effects on TOP:
 *
 * - RAMMING (book p215): the ramming ship gives up its Shooting Action for
 *   the turn and must end its Manoeuvre within 1 VU, bow facing the target
 *   (the facing stays a GM check — no spatial sim in v1); the combined test
 *   is Hard (−20). On success the DEFENDER takes (hull-class die + the
 *   RAMMER's prow armour) — void shields are IGNORED explicitly (p215), so
 *   the damage does NOT route through the salvo's shield prompt — and the
 *   RAMMER takes (defender's armour + 1d5) the same way. Armour still soaks
 *   per the p221 damage rule; Hull Integrity losses drag Crew and Morale 1:1
 *   through crewLossFromHullDamage (both sides).
 * - BOARDING (book p215): same combined test within 1 VU; success writes
 *   the boardedWith pair onto BOTH ships (neither ship can take Manoeuvre
 *   or Shooting Actions; both drop to last in initiative, the S3 card). The
 *   locked card posts the opposed-Command manual reminder with the computed
 *   bonus rows both directions.
 * - BREAK-FREE (book p215): Hard (−20) combined test at the START of the
 *   ship's turn; success clears the pair on BOTH ships, failure keeps the
 *   lock and sets the −20 on the ship's SUBSEQUENT opposed Command test
 *   (S2's breakFreeFailedThisTurn).
 * - ROUT (book p215): each boarding turn's opposed Command stays MANUAL
 *   (owner ruling) — this surface resolves the turn: it prompts for which
 *   side won the manual Command, the winning degrees and the winner's
 *   per-degree pick (1d5 Crew Population + 1d5 Morale OR 1 Hull Integrity,
 *   which propagates Crew 1:1 as normal, p215→p221), applies it to the
 *   loser, then rolls the loser's rout d100 vs CURRENT Morale: equal or
 *   lower keeps fighting; higher routes — an NPC vessel surrenders, the
 *   explorers' vessel faces the grim choice (the book's own words, GM
 *   decision; v1 has no actor-data signal for who owns the vessel, so the
 *   GM picks the branch — see the rout row's card).
 *
 * Kernel maths lives in rules-engine/ship-turn-state.ts (ramHullClassDie,
 * boardingCommandBonus, routRoll, boardLockPairState, breakFreePairState);
 * everything here goes through the ports — the dialogs (DialogV2, the
 * roll-prompts.ts precedent) and the one Foundry uuid resolution are
 * presentation-layer only, never in the kernel.
 */

import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { outcomeLabel } from "../../../ffg/presentation/rolls/pipeline";
import type { Modifier } from "../../../rules-engine/index";
import {
	type BoardingCommandBonus,
	type BoardingTurnSide,
	boardingCommandBonus,
	boardLockPairState,
	breakFreePairState,
	combinedTarget,
	crewLossFromHullDamage,
	ramHullClassDie,
	resolveSalvoDamage,
	routRoll,
	type ShipBoardingState,
	type ShipTurnFlag,
	shipIsBoarded,
	shipLockGate,
} from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { actionDifficulty } from "../../rules/actions";
import { postCard } from "../../rules/chat-flags";
import type {
	PreparedRoll,
	RollHandler,
	ShipActionRollRequest,
} from "../../rules/roll-contract";
import type { PackDocAnchor } from "../../sheet/pack-doc-links";
import { OPEN_PACK_DOC_ACTION } from "../../sheet/pack-doc-links";
import { escapeDocumentData } from "../roll-prompts";
import {
	parseShipActionTestKey,
	resolvePerformerSide,
	shipAbilityRow,
} from "./ship-action";

// ------------------------------------------------------------- row dispatch

/**
 * The minimal ship-action item shape the rows read (a Foundry Item passes
 * structurally).
 */
interface ShipActionItemLike {
	name?: string | null;
	uuid?: string | null;
	system?: unknown;
}

/**
 * One machinery row: the row OWNS its whole preparation (gates + the shared
 * combined test + the standard kindData anatomy) and its outcome machinery;
 * ship-action.ts's after() delegates to it INSTEAD of posting the standard
 * action card — every row posts its own card (the ship-weapon two-card
 * precedent).
 */
export interface ShipRow {
	prepare(
		request: ShipActionRollRequest,
		item: ShipActionItemLike,
	): Promise<PreparedRoll<"ship-action"> | null>;
	after?: RollHandler<"ship-action">["after"];
}

/**
 * The machine row key: the item's name normalised (lowercase, hyphenated).
 * The canonical names carry the machinery — "Ramming", "Boarding", "Break
 * Free", "Rout" (the Core Rulebook p215 subsection vocabulary, with the
 * "Boarding Actions" full-heading alias). A RENAMED item falls through to
 * the standard path silently — the pack/UI surfaces must use the canonical
 * names (bead 7gcm owns the chips).
 */
export function boardingRowKey(name: string): string {
	return (name ?? "")
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// ------------------------------------------------------------ gates + prompts

/** Starship statline the rows read (schema-first, bead vph0). */
interface StarshipSystem {
	hullClass?: string;
	armour?: number;
	hullIntegrity?: { value?: number; max?: number };
	voidShields?: number;
	crewPopulation?: number;
	crewMorale?: number;
	crewQuality?: string;
	turretRating?: number;
	turnFlags?: ShipTurnFlag[];
	boardedWith?: Partial<ShipBoardingState>;
}

const readShipSystem = (ship: unknown): StarshipSystem =>
	systemOf(ship as { system: unknown }) as StarshipSystem;

/**
 * The lock gate for the ram/board entries (Core Rulebook p215): a LOCKED
 * ship cannot take Manoeuvre or Shooting Actions, and ramming/boarding
 * consume the ship's Movement — the manoeuvre-class gate refuses.
 */
function notWhileBoardedGate(ship: unknown): boolean {
	if (shipLockGate(readShipSystem(ship).boardedWith, "manoeuvre").allowed) {
		return true;
	}
	getPorts().notify.warn("SHIP_COMBAT.BOARDED_NO_MANOEUVRE");
	return false;
}

/**
 * The ram/boarding "give up Shooting Action" assertion (book p215: the ship
 * gives up its Shooting this turn). The v1 starship schema records no
 * fired-this-turn state (the salvo's after-hook writes none), so the gate
 * reads the field DEFENSIVELY — turn-state machinery that starts recording
 * fire blocks these entries with no handler change.
 */
function hasNotFiredGate(ship: unknown): boolean {
	const system = readShipSystem(ship) as StarshipSystem & {
		firedThisTurn?: unknown;
	};
	if (system.firedThisTurn === true) {
		getPorts().notify.warn("SHIP_BOARDING.ALREADY_FIRED");
		return false;
	}
	return true;
}

/**
 * The boarded-only gate: break-free and rout only run on a LOCKED ship —
 * the boarding machinery is only ever in force during the lock.
 */
function whileBoardedGate(ship: unknown): boolean {
	if (shipIsBoarded(readShipSystem(ship).boardedWith)) return true;
	getPorts().notify.warn("SHIP_BOARDING.NOT_BOARDED");
	return false;
}

/**
 * Manual distance entry (the spatial-map non-goal: Core Rulebook p215's
 * "within one VU" stays a GM check, like the Disengage gate; the bow-facing
 * requirement rides the card note). The caller refuses anything beyond the
 * book's 1 VU. Cancel = the user declined the attempt (the roll stops, no
 * warning); the distance entry itself is the bead's manual-entry surface.
 */
async function promptBoardingDistance(
	targetName: string,
): Promise<number | null> {
	const ports = getPorts();
	const result = (await foundry.applications.api.DialogV2.input({
		window: {
			title: ports.i18n.t("SHIP_BOARDING.DISTANCE_TITLE"),
		},
		content: `<p>${ports.i18n.t("SHIP_BOARDING.DISTANCE_PROMPT", {
			target: targetName ? escapeDocumentData(targetName) : "",
		})}</p><div class="form-group"><input type="number" name="distance" value="1" min="0" step="1"></div>`,
		ok: { label: ports.i18n.t("SHIP_BOARDING.DISTANCE_CONFIRM") },
	})) as { distance?: string } | null;
	const parsed = Number(result?.distance);
	return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

/** The shared within-1-VU + gates preamble of the ram and lock rows. */
async function ramBoardPreamble(
	request: ShipActionRollRequest,
	rowName: string,
): Promise<boolean> {
	const ports = getPorts();
	const ship = request.actor;
	if (!hasNotFiredGate(ship)) return false;
	if (!notWhileBoardedGate(ship)) return false;
	const target = ports.targets.actor() as
		| (Actor & { name?: string })
		| undefined;
	if (!target) {
		ports.notify.warn("SHIP_COMBAT.NO_TARGET");
		return false;
	}
	// Book p215: the ship ends its Manoeuvre Action within ONE VU (the
	// facing check stays GM-side; the card notes it).
	const distance = await promptBoardingDistance(target.name ?? "");
	if (distance === null) return false;
	if (distance > 1) {
		ports.notify.warn("SHIP_BOARDING.OUT_OF_RANGE", {
			distance,
			row: rowName,
		});
		return false;
	}
	return true;
}

// ------------------------------------------------- the shared combined test

/**
 * The standard combined-test preparation (Core Rulebook p212), the same
 * resolution ship-action.ts's standard path runs: helmsman skill or crew
 * fallback, the ship-ability row, the printed difficulty row and the
 * kindData anatomy. The row dispatch re-enters HERE rather than through
 * shipActionHandler (its dispatch would loop); the pipeline tests pin the
 * shared numbers so a divergence between the two bodies is test-visible.
 */
async function prepareCombinedTest(
	request: ShipActionRollRequest,
	item: ShipActionItemLike,
): Promise<PreparedRoll<"ship-action"> | null> {
	const ports = getPorts();
	const ship = request.actor;
	const data = (item.system ?? {}) as {
		actionCost?: string;
		shortDescription?: string;
		roll?: { test?: string; difficulty?: string };
	};
	const parsed = parseShipActionTestKey(data.roll?.test ?? "");
	if (!parsed) {
		ports.notify.warn("SHIP_ACTION.UNKNOWN_TEST", {
			test: data.roll?.test || "—",
			action: item.name ?? "",
		});
		return null;
	}
	const side = await resolvePerformerSide(
		request,
		parsed.skillRoute,
		parsed.routeKey,
	);
	if (!side) return null;
	const modifiers: Modifier[] = [];
	let shipMod = 0;
	if (parsed.shipStat) {
		const starship = readShipSystem(ship) as unknown as Record<
			string,
			number | undefined
		>;
		shipMod = starship[parsed.shipStat] ?? 0;
		modifiers.push(shipAbilityRow(parsed.shipStat, shipMod));
	}
	// The p75 untrained-specialisation stand-in as a VISIBLE row.
	if (side.specPenalty) {
		modifiers.push({
			id: "ship:untrained-specialisation",
			source: { type: "skill", label: "SOURCE.FROM_SKILL" },
			label: ports.i18n.t("SHIP_ACTION.UNTRAINED_SPEC", {
				skill: parsed.skillRoute.skill,
			}),
			value: side.specPenalty,
		});
	}
	// The printed difficulty through the shared ladder (see ship-action.ts):
	// numeric tokens contribute a visible row; an UNMAPPED one is a broken
	// row — the same loud refusal the standard path gives.
	try {
		const difficulty = actionDifficulty(data.roll?.difficulty ?? "");
		if (difficulty.kind === "numeric") {
			modifiers.push({
				id: "ship-action:difficulty",
				source: { type: "item", label: "SHIP_COMBAT.DIFFICULTY" },
				label: data.roll?.difficulty ?? "",
				value: difficulty.value,
			});
		}
	} catch (error) {
		ports.notify.warn("SHIP_ACTION.UNKNOWN_DIFFICULTY", {
			difficulty: data.roll?.difficulty || "—",
			action: item.name ?? "",
		});
		console.warn(error);
		return null;
	}
	modifiers.push(...(request.modifiers ?? []));
	return {
		title: `${ship.name} — ${item.name}`,
		baseTarget: side.baseTarget,
		testKind: side.testKind,
		testKey: side.testKey,
		initialModifiers: modifiers,
		weapon: null,
		context: { skillName: side.skillName },
		kindData: {
			itemId: request.itemId,
			uuid: item.uuid ?? "",
			name: item.name ?? "",
			actionCost: data.actionCost ?? "",
			description: data.shortDescription ?? "",
			testKey: data.roll?.test ?? "",
			difficulty: data.roll?.difficulty ?? "",
			// Reclassified below through the same ladder (the try/catch above
			// already refused broken tokens — this can only see mapped ones).
			difficultyKind: difficultyKindOf(data.roll?.difficulty ?? ""),
			crewFallback: !request.performer,
			shipMod,
			combinedTarget: combinedTarget(side.baseTarget, shipMod),
		},
	};
}

/** Re-run the difficulty classification for kindData (mirrors the standard). */
function difficultyKindOf(difficulty: string): "none" | "opposed" | "numeric" {
	try {
		return actionDifficulty(difficulty).kind;
	} catch {
		return "none";
	}
}

// ------------------------------------------------------- shared card pieces

/** The card doc anchor (the lookup-card anatomy ship-action.ts posts). */
function docAnchor(kindData: PreparedRoll["kindData"]): PackDocAnchor | null {
	const data = kindData as { uuid?: string; name?: string } | undefined;
	return data?.uuid
		? {
				action: OPEN_PACK_DOC_ACTION,
				uuid: data.uuid,
				name: data.name ?? "",
			}
		: null;
}

/** The opposed-Command bonus rows rendered visibly (p215: never silent). */
interface BonusCardRow {
	id: string;
	label: string;
	/** The pre-rendered signed value ("+20" / "−10") — no template helpers. */
	display: string;
}

/** The signed display of one bonus row (the prompt's two i18n keys). */
function bonusDisplay(
	ports: ReturnType<typeof getPorts>,
	value: number,
): string {
	const magnitude = Math.abs(value);
	return value >= 0
		? ports.i18n.t("SHIP_BOARDING.COMMAND_ROW_PLUS", { bonus: magnitude })
		: ports.i18n.t("SHIP_BOARDING.COMMAND_ROW_MINUS", { bonus: magnitude });
}

/** The five signed rows one side of a boarding turn reads. */
function commandBonusRows(bonus: BoardingCommandBonus): BonusCardRow[] {
	const ports = getPorts();
	return [
		{
			id: "bon:population",
			label: ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_POPULATION"),
			display: bonusDisplay(ports, bonus.population),
		},
		{
			id: "bon:hull",
			label: ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_HULL"),
			display: bonusDisplay(ports, bonus.hullIntegrity),
		},
		{
			id: "bon:turret",
			label: ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_TURRET"),
			display: bonusDisplay(ports, bonus.turret),
		},
		{
			id: "bon:turret-opponent",
			label: ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_OPPONENT_TURRET"),
			display: bonusDisplay(ports, bonus.opponentTurret),
		},
		{
			id: "bon:repel",
			label: ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_REPEL"),
			display: bonusDisplay(ports, bonus.repel),
		},
	];
}

/** One side's opposed-Command input off its live statline (p215/p220). */
function boardingSide(system: StarshipSystem): BoardingTurnSide {
	return {
		crewPopulation: Math.max(0, system.crewPopulation ?? 100),
		hullIntegrity: Math.max(0, system.hullIntegrity?.value ?? 0),
		turretRating: Math.max(0, system.turretRating ?? 0),
		// The persistent Repel Boarders bonus (p218) rides a turn flag's value.
		repelBonus:
			system.turnFlags?.find((flag) => flag.key === "repel-boarders")?.value ??
			0,
	};
}

/** Track write for HI + Crew losses (one payload per ship, the 6l68 rule). */
function crewTrackWrite(
	system: StarshipSystem,
	hullDamage: number,
): {
	hullIntegrity: { value: number };
	crewPopulation: number;
	crewMorale: number;
} {
	const loss = crewLossFromHullDamage(hullDamage);
	return {
		hullIntegrity: {
			value: Math.max(0, (system.hullIntegrity?.value ?? 0) - hullDamage),
		},
		crewPopulation: Math.max(
			0,
			Math.max(0, system.crewPopulation ?? 100) - loss.population,
		),
		crewMorale: Math.max(
			0,
			Math.max(0, system.crewMorale ?? 100) - loss.morale,
		),
	};
}

// ------------------------------------------------------------------ ramming

/** RAMMING (Core Rulebook p215): gives up Shooting; within 1 VU; Hard (−20). */
const rammingRow: ShipRow = {
	async prepare(request, item) {
		if (!(await ramBoardPreamble(request, "ramming"))) return null;
		return prepareCombinedTest(request, item);
	},
	async after(request, prepared, outcome, _messageId) {
		const ports = getPorts();
		const rammer = request.actor;
		const target = ports.targets.actor() as
			| (Actor & { name?: string })
			| undefined;
		// The row posts its own card in EVERY branch (after() replaces the
		// standard action card — the machinery row contract).
		const rammerSystem = readShipSystem(rammer);
		if (!outcome.success) {
			await postCard(rammer, `${TEMPLATE_ROOT}chat/ship-ramming.hbs`, {
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: (prepared.kindData as { name?: string }).name ?? "",
					link: docAnchor(prepared.kindData),
				},
				success: false,
				targetName: target?.name ?? "",
				roll: outcome.roll,
				outcomeLabel: outcomeLabel(false, outcome.degrees),
			});
			return;
		}
		if (!target) {
			ports.notify.warn("SHIP_COMBAT.NO_TARGET");
			return;
		}
		const targetSystem = readShipSystem(target);
		// The hull-class die (transports/raiders 1d5 ... cruisers 2d10, p215):
		// an unmapped hull class is corrupt data — refuse LOUDLY, apply
		// NOTHING (never a silently inferred die).
		const die = ramHullClassDie(rammerSystem.hullClass ?? "");
		if (!die) {
			ports.notify.error("SHIP_BOARDING.RAM_UNKNOWN_HULL_CLASS", {
				hullClass: rammerSystem.hullClass || "—",
			});
			return;
		}
		// The ram: hull-class die + the RAMMER's prow armour, void shields
		// IGNORED (p215) — no salvo shield prompt; the p221 Armour soak still
		// applies through resolveSalvoDamage.
		const ramRoll = await ports.dice.roll(die);
		const ramTotal = ramRoll.total + Math.max(0, rammerSystem.armour ?? 0);
		const ramSalvo = resolveSalvoDamage({
			damageTotal: ramTotal,
			armour: Math.max(0, targetSystem.armour ?? 0),
			lance: false,
		});
		const ramCrewLoss = crewLossFromHullDamage(ramSalvo.hullDamage);
		// The rammer takes the defender's armour + 1d5 to its own prow (p215)
		// — the same shield bypass, its own Armour soaks.
		const backRoll = await ports.dice.roll("1d5");
		const backTotal = backRoll.total + Math.max(0, targetSystem.armour ?? 0);
		const backSalvo = resolveSalvoDamage({
			damageTotal: backTotal,
			armour: Math.max(0, rammerSystem.armour ?? 0),
			lance: false,
		});
		const backCrewLoss = crewLossFromHullDamage(backSalvo.hullDamage);
		// HI + Crew/Morale on BOTH sides; one write payload per ship (6l68).
		await ports.actors.update(target, {
			system: crewTrackWrite(targetSystem, ramSalvo.hullDamage),
		});
		await ports.actors.update(rammer, {
			system: crewTrackWrite(rammerSystem, backSalvo.hullDamage),
		});
		await postCard(
			rammer,
			`${TEMPLATE_ROOT}chat/ship-ramming.hbs`,
			{
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: (prepared.kindData as { name?: string }).name ?? "",
					link: docAnchor(prepared.kindData),
				},
				success: true,
				targetName: target.name ?? "",
				roll: outcome.roll,
				outcomeLabel: outcomeLabel(true, outcome.degrees),
				ramDie: die,
				ramDamage: ramTotal,
				ramArmour: ramSalvo.armourAbsorbed,
				ramHullDamage: ramSalvo.hullDamage,
				ramPopulationLoss: ramCrewLoss.population,
				ramMoraleLoss: ramCrewLoss.morale,
				backDamage: backTotal,
				backArmour: backSalvo.armourAbsorbed,
				backHullDamage: backSalvo.hullDamage,
				backPopulationLoss: backCrewLoss.population,
				backMoraleLoss: backCrewLoss.morale,
			},
			undefined,
			// Bead wvkd: the ram dice animate via the card's rolls.
			[...(ramRoll.rolls ?? []), ...(backRoll.rolls ?? [])],
		);
	},
};

// ----------------------------------------------------------------- boarding

/** BOARDING (Core Rulebook p215): the lock within 1 VU; the pair on both. */
const boardingRow: ShipRow = {
	async prepare(request, item) {
		if (!(await ramBoardPreamble(request, "boarding"))) return null;
		return prepareCombinedTest(request, item);
	},
	async after(request, prepared, outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		if (!outcome.success) {
			// The lock fails: the ships remain separate (Manoeuvre spent).
			await postCard(ship, `${TEMPLATE_ROOT}chat/ship-boarding.hbs`, {
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: (prepared.kindData as { name?: string }).name ?? "",
					link: docAnchor(prepared.kindData),
				},
				locked: false,
				roll: outcome.roll,
				outcomeLabel: outcomeLabel(false, outcome.degrees),
			});
			return;
		}
		const target = ports.targets.actor() as
			| (Actor & { name?: string; uuid?: string })
			| undefined;
		if (!target) {
			ports.notify.warn("SHIP_COMBAT.NO_TARGET");
			return;
		}
		// The lock lands on BOTH ships (Core Rulebook p215): the pair uuids
		// point at each other, the lock gate then refuses Manoeuvre and
		// Shooting on both sides, and the S3 initiative drops the pair last.
		const partnerUuid = target.uuid ?? "";
		await ports.actors.update(ship, {
			system: {
				boardedWith: boardLockPairState(partnerUuid),
			},
		});
		await ports.actors.update(target, {
			system: {
				boardedWith: boardLockPairState((ship as { uuid?: string }).uuid ?? ""),
			},
		});
		// The locked card carries the opposed-Command manual reminder with the
		// computed bonus rows BOTH directions (Core Rulebook p215/p220/p218).
		const shipSystem = readShipSystem(ship);
		const targetSystem = readShipSystem(target);
		const targetName = ports.i18n.t("SHIP_BOARDING.BOARDED_WITH", {
			target: target.name ?? "",
		});
		await postCard(ship, `${TEMPLATE_ROOT}chat/ship-boarding.hbs`, {
			title: prepared.title,
			titleDoc: {
				prefix: "",
				suffix: "",
				name: (prepared.kindData as { name?: string }).name ?? "",
				link: docAnchor(prepared.kindData),
			},
			locked: true,
			targetName,
			roll: outcome.roll,
			outcomeLabel: outcomeLabel(true, outcome.degrees),
			commandRows: commandBonusRows(
				boardingCommandBonus(
					boardingSide(shipSystem),
					boardingSide(targetSystem),
				),
			),
			enemyCommandRows: commandBonusRows(
				boardingCommandBonus(
					boardingSide(targetSystem),
					boardingSide(shipSystem),
				),
			),
			breakFreePenalty:
				shipIsBoarded(shipSystem.boardedWith) &&
				(shipSystem.boardedWith as ShipBoardingState | undefined)
					?.breakFreeFailedThisTurn === true
					? 20
					: 0,
		});
	},
};

// -------------------------------------------------------------- break free

/** BREAK-FREE (Core Rulebook p215): Hard (−20) at the START of the turn. */
const breakFreeRow: ShipRow = {
	async prepare(request, item) {
		if (!whileBoardedGate(request.actor)) return null;
		return prepareCombinedTest(request, item);
	},
	async after(request, prepared, outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		const shipSystem = readShipSystem(ship);
		const state = breakFreePairState(
			shipSystem.boardedWith as Partial<ShipBoardingState> | undefined,
			outcome.success,
		);
		if (state.pairCleared) {
			// Success frees BOTH ships (the pair clears on both sides, book
			// p215). The partner resolves by the stamped uuid.
			await ports.actors.update(ship, {
				system: { boardedWith: state.state },
			});
			const partnerUuid = shipSystem.boardedWith?.uuid ?? "";
			const partner = resolveByUuid(partnerUuid) as
				| (Actor & { uuid?: string })
				| null;
			if (partner) {
				await ports.actors.update(partner, {
					system: {
						boardedWith: boardLockPairState(""),
					},
				});
			} else if (partnerUuid) {
				ports.notify.error("SHIP_BOARDING.PARTNER_UNRESOLVED", {
					uuid: partnerUuid,
				});
			}
			await postCard(ship, `${TEMPLATE_ROOT}chat/ship-boarding.hbs`, {
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: (prepared.kindData as { name?: string }).name ?? "",
					link: docAnchor(prepared.kindData),
				},
				locked: false,
				brokeFree: true,
				roll: outcome.roll,
				outcomeLabel: outcomeLabel(true, outcome.degrees),
			});
			return;
		}
		// Failure: the lock HOLDS and the ship's SUBSEQUENT opposed Command
		// suffers −20 (Core Rulebook p215; the S2 pair flag records it).
		await ports.actors.update(ship, {
			system: { boardedWith: state.state },
		});
		await postCard(ship, `${TEMPLATE_ROOT}chat/ship-boarding.hbs`, {
			title: prepared.title,
			titleDoc: {
				prefix: "",
				suffix: "",
				name: (prepared.kindData as { name?: string }).name ?? "",
				link: docAnchor(prepared.kindData),
			},
			locked: true,
			brokeFree: false,
			breakFreePenalty: 20,
			roll: outcome.roll,
			outcomeLabel: outcomeLabel(false, outcome.degrees),
		});
	},
};

// --------------------------------------------------------------------- rout

/**
 * The boarding turn's loser ship + manual opposed-Command resolution prompts
 * (Core Rulebook p215; the opposed Command itself stays MANUAL — owner
 * ruling). The prompts RUN in after() (prepare-only: the shared test step
 * would be wrong for a raw d100-vs-Morale kind), so the TestDialog the
 * pipeline owns is pass-through here — the turn buttons (S8) invoke this row
 * with skipDialog.
 */
const routRow: ShipRow = {
	async prepare(request, _item) {
		const ports = getPorts();
		const ship = request.actor;
		// The rout happens DURING the lock (Core Rulebook p215).
		if (!whileBoardedGate(ship)) return null;
		const currentMorale = Math.max(0, readShipSystem(ship).crewMorale ?? 100);
		return {
			title: `${ship.name} — ${ports.i18n.t("SHIP_BOARDING.ROUT_TITLE")}`,
			// Prepare-only (the initiative precedent): the shared pass/fail
			// test step is skipped; the after-hook owns the prompts, the dice
			// and the card. baseTarget displays the current Morale the rout
			// roll compares against.
			baseTarget: currentMorale,
			testKind: "characteristic",
			testKey: "rout",
			initialModifiers: [],
			weapon: null,
			context: {},
			prepareOnly: true,
			kindData: {
				itemId: request.itemId,
				uuid: _item.uuid ?? "",
				name: _item.name ?? "",
				actionCost: "",
				description: "",
				testKey: "rout",
				difficulty: "",
				difficultyKind: "none",
				crewFallback: false,
				shipMod: 0,
				combinedTarget: currentMorale,
			},
		};
	},
	async after(request, prepared, _outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		const shipSystem = readShipSystem(ship);
		const target = ports.targets.actor() as
			| (Actor & { name?: string; uuid?: string })
			| undefined;
		if (!target) {
			// The board turn needs BOTH ships: the target is the boarding
			// partner (the lock banner's target, the S8 surface).
			ports.notify.warn("SHIP_COMBAT.NO_TARGET");
			return;
		}
		const targetSystem = readShipSystem(target);

		// -- which side won the MANUAL opposed Command (owner ruling) --------
		const winner = (await foundry.applications.api.DialogV2.wait({
			window: { title: ports.i18n.t("SHIP_BOARDING.COMMAND_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_BOARDING.COMMAND_PROMPT", {
				ship: escapeDocumentData(ship.name ?? ""),
				target: escapeDocumentData(target.name ?? ""),
			})}</p><p>${ports.i18n.t("SHIP_BOARDING.COMMAND_BONUS_ROWS")}: ${bonusRowsHtml(
				commandBonusRows(
					boardingCommandBonus(
						boardingSide(shipSystem),
						boardingSide(targetSystem),
					),
				),
			)} ${bonusRowsHtml(
				commandBonusRows(
					boardingCommandBonus(
						boardingSide(targetSystem),
						boardingSide(shipSystem),
					),
				),
			)}</p>`,
			buttons: [
				{
					action: "ship",
					label: ports.i18n.t("SHIP_BOARDING.COMMAND_WINNER_SHIP", {
						ship: ship.name ?? "",
					}),
					callback: () => "ship",
				},
				{
					action: "target",
					label: ports.i18n.t("SHIP_BOARDING.COMMAND_WINNER_TARGET", {
						target: target.name ?? "",
					}),
					callback: () => "target",
				},
			],
		})) as string | null;
		if (winner === null) return;
		const loserName =
			winner === "ship" ? (target.name ?? "") : (ship.name ?? "");

		// -- the winning degrees of the manual test ---------------------------
		const degreeInput = (await foundry.applications.api.DialogV2.input({
			window: { title: ports.i18n.t("SHIP_BOARDING.DEGREES_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_BOARDING.DEGREES_PROMPT", {
				winner: escapeDocumentData(
					winner === "ship" ? (ship.name ?? "") : (target.name ?? ""),
				),
			})}</p><div class="form-group"><input type="number" name="degrees" value="1" min="1" max="10" step="1"></div>`,
			ok: { label: ports.i18n.t("SHIP_BOARDING.DEGREES_CONFIRM") },
		})) as { degrees?: string } | null;
		if (degreeInput === null) return;
		const degrees = Math.max(
			1,
			Math.min(10, Math.floor(Number(degreeInput.degrees) || 1)),
		);

		// -- the winner's per-degree pick (book p215) -------------------------
		const crewLosses = { population: 0, morale: 0 };
		let hullDamage = 0;
		const rolls: unknown[] = [];
		if (winner === "ship") {
			// This ship (request.actor) won: the DAMAGE lands on the target.
			const applied = await applyWinnerPick(ports, degrees);
			if (!applied) return;
			hullDamage = applied.hullDamage;
			crewLosses.population = applied.loss.population;
			crewLosses.morale = applied.loss.morale;
			rolls.push(...applied.rolls);
			await ports.actors.update(target, {
				system: crewTrackWrite(targetSystem, hullDamage),
			});
		} else {
			// The target won: the damage lands on THIS ship.
			const applied = await applyWinnerPick(ports, degrees);
			if (!applied) return;
			hullDamage = applied.hullDamage;
			crewLosses.population = applied.loss.population;
			crewLosses.morale = applied.loss.morale;
			rolls.push(...applied.rolls);
			await ports.actors.update(ship, {
				system: crewTrackWrite(shipSystem, hullDamage),
			});
		}

		// -- the rout roll: the LOSER's d100 vs CURRENT Morale (book p215) ---
		const loserSystem = winner === "ship" ? targetSystem : shipSystem;
		const moraleAfter = Math.max(
			0,
			Math.max(0, loserSystem.crewMorale ?? 100) - crewLosses.morale,
		);
		const routDice = await ports.dice.roll("1d100");
		rolls.push(...(routDice.rolls ?? []));
		const rout = routRoll(routDice.total, moraleAfter);
		// The branch (book p215): NPC vessel → SURRENDER card; the explorers'
		// vessel → the grim-choice card. v1 has no actor-data signal for who
		// owns the vessel, so the GM picks the branch in the rout prompt (the
		// card carries both branches' words).
		let branch = "continue";
		if (rout.routed) {
			const branchChoice = (await foundry.applications.api.DialogV2.wait({
				window: { title: ports.i18n.t("SHIP_BOARDING.ROUT_RESOLVED_TITLE") },
				content: `<p>${ports.i18n.t("SHIP_BOARDING.ROUT_RESOLVED_PROMPT", {
					ship: escapeDocumentData(loserName),
				})}</p>`,
				buttons: [
					{
						action: "npc",
						label: ports.i18n.t("SHIP_BOARDING.ROUT_BRANCH_NPC"),
						callback: () => "npc",
					},
					{
						action: "explorers",
						label: ports.i18n.t("SHIP_BOARDING.ROUT_BRANCH_EXPLORERS"),
						callback: () => "explorers",
					},
				],
			})) as string | null;
			if (branchChoice) branch = branchChoice;
		}
		await postCard(
			ship,
			`${TEMPLATE_ROOT}chat/ship-rout.hbs`,
			{
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: (prepared.kindData as { name?: string }).name ?? "",
					link: docAnchor(prepared.kindData),
				},
				winnerName: winner === "ship" ? (ship.name ?? "") : (target.name ?? ""),
				loserName,
				degrees,
				commandRows: commandBonusRows(
					boardingCommandBonus(
						boardingSide(shipSystem),
						boardingSide(targetSystem),
					),
				),
				enemyCommandRows: commandBonusRows(
					boardingCommandBonus(
						boardingSide(targetSystem),
						boardingSide(shipSystem),
					),
				),
				hullDamage,
				populationLoss: crewLosses.population,
				moraleLoss: crewLosses.morale,
				routRoll: routDice.total,
				routMorale: moraleAfter,
				routed: rout.routed,
				// The branch content (the book's own words, p215), pre-computed
				// for the template (no Handlebars logic helpers).
				surrender: rout.routed && branch === "npc",
				grimChoice: rout.routed && branch === "explorers",
				branch,
			},
			undefined,
			rolls,
		);
	},
};

/**
 * The winner's per-degree pick (Core Rulebook p215): 1d5 Crew Population +
 * 1d5 Morale per degree, OR 1 Hull Integrity per degree (which then damages
 * Crew and Morale 1:1 as normal, p221). One pick applies to ALL degrees —
 * the book's per-degree choice stays GM-correctable in play.
 */
async function applyWinnerPick(
	ports: ReturnType<typeof getPorts>,
	degrees: number,
): Promise<{
	hullDamage: number;
	loss: { population: number; morale: number };
	rolls: unknown[];
} | null> {
	const pick = (await foundry.applications.api.DialogV2.wait({
		window: { title: ports.i18n.t("SHIP_BOARDING.PICK_TITLE") },
		content: `<p>${ports.i18n.t("SHIP_BOARDING.PICK_PROMPT", { degrees })}</p>`,
		buttons: [
			{
				action: "crew",
				label: ports.i18n.t("SHIP_BOARDING.PICK_CREW", { degrees }),
				callback: () => "crew",
			},
			{
				action: "hull",
				label: ports.i18n.t("SHIP_BOARDING.PICK_HULL", { degrees }),
				callback: () => "hull",
			},
		],
	})) as string | null;
	if (pick === null) return null;
	const rolls: unknown[] = [];
	if (pick === "hull") {
		// 1 HI per degree (p215); p221 drags Crew/Morale 1:1.
		const hull = degrees;
		return { hullDamage: hull, loss: crewLossFromHullDamage(hull), rolls };
	}
	// 1d5 + 1d5 per degree (p215): the composed per-axis totals.
	const populationDice = await ports.dice.roll(`${degrees}d5`);
	const moraleDice = await ports.dice.roll(`${degrees}d5`);
	rolls.push(...(populationDice.rolls ?? []), ...(moraleDice.rolls ?? []));
	return {
		hullDamage: 0,
		loss: { population: populationDice.total, morale: moraleDice.total },
		rolls,
	};
}

/** The bonus rows as prompt/content HTML (escape + pre-rendered display). */
function bonusRowsHtml(rows: BonusCardRow[]): string {
	return rows
		.map((row) => {
			return `<div class="form-group"><strong>${escapeDocumentData(
				row.display,
			)}</strong> ${escapeDocumentData(row.label)}</div>`;
		})
		.join("");
}

/** The boarding-machinery row map (bead w98s) — the ship-action dispatch's
 * lookup table; row keys ship-normalised through boardingRowKey. */
export const boardingRowHandlers: Readonly<Record<string, ShipRow>> = {
	ramming: rammingRow,
	boarding: boardingRow,
	// The printed full heading "Boarding Actions" aliases the lock row.
	"boarding-actions": boardingRow,
	"break-free": breakFreeRow,
	rout: routRow,
};

/**
 * The one Foundry uuid resolution (presentation-level; the kernel never
 * resolves documents). fromUuidSync is in-world only — a missing partner
 * warns LOUDLY (the break-free still clears the acting ship's own state).
 */
function resolveByUuid(uuid: string): unknown {
	if (!uuid || typeof foundry === "undefined") return null;
	return foundry.utils.fromUuidSync(uuid as never) as unknown;
}

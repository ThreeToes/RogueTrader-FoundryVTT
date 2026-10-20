/**
 * Table 8-11 Extended Actions beyond Emergency Repairs (epic necp bead z697,
 * Core Rulebook printed pp216-218) — the row handlers the shared
 * ship-action handler dispatches to. This module owns the 13 rows:
 * Active Augury, Focused Augury, Aid the Machine Spirit, Disinformation,
 * Flank Speed, Hail the Enemy, Hit and Run, Hold Fast!, Jam Communications,
 * Lock on Target, Prepare to Repel Boarders!, Put Your Backs Into It! and
 * Triage. Emergency Repairs stays the ship-repair machinery (bead xfta).
 *
 * DISPATCH CONTRACT (the sibling-handler file-ownership line): ship-action.ts
 * merges this module at exactly two points — the row's side/prepare gate and
 * the row's after() effects — keyed on the pack's verbatim action names
 * (pinned by the S4 pack guard test). The merged state builds on:
 * - S1's combined-test resolution (resolvePerformerSide stays authoritative
 *   for every row that does not declare its own side);
 * - S2's turn-state kernel (turnFlags writes, replace/upsert helpers, the
 *   Focused Augury reveal ladder in rules-engine/ship-turn-state.ts);
 * - S4's pack rows with their printed test keys + difficulty tokens.
 *
 * Rows grounded in the book (printed page = file page N-1, verified in the
 * pack's verbatim prose):
 * - Focused Augury (p217): the reveal ladder 0° essentials-except-auger/
 *   shields, 1° + weapons, 2° + auger/shields, 3° all — the revealed set
 *   GATES decision 11's promptTargetComponent.
 * - Hold Fast! (p218): the prose UNAMBIGUOUSLY scopes the cancellation to
 *   "Morale damage suffered during the previous turn" — verified in the
 *   extracted text (page-0219 raw); no previous/this-turn ambiguity, so no
 *   split bead is owed. Same shape as Triage's "previous Turn" (p218).
 * - Put Your Backs Into It! (p218): the reported "Intimidate grants +10
 *   within Command in ship combat" NOTE is NOT in the source text — no such
 *   footnote appears under Table 8-11, in the action prose, or in the
 *   Interaction chapter (pp293-294). Per the extraction convention nothing
 *   is coded on that note; it is escalated to the owner instead.
 */

import {
	type AugurComponentLike,
	crewLossFromHullDamage,
	degreesOfFailure,
	focusedAuguryReveal,
	type Modifier,
	replaceTurnFlag,
	ShipTurnFlag,
	shipCritical,
	type TestOutcome,
	upsertTurnFlag,
} from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type {
	PreparedRoll,
	ShipActionRollRequest,
} from "../../rules/roll-contract";
import { escapeDocumentData, promptTargetComponent } from "../roll-prompts";
import { characteristicHandler, skillHandler } from "./characteristic-skill";
import type { PerformerSide } from "./ship-action";
import { findOwnedSkillItem } from "./skill-lookup";

// ------------------------------------------------------------- shared shapes

/** Structural shapes so the handlers read test fixtures and real documents alike. */
type RowItemLike = {
	id?: string | null;
	name?: string | null;
	type?: string;
	/** Read through casts (the ladder input, gates) — never presumed complete. */
	system?: unknown;
};

type RowActorLike = {
	name?: string;
	items: Iterable<RowItemLike> & {
		get: (id: string) => RowItemLike | undefined;
	};
	system?: Record<string, unknown>;
};

/** What the orchestrator passes the after-hook (bead 77r1 shape). */
export interface ExtendedRowEffectInfo {
	target: number;
	modifiers: Modifier[];
}

/** The row's prepare-side contribution (side override + visible rows). */
export interface ExtendedRowPrepareResult {
	/**
	 * The row resolved the character side itself (prompt-routed rows: the
	 * Willpower characteristic test, the Interaction-skill class, the
	 * either-skill rows). Absent = the shared combined-test resolution
	 * stays authoritative.
	 */
	side?: PerformerSide;
	/** The row's visible prepare-side rows (e.g. Hit and Run's Turret Rating). */
	modifiers?: Modifier[];
}

export interface ExtendedRowHandler {
	/**
	 * prepare(): the row's gates and side resolution. Returning NULL is a
	 * LOUD refusal (prerequisites, no assigned Explorer); an object without
	 * `side` keeps the shared resolution.
	 */
	prepare?: (
		request: ShipActionRollRequest,
		item: RowItemLike,
	) => Promise<ExtendedRowPrepareResult | null>;
	/** after(): the row's effects (state writes, prompts, the effect card). */
	after?: (
		request: ShipActionRollRequest,
		prepared: PreparedRoll<"ship-action">,
		outcome: TestOutcome,
		info: ExtendedRowEffectInfo,
	) => Promise<void>;
}

/**
 * The row table is declared at the END of this module (the entries close
 * over the row hooks, which are const-declared throughout).
 */

// ------------------------------------------------------------------- helpers

/** The starship system, read the way ship.ts reads it. */
function shipSystem(ship: unknown): Record<string, unknown> {
	return systemOf(ship as { system: unknown }) as unknown as Record<
		string,
		unknown
	>;
}

/** The ship's components (passive + weapon) as the augury/gate reads them. */
function componentsOf(target: unknown): RowItemLike[] {
	return ((
		target as { items?: { filter: (fn: (i: unknown) => boolean) => unknown[] } }
	).items?.filter(
		(i) =>
			(i as RowItemLike).type === "ship-component" ||
			(i as RowItemLike).type === "ship-weapon-component",
	) ?? []) as RowItemLike[];
}

/** Write ONE turn flag, replacing the KEY's previous entry (the upsert-by-id
 * variant lives in the kernel and is used by the multi-target rows). */
async function writeTurnFlag(
	ship: RowActorLike,
	flag: ShipTurnFlag,
): Promise<void> {
	const ports = getPorts();
	const system = shipSystem(ship);
	const flags = (system.turnFlags as ShipTurnFlag[] | undefined) ?? [];
	const next = replaceTurnFlag(flags, flag);
	await ports.actors.update(ship, { system: { turnFlags: next } });
}

/**
 * The row effect card: the roll card is the shared handler's; the row's
 * effects ride a follow-up note card (the ship-salvo two-card precedent),
 * the notes as plain text (document data interpolated into them escapes).
 */
async function postRowCard(
	request: ShipActionRollRequest,
	item: RowItemLike,
	notes: string[],
	rolls: unknown[] = [],
): Promise<void> {
	const ports = getPorts();
	const title = `${escapeDocumentData((request.actor as RowActorLike).name ?? "")} — ${escapeDocumentData(item.name ?? "")}`;
	const html =
		`<div class="rogue-trader chat roll"><div class="background border"><h1>${title}</h1>` +
		notes
			.map((note) => `<p class="action-note">${escapeDocumentData(note)}</p>`)
			.join("") +
		"</div></div>";
	await ports.chat.postHtml(request.actor as { uuid?: string }, html, rolls);
}

/**
 * A radio-choice prompt (the promptTargetComponent anatomy: one dialog,
 * radios, cancel = null). Labels are localized/fixed text; values are
 * machine tokens — both escape before they render.
 */
async function promptChoice(
	options: Array<{ value: string; label: string }>,
	titleKey: string,
	promptKey: string,
	promptVars?: Record<string, unknown>,
): Promise<string | null> {
	const ports = getPorts();
	const content =
		`<p>${ports.i18n.t(promptKey, promptVars)}</p>` +
		options
			.map(
				(option, index) =>
					`<div class="form-group"><label><input type="radio" name="choice" value="${escapeDocumentData(option.value)}"${
						index === 0 ? " checked" : ""
					}> ${escapeDocumentData(option.label)}</label></div>`,
			)
			.join("");
	const result = (await foundry.applications.api.DialogV2.input({
		window: { title: ports.i18n.t(titleKey) },
		content,
		ok: { label: ports.i18n.t("SHIP_ACTION.APPLY") },
	})) as { choice?: string } | null;
	const value = result?.choice?.trim();
	return value ?? null;
}

// -------------------------------------------------- the performer-side routes

/**
 * Core Rulebook printed p293-294 Interaction Skills + Table 3-1 (printed
 * p75-76, the Descriptor column): the names the ship-combat pages pair and
 * name are Interaction skills — the Table 8-11 cells pair "Deceive or
 * Blather" and "Intimidate or Charm", p293 names Charm/Command/Deceive/
 * Intimidate. Intimidate's characteristic is STRENGTH (`s`); the others are
 * Fellowship. Each entry therefore carries the skill's PRINTED characteristic
 * (verified in the cached core dump, file pages 77-82 = printed pp76-81:
 * Blather/Charm/Command/Deceive → Fellowship, Intimidate → Strength — the
 * printed header, with p81's GM option to substitute Int or Fel for
 * subtle threats staying a table, not a silent override) so an UNTRAINED
 * candidate resolves to the right characteristic instead of riding the
 * evasion-only UNTRAINED_SKILL_CHARACTERISTIC table (bead tueu: that
 * fallback used to send Intimidate to Fellowship). BLATHER IS ADVANCED —
 * basic-only untrained rule (Core Rulebook p74) has no untrained Blather,
 * so its entry is never picked untrained.
 */
const INTERACTION_SKILLS: Readonly<
	Record<string, { basic: boolean; characteristic: string }>
> = {
	Blather: { basic: false, characteristic: "fel" },
	Charm: { basic: true, characteristic: "fel" },
	Command: { basic: true, characteristic: "fel" },
	Deceive: { basic: true, characteristic: "fel" },
	Intimidate: { basic: true, characteristic: "s" },
};

/**
 * The untrained-characteristic fallback per interaction skill name; every
 * candidate in the table has one, so the fallback text is unreachable here.
 */
function candidateCharacteristic(skill: string): string {
	return INTERACTION_SKILLS[skill]?.characteristic ?? "fel";
}

type SkillCandidate = {
	skill: string;
	/** Trained attempt: the owned skill item. Untrained: the characteristic. */
	itemId?: string;
	characteristicKey?: string;
};

/**
 * The p74 rules per candidate: an owned skill item is a TRAINED attempt;
 * otherwise a BASIC interaction skill is attempted untrained (untrained
 * Advanced skills are not attempted at all — Core Rulebook p74).
 */
function skillCandidates(
	performer: RowActorLike,
	names: readonly string[],
): SkillCandidate[] {
	const candidates: SkillCandidate[] = [];
	for (const skill of names) {
		const owned = findOwnedSkillItem(performer, skill);
		if (owned?.id) candidates.push({ skill, itemId: owned.id });
		else if (INTERACTION_SKILLS[skill]?.basic) {
			candidates.push({
				skill,
				characteristicKey: candidateCharacteristic(skill),
			});
		}
	}
	return candidates;
}

/**
 * Delegate one candidate to the skill handler (the shared
 * characteristic/skill paths — never a hand-rolled test), then read the
 * PerformerSide shape the combined-test side carries.
 */
async function candidateSide(
	performer: unknown,
	candidate: SkillCandidate,
): Promise<PerformerSide | null> {
	const prepared =
		candidate.itemId !== undefined
			? await skillHandler.prepare({
					kind: "skill",
					actor: performer as never,
					itemId: candidate.itemId,
				})
			: await skillHandler.prepare({
					kind: "skill",
					actor: performer as never,
					characteristicKey: candidate.characteristicKey ?? "",
					label: candidate.skill,
				});
	if (!prepared) return null;
	return {
		baseTarget: prepared.baseTarget,
		testKind: prepared.testKind,
		testKey: prepared.testKey,
		skillName:
			candidate.itemId !== undefined ? prepared.context.skillName : undefined,
	};
}

/**
 * The skill-class prompt routed rows share: owned skills offer themselves as
 * trained attempts, basic ones as untrained; a single candidate skips the
 * prompt entirely (no pointless dialog).
 */
async function promptSkillCandidate(
	request: ShipActionRollRequest,
	names: readonly string[],
	actionName: string,
	titleKey: string,
	promptKey: string,
): Promise<PerformerSide | null> {
	const ports = getPorts();
	const performer = request.performer as RowActorLike | undefined;
	// Prompt-routed rows perform an EXPLORER's test — the crew-quality
	// fallback (Table 8-9) carries no Interaction/Willpower vocabulary, so a
	// missing performer refuses loudly instead of silently mis-rolling.
	if (!performer) {
		ports.notify.warn("SHIP_ACTION.ROW_REQUIRES_PERFORMER", {
			action: actionName,
		});
		return null;
	}
	const candidates = skillCandidates(performer, names);
	if (candidates.length === 0) {
		ports.notify.warn("SHIP_ACTION.INTERACTION_UNOWNED", {
			actor: performer.name ?? "?",
		});
		return null;
	}
	let chosen = candidates[0];
	if (candidates.length > 1) {
		const value = await promptChoice(
			candidates.map((candidate) => ({
				value: candidate.skill,
				label: ports.i18n.t(
					candidate.itemId !== undefined
						? "SHIP_ACTION.SKILL_TRAINED"
						: "SHIP_ACTION.SKILL_UNTRAINED",
					{ skill: candidate.skill },
				),
			})),
			titleKey,
			promptKey,
		);
		if (!value) return null;
		const found = candidates.find((candidate) => candidate.skill === value);
		if (!found) return null;
		chosen = found;
	}
	return await candidateSide(performer, chosen);
}

// ------------------------------------------------------------ the row hooks

/** Prepare hook builders — see extendedRowHandlers' entries. */

/** The either-skill rows (printed "Deceive or Blather" / "Intimidate or
 * Charm", Table 8-11 p217): the routed skill is the player's choice. */
function eitherSkillPrepare(names: [string, string]) {
	return async (
		request: ShipActionRollRequest,
		item: RowItemLike,
	): Promise<ExtendedRowPrepareResult | null> => {
		const side = await promptSkillCandidate(
			request,
			names,
			item.name ?? "",
			"SHIP_ACTION.SKILL_PROMPT_TITLE",
			"SHIP_ACTION.SKILL_PROMPT",
		);
		return side ? { side, modifiers: [] } : null;
	};
}

/** Hail the Enemy (printed p217): the Test column names a CLASS ("Interaction
 * Skill"), not one skill (book p217 prose: "left up to the GM"). */
function hailTheEnemyPrepare(
	request: ShipActionRollRequest,
	item: RowItemLike,
): Promise<ExtendedRowPrepareResult | null> {
	return promptSkillCandidate(
		request,
		Object.keys(INTERACTION_SKILLS),
		item.name ?? "",
		"SHIP_ACTION.SKILL_PROMPT_TITLE",
		"SHIP_ACTION.HAIL_PROMPT",
	).then((side) => (side ? { side, modifiers: [] } : null));
}

/** Hold Fast! (printed p218): a Willpower CHARACTERISTIC test (no skill
 * item), gated on the Air of Authority talent. */
async function holdFastPrepare(
	request: ShipActionRollRequest,
	item: RowItemLike,
): Promise<ExtendedRowPrepareResult | null> {
	const ports = getPorts();
	const performer = request.performer as RowActorLike | undefined;
	if (!performer) {
		ports.notify.warn("SHIP_ACTION.ROW_REQUIRES_PERFORMER", {
			action: item.name ?? "",
		});
		return null;
	}
	// Loud refusal without Air of Authority (Core Rulebook p218: "must have
	// Air of Authority (or a similar Talent at the GM's discretion)" — the
	// parenthetical is the GM's manual escape hatch, never a silent pass).
	const authority = [...performer.items].find(
		(item) =>
			item.type === "talent" && item.name?.toLowerCase() === "air of authority",
	);
	if (!authority) {
		ports.notify.warn("SHIP_ACTION.HOLD_FAST_AUTHORITY", {
			actor: performer.name ?? "?",
		});
		return null;
	}
	const prepared = await characteristicHandler.prepare({
		kind: "characteristic",
		actor: performer as never,
		key: "wp",
	});
	if (!prepared) return null;
	return {
		side: {
			baseTarget: prepared.baseTarget,
			testKind: prepared.testKind,
			testKey: prepared.testKey,
		},
		modifiers: [],
	};
}

/** Hit and Run (printed p218): the target vessel's Turret Rating rides the
 * combined test as a VISIBLE row (p220: −10 per Turret point). */
async function hitAndRunPrepare(
	_request: ShipActionRollRequest,
	_item: RowItemLike,
): Promise<ExtendedRowPrepareResult | null> {
	const ports = getPorts();
	const target = ports.targets.actor() as RowActorLike | undefined;
	const turretRating = Math.max(
		0,
		Number((target?.system as { turretRating?: number })?.turretRating ?? 0),
	);
	const modifiers: Modifier[] = [];
	if (turretRating > 0) {
		modifiers.push({
			id: "ship-action:turret-rating",
			source: { type: "item", label: "SHIP_COMBAT.TURRET_RATING" },
			label: ports.i18n.t("SHIP_COMBAT.TURRET_RATING_ROW", {
				rating: turretRating,
			}),
			value: -10 * turretRating,
		});
	}
	return { modifiers };

	// NOTE: no side override — the raiding craft's Challenging (+0)
	// Pilot (Space Craft) test is the shared combined-test resolution (crew
	// fallback included), exactly like the manoeuvre rows.
}

// ------------------------------------------------------------- after() hooks

/** After-hook context shared by the state-writing rows. */
type RowAfter = (
	request: ShipActionRollRequest,
	prepared: PreparedRoll<"ship-action">,
	outcome: TestOutcome,
	info: ExtendedRowEffectInfo,
) => Promise<void>;

/** The pipeline's clamped target, for the failure-degree reads. */
function rollTarget(info: ExtendedRowEffectInfo): number {
	return info?.target ?? 0;
}

/** Active Augury (p216): GM-apply reveal + the Silent Running check. */
const activeAuguryAfter: RowAfter = async (
	request,
	prepared,
	outcome,
	_info,
) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const item = { name: prepared.kindData?.name ?? "" };
	// Scan radius (p216): 20 VUs base, +5 per degree; the actual reveal of
	// celestial bodies / phenomena / ships stays the GM's manual step.
	const notes = [
		ports.i18n.t("SHIP_ACTION.AUGURY_RANGE_NOTE", {
			range: 20 + 5 * outcome.degrees,
		}),
	];
	const target = ports.targets.actor() as RowActorLike | undefined;
	if (target?.system?.silentRunning === true) {
		// p216: a vessel on Silent Running within scan range is immediately
		// detected (the FLAG stays — it is broken by firing, p218).
		notes.push(
			ports.i18n.t("SHIP_ACTION.AUGURY_SILENT_DETECTED", {
				ship: target.name ?? "?",
			}),
		);
	}
	await postRowCard(request, item, notes);
};

/** Focused Augury (p217): fills the target's revealedComponents ladder. */
const focusedAuguryAfter: RowAfter = async (
	request,
	prepared,
	outcome,
	_info,
) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const target = ports.targets.actor() as RowActorLike | undefined;
	if (!target) {
		ports.notify.warn("SHIP_COMBAT.NO_TARGET");
		return;
	}
	const components = componentsOf(target);
	const revealed: string[] = [];
	const names: string[] = [];
	for (const component of components) {
		if (component.id == null) continue;
		if (!focusedAuguryReveal(component as AugurComponentLike, outcome.degrees))
			continue;
		revealed.push(component.id);
		names.push(component.name ?? "?");
	}
	const existing = ((target.system as { revealedComponents?: string[] })
		.revealedComponents ?? []) as string[];
	const merged = [...new Set([...existing, ...revealed])];
	await ports.actors.update(target, {
		system: { revealedComponents: merged },
	});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.FOCUSED_REVEALED", {
			target: target.name ?? "?",
			count: revealed.length,
			names: names.join(", "),
		}),
	]);
};

/** Aid the Machine Spirit (p216): +5 (or +5 per 2 extra degrees) to the
 * prompted Manoeuvrability/Detection, one turn flag. */
const aidMachineSpiritAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const chosen = await promptChoice(
		[
			{
				value: "manoeuvrability",
				label: ports.i18n.t("SHIP_COMBAT.STAT_MANOEUVRABILITY"),
			},
			{ value: "detection", label: ports.i18n.t("SHIP_COMBAT.STAT_DETECTION") },
		],
		"SHIP_ACTION.AID_TITLE",
		"SHIP_ACTION.AID_PROMPT",
	);
	if (!chosen) return;
	const stat = chosen === "detection" ? "detection" : "manoeuvrability";
	// p216: +5 on success, +5 more per two degrees of success.
	const value = 5 + 5 * Math.floor(outcome.degrees / 2);
	const ship = request.actor as RowActorLike;
	await writeTurnFlag(
		ship,
		{
			id: `aid-machine-spirit:${stat}`,
			key: "aid-machine-spirit",
			value,
			target: stat,
			expiresAtTurn: null,
			persistent: false,
		});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.AID_NOTE", {
			value,
			stat: ports.i18n.t(
				stat === "detection"
					? "SHIP_COMBAT.STAT_DETECTION"
					: "SHIP_COMBAT.STAT_MANOEUVRABILITY",
			),
		}),
	]);
};

/** Disinformation (p216): the Morale recovery is a MANUAL note (the book's
 * 1d5-per-degree rule rides the card verbatim; nothing is auto-written). */
const disinformationAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.DISINFORMATION_NOTE", {
			degrees: outcome.degrees,
		}),
	]);
};

/** Flank Speed (p217): +1 VU per degree this turn (note only — no spatial
 * sim); failure by 2+ degrees is the immediate Engines Crippled critical. */
const flankSpeedAfter: RowAfter = async (request, prepared, outcome, info) => {
	const ports = getPorts();
	const item = { name: prepared.kindData?.name ?? "" };
	if (outcome.success) {
		await postRowCard(request, item, [
			ports.i18n.t("SHIP_ACTION.FLANK_SPEED_NOTE", {
				vus: 1 + outcome.degrees,
			}),
		]);
		return;
	}
	// Failure by 2 or more degrees (p217): the engines strained too hard.
	const failureDegrees = degreesOfFailure(
		rollTarget(info) || prepared.baseTarget,
		outcome.roll,
	);
	if (failureDegrees < 2) return;
	// The acting ship's OWN components are all known — decision 11's reveal
	// gating is for ENEMY critical picks (ship.ts), not the crew's own hull.
	// Table 8-12 (6) Engines Crippled (Core Rulebook p217 + p222) rides the
	// ship's ENGINES: the pick is scoped to the plasma drives (the drive
	// component family, Core Rulebook pp200-202) — not every fixable
	// component. Skipping / no intact drive applies NOTHING, and the
	// cripple claim posts only when the critical actually lands.
	const component = await promptTargetComponent(request.actor, {
		componentTypes: ["plasma-drive"],
	});
	if (!component) return;
	await ports.actors.update(component, { system: { state: "damaged" } });
	await postRowCard(request, item, [
		ports.i18n.t("SHIP_ACTION.FLANK_SPEED_CRIPPLED", {
			degrees: failureDegrees,
		}),
	]);
};

/** Hail the Enemy (p217): the interaction test already ran on the character —
 * the card notes the book's GM discretion (any outcome). */
const hailTheEnemyAfter: RowAfter = async (request, prepared) => {
	const ports = getPorts();
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.HAIL_NOTE"),
	]);
};

/** Hit and Run (p218): the opposed +10 Ordinary Command vs the enemy
 * commander stays MANUAL (standing ruling); the effects on a MANUAL win
 * resolve through prompts (bead z697). */
const hitAndRunAfter: RowAfter = async (request, prepared, outcome, info) => {
	const ports = getPorts();
	const item = { name: prepared.kindData?.name ?? "" };
	const notes = [ports.i18n.t("SHIP_ACTION.MANUAL_RANGE_HIT_RUN")];
	if (!outcome.success) {
		// Failure by four or more degrees (p218): the craft is shot down.
		const failureDegrees = degreesOfFailure(
			rollTarget(info) || prepared.baseTarget,
			outcome.roll,
		);
		notes.push(
			failureDegrees >= 4
				? ports.i18n.t("SHIP_ACTION.HIT_RUN_SHOT_DOWN", {
						degrees: failureDegrees,
					})
				: ports.i18n.t("SHIP_ACTION.HIT_RUN_RETURN"),
		);
		await postRowCard(request, item, notes);
		return;
	}
	// The opposed Command is manual; the boarding modifiers ride the note so
	// the computation stays visible (Core Rulebook p215 + p220 turret bonus).
	notes.push(ports.i18n.t("SHIP_ACTION.HIT_RUN_OPPOSED_NOTE"));
	await postRowCard(request, item, notes);
	const won = (await foundry.applications.api.DialogV2.wait({
		window: { title: ports.i18n.t("SHIP_ACTION.HIT_RUN_PROMPT_TITLE") },
		content: `<p>${ports.i18n.t("SHIP_ACTION.HIT_RUN_PROMPT")}</p>`,
		buttons: [
			{
				action: "won",
				label: ports.i18n.t("SHIP_ACTION.HIT_RUN_WON"),
				callback: () => "won",
			},
			{
				action: "failed",
				label: ports.i18n.t("SHIP_ACTION.HIT_RUN_FAILED"),
				callback: () => "failed",
			},
		],
	})) as string | null;
	if (won !== "won") {
		if (won === "failed") {
			await postRowCard(request, item, [
				ports.i18n.t("SHIP_ACTION.HIT_RUN_RAID_LOST"),
			]);
		}
		return;
	}
	const degreeInput = (await foundry.applications.api.DialogV2.input({
		window: { title: ports.i18n.t("SHIP_ACTION.HIT_RUN_PROMPT_TITLE") },
		content: `<p>${ports.i18n.t("SHIP_ACTION.HIT_RUN_DEGREES_PROMPT")}</p><div class="form-group"><input type="number" name="degrees" value="0" min="0" max="10"></div>`,
		ok: { label: ports.i18n.t("SHIP_ACTION.APPLY") },
	})) as { degrees?: string } | null;
	const degrees = Math.max(
		0,
		Math.min(10, Math.floor(Number(degreeInput?.degrees ?? 0)) || 0),
	);
	// 1d5 on the Ship Critical chart TWICE, pick one (Core Rulebook p218).
	// Bead wvkd's animation contract: the chart dice ride the card.
	const effectNotes: string[] = [];
	const rolls: unknown[] = [];
	const entries: Array<{ value: string; label: string }> = [];
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const chartRoll = await ports.dice.roll("1d5");
		rolls.push(...(chartRoll.rolls ?? []));
		const entry = shipCritical(chartRoll.total || 1);
		const label = entry
			? `${chartRoll.total} — ${entry.name}`
			: String(chartRoll.total);
		entries.push({ value: label, label });
		effectNotes.push(
			ports.i18n.t("SHIP_ACTION.HIT_RUN_CRIT_ROLL", {
				roll: attempt,
				label,
			}),
		);
	}
	let pickedLabel: string | null = entries[0]?.value ?? null;
	if (entries.length === 2 && entries[0]!.label !== entries[1]!.label) {
		const pick = await promptChoice(
			entries,
			"SHIP_ACTION.CRITICAL_PICK_TITLE",
			"SHIP_ACTION.CRITICAL_PICK_PROMPT",
		);
		if (pick) pickedLabel = pick;
	}
	if (pickedLabel) {
		effectNotes.push(
			ports.i18n.t("SHIP_ACTION.HIT_RUN_CRIT_PICK", { label: pickedLabel }),
		);
	}
	// Hull Integrity damage = 1 per degree (p218); crew loss follows as
	// normal (the merged kernel's p221 rule, crewLossFromHullDamage).
	const target = ports.targets.actor() as RowActorLike | undefined;
	if (degrees > 0 && target) {
		const targetSystem = target.system as {
			hullIntegrity?: { value?: number; max?: number };
			crewPopulation?: number;
			crewMorale?: number;
		};
		const currentHI = Math.max(0, targetSystem.hullIntegrity?.value ?? 0);
		const crewLoss = crewLossFromHullDamage(degrees);
		await ports.actors.update(target, {
			system: {
				hullIntegrity: {
					value: Math.max(0, currentHI - degrees),
				},
				crewPopulation: Math.max(
					0,
					(targetSystem.crewPopulation ?? 100) - crewLoss.population,
				),
				crewMorale: Math.max(
					0,
					(targetSystem.crewMorale ?? 100) - crewLoss.morale,
				),
			},
		});
		// The raiders are ABOARD the target — they see the component they are
		// sabotaging, so the pick is NOT reveal-gated (decision 11 gates the
		// ranged critical path in ship.ts only).
		const component = await promptTargetComponent(target);
		if (component) {
			await ports.actors.update(component, { system: { state: "damaged" } });
		}
	}
	effectNotes.push(
		ports.i18n.t("SHIP_ACTION.HIT_RUN_APPLIED", {
			degrees,
			target: target?.name ?? "?",
		}),
	);
	await postRowCard(request, item, effectNotes, rolls);
};

/** Hold Fast! (p218): cancels PREVIOUS-turn Morale damage — 1 + 1 per degree,
 * clamped by what lastTurnLosses records (the book's prior-turn-only rule). */
const holdFastAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const ship = request.actor as RowActorLike;
	const system =
		(shipSystem(ship) as {
			crewMorale?: number;
			lastTurnLosses?: { morale?: number };
		}) ?? {};
	const losses = Math.max(0, system.lastTurnLosses?.morale ?? 0);
	const cancelled = Math.min(1 + outcome.degrees, losses);
	if (cancelled <= 0) {
		await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
			ports.i18n.t("SHIP_ACTION.HOLD_FAST_NONE"),
		]);
		return;
	}
	await ports.actors.update(ship, {
		system: {
			crewMorale: Math.min(100, (system.crewMorale ?? 100) + cancelled),
		},
	});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.HOLD_FAST_NOTE", { cancelled, losses }),
	]);
};

/** Jam Communications (p218): a manual "jammed" note per degree of range. */
const jamCommunicationsAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.JAM_NOTE", { range: 10 + outcome.degrees }),
	]);
};

/** Lock on Target (p218): the +5 (or +5 per 2 extra degrees) flag names the
 * chosen weapon component; the FIRING-side consumption is S2's read path. */
const lockOnTargetAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const weapons = componentsOf(request.actor).filter(
		(item) => item.type === "ship-weapon-component",
	);
	if (weapons.length === 0) {
		ports.notify.warn("SHIP_COMBAT.NO_WEAPONS");
		return;
	}
	const weaponId = await promptChoice(
		weapons.map((weapon) => ({
			value: weapon.id ?? "",
			label: weapon.name ?? "?",
		})),
		"SHIP_ACTION.LOCK_ON_TARGET_TITLE",
		"SHIP_ACTION.LOCK_ON_TARGET_PROMPT",
	);
	if (!weaponId) return;
	// p218: +5, plus +5 per two additional degrees.
	const value = 5 + 5 * Math.floor(outcome.degrees / 2);
	const weapon = weapons.find((candidate) => candidate.id === weaponId);
	await writeTurnFlag(
		request.actor as RowActorLike,
		{
			id: `lock-on-target:${weaponId}`,
			key: "lock-on-target",
			value,
			target: weaponId,
			expiresAtTurn: null,
			persistent: false,
		});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.LOCK_ON_TARGET_NOTE", {
			value,
			weapon: weapon?.name ?? "?",
		}),
	]);
};

/** Prepare to Repel Boarders! (p218): the PERSISTENT +10 (+5 per degree)
 * opposed-Command flag — never auto-expired, the character occupies the
 * maintenance. */
const repelBoardersAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	// p218: +10 on success, +5 per degree of success.
	const value = 10 + 5 * outcome.degrees;
	await writeTurnFlag(
		request.actor as RowActorLike,
		{
			id: "repel-boarders",
			key: "repel-boarders",
			value,
			target: "all",
			expiresAtTurn: null,
			persistent: true,
		});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.REPEL_BOARDERS_NOTE", { value }),
	]);
};

/** Put Your Backs Into It! (p218): +5 to a chosen BS/repairs/firefighting
 * action this turn, +1 additional target per three degrees. */
const putYourBacksIntoItAfter: RowAfter = async (
	request,
	prepared,
	outcome,
) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const ship = request.actor as RowActorLike;
	const weapons = componentsOf(ship).filter(
		(item) => item.type === "ship-weapon-component",
	);
	// Bead 6l68's stale-snapshot lesson applied here: the loop builds the
	// flags locally and writes ONE turnFlags payload at the END — a per-pick
	// ports.actors.update would read back a stale pre-write system, and each
	// later write would erase the earlier ones.
	const backsSystem =
		(shipSystem(ship) as {
			turnFlags?: ShipTurnFlag[];
		}) ?? {};
	let nextFlags: ShipTurnFlag[] = [
		...((backsSystem.turnFlags as ShipTurnFlag[] | undefined) ?? []),
	];
	const BACKS_ACTIONS = [
		{ value: "bs", label: ports.i18n.t("SHIP_ACTION.BACKS_BS") },
		{
			value: "emergency-repairs",
			label: ports.i18n.t("SHIP_ACTION.BACKS_REPAIRS"),
		},
		{ value: "firefighting", label: ports.i18n.t("SHIP_ACTION.BACKS_FIRE") },
	];
	// p218: one aided action, plus one more per three degrees of success.
	const pickCount = 1 + Math.floor(outcome.degrees / 3);
	const targets: string[] = [];
	for (let pick = 0; pick < pickCount; pick += 1) {
		const action = await promptChoice(
			BACKS_ACTIONS,
			"SHIP_ACTION.BACKS_PROMPT_TITLE",
			"SHIP_ACTION.BACKS_PROMPT",
		);
		if (!action) break;
		let target: string;
		if (action === "bs") {
			if (weapons.length === 0) {
				ports.notify.warn("SHIP_COMBAT.NO_WEAPONS");
				continue;
			}
			const weaponId = await promptChoice(
				weapons.map((weapon) => ({
					value: weapon.id ?? "",
					label: weapon.name ?? "?",
				})),
				"SHIP_ACTION.BACKS_WEAPON_TITLE",
				"SHIP_ACTION.BACKS_WEAPON_PROMPT",
			);
			if (!weaponId) continue;
			const weapon = weapons.find((candidate) => candidate.id === weaponId);
			target = weaponId;
			targets.push(
				ports.i18n.t("SHIP_ACTION.BACKS_WEAPON_LABEL", {
					weapon: weapon?.name ?? "?",
				}),
			);
		} else {
			target = action;
			targets.push(
				ports.i18n.t(
					action === "emergency-repairs"
						? "SHIP_ACTION.BACKS_REPAIRS"
						: "SHIP_ACTION.BACKS_FIRE",
				),
			);
		}
		nextFlags = upsertTurnFlag(nextFlags, {
			id: `backs-into-it:${target}`,
			key: "backs-into-it",
			value: 5,
			target,
			expiresAtTurn: null,
			persistent: false,
		});
	}
	if (targets.length === 0) return;
	await ports.actors.update(ship, { system: { turnFlags: nextFlags } });
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.BACKS_NOTE", {
			count: targets.length,
			targets: targets.join(", "),
		}),
	]);
};

/** Triage (p218): cancels PREVIOUS-turn Crew Population damage — 1 + 1 per
 * degree, clamped by lastTurnLosses.population (the book's prior-turn rule). */
const triageAfter: RowAfter = async (request, prepared, outcome) => {
	if (!outcome.success) return;
	const ports = getPorts();
	const ship = request.actor as RowActorLike;
	const system =
		(shipSystem(ship) as {
			crewPopulation?: number;
			lastTurnLosses?: { population?: number };
		}) ?? {};
	const losses = Math.max(0, system.lastTurnLosses?.population ?? 0);
	const cancelled = Math.min(1 + outcome.degrees, losses);
	if (cancelled <= 0) {
		await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
			ports.i18n.t("SHIP_ACTION.TRIAGE_NONE"),
		]);
		return;
	}
	await ports.actors.update(ship, {
		system: {
			crewPopulation: Math.min(100, (system.crewPopulation ?? 100) + cancelled),
		},
	});
	await postRowCard(request, { name: prepared.kindData?.name ?? "" }, [
		ports.i18n.t("SHIP_ACTION.TRIAGE_NOTE", { cancelled, losses }),
	]);
};

// ------------------------------------------------------------- the merge API

/**
 * The after()-side merge point (ship-action.ts calls this once): dispatches
 * the row's effects off the pack's verbatim action name.
 */
export async function extendedRowAfter(
	request: ShipActionRollRequest,
	prepared: PreparedRoll<"ship-action">,
	outcome: TestOutcome,
	info?: { target?: number; modifiers?: Modifier[] },
): Promise<void> {
	const name = prepared.kindData?.name ?? "";
	const handler = extendedRowHandlers[name];
	if (!handler?.after) return;
	await handler.after(request, prepared, outcome, {
		target: info?.target ?? prepared.baseTarget,
		modifiers: info?.modifiers ?? [],
	});
}

// The prepare-side merge helper is extendedRowHandlers itself (the shared
// handler looks the row up by name — see ship-action.ts).

/**
 * The row table, keyed on the pack's verbatim action names (Table 8-11's
 * rows; the S4 pack guard test pins the names — a renamed row falls through
 * to the shared combined-test resolution and loses its effects, so the pack
 * test is the guard rail).
 */
export const extendedRowHandlers: Record<string, ExtendedRowHandler> = {
	"Active Augury": { after: activeAuguryAfter },
	"Aid the Machine Spirit": { after: aidMachineSpiritAfter },
	Disinformation: {
		prepare: eitherSkillPrepare(["Deceive", "Blather"]),
		after: disinformationAfter,
	},
	"Flank Speed": { after: flankSpeedAfter },
	"Focused Augury": { after: focusedAuguryAfter },
	"Hail the Enemy": {
		prepare: hailTheEnemyPrepare,
		after: hailTheEnemyAfter,
	},
	"Hit and Run": { prepare: hitAndRunPrepare, after: hitAndRunAfter },
	"Hold Fast!": { prepare: holdFastPrepare, after: holdFastAfter },
	"Jam Communications": { after: jamCommunicationsAfter },
	"Lock on Target": { after: lockOnTargetAfter },
	"Prepare to Repel Boarders!": { after: repelBoardersAfter },
	"Put Your Backs Into It!": {
		prepare: eitherSkillPrepare(["Intimidate", "Charm"]),
		after: putYourBacksIntoItAfter,
	},
	Triage: { after: triageAfter },
};

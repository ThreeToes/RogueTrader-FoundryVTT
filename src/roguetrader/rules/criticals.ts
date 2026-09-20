/**
 * Character Critical Damage — the Foundry side (bead ks3k).
 *
 * The MATHS lives in the rules-engine kernel (src/rules-engine/src/criticals.ts):
 * which table, what severity, whether a battlesuit diverts the wound, how many
 * effects a repair removes, and how a d100 picks a row. This module only reads
 * the actor, rolls, stores the result and reports it — the same split the ship
 * criticals use.
 *
 * Rule sources, quoted where the behaviour is not obvious:
 *   - core Critical Damage: damage that arrives while the character is on 0
 *     Wounds becomes Critical Damage in the hit location, and the severity used
 *     to enter the table is the TOTAL critical damage in that location (cap 10).
 *   - Tau Character Guide p31 (battlesuit): "The first time an Explorer wearing
 *     a battlesuit would suffer Critical Damage each Turn, roll 1d10; on a
 *     result of 9 or higher, he suffers Critical Damage as normal. Otherwise,
 *     he does not suffer that Critical Damage; instead, roll on Table 1–5:
 *     Battlesuit Critical Effects and apply the result."
 *   - Tau Character Guide p31 (repair): Hard (–20) Tech-Use or Trade (Armourer),
 *     at least an hour, removes one effect plus one per Degree of Success.
 */

import {
	BATTLESUIT_CRITICAL_TABLE,
	battlesuitSuffersCritical,
	criticalSeverity,
	criticalTableName,
	type CriticalResultRow,
	repairEffectCount,
	selectCriticalResult,
	splitWoundDamage,
} from "../../rules-engine/src/index";
import { ROLLTABLES_PACK } from "../application/packs";
import { postCard } from "./chat-flags";
import type { ContentPort } from "../application/ports";
import { getPorts } from "../infrastructure/foundry/ports";

/** One suffered critical effect; stored on the actor until something clears it. */
export interface CriticalEffectRow {
	id: string;
	location: string;
	severity: number;
	table: string;
	roll: number;
	source: "core" | "battlesuit";
	text: string;
	/** True when the table content was not installed; apply manually. */
	manual?: boolean;
}

/** What resolving one hit produced. */
export interface CriticalOutcome {
	/** Effects to store on the actor (empty when no critical happened). */
	effects: CriticalEffectRow[];
	/** Wounds actually removed. */
	woundsApplied: number;
	/** Damage that went past 0 Wounds and became Critical Damage. */
	excess: number;
	/** True when a battlesuit used its once-per-Turn 1d10 override. */
	overrideUsed: boolean;
	/** Set when the tables were unavailable — the damage still applied. */
	warning?: string;
	/** True when the critical was recorded without its table text (manual). */
	manual?: boolean;
}

interface ItemLike {
	id?: string;
	type?: string;
	name?: string;
	system?: Record<string, unknown>;
}

interface ActorLike {
	uuid?: string;
	name?: string;
	items?: Iterable<ItemLike>;
	system?: Record<string, unknown>;
	isOwner?: boolean;
	update?: (data: object) => Promise<unknown>;
}

interface TableLike {
	name?: string;
	formula?: string;
	results?: Iterable<CriticalResultRow>;
}

/** Narrow an unknown actor to the shape this module uses. */
function asActor(actor: unknown): ActorLike {
	return (actor ?? {}) as ActorLike;
}

function itemsOf(actor: ActorLike): ItemLike[] {
	const items = actor.items;
	if (!items) return [];
	return Array.isArray(items) ? items : Array.from(items);
}

/**
 * The battlesuit a character is wearing, if any. The p31 override belongs to
 * the WEARER, so a battlesuit merely carried in the pack does not qualify.
 */
export function wornBattlesuit(actor: unknown): ItemLike | undefined {
	return itemsOf(asActor(actor)).find(
		(item) =>
			item.type === "battlesuit" && item.system?.equipState === "worn",
	);
}

/**
 * Current combat round, or 0 when no combat is running. Reads the global
 * defensively: this module is imported at boot (the sheet and the chat handler
 * both pull it in) and unit tests run with no `game` at all.
 */
export function currentRound(): number {
	return getPorts().clock.round();
}

/**
 * Does the battlesuit override still apply this Turn? The book limits it to the
 * FIRST Critical Damage of each Turn, so a stored round equal to the current
 * one means it has already been spent. Outside combat there are no Turns to
 * count, so every hit is treated as a fresh one (documented behaviour).
 */
export function overrideAppliesThisTurn(
	storedRound: number,
	round: number,
): boolean {
	if (round <= 0) return true;
	return Number(storedRound ?? 0) !== round;
}

/** Accumulated Critical Damage per location (missing locations read as 0). */
export function criticalsOf(actor: unknown): Record<string, number> {
	return (asActor(actor).system?.criticals as Record<string, number>) ?? {};
}

/** Active critical effects on the actor. */
export function criticalEffectsOf(actor: unknown): CriticalEffectRow[] {
	return (
		(asActor(actor).system?.criticalEffects as CriticalEffectRow[]) ?? []
	);
}

/** Total Critical Damage across every location (sheet summary). */
export function totalCriticalDamage(actor: unknown): number {
	return Object.values(criticalsOf(actor)).reduce(
		(sum, value) => sum + Number(value ?? 0),
		0,
	);
}

/** Find a RollTable in the rolltables pack by name. */
export async function findCriticalTable(
	name: string,
	content: ContentPort = getPorts().content,
): Promise<TableLike | undefined> {
	const table = await content.find(ROLLTABLES_PACK, name);
	// Content-optional: a missing pack is NOT an error. The caller records the
	// critical from the kernel's severity/location and asks the player to apply
	// the table effect manually.
	return table ? (table as TableLike) : undefined;
}

/** Roll a formula through the dice port. */
async function rollDie(formula: string): Promise<number> {
	return (await getPorts().dice.roll(formula)).total;
}

let effectCounter = 0;

/** Stable-ish id for a stored effect (removal works off the array index). */
function effectId(): string {
	effectCounter += 1;
	return `crit-${Date.now().toString(36)}-${effectCounter}`;
}

/**
 * Resolve the critical part of a hit: decide the severity, honour a worn
 * battlesuit's 1d10 override, roll the right table and return the effects to
 * store. Never throws for missing pack data — it reports a warning instead, so
 * a world without the compendium still applies the damage.
 */
export async function resolveCritical(outcome: {
	actor: unknown;
	damageType: string;
	location: string;
	excess: number;
	/** Injectable dice for tests. */
	overrideRoll?: number;
	tableRoll?: number;
	/** Content provider (defaults to the Foundry packs). */
	content?: ContentPort;
}): Promise<CriticalOutcome> {
	const actor = asActor(outcome.actor);
	const excess = Math.max(0, outcome.excess);
	const result: CriticalOutcome = {
		effects: [],
		woundsApplied: 0,
		excess,
		overrideUsed: false,
	};
	if (excess <= 0) return result;

	const suit = wornBattlesuit(outcome.actor);
	let useBattlesuitTable = false;
	if (suit) {
		const round = currentRound();
		const stored = Number(actor.system?.criticalOverrideRound ?? 0);
		if (overrideAppliesThisTurn(stored, round)) {
			const d10 = outcome.overrideRoll ?? (await rollDie("1d10"));
			result.overrideUsed = true;
			// 9+ : the Critical Damage stands (core tables). Otherwise the suit
			// absorbs it and Table 1-5 decides what breaks instead.
			useBattlesuitTable = !battlesuitSuffersCritical(d10);
		}
	}

	const location = outcome.location || "body";
	const existing = Number(criticalsOf(actor)[location] ?? 0);
	const severity = criticalSeverity(existing, excess);
	const tableName = useBattlesuitTable
		? BATTLESUIT_CRITICAL_TABLE
		: criticalTableName(outcome.damageType, location);

	const table = await findCriticalTable(tableName, outcome.content);
	if (!table) {
		// Content-optional fallback: the kernel still knows the severity and
		// location, so record the critical and let the player apply the table
		// effect manually. Never a silent no-op.
		result.warning = tableName;
		result.manual = true;
		result.effects.push({
			id: effectId(),
			location,
			severity,
			table: tableName,
			roll: 0,
			source: useBattlesuitTable ? "battlesuit" : "core",
			text: "",
			manual: true,
		});
		return result;
	}
	const roll = outcome.tableRoll ?? (await rollDie(table.formula ?? "1d10"));
	const row = selectCriticalResult(roll, Array.from(table.results ?? []));
	if (!row) {
		result.warning = tableName;
		return result;
	}
	result.effects.push({
		id: effectId(),
		location,
		severity,
		table: tableName,
		roll,
		source: useBattlesuitTable ? "battlesuit" : "core",
		text: String(row.text ?? ""),
	});
	return result;
}

/**
 * The full apply-damage step: wounds first, then Critical Damage for whatever
 * went past 0. Returns the outcome so the caller can post it.
 *
 * Only characters track criticals: a vehicle or starship has no `criticals`
 * field, so for those this behaves exactly like the old apply step (wounds
 * only, floored at 0) rather than stamping stray fields onto their system data.
 */
export async function applyDamageWithCriticals(outcome: {
	actor: unknown;
	damage: number;
	damageType: string;
	location: string;
	overrideRoll?: number;
	tableRoll?: number;
	/** Content provider (defaults to the Foundry packs). */
	content?: ContentPort;
}): Promise<CriticalOutcome> {
	const actor = asActor(outcome.actor);
	const supportsCriticals = actor.system?.criticals !== undefined &&
		actor.system?.criticalEffects !== undefined;
	const currentWounds = Number(
		(actor.system?.wounds as { value?: number } | undefined)?.value ?? 0,
	);
	const { applied, excess } = splitWoundDamage(currentWounds, outcome.damage);
	if (!supportsCriticals) {
		await actor.update?.({ system: { wounds: { value: Math.max(0, currentWounds - applied) } } });
		return { effects: [], woundsApplied: applied, excess: 0, overrideUsed: false };
	}
	const resolved = await resolveCritical({
		actor: outcome.actor,
		damageType: outcome.damageType,
		location: outcome.location,
		excess,
		overrideRoll: outcome.overrideRoll,
		tableRoll: outcome.tableRoll,
		content: outcome.content,
	});
	resolved.woundsApplied = applied;

	const update: Record<string, unknown> = {
		wounds: { value: Math.max(0, currentWounds - applied) },
	};
	if (resolved.effects.length > 0) {
		const criticals = { ...criticalsOf(actor) };
		for (const effect of resolved.effects) {
			criticals[effect.location] = effect.severity;
		}
		update.criticals = criticals;
		update.criticalEffects = [...criticalEffectsOf(actor), ...resolved.effects];
	}
	if (resolved.overrideUsed) {
		update.criticalOverrideRound = currentRound();
	}
	await actor.update?.({ system: update });
	return resolved;
}

/**
 * Repair (Tau Guide p31): a successful Hard (–20) Tech-Use or Trade (Armourer)
 * Test removes one effect of the character's choice plus one per Degree of
 * Success. Only battlesuit effects are removable this way — a core critical
 * injury is a wound, not a system fault.
 */
export async function repairBattlesuitCriticals(
	actor: unknown,
	degreesOfSuccess: number,
): Promise<{ removed: number; remaining: number }> {
	const target = asActor(actor);
	const removeCount = repairEffectCount(degreesOfSuccess);
	const effects = criticalEffectsOf(actor);
	const isRepairable = (effect: CriticalEffectRow) =>
		effect.source === "battlesuit";
	if (removeCount <= 0 || !effects.some(isRepairable)) {
		return { removed: 0, remaining: effects.length };
	}
	const kept: CriticalEffectRow[] = [];
	let removed = 0;
	for (const effect of effects) {
		if (removed < removeCount && isRepairable(effect)) {
			removed += 1;
			continue;
		}
		kept.push(effect);
	}
	// Recompute the per-location totals from what is left, so the sheet cannot
	// keep showing critical damage whose effect was repaired away.
	const criticals: Record<string, number> = {};
	for (const effect of kept) {
		criticals[effect.location] = Math.max(
			Number(criticals[effect.location] ?? 0),
			effect.severity,
		);
	}
	await target.update?.({
		system: { criticalEffects: kept, criticals },
	});
	return { removed, remaining: kept.length };
}

/**
 * Sheet context for the Critical Damage panel (bead ks3k). Rows only list
 * locations that have actually taken critical damage, so a healthy character
 * shows no panel at all (`any: false`).
 *
 * NOTE the location key mapping: our body locations are kebab-cased
 * ("left-arm") but the lang keys are underscored (BODY_LOCATION.LEFT_ARM), so
 * the hyphens are swapped here rather than in the template.
 */
export function criticalSheetContext(actor: unknown): {
	any: boolean;
	rows: Array<{ location: string; labelKey: string; severity: number }>;
	effects: Array<CriticalEffectRow & { locationLabelKey: string }>;
	canRepair: boolean;
} {
	const labelKey = (location: string) =>
		`BODY_LOCATION.${location.replace(/-/g, "_").toUpperCase()}`;
	const criticals = criticalsOf(actor);
	const rows = Object.entries(criticals)
		.filter(([, severity]) => Number(severity) > 0)
		.map(([location, severity]) => ({
			location,
			labelKey: labelKey(location),
			severity: Number(severity),
		}));
	const effects = criticalEffectsOf(actor).map((effect) => ({
		...effect,
		locationLabelKey: labelKey(effect.location),
	}));
	const repairable = effects.some((effect) => effect.source === "battlesuit");
	return {
		any: rows.length > 0 || effects.length > 0,
		rows,
		effects,
		canRepair: repairable && wornBattlesuit(actor) !== undefined,
	};
}

/** The skill item used for the repair Test: Tech-Use, else Trade (Armourer). */
export function repairSkillFor(actor: unknown): ItemLike | undefined {
	const skills = itemsOf(asActor(actor)).filter(
		(item) => item.type === "skill",
	);
	const named = (name: string, prefix = false) =>
		skills.find((item) => {
			const value = String(item.name ?? "").toLowerCase();
			return prefix
				? value.startsWith(name.toLowerCase())
				: value === name.toLowerCase();
		});
	// "Trade (Armourer)" is the trade specialisation; a bare "Trade" item is the
	// same skill on this system's ladder, so either satisfies the book's "or".
	return named("Tech-Use") ?? named("Trade", true);
}

/** Post the resolved critical (or the plain-damage result) to chat. */
export async function postCriticalCard(
	actor: { uuid?: string },
	retort: CriticalOutcome,
	outcome: { damageType: string; location: string },
): Promise<void> {
	const effects = retort.effects;
	await postCard(
		actor,
		"systems/rogue-trader/template/chat/critical.hbs",
		{
			woundsApplied: retort.woundsApplied,
			excess: retort.excess,
			overrideUsed: retort.overrideUsed,
			warning: retort.warning,
			damageType: outcome.damageType,
			locationLabelKey: `BODY_LOCATION.${outcome.location.toUpperCase()}`,
			effects: effects.map((effect) => ({
				...effect,
				locationLabelKey: `BODY_LOCATION.${effect.location.toUpperCase()}`,
			})),
		},
		undefined,
	);
}

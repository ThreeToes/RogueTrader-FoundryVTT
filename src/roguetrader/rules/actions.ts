/**
 * The warmed actions catalog + the combat-action prerequisite evaluator
 * (epic moew, bead 9r82): Table 9-4's 31 action Items (the actions pack,
 * moew child 1) surface as two-column chips on the character sheet's ACTIONS
 * tab, greyed when the actor does not meet the action's printed
 * prerequisites — VISIBLE, NEVER LOCKED (the owner's "no need to lock people
 * in" ruling: the grey is purely visual).
 *
 * Pure data + logic (Foundry-free, the talent-catalog precedent, bead 5rk0):
 * the pool + the shared doc→entry mapper live HERE so the ready warmer
 * (bootstrap/warmers.ts) and the sheet's on-demand pre-ready fill cannot
 * drift; every pack FETCH stays at the edges (the fetches are Foundry-coupled
 * and live in the warmer + sheet/actor/actions-view.ts). The chip CLICK
 * (lookup-card dispatch, roll stub for child 3's rolls) lives on the sheet
 * side too — game.i18n must not be read inside this module.
 */

import { equipStateOf, isWeaponType } from "../../ffg/domain/model/taxonomy";
import { postCard } from "./chat-flags";
import { nested, packSystem, str } from "../data/pack-fields";
import { type PackDocAnchor, OPEN_PACK_DOC_ACTION } from "../sheet/pack-doc-links";

// ------------------------------------------------------------------ the catalog

/**
 * One warmed combat action: the printed Table 9-4 row plus the machine bits
 * the tab consumes. `uuid` is the pack document uuid — the chip's lookup
 * card links the full prose through it ("" when the doc has none, which
 * degrades the card's title to plain text, never an error).
 */
export interface ActionEntry {
	/** Lowercase-hyphen name slug (the actions pack carries no key field). */
	key: string;
	name: string;
	uuid: string;
	/** Printed Table 9-4 Type value: Half | Full | Half/Full | Reaction | Varies. */
	actionCost: string;
	/** Verbatim "Varies by …" note (Varies rows only). */
	actionNote: string;
	/** Printed Subtype(s) column, verbatim. */
	subtypes: string;
	/** Printed prerequisite sentence ("" = no printed prerequisite). */
	prerequisites: string;
	/** The printed Table 9-4 terse description. */
	shortDescription: string;
	/** Printed test machine key — "" when the action does not call for a roll. */
	rollTest: string;
	/** Printed difficulty label, verbatim ("" when none printed). */
	rollDifficulty: string;
	/** The printed difficulty classified to its machine bits (bead et5a). */
	difficulty: ActionDifficulty;
	/** The machine kind the printed prerequisites text classifies to. */
	prereqKind: ActionPrereqKind;
}

/**
 * The machine prerequisite kind an action's printed prerequisites text
 * resolves to. The set is exactly the printed pack texts (bead 9r82:
 * data-driven, "no fabricated taxonomy"): every OTHER text must fail loudly.
 * Note `ranged-full-auto` covers both printed full-auto texts — rateOfFire
 * (and thus automatic fire) exists only on ranged weapons in the schema, so
 * Suppressing Fire's "A weapon capable of fully automatic fire" and Full Auto
 * Burst's ranged variant evaluate the SAME machine capability.
 */
export type ActionPrereqKind =
	| "none"
	| "heavy-weapon"
	| "ranged-full-auto"
	| "ranged-semi-auto"
	| "two-weapons-or-assault";

/**
 * Data-driven text → kind table (order matters: the specific full-auto/semi
 * sentences match before the short ones). One row per printed prerequisite
 * kind; a new pack text must add its kind here — the throw below is the
 * extraction convention's loud failure ("unmapped values fail, never drop").
 */
const PREREQ_KINDS: ReadonlyArray<readonly [ActionPrereqKind, RegExp]> = [
	["heavy-weapon", /heavy weapon/i],
	["ranged-full-auto", /fully automatic fire/i],
	["ranged-semi-auto", /semi-automatic fire/i],
	["two-weapons-or-assault", /two weapons/i],
];

/** Classify an action's printed prerequisites text into its machine kind. */
export function prereqKind(text: string): ActionPrereqKind {
	if (!text) return "none";
	for (const [kind, pattern] of PREREQ_KINDS) {
		if (pattern.test(text)) return kind;
	}
	throw new Error(
		`rogue-trader | action prerequisites "${text}" resolve to no machine kind — extend PREREQ_KINDS in rules/actions.ts (bead 9r82)`,
	);
}

// ------------------------------------------------- the printed difficulty (bead et5a)

/**
 * The machine kind a printed difficulty label resolves to:
 * - `none` — the row prints no difficulty (""),
 * - `opposed` — the book prints a bare "Opposed" test (owner ruling: the
 *   opposed side rolls MANUALLY, so there is no numeric auto-modifier),
 * - `numeric` — the label carries its modifier in parentheses
 *   ("Hard (–20)", "Challenging (+0)"); the printed value is authoritative
 *   data and does NOT go through the TestDialog's difficulty ladder, whose
 *   Hard/Very-Hard step values are a different (still unverified) table.
 */
export type ActionDifficultyKind = "none" | "opposed" | "numeric";

/** The printed difficulty's machine bits: kind + parsed signed value. */
export interface ActionDifficulty {
	kind: ActionDifficultyKind;
	/** Parsed signed value ("Hard (–20)" → −20, "+0" → 0); 0 otherwise. */
	value: number;
}

/**
 * Classify a printed difficulty label. One printed form at a time; an
 * UNMAPPED label throws (the extraction convention: loud failure, never a
 * silently-dropped difficulty). The pack prints exactly: "" (no test),
 * "Hard (–20)", "Challenging (+0)" and bare "Opposed"; the parenthesised
 * value may use the en dash (–) or minus sign (−) the text layer emits, so
 * both, plus the ASCII hyphen, are accepted.
 */
export function actionDifficulty(text: string): ActionDifficulty {
	if (!text) return { kind: "none", value: 0 };
	if (/^opposed$/i.test(text)) return { kind: "opposed", value: 0 };
	const match = /([+\u2212\u2013-])\s*([0-9]+(?:\.[0-9]+)?)/.exec(text);
	if (match) {
		const negative =
			match[1] === "\u2212" || match[1] === "\u2013" || match[1] === "-";
		const value = Number(match[2]);
		return { kind: "numeric", value: negative ? -value : value };
	}
	throw new Error(
		`rogue-trader | action difficulty "${text}" resolves to no machine kind — extend actionDifficulty in rules/actions.ts (bead et5a)`,
	);
}

/**
 * The SHARED doc→entry mapper (bead 5rk0 precedent): bootstrap/warmers.ts's
 * ready warmer and the sheet's on-demand ensureActionCatalog both build
 * entries through this, so the catalog shape cannot drift. Unknown
 * prerequisite text THROWS here (prereqKind), so an unrecognized sentence
 * fails at map time — ready — not silently as an always-available chip.
 */
export function actionEntryFromDoc(doc: {
	name?: string | null;
	uuid?: string;
	system?: unknown;
}): ActionEntry {
	const system = packSystem(doc);
	const roll = nested(system, "roll");
	const name = doc.name ?? "";
	return {
		key: name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, ""),
		name,
		uuid: doc.uuid ?? "",
		actionCost: str(system, "actionCost"),
		actionNote: str(system, "actionNote"),
		subtypes: str(system, "subtypes"),
		prerequisites: str(system, "prerequisites"),
		shortDescription: str(system, "shortDescription"),
		rollTest: str(roll, "test"),
		rollDifficulty: str(roll, "difficulty"),
		// The difficulty's machine bits ride the entry like prereqKind: an
		// unrecognized printed label THROWS here (actionDifficulty), so it
		// fails at map time — ready — not silently at click time.
		difficulty: actionDifficulty(str(roll, "difficulty")),
		// The mapper validates the printed text against the machine kinds; the
		// kind rides every entry so evaluation never re-parses prose.
		prereqKind: prereqKind(str(system, "prerequisites")),
	};
}

let actionCatalog: ActionEntry[] = [];

/** The warmed action catalog (empty until ready / first use). */
export function getActionCatalog(): ActionEntry[] {
	return actionCatalog;
}

/** Replace the catalog (the warmer's and the sheet's fill both). */
export function setActionCatalog(entries: ActionEntry[]): void {
	actionCatalog = entries;
}

export const ACTION_ITEM_TYPE = "action";

/**
 * On-demand catalog fill (the creator's on-demand fill precedent, epic 61pk):
 * the warmer runs at `ready`; a sheet opened PRE-ready would read an empty
 * pool, so the sheet passes its pack-fetch loader here — pool-first, one
 * shared mapper, no drift. An empty pack result leaves the pool empty (the
 * content-optional warmer contract: an absent pack degrades, never errors).
 */
export async function ensureActionCatalog(
	load: () => Promise<unknown[]>,
): Promise<ActionEntry[]> {
	if (actionCatalog.length > 0) return actionCatalog;
	const entries = ((await load()) as unknown as Array<{ type?: string }>)
		.filter((doc) => doc.type === ACTION_ITEM_TYPE)
		.map((doc) =>
			actionEntryFromDoc(doc as unknown as {
				name?: string | null;
				uuid?: string;
				system?: unknown;
			}),
		);
	if (entries.length > 0) setActionCatalog(entries);
	return actionCatalog;
}

// ------------------------------------------------------ the prerequisite evaluator

/** A loose owned-item read shape (Foundry documents conform structurally). */
export interface ActionOwnedItem {
	name?: string | null;
	type?: string;
	system?: {
		equipState?: string | null;
		class?: string | null;
		rateOfFire?: { burst?: number; fullAuto?: number } | null;
	} | null;
}

/**
 * What the actor can do, computed once per render from its owned items.
 *
 * The names follow the PRINTED prerequisites: `heavyWeapon` covers Brace's
 * "A Heavy weapon"; `rangedFullAuto`/`rangedSemiAuto` cover the burst actions'
 * "capable of (fully) automatic fire"; `readyWeapons` + the Swift/Lightning
 * Attack talent names cover Multiple Attacks' "Two weapons, or the Swift
 * Attack or Lightning Attack talent".
 */
export interface ActionCapabilities {
	heavyWeapon: boolean;
	rangedFullAuto: boolean;
	rangedSemiAuto: boolean;
	readyWeapons: number;
	/** Lowercase owned talent names (the print-verbatim names the book cites). */
	talents: Set<string>;
}

/** The talent names Multiple Attacks accepts (book print, case-insensitive). */
const MULTIPLE_ATTACK_TALENTS = ["swift attack", "lightning attack"];

/**
 * Compute the capabilities. Weapons must be READY (carried) — a stowed heavy
 * weapon cannot brace, a stowed launcher cannot go full-auto
 * (domain/model/taxonomy's equip model; the attack equip gate's posture).
 * Only ranged weapons carry the rateOfFire block, so the two automatic-fire
 * capabilities both read it (prereq kind note above).
 */
export function actionCapabilities(items: ActionOwnedItem[]): ActionCapabilities {
	const caps: ActionCapabilities = {
		heavyWeapon: false,
		rangedFullAuto: false,
		rangedSemiAuto: false,
		readyWeapons: 0,
		talents: new Set(),
	};
	for (const item of items) {
		if (isWeaponType(item.type)) {
			// Non-armour items are ready when CARRIED (isReady semantics).
			if (equipStateOf(item) !== "carried") continue;
			caps.readyWeapons += 1;
			const system = item.system ?? {};
			if (system.class === "heavy") caps.heavyWeapon = true;
			const rof = system.rateOfFire;
			const fullAuto = Number(rof?.fullAuto ?? 0);
			const burst = Number(rof?.burst ?? 0);
			if (item.type === "ranged-weapon" && fullAuto > 0) {
				caps.rangedFullAuto = true;
			}
			if (item.type === "ranged-weapon" && burst > 0) {
				caps.rangedSemiAuto = true;
			}
		} else if (item.type === "talent" && item.name) {
			caps.talents.add(item.name.toLowerCase());
		}
	}
	return caps;
}

/**
 * Whether an actor (through its capabilities) meets an action's printed
 * prerequisites. Always TRUE for the 26 actions with none. For Multiple
 * Attacks the book's "or" is an ALTERNATIVE, not both: two ready weapons OR
 * the talent satisfies it.
 */
export function actionAvailable(
	entry: { prereqKind: ActionPrereqKind },
	caps: ActionCapabilities,
): boolean {
	switch (entry.prereqKind) {
		case "none":
			return true;
		case "heavy-weapon":
			return caps.heavyWeapon;
		case "ranged-full-auto":
			return caps.rangedFullAuto;
		case "ranged-semi-auto":
			return caps.rangedSemiAuto;
		case "two-weapons-or-assault":
			return (
				caps.readyWeapons >= 2 ||
				MULTIPLE_ATTACK_TALENTS.some((talent) => caps.talents.has(talent))
			);
	}
}

// ------------------------------------------------------------- the lookup card

/** The lookup chat card template (template/chat/action-lookup.hbs). */
export const ACTION_LOOKUP_TEMPLATE =
	"systems/rogue-trader/template/chat/action-lookup.hbs";

/**
 * The roll-RESULT card's template (template/chat/action-roll.hbs, bead et5a):
 * the lookup-card anatomy (doc link + cost + terse description) carrying the
 * roll result — the after-hook's follow-up to the inline roll card.
 */
export const ACTION_ROLL_TEMPLATE =
	"systems/rogue-trader/template/chat/action-roll.hbs";

/**
 * Pure card vars (epic 61pk's titleDoc anatomy, template/chat/roll.hbs): the
 * h1 carries the action NAME as a pack-doc link (the OPEN_PACK_DOC_ACTION
 * convention the chat doc-link delegation reads), so the full verbatim prose
 * is "one click away". `uuid` from the entry IS the resolution — no catalog
 * re-scan needed here (unlike chatCardTitleDoc's name lookups): the chip was
 * built from the same pack doc. No uuid → null link → plain-text title.
 */
export function actionLookupTitleDoc(
	entry: Pick<ActionEntry, "name" | "uuid">,
): {
	prefix: string;
	name: string;
	suffix: string;
	link: PackDocAnchor | null;
} {
	return {
		prefix: "",
		name: entry.name,
		suffix: "",
		link: entry.uuid
			? { action: OPEN_PACK_DOC_ACTION, uuid: entry.uuid, name: entry.name }
			: null,
	};
}

/** The lookup card's template context (labels localized by the caller). */
export interface ActionLookupCardVars {
	title: string;
	titleDoc: ReturnType<typeof actionLookupTitleDoc>;
	costLabel: string;
	cost: string;
	descriptionLabel: string;
	description: string;
}

/** Build the lookup card context. The Varies note rides the cost verbatim. */
export function actionLookupCardVars(options: {
	entry: ActionEntry;
	labels: { cost: string; description: string };
}): ActionLookupCardVars {
	const entry = options.entry;
	const note = entry.actionNote ? ` (${entry.actionNote})` : "";
	return {
		title: entry.name,
		titleDoc: actionLookupTitleDoc(entry),
		costLabel: options.labels.cost,
		cost: `${entry.actionCost}${note}`,
		descriptionLabel: options.labels.description,
		description: entry.shortDescription,
	};
}

/**
 * Post the lookup chat card (the owner ruling: unrolled actions help LOOKUP —
 * the compendium doc link carries the full prose). Thin poster over the
 * shared chat-flags postCard; the Foundry coupling stays at the shim.
 */
export async function postActionLookupCard(options: {
	actor: { uuid?: string };
	entry: ActionEntry;
	labels: { cost: string; description: string };
}): Promise<{ id?: string } | undefined> {
	// Post through the shared chat-flags poster; it resolves its ports
	// internally, so this module never touches getPorts itself.
	return postCard(
		options.actor,
		ACTION_LOOKUP_TEMPLATE,
		actionLookupCardVars(options) as unknown as Record<string, unknown>,
	);
}

// ---------------------------------------------------- the roll-result card

/**
 * Pure vars for the action ROLL card (bead et5a): the lookup-card anatomy
 * (titleDoc + cost + terse description) with the test's result fields. The
 * outcome label/class and the opposed note arrive pre-localised from the
 * after-hook (labels composed through the i18n port).
 */
export function actionRollCardVars(options: {
	entry: ActionEntry;
	labels: { cost: string; description: string };
	result: {
		target: number;
		roll: number;
		outcomeLabel: string;
		outcomeClass: string;
		opposedNote: string;
	};
}): Record<string, unknown> {
	return {
		...actionLookupCardVars(options),
		target: options.result.target,
		roll: options.result.roll,
		outcomeLabel: options.result.outcomeLabel,
		outcomeClass: options.result.outcomeClass,
		opposedNote: options.result.opposedNote,
	};
}

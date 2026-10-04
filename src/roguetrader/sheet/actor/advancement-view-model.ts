/**
 * Advancement view model (epic lzeb child 1, bead anv0): pure enrichment of
 * every row the Spend-XP dialog renders — resolved display names, owned
 * state + multiplier remaining, skill ladder previews, characteristic tier
 * progression, affordability, prereq unmet lists, talent benefit tooltips,
 * rank groups and the default rank chip.
 *
 * Foundry-free by design (house style, see view-models.ts / skills-domain.ts):
 * inputs are plain data (career doc shape, ledger, actor snapshot), so bun
 * unit-tests run without Foundry. The dialog's _prepareContext is the
 * orchestration layer that assembles the inputs and hangs the result on the
 * template context (existing keys unchanged; new fields are additive).
 *
 * Sources: Core Rulebook p13/p38 (pool, ranks, rank tables), p38
 * characteristic schemes, p39 multipliers. Pure math lives in
 * rules/advancement.ts; prereq evaluation in rules/prereq.ts (bead tfk).
 */

import { evaluatePrerequisites, parsePrerequisites } from "../../rules/prereq";
import {
	availableRows,
	characteristicNextAdvance,
	derivedRank,
	multiplierRemaining,
	rankProgress,
	spentOnRank,
	totalSpent,
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	type CharacteristicSchemeLike,
	type RankThresholdLike,
} from "../../rules/advancement";
import {
	CHARACTERISTIC_KEYS,
	type CharacteristicKey,
} from "../../../ffg/domain/model/taxonomy";

import {
	findOwnedSkillForRow,
	LADDER_MAX,
} from "../skills-domain";
// The shared doc-link library (epic 61pk, bead n2b2): the row→pack-doc
// resolvers + uuid stamp live in sheet/pack-doc-links.ts — this module is a
// CONSUMER, not a second definition (behaviour-preserving extraction; the
// parity tests moved with the library, pack-doc-links.test.ts).
import {
	docLinkUuid,
	resolveSkillDoc,
	resolveTalentDoc,
} from "../pack-doc-links";

// --------------------------------------------------------------- input shapes

/** The career doc shape the dialog builds (ranks with AdvanceRowLike rows). */
export interface AdvancementCareerLike {
	ranks: Array<{
		rank: number;
		xpLevel: number;
		advances: AdvanceRowLike[];
	}>;
	characteristicAdvances: Record<string, CharacteristicSchemeLike>;
}

/** Catalog skill doc (compendium): key, display name, pack characteristic. */
export interface PackSkillLike {
	key: string;
	name: string;
	characteristic: string;
	/** Pack document uuid (bead ha1y) — ""/absent when unknown (tests). */
	uuid?: string;
}

/** Catalog talent doc (compendium): key, display name, benefit description. */
export interface PackTalentLike {
	key: string;
	name: string;
	description?: string;
	/** Pack document uuid (bead ha1y) — ""/absent when unknown (tests). */
	uuid?: string;
}

/** Owned skill item shape for ladder previews (dialog adapts actor items). */
export interface OwnedSkillLadderLike {
	key?: string;
	name: string;
	ladder?: number;
}

export interface AdvancementViewModelInput {
	/** Total career xp; the pool is total - spent (p13/p38). */
	xpTotal: number;
	/** Primary career, or null (no career — safe empty output). */
	career: AdvancementCareerLike | null;
	/** Rows from ELIGIBLE alternate ranks (tagged with source/sourceName). */
	alternateRows?: Array<AdvanceRowLike & { source?: string; sourceName?: string }>;
	/** The actor's xp ledger. */
	ledger: AdvanceLedgerEntry[];
	/** Actor characteristic values (scheme rows + prereq snapshot). */
	characteristics: Partial<Record<CharacteristicKey, number>>;
	/** Owned talent NAMES, as the prereq evaluator matches (bead tfk). */
	ownedTalentNames: string[];
	/** Actor's Psy Rating (prereq snapshot, "Psy Rating N" atoms). */
	psyRating?: number;
	/** Owned skill items for ladder previews. */
	ownedSkills: OwnedSkillLadderLike[];
	/** Skill catalog docs (new-skill characteristic + name resolution). */
	skillDocs: PackSkillLike[];
	/** Talent catalog docs (name resolution + benefit tooltips). */
	talentDocs: PackTalentLike[];
}

// ---------------------------------------------------------------- output rows

/** Skill ladder preview for one advance row (row.type === "skill"). */
export interface SkillLadderPreview {
	/** true when the actor owns no matching skill item. */
	newSkill: boolean;
	/** Current ladder of the owned skill (null for new skills). */
	currentLadder: number | null;
	/** The ladder the purchase lands on: current+1, or 1 for a new skill. */
	nextLadder: number;
	/** Owned skill already at the ladder cap (+20, Core Rulebook p74) — no bump possible. */
	maxed: boolean;
	/** Pack characteristic for the grant path (unowned rows); "" if unknown. */
	characteristic: string;
}

/** Next-rank progress (rankProgress shape). */
export interface RankProgress {
	nextRank: number | null;
	nextXpLevel: number | null;
	remaining: number;
}

/** One enriched rank-table row the dialog template renders. */
export interface AdvancementRowVM extends AdvanceRowLike {
	/**
	 * Resolved display name: row.name, else the name-by-key pack map, else
	 * the raw key. Kept as `name` for template/`data-name` compatibility.
	 */
	name: string;
	/** Purchases of this (type, key, rank) in the ledger. */
	purchased: number;
	/** Multiplier remaining after those purchases. */
	remaining: number;
	/** cost <= pool. */
	affordable: boolean;
	/** All raw prerequisite strings, ", "-joined (display). */
	prereqText: string;
	/** All raw prerequisite strings, "|"-joined (data-* pipe convention). */
	prereqList: string;
	/** UNMET prerequisites, precomputed from the actor snapshot (new chips). */
	unmetPrereqs: string[];
	/** Alternate-rank source career display name. */
	sourceName?: string;
	/** Index of the newest matching ledger entry (GM refund). */
	ledgerIndex: number;
	/** Talent benefit tooltip (description slice, 300 chars), "" otherwise. */
	benefitTooltip: string;
	/**
	 * Resolved pack document uuid (bead ha1y) — "" when the row matches no
	 * catalog doc (unresolvable keys, parameterised talents like
	 * "Peer (choose one)"). The template renders an openPackDoc anchor only
	 * when this is non-empty; a plain-text name otherwise.
	 */
	uuid: string;
	/** Skill ladder preview, null for talent rows. */
	skill: SkillLadderPreview | null;
}

/** One rank group (template: heading + rows). */
export interface AdvancementRankGroupVM {
	rank: number;
	xpLevel: number;
	spentOnRank: number;
	rows: AdvancementRowVM[];
}

/** One characteristic scheme row (template: +5 next tier, buy button). */
export interface AdvancementCharacteristicVM {
	key: CharacteristicKey;
	labelKey: string;
	value: number;
	purchased: number;
	next: { tier: string; cost: number } | null;
	/** Uppercased tier lang key (ADVANCE.TIER_SIMPLE) — empty when exhausted. */
	tierLabelKey: string;
	affordable: boolean;
}

/** Dialog-held filter state (epic lzeb child 2): search text + toggles. */
export interface AdvancementFilter {
	/** Free text matched against the resolved name, prereqs and the tooltip. */
	search?: string;
	/** cost <= pool and purchases may remain. */
	affordableOnly?: boolean;
	/** Nothing of this row in the ledger yet. */
	unownedOnly?: boolean;
}

/**
 * Filter the rows of the SHOWN rank (epic lzeb child 2). Pure: the dialog
 * holds the state, calls this per render, and the template consumes the
 * pre-filtered group.
 */
export function filterAdvancementRows(
	rows: AdvancementRowVM[],
	filter: AdvancementFilter,
): AdvancementRowVM[] {
	const needle = (filter.search ?? "").trim().toLowerCase();
	return rows.filter((row) => {
		if (filter.affordableOnly && !(row.affordable && row.remaining > 0)) {
			return false;
		}
		if (filter.unownedOnly && row.purchased > 0) return false;
		if (needle) {
			const haystack =
				`${row.name} ${row.prereqText} ${row.benefitTooltip}`.toLowerCase();
			if (!haystack.includes(needle)) return false;
		}
		return true;
	});
}

export interface AdvancementViewModel {
	/** Remaining spendable xp: xpTotal - spent, clamped to 0. */
	pool: number;
	/** Total spent xp, creation baseline included (p13). */
	spent: number;
	/** Derived rank (Table 2-2). */
	rank: number;
	/** Next-rank progress for the meter. */
	progress: RankProgress;
	/** pool > 0 and a career is present. */
	canBuy: boolean;
	characteristics: AdvancementCharacteristicVM[];
	rankGroups: AdvancementRankGroupVM[];
	/**
	 * Default rank chip (owner decision, epic lzeb): the LOWEST rank with at
	 * least one unpurchased row (multiplier purchases may remain), falling
	 * back to the highest held rank; null with no rank groups.
	 */
	defaultRank: number | null;
}

// ---------------------------------------------------------------- the builder

/** Benefit tooltip slice length (creator acquisition-chip convention). */
const BENEFIT_SLICE = 300;

// --------------------------------------------------------------------- at-cap guard

/**
 * At-cap purchase guard (bead i1f4): the reason string for a soft confirm
 * when the row's owned skill is already at the ladder cap (ladder 3 = +20,
 * Core Rulebook p74) — buying again is a no-op bump that would still spend
 * the row's xp. The dialog joins this onto its validation.reasons so the
 * purchase proceeds only through the GM-override confirm, mirroring
 * cost-over-pool and unmet prerequisites. Null when the skill is unowned or
 * below the cap, and for non-skill (talent) rows. Pure: same shared matcher as the preview and the live
 * application, so the guard agrees with both.
 *
 * Returns the i18n LANG KEY `ADVANCE.AT_CAP_REASON` (not a translated
 * string): the helper is deliberately pure/Foundry-free, so the dialog call
 * site resolves the key with `game.i18n.localize`.
 */
export function skillAtCapReason(
	row: AdvanceRowLike,
	ownedSkills: OwnedSkillLadderLike[],
	resolvedName?: string | null,
): string | null {
	const owned = findOwnedSkillForRow(ownedSkills, row, resolvedName);
	if (!owned) return null;
	if (row.type !== "skill") return null;
	if ((owned.ladder ?? 1) < LADDER_MAX) return null;
	return "ADVANCE.AT_CAP_REASON";
}

function nameByKeyFromDocs(
	skillDocs: PackSkillLike[],
	talentDocs: PackTalentLike[],
): Record<string, string> {
	const byKey: Record<string, string> = {};
	// Dialog parity: talents first, skills override afterwards.
	for (const doc of talentDocs) {
		if (doc.name && doc.key) byKey[doc.key] = doc.name;
	}
	for (const doc of skillDocs) {
		if (doc.key) byKey[doc.key] = doc.name;
	}
	return byKey;
}

function skillPreview(
	row: AdvanceRowLike,
	resolvedName: string,
	input: AdvancementViewModelInput,
): SkillLadderPreview {
	// Shared matcher (bead wxkw): the identical helper #applySkillAdvance
	// uses, so the preview can never promise a bump the purchase won't do.
	const owned = findOwnedSkillForRow(input.ownedSkills, row, resolvedName);
	if (!owned) {
		// New skill: the grant clones the pack doc's characteristic.
		const doc = resolveSkillDoc(row, input.skillDocs);
		return {
			newSkill: true,
			currentLadder: null,
			nextLadder: 1,
			maxed: false,
			characteristic: doc?.characteristic ?? "",
		};
	}
	const current = Math.min(LADDER_MAX, owned.ladder ?? 1);
	return {
		newSkill: false,
		currentLadder: current,
		nextLadder: Math.min(LADDER_MAX, current + 1),
		maxed: current >= LADDER_MAX,
		characteristic: "",
	};
}

/**
 * The pack document behind a row, for the compendium link (bead ha1y): the
 * SHARED library uuid stamp (bead n2b2, pack-doc-links.docLinkUuid) — the
 * same matchers benefitTooltip, the preview and the grant use. Parameterised
 * rows match nothing → "" → plain text in the template. Pure: the uuid is
 * just a string, no Foundry here.
 */

function benefitTooltip(
	row: AdvanceRowLike,
	talentDocs: PackTalentLike[],
): string {
	const doc = resolveTalentDoc(row, talentDocs);
	return (doc?.description ?? "").slice(0, BENEFIT_SLICE);
}

/**
 * Build the whole Spend-XP view model from plain data. Pure: no Foundry, no
 * i18n (label keys are emitted as keys; localization happens in templates),
 * no imports that touch `foundry` at load time.
 */
export function buildAdvancementViewModel(
	input: AdvancementViewModelInput,
): AdvancementViewModel {
	const ledger = input.ledger;
	const spent = totalSpent(ledger);
	const pool = Math.max(0, input.xpTotal - spent);
	const thresholds: RankThresholdLike[] = (input.career?.ranks ?? []).map(
		(rankRow) => ({ rank: rankRow.rank, xpLevel: rankRow.xpLevel }),
	);
	const rank = derivedRank(thresholds, spent);
	const progress: RankProgress = rankProgress(thresholds, spent);
	const nameByKey = nameByKeyFromDocs(input.skillDocs, input.talentDocs);

	// Characteristic scheme rows: next tier per characteristic; the ledger
	// counts prior +5 purchases. Uppercased tier lang keys are computed here
	// because the pack tiers are lowercase ("simple") and the lang keys are
	// uppercase (the 2314e96 case bug — a template concat resolved a key that
	// does not exist and rendered every tier raw).
	const characteristicRows: AdvancementCharacteristicVM[] = CHARACTERISTIC_KEYS.map(
		(key) => {
			const scheme = input.career?.characteristicAdvances?.[key];
			const purchased = ledger.filter(
				(entry) =>
					entry.type === "characteristic" && entry.characteristic === key,
			).length;
			const next = scheme ? characteristicNextAdvance(scheme, purchased) : null;
			return {
				key,
				labelKey: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: input.characteristics[key] ?? 0,
				purchased,
				next,
				tierLabelKey: next ? `ADVANCE.TIER_${next.tier.toUpperCase()}` : "",
				affordable: next ? next.cost <= pool : false,
			};
		},
	);

	const rows = availableRows(
		[
			...(input.career?.ranks.flatMap((rankRow) => rankRow.advances) ?? []),
			...(input.alternateRows ?? []),
		],
		rank,
	);
	const prereqSnapshot = {
		characteristics: input.characteristics,
		talents: input.ownedTalentNames,
		psyRating: input.psyRating ?? 0,
	};
	const enriched: AdvancementRowVM[] = rows.map((row) => {
		const prerequisites = row.prerequisites ?? [];
		// Name-key resolution (dialog parity): verbatim name, else the pack
		// name by key, else the raw key (careers carry 2.7k key-only rows).
		const resolvedName = row.name || nameByKey[row.key] || row.key;
		const { unmet } = evaluatePrerequisites(
			parsePrerequisites(prerequisites.filter(Boolean).join(", ")),
			prereqSnapshot,
		);
		return {
			...row,
			prerequisites,
			displayName: resolvedName,
			name: resolvedName, // template compatibility: rendered + data-name
			purchased: ledger.filter(
				(entry) =>
					entry.type === row.type &&
					entry.key === row.key &&
					entry.rank === row.rank,
			).length,
			remaining: multiplierRemaining(row, ledger),
			affordable: row.cost <= pool,
			prereqText: prerequisites.filter(Boolean).join(", "),
			prereqList: prerequisites.join("|"),
			unmetPrereqs: unmet,
			sourceName: (row as { sourceName?: string }).sourceName,
			ledgerIndex: ledger.findIndex(
				(entry) =>
					entry.type === row.type &&
					entry.rank === row.rank &&
					((row.key && entry.key === row.key) ||
						(!row.key && entry.name === row.name)),
			),
			benefitTooltip:
				row.type === "talent" ? benefitTooltip(row, input.talentDocs) : "",
			uuid: docLinkUuid(row, input.skillDocs, input.talentDocs),
			skill: row.type === "skill" ? skillPreview(row, resolvedName, input) : null,
		};
	});

	const rankGroups: AdvancementRankGroupVM[] = [];
	for (let rankIndex = 1; rankIndex <= rank; rankIndex += 1) {
		const groupRows = enriched.filter((row) => row.rank === rankIndex);
		if (groupRows.length > 0) {
			rankGroups.push({
				rank: rankIndex,
				xpLevel: thresholds.find((t) => t.rank === rankIndex)?.xpLevel ?? 0,
				spentOnRank: spentOnRank(ledger, rankIndex),
				rows: groupRows,
			});
		}
	}
	const firstUnpurchased = rankGroups.find((group) =>
		group.rows.some((row) => row.remaining > 0),
	);
	const defaultRank = firstUnpurchased?.rank ?? rankGroups.at(-1)?.rank ?? null;

	return {
		pool,
		spent,
		rank,
		progress,
		canBuy: pool > 0 && Boolean(input.career),
		characteristics: characteristicRows,
		rankGroups,
		defaultRank,
	};
}
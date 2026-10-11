/**
 * PURE purchase helpers for the advancement dialog's #buyRow (bead avah):
 * the validation step, the ledger update and the talent-grant branch, each
 * testable with plain fixtures and NO Foundry — even the talent grant takes
 * its prompts/grants as injected deps, so the branch can be exercised
 * headlessly (the dialog wires the real prompter/clone through
 * foundryTalentGrantDeps).
 *
 * The rules math itself stays in rules/advancement.ts (validatePurchase,
 * ledgerEntryFor, derivedRank, totalSpent) and rules/prereq.ts; this module
 * composes them into the dialog's purchase flow and pins its composition.
 * Tested by advancement-buy.test.ts.
 */
import {
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	derivedRank,
	type RankThresholdLike,
	totalSpent,
	validatePurchase,
} from "../../rules/advancement";
import { evaluatePrerequisites, parsePrerequisites } from "../../rules/prereq";
import {
	type OwnedSkillLadderLike,
	skillAtCapReason,
} from "./advancement-view-model";

/** i18n seams so no Foundry global reaches this module (arch: domain never
 * localizes; these helpers sit at the presentation edge and take the seam). */
export type LocalizeFn = (key: string) => string;
export type FormatFn = (key: string, vars?: Record<string, string>) => string;

/** A character snapshot for the structured prereq evaluator (bead tfk). */
export interface AdvancePurchaseContext {
	spent: number;
	pool: number;
	ledger: AdvanceLedgerEntry[];
	derivedRank: number;
	/** Structured prereq snapshot: characteristic VALUES, talent names, psy. */
	characteristics: Partial<Record<string, number>>;
	ownedTalents: string[];
	psyRating: number;
	/** The actor's owned skills (key/name/ladder), for the at-cap check. */
	ownedSkills: OwnedSkillLadderLike[];
	/** The row's resolved display name (bead i1f4: data-name is resolved). */
	rowName: string;
}

export interface AdvancePurchaseValidation {
	/** Hard reasons from the advancement rules: FINAL confirm text (en). */
	reasons: string[];
	/** UNMET prerequisites only, unlocalized (the dialog prefixes them). */
	unmetPrereqs: string[];
	/** Lang key when the owned skill already sits at the ladder cap. */
	atCap: string | null;
}

/**
 * Validate a purchase (bead avah): the shared rule validator (rank cap,
 * multiplier budget, affordability), the structured prereq evaluation —
 * only UNMET prereqs join the confirm reasons; unparseable strings stay
 * GM-confirm text — and the skill-at-cap soft-confirm (bead i1f4, +20
 * ladder cap, Core Rulebook p74). The helper self-guards on row.type via
 * skillAtCapReason, like the preview and the live application.
 */
export function validateAdvancePurchase(
	row: AdvanceRowLike,
	context: AdvancePurchaseContext,
): AdvancePurchaseValidation {
	const validation = validatePurchase(row, {
		spent: context.spent,
		pool: context.pool,
		ledger: context.ledger,
		derivedRank: context.derivedRank,
	});
	const { unmet } = evaluatePrerequisites(
		parsePrerequisites(row.prerequisites.join(", ")),
		{
			characteristics: context.characteristics,
			talents: context.ownedTalents,
			psyRating: context.psyRating,
		},
	);
	const atCap = skillAtCapReason(row, context.ownedSkills, context.rowName);
	return {
		reasons: validation.reasons,
		unmetPrereqs: unmet,
		atCap,
	};
}

/**
 * The confirm dialog's bullet list for a validation: the rule reasons as-is
 * (they are final English sentences from rules/advancement), the unmet
 * prereqs prefixed through the dialog's key, and the at-cap reason
 * localized from its lang key.
 */
export function advanceConfirmReasons(
	validation: AdvancePurchaseValidation,
	localize: LocalizeFn,
	format: FormatFn,
): string[] {
	const reasons = [...validation.reasons];
	for (const unmet of validation.unmetPrereqs) {
		reasons.push(format("ADVANCE.PREREQ_PREFIX", { prereq: unmet }));
	}
	// skillAtCapReason returns the LANG KEY: localize here so the confirm
	// bullet renders in the character's language.
	if (validation.atCap) reasons.push(localize(validation.atCap));
	return reasons;
}

/**
 * The ledger + rank updates a confirmed purchase produces (p38: the Rank
 * rises automatically once the threshold is crossed). `currentRank` is the
 * actor's rank BEFORE the purchase; `rankUp` is the new rank (null when the
 * threshold was not crossed) so the dialog can notify.
 *
 * NOTE (bead avah): the signature takes the LEDGER, not the actor — the
 * function must stay pure; the naming follows the bead, the input is what
 * keeps it Foundry-free.
 */
export function updateLedger(
	ledger: AdvanceLedgerEntry[],
	entry: AdvanceLedgerEntry,
	thresholds: RankThresholdLike[],
	currentRank: number,
): {
	updates: Record<string, unknown>;
	nextRank: number;
	rankUp: number | null;
} {
	const nextLedger = [...ledger, entry];
	const derived = derivedRank(thresholds, totalSpent(nextLedger));
	const updates: Record<string, unknown> = {
		advances: nextLedger,
		xp: { spent: totalSpent(nextLedger) },
	};
	if (derived > currentRank) {
		updates.rank = derived;
	}
	return {
		updates,
		nextRank: derived,
		rankUp: derived > currentRank ? derived : null,
	};
}

/** The injected Foundry edges of the talent-grant branch. */
export interface TalentGrantDeps {
	/** yclz: prompt for a parameterised subject; null = cancelled. */
	promptSubject: (name: string) => Promise<string | null>;
	/** meh0: build the pack-clone payload for the concrete name. */
	grantPayload: (name: string) => Promise<object>;
	/** The actor's owned talent names (exact-match against the granted name). */
	ownedTalentNames: () => string[];
	/** Create the embedded Item (the actor's createEmbeddedDocuments). */
	createItems: (payload: object) => Promise<unknown>;
}

/**
 * The talent-grant branch of #buyRow (bead avah): idempotent grant by name
 * (matching the talent picker) — parameterised rows ("Peer", "Enemy (choose
 * one)" ) prompt for their subject first; a CANCELLED prompt grants nothing
 * and records no ledger entry (the caller checks the return). Returns false
 * when cancelled, true otherwise (whether or not the actor already owned it).
 */
export async function applyTalentGrant(
	row: AdvanceRowLike,
	deps: TalentGrantDeps,
): Promise<boolean> {
	let grantName = row.name;
	const prompted = await deps.promptSubject(grantName);
	if (prompted === null) return false;
	grantName = prompted;
	// meh0: clone the pack document so granted talents carry their
	// description/category/effects instead of arriving bare.
	const payload = await deps.grantPayload(grantName);
	if (!deps.ownedTalentNames().includes(grantName)) {
		await deps.createItems(payload);
	}
	return true;
}

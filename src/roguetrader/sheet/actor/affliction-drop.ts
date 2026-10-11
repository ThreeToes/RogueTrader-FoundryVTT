/**
 * Affliction drop machinery (epic nt8k, beads xu83 / kam1; extracted from
 * character-sheet.ts in bead yxpk): the four module-level functions behind
 * CharacterSheet._onDrop for disorders/malignancies/mutations, kept off the
 * 1490-line sheet class so the drop pipeline can be tested with plain
 * fixtures. Behaviour-preserving move; Foundry access rides the ports seam
 * (dice/chat) and the stubbed `game.packs` for pack lookups.
 */

import { systemOf } from "../../data/accessors";
import type { EffectData } from "../../data/item/effects";
import type { MutationRow } from "../../data/item/mutation-roll";
import { getPackDocuments } from "../pack-resolve";
import { findPackDoc } from "./grant-helpers";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import {
	applyAfflictionProcedure,
	resolveEffectValues,
	type ProcedureGrant,
} from "../../rules/afflictions";
import { dueDisorders } from "../../rules/madness";
import { postCard } from "../../rules/chat-flags";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

const MUTATION_PACK = "rogue-trader.afflictions";

/** Structural view of a mutation pack document (band + name). */
interface MutationPackDoc {
	name?: string;
	type?: string;
	system?: { tableKey?: string; rollMin?: number; rollMax?: number };
	toObject?: () => unknown;
}

/**
 * Read the mutation table rows out of the pack. A row missing its band THROWS:
 * a silently-defaulted band would make one row cover every number and quietly
 * corrupt every Ravaged Body roll.
 */
export function mutationRowsFrom(docs: MutationPackDoc[]): MutationRow[] {
	return docs.map((doc) => {
		const system = doc.system;
		if (
			!doc.name ||
			typeof system?.rollMin !== "number" ||
			typeof system?.rollMax !== "number"
		) {
			throw new Error(
				`mutation pack row "${doc.name ?? "?"}" has no table band (rollMin/rollMax)`,
			);
		}
		return {
			name: doc.name,
			tableKey: system.tableKey ?? "mutations",
			rollMin: system.rollMin,
			rollMax: system.rollMax,
		};
	});
}

/**
 * Clone a dropped Item for embedding, settling acquisition-time state on the
 * copy (epic nt8k). Four affliction-specific steps:
 * - a printed acquisition procedure (bead xu83) runs once and appends its
 *   settled effect rows (Degenerate Mind's trait pick, Mental Regressive's
 *   per-characteristic table), then clears the marker so it cannot re-run;
 * - a procedure that rolls up FURTHER mutations (bead kam1: Ravaged Body's
 *   "Roll 1d5 times on this table") returns them as grants. They are resolved
 *   against the mutation pack, settled the same way, and returned alongside
 *   the dropped item so one drop can produce several Items;
 * - characteristic changes are rolled ONCE here and written onto the effect
 *   row, so later tests see a stable number (dice are signed: "-1d10" reduces);
 * - an acquired Disorder records the severity it was gained at, which is what
 *   `dueDisorders` reads to stop re-prompting that threshold.
 *
 * Returns the dropped item's payload FIRST, then any granted mutations, so the
 * caller's single createEmbeddedDocuments call preserves drop order.
 */
export async function prepareDroppedItems(
	actor: foundry.documents.Actor,
	source: foundry.documents.Item,
	gainedByTableRoll = false,
): Promise<Record<string, unknown>[]> {
	const object = source.toObject() as unknown as {
		system?: {
			kind?: string;
			effects?: EffectData[];
			acquiredSeverity?: string;
			procedure?: string;
		};
	};
	const system = object.system;
	if (!system) return [object as unknown as Record<string, unknown>];
	const grants: ProcedureGrant[] = [];
	if (system.procedure) {
		// A mutation gained BY a table roll must not re-run its own table
		// procedure. The book does not resolve re-rolling Ravaged Body into
		// Ravaged Body, and recursing would loop without bound; the bounded
		// reading is to grant the mutation and stop (bead kam1 records this
		// for owner confirmation). Every other procedure still settles.
		if (gainedByTableRoll && system.procedure === "ravaged-body") {
			system.procedure = "";
		} else {
			const character = systemOf(actor);
			// The pack is read at most once per drop, and only when a
			// procedure actually needs the table.
			let packDocs: MutationPackDoc[] | null = null;
			const loadMutations = async (): Promise<MutationPackDoc[]> => {
				packDocs ??= (
					(await getPackDocuments(MUTATION_PACK)) as MutationPackDoc[]
				).filter((doc) => doc.type === "mutation");
				return packDocs;
			};
			const outcome = await applyAfflictionProcedure(system.procedure, {
				roll: async (notation) => {
					return (await getPorts().dice.roll(notation)).total ?? 0;
				},
				characteristic: (key) => character.effectiveCharacteristicValue(key),
				mutationRows: async () => mutationRowsFrom(await loadMutations()),
			});
			system.effects = [...(system.effects ?? []), ...outcome.effects];
			grants.push(...outcome.grants);
			// Settled: the sub-roll must never run again on this item.
			system.procedure = "";
		}
	}
	if (
		system.effects?.some(
			(effect) =>
				effect.kind === "characteristic-modifier" &&
				effect.dice &&
				!effect.value,
		)
	) {
		system.effects = await resolveEffectValues(
			system.effects,
			async (notation) => {
				return (await getPorts().dice.roll(notation)).total ?? 0;
			},
		);
	}
	if (source.type === "madnessentry" && system.kind === "disorder") {
		const character = actor.system as unknown as { insanity?: number };
		const held = actor.items
			.filter(
				(item) =>
					item.type === "madnessentry" &&
					(item.system as unknown as { kind?: string }).kind === "disorder",
			)
			.map((item) => ({
				severity:
					(item.system as unknown as { acquiredSeverity?: string })
						.acquiredSeverity ?? "",
			}));
		system.acquiredSeverity =
			dueDisorders(character.insanity ?? 0, held)[0]?.severity ?? "";
	}

	const payloads = [object as unknown as Record<string, unknown>];
	if (grants.length > 0) {
		await postMutationRollCard(actor, source.name ?? "", grants);
		for (const grant of grants) {
			const granted = await resolveMutationByName(grant.name);
			if (!granted) {
				console.warn(
					`rogue-trader | Ravaged Body rolled "${grant.name}", which is not in ${MUTATION_PACK}`,
				);
				continue;
			}
			const grantedPayloads = await prepareDroppedItems(actor, granted, true);
			for (const payload of grantedPayloads) {
				// A granted mutation is a NEW owned Item, so the pack document's
				// _id must go: rolling the same mutation twice is legal (the book
				// says roll 1d5 times, not re-roll repeats), and two embedded
				// Items cannot share an _id.
				const clone = { ...(payload as Record<string, unknown>) };
				delete clone._id;
				payloads.push(clone);
			}
		}
	}
	return payloads;
}

/** Resolve a mutation pack Item by name (fresh document, safe to clone). */
export async function resolveMutationByName(
	name: string,
): Promise<foundry.documents.Item | null> {
	// bead 38io: the shared case-insensitive pack-by-name resolve, pointed at
	// the afflictions pack's mutation items; the Ravaged Body grant site
	// (caller) owns the missing-name warn and keeps its wording.
	return (await findPackDoc("mutation", name, {
		pack: MUTATION_PACK,
	})) as unknown as foundry.documents.Item | null;
}

/**
 * Post the Ravaged Body card (bead kam1): the mutation that triggered the
 * table, and each d100 with the row it landed on, so the roll is auditable at
 * the table rather than appearing as N unexplained new items.
 */
export async function postMutationRollCard(
	actor: foundry.documents.Actor,
	sourceName: string,
	grants: ProcedureGrant[],
): Promise<void> {
	try {
		await postCard(actor, `${TEMPLATE_ROOT}chat/mutation-roll.hbs`, {
			title: game.i18n.format("CHAT.MUTATION_ROLL_TITLE", {
				mutation: sourceName,
			}),
			countLabel: game.i18n.format("CHAT.MUTATION_ROLL_COUNT", {
				count: grants.length,
			}),
			results: grants.map((grant) => ({
				roll: grant.roll ?? 0,
				name: grant.name,
			})),
		});
	} catch (error) {
		// The items are already being created; a failed card must not abort the
		// drop. Loud, because a silent failure here loses the audit trail.
		console.error("rogue-trader | mutation roll card failed", error);
	}
}
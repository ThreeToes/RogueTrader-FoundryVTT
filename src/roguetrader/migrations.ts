/**
 * System data migrations (bead ow8w). Foundry has no automatic actor-type
 * rename and changing `type` via update is not a supported path, so a legacy
 * character type is migrated by CREATE-RECREATE: a new explorer actor is
 * created with the same name/system data/prototype token and embedded items,
 * then the legacy document is deleted. The new actor's _id differs from the
 * legacy one (id-preserving creates collide with the still-existing doc) —
 * the old->new id pair is logged loudly so any hand-made references can be
 * relinked.
 *
 * Pure decision logic (`LEGACY_CHARACTER_TYPES`, `needsTypeMigration`,
 * `explorerClonePayload`, and the origin-ledger backfill below) is exported
 * for tests; the runner is the only Foundry-coupled layer.
 */

import {
	originLedgerEntry,
	totalSpent,
	type AdvanceLedgerEntry,
} from "./rules/advancement";
import {
	type OriginPick,
	type OriginRow,
	originLedgerEntryName,
	resolveOrigins,
	storedOriginPicks,
} from "./rules/origins";

export const TARGET_CHARACTER_TYPE = "explorer";

/** Legacy character types that must be migrated onto "explorer". */
export const LEGACY_CHARACTER_TYPES = ["pc", "acolyte"] as const;

/**
 * The system this migration belongs to (bead w9sa.7).
 *
 * "acolyte" is not a made-up legacy name here — it is the Rogue Trader
 * system's OLD character type, and it is coincidentally also the name Dark
 * Heresy 2e uses for ITS character type. A sibling system that boots this
 * code would find its perfectly healthy acolytes, clone them into RT's
 * `explorer` type with RT's Character dataModel, and delete the originals.
 * So the runner is gated on the running system's id, and the gate is a PURE
 * predicate so it is testable without Foundry.
 */
export const LEGACY_MIGRATION_SYSTEM_ID = "rogue-trader";

/**
 * Whether the legacy-actor migration should run at all.
 *
 * True only for the Rogue Trader system itself. A sibling system sharing this
 * code (a dark_heresy_2e boot, say) gets `false`, so its own actor types are
 * left alone — and the gate is deliberately a strict equality rather than a
 * "not blank" check, because the failure it prevents is silent data loss.
 */
export function shouldRunLegacyMigration(systemId: unknown): boolean {
	return systemId === LEGACY_MIGRATION_SYSTEM_ID;
}

export function needsTypeMigration(type: string): boolean {
	return (LEGACY_CHARACTER_TYPES as readonly string[]).includes(type);
}

/**
 * Remove the legacy character types from a document-type registry, in place of
 * the retired name still being OFFERED (bead vnz3). Handles both shapes Foundry
 * exposes, because they are easy to confuse and the failure is silent:
 *
 *   - `game.documentTypes.Actor`          -> string[] of type names. This is
 *     the registry the client reads ("document types supported by the active
 *     world"), i.e. what builds the Create Actor dropdown.
 *   - `game.system.documentTypes.Actor`   -> `{ type: config }` object MAP
 *     (the raw manifest field, an ObjectField).
 *
 * The previous code tested `Array.isArray(game.system.documentTypes?.Actor)`,
 * which is ALWAYS false for the object map, so it never filtered anything.
 * Pure and total: anything that is neither shape is returned untouched.
 */
export function withoutLegacyCharacterTypes(registry: unknown): unknown {
	if (Array.isArray(registry)) {
		return registry.filter((type) => !needsTypeMigration(String(type)));
	}
	if (registry && typeof registry === "object") {
		const out = { ...(registry as Record<string, unknown>) };
		for (const legacy of LEGACY_CHARACTER_TYPES) delete out[legacy];
		return out;
	}
	return registry;
}

/**
 * Strip the legacy character types from a live registry IN PLACE (bead aicd).
 * `withoutLegacyCharacterTypes` cannot be used at the call site any more:
 * Foundry v14 freezes `game.documentTypes` itself (foundry.mjs:206129), so
 * `registry.Actor = ...` throws `TypeError: Cannot assign to read only
 * property 'Actor'` on every world load. The outer object is frozen but its
 * VALUES are not — the type-name arrays and the `game.system.documentTypes`
 * object map are ordinary mutable objects — so mutating them in place works
 * identically on v13 and v14. Shapes follow `withoutLegacyCharacterTypes`:
 *
 *   - an ARRAY (e.g. `game.documentTypes.Actor`) -> filtered in place via
 *     the pure helper
 *   - an OBJECT MAP (e.g. `game.system.documentTypes.Actor`) -> legacy keys
 *     deleted
 *   - anything else -> ignored (fail soft; fail loudly upstream)
 */
export function removeLegacyCharacterTypes(registry: unknown): void {
	if (Array.isArray(registry)) {
		const kept = withoutLegacyCharacterTypes(registry) as string[];
		registry.length = 0;
		registry.push(...kept);
		return;
	}
	if (registry && typeof registry === "object") {
		for (const legacy of LEGACY_CHARACTER_TYPES) {
			delete (registry as Record<string, unknown>)[legacy];
		}
	}
}

/** The payload a legacy actor carries over (id included for logging). */
interface LegacyActorLike {
	type: string;
	id?: string;
	name?: string;
	img?: string;
	prototypeToken?: object;
	system?: object;
	items?: Array<{ toObject: () => object }>;
}

export interface ExplorerClonePayload {
	type: string;
	name?: string;
	img?: string;
	prototypeToken?: object;
	system?: object;
	items?: object[];
}

/**
 * The creation payload for a legacy actor's replacement: type switched to
 * "explorer", identity fields kept, items embedded so nothing is lost when
 * the old document is deleted.
 */
export function explorerClonePayload(
	actor: LegacyActorLike,
): ExplorerClonePayload {
	return {
		type: TARGET_CHARACTER_TYPE,
		...(actor.name !== undefined ? { name: actor.name } : {}),
		...(actor.img !== undefined ? { img: actor.img } : {}),
		...(actor.prototypeToken !== undefined
			? { prototypeToken: actor.prototypeToken }
			: {}),
		...(actor.system !== undefined ? { system: actor.system } : {}),
		items: (actor.items ?? []).map((item) => item.toObject()),
	};
}

/**
 * Run the migration. GM-only (only a GM can create/delete world actors).
 * Recreate-then-delete is sequential so a failure mid-run leaves a
 * consistent world (either a migrated explorer plus the old doc, or the
 * untouched legacy actor — never a deleted actor with no replacement).
 */
export async function migrateLegacyActors(): Promise<void> {
	const api = game as unknown as {
		user?: { isGM: boolean };
		actors?: { contents: LegacyActorLike[] };
		system?: { id?: unknown };
	};
	if (!api.user?.isGM) return;
	// Bead w9sa.7: this migration is RT-specific. A sibling system sharing this
	// code would clone its own "acolyte" actors into RT's `explorer` type and
	// delete the originals, so bail before touching anything.
	if (!shouldRunLegacyMigration(api.system?.id)) {
		console.log(
			`rogue-trader | legacy migration skipped: not running under "${LEGACY_MIGRATION_SYSTEM_ID}".`,
		);
		return;
	}
	for (const actor of [...(api.actors?.contents ?? [])]) {
		if (!needsTypeMigration(actor.type)) continue;
		console.log(
			`rogue-trader | migrating legacy "${actor.type}" actor "${actor.name}" (${actor.id}) -> ${TARGET_CHARACTER_TYPE}`,
		);
		try {
			const created = (await foundry.documents.Actor.create(
				explorerClonePayload(actor) as never,
			)) as unknown as { id?: string };
			await (actor as unknown as { delete: () => Promise<unknown> }).delete();
			console.log(
				`rogue-trader | migrated ${actor.id} -> ${created?.id ?? "?"} (${actor.name})`,
			);
		} catch (error) {
			console.error(
				`rogue-trader | legacy-actor migration failed for ${actor.id}:`,
				error,
			);
		}
	}
}

// -------------------------------------------------------------------------
// Bead gfsp — one-time origin-xp ledger backfill for EXISTING actors
// -------------------------------------------------------------------------

/** The actor surface the origin-ledger backfill reads/patches. */
export interface OriginLedgerActorLike {
	system?: {
		origins?: Record<string, unknown>;
		advances?: AdvanceLedgerEntry[];
		xp?: { spent?: number; total?: number };
	};
}

/**
 * The audit name for the backfilled creation-baseline entry: the picked
 * origins' book names in canonical row order, exactly like the creator's own
 * originLedgerName (shared helper originLedgerEntryName, rules/origins.ts),
 * so a backfilled entry is indistinguishable in kind from a creator-booked
 * one.
 */
function originLedgerBackfillName(
	picks: Partial<Record<OriginRow, OriginPick>>,
): string {
	return originLedgerEntryName(picks);
}

/**
 * Bead gfsp (owner-approved backfill of EXISTING actors): the origin-ledger
 * baseline (bead r8mw) only reaches characters made by the FIXED creator;
 * previously-created actors have no type:"origin" entry, so their pool
 * overstates by the origin xpCost. The pure decision: when an actor persists
 * origin picks (system.origins) and its ledger carries NO origin entry,
 * resolve the origin's xpCost and append the originLedgerEntry baseline,
 * recomputing xp.spent FROM the merged ledger. xpCost = 0 needs no entry.
 * REPEATED RUNS MUST NOT DOUBLE-APPEND — the "no origin entry present" gate
 * makes a patched actor a no-op on the next pass (idempotent).
 *
 * Returns the update patch, or null when there is nothing to do.
 */
export function originLedgerBackfill(
	actor: OriginLedgerActorLike,
): Record<string, unknown> | null {
	// THE single stored-picks reader (bead 58js): a xeno's path picks must
	// resolve here too, not just the five human fields.
	const picks = storedOriginPicks(
		actor.system?.origins as Parameters<typeof storedOriginPicks>[0],
	);
	if (Object.keys(picks).length === 0) return null;
	const existing = Array.isArray(actor.system?.advances)
		? actor.system!.advances
		: [];
	// Same idempotency gate as the creator re-run's merge (bead 9o5z): an
	// actor that already carries an origin entry (newer creator) is untouched.
	if (existing.some((entry) => entry.type === "origin")) return null;
	const xpCost = resolveOrigins(picks).xpCost;
	if (xpCost <= 0) return null;
	const merged: AdvanceLedgerEntry[] = [
		...existing,
		originLedgerEntry(originLedgerBackfillName(picks), xpCost),
	];
	return {
		system: {
			advances: merged,
			xp: { ...(actor.system?.xp ?? {}), spent: totalSpent(merged) },
		},
	};
}

/**
 * Run the backfill at ready. GM-only (players cannot update world actors the
 * group sheet does not own), RT-system-gated like the legacy-type migration.
 * Per-actor try/catch: one broken actor must not stop the pass.
 */
export async function backfillOriginLedgerEntries(): Promise<void> {
	const api = game as unknown as {
		user?: { isGM: boolean };
		actors?: {
			contents: Array<
				OriginLedgerActorLike & {
					id?: string;
					update: (data: object) => Promise<unknown>;
				}
			>;
		};
		system?: { id?: unknown };
	};
	if (!api.user?.isGM) return;
	if (api.system?.id !== LEGACY_MIGRATION_SYSTEM_ID) {
		console.log(
			`rogue-trader | origin-ledger backfill skipped: not running under "${LEGACY_MIGRATION_SYSTEM_ID}".`,
		);
		return;
	}
	for (const actor of [...(api.actors?.contents ?? [])]) {
		try {
			const patch = originLedgerBackfill(actor);
			if (!patch) continue;
			await actor.update(patch);
			console.log(
				"rogue-trader | origin-ledger baseline backfilled onto actor.",
			);
		} catch (error) {
			console.error(
				"rogue-trader | origin-ledger backfill failed for an actor:",
				error,
			);
		}
	}
}

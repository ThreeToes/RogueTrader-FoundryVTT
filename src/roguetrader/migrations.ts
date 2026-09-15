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
 * `explorerClonePayload`) is exported for tests; the runner is the only
 * Foundry-coupled layer.
 */

export const TARGET_CHARACTER_TYPE = "explorer";

/** Legacy character types that must be migrated onto "explorer". */
export const LEGACY_CHARACTER_TYPES = ["pc", "acolyte"] as const;

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
export function explorerClonePayload(actor: LegacyActorLike): ExplorerClonePayload {
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
	};
	if (!api.user?.isGM) return;
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
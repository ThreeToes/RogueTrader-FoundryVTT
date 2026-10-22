/**
 * Foundry-coupled grant helpers (beads meh0, yclz): compendium pack lookup
 * and the parameterised-talent subject prompt. The pure logic lives in
 * rules/grants.ts; this module is the single Foundry-coupled layer shared
 * by the creator, advancement dialog and talent picker.
 */

import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import {
	type GrantPayload,
	type PackTalentSnapshot,
	parameterisedBase,
	parameterisedPackBase,
	resolveParameterised,
	suggestedSubjects,
	talentGrantPayload,
} from "../../rules/grants";
import { CHARACTER_OPTIONS_PACK, getPackDocuments } from "../pack-resolve";

/**
 * Pack slugs used by grants-item effect labels ("traits:Fear",
 * "talents:Iron Jaw") mapped onto the character-options concept pack's
 * Item types (bead 4tj1 merged the per-pack traits/talents/skills sources
 * into it). Pure; used by the sheet's affliction grant action.
 */
const GRANT_PACK_TYPES: Readonly<Record<string, string>> = {
	traits: "trait",
	talents: "talent",
	skills: "skill",
};

/** Map a pack-qualified effect label slug ("traits") to its Item type. */
export function packSlugToType(slug: string): string | null {
	return GRANT_PACK_TYPES[slug.toLowerCase()] ?? null;
}

/**
 * THE pack-by-name resolve (bead 38io): case-insensitive name match against
 * character-option documents of ONE Item type — or, with `options.pack`,
 * against another compendium pack (the afflictions mutations) filtered by
 * the same type; `type` may be null to accept any Item type (the starting
 * kit's mixed-type gear). With `options.source`, only docs whose
 * `flags["rogue-trader"].source` folder matches resolve (build-time source
 * provenance, bead n7hu). Returns null on miss; the CALLER owns the
 * missing-doc behaviour through warnPackDocMissing (bare fallback / notify /
 * no-op), so one function owns the resolution instead of a per-surface
 * docs.find().
 */
/**
 * THE pack-by-name resolve (bead 38io): case-insensitive name match against
 * character-option documents of ONE Item type (or ANY type, with a null
 * `type`); with `options.pack`, against that compendium pack; with
 * `options.source`, narrowed to one build-time source folder
 * (`flags["rogue-trader"].source`, bead n7hu). Fetches go through the shared
 * once-cache under the PACK key so mixed-type resolves (the starting kit)
 * never refetch per option (epic zlwc round 4). Returns null on miss; the
 * CALLER owns the missing-doc behaviour through warnPackDocMissing (bare
 * fallback / notify / no-op), so one function owns the resolution instead of
 * a per-surface docs.find().
 */
/**
 * THE pack-by-name resolve (bead 38io): case-insensitive name match against
 * character-option documents of ONE Item type (or ANY type, with a null
 * `type`); with `options.pack`, against that compendium pack; with
 * `options.source`, narrowed to one build-time source folder
 * (`flags["rogue-trader"].source`, bead n7hu). Callers that resolve MANY
 * names from ONE pack pass `options.docs` (their own once-fetched list —
 * the kit finalize) and no refetch happens per option. Returns null on
 * miss; the CALLER owns the missing-doc behaviour through
 * warnPackDocMissing (bare fallback / notify / no-op), so one function owns
 * the resolution instead of a per-surface docs.find().
 */
export async function findPackDoc(
	type: string | null,
	name: string,
	options: { pack?: string; source?: string; docs?: unknown[] } = {},
): Promise<unknown | null> {
	const docs = (options.docs ??
		(options.pack
			? await getPackDocuments(options.pack)
			: await getPackDocuments(CHARACTER_OPTIONS_PACK))) as unknown as Array<{
		name?: string;
		type?: string;
		flags?: Record<string, Record<string, unknown>>;
	}>;
	let candidates = type ? docs.filter((d) => d.type === type) : docs;
	if (options.source) {
		candidates = candidates.filter(
			(d) =>
				String(
					(d.flags?.["rogue-trader"] as { source?: string } | undefined)
						?.source ?? "",
				) === options.source,
		);
	}
	const lower = name.toLowerCase();
	return candidates.find((d) => d.name?.toLowerCase() === lower) ?? null;
}

/**
 * User-facing notify spec (bead eqay): missing-doc GRANT surfaces get BOTH
 * the console line (owned here) and a toast (owned here) — no grant surface
 * resolves a missing pack doc silently. (Some non-grant open surfaces, e.g.
 * the generic openPackItemAction, remain console-only.)
 */
export interface PackDocMissingNotify {
	/** i18n key for the toast (all sites pass their own action-local key). */
	key: string;
	/** Toast severity — defaults to "error" when omitted. */
	severity?: "info" | "warn" | "error";
	/** Interpolation vars for the toast (e.g. { name } / { uuid }). */
	vars?: Record<string, unknown>;
}

/**
 * Shared missing-doc warn (bead 38io): the established grant semantics — one
 * loud console line per miss — from every surface that resolves pack docs by
 * name. Bead eqay: this function now owns the user-facing notify TOO (the
 * default severity is "error" — a missing doc is never silent), so callers
 * no longer layer their own toasts with divergent severity choices; a
 * surface that needs a specific key/severity passes a
 * PackDocMissingNotify (both character-sheet severities and the psychic
 * picker's error route through here unchanged).
 */
export function warnPackDocMissing(
	type: string,
	name: string,
	action: string,
	pack = "character-options",
	notify?: PackDocMissingNotify,
): void {
	console.warn(
		`rogue-trader | ${type} "${name}" not found in the ${pack} pack; ${action}`,
	);
	const {
		key,
		severity = "error",
		vars,
	} = notify ?? {
		key: "GRANT.DOC_MISSING",
		vars: { type, name, pack },
	};
	getPorts().notify[severity](key, vars);
}

/** Case-insensitive name match against the talents compendium pack. */
export async function findPackTalentDoc(
	name: string,
): Promise<(PackTalentSnapshot & { id?: string }) | null> {
	return (await findPackDoc("talent", name)) as
		| (PackTalentSnapshot & { id?: string })
		| null;
}

/**
 * Build a talent grant payload cloning the pack doc (meh0). Missing pack
 * docs fall back to a bare item with a console note — never silent.
 */
export async function talentGrant(
	name: string,
	options: { grantedBy?: string } = {},
): Promise<GrantPayload> {
	let doc = await findPackTalentDoc(name);
	if (!doc) {
		// Parameterised talents are authored as BARE base docs in the pack
		// ("Rival", "Resistance") while origins/careers grant concrete
		// subject-qualified names ("Rival (Rogue Trader family)"). Fall back
		// to the base pack doc and clone it under the concrete name —
		// talentGrantPayload takes the display name separately (h1o5).
		const base = parameterisedPackBase(name);
		if (base) doc = await findPackTalentDoc(base);
	}
	if (!doc) {
		warnPackDocMissing("talent", name, "granting a bare item");
	}
	return talentGrantPayload(name, doc, options);
}

/**
 * Prompt for a parameterised talent's parenthetical subject (yclz):
 * "Peer" alone is mechanically meaningless, so resolve to e.g.
 * "Peer (Underworld)" before granting. Suggestions come from the book's
 * representative group lists (Core Rulebook p92); free text is always allowed
 * (book: "representative, not all-inclusive").
 *
 * Returns the resolved name, or null when the player cancels (caller
 * skips the grant — never grant an unresolved parameterised talent).
 */
export async function promptParameterisedSubject(
	name: string,
): Promise<string | null> {
	const base = parameterisedBase(name);
	if (!base) return name;
	const suggestions = suggestedSubjects(base);
	const options = suggestions
		.map((subject) => `<option value="${subject}">${subject}</option>`)
		.join("");
	const content = `<p>${game.i18n!.format("GRANT.PARAM_PROMPT", { name: base })}</p>${
		options
			? `<div class="form-group"><select name="subject" autofocus>${options}<option value="">— ${game.i18n!.localize("GRANT.PARAM_CUSTOM")} —</option></select></div>`
			: ""
	}<div class="form-group"><input type="text" name="custom" placeholder="${game.i18n!.localize("GRANT.PARAM_PLACEHOLDER")}" /></div>`;
	// DialogV2.input reads form inputs and resolves to their data object.
	const result = (await foundry.applications.api.DialogV2.input({
		window: { title: game.i18n!.format("GRANT.PARAM_TITLE", { name: base }) },
		content,
		ok: { label: game.i18n!.localize("GRANT.PARAM_OK") },
	})) as { subject?: string; custom?: string } | null;
	const data = result ?? {};
	const subject = (data.custom?.trim() || data.subject?.trim()) ?? "";
	if (!subject) return null;
	return resolveParameterised(base, subject);
}

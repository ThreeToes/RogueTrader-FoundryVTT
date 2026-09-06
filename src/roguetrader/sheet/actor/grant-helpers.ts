/**
 * Foundry-coupled grant helpers (beads meh0, yclz): compendium pack lookup
 * and the parameterised-talent subject prompt. The pure logic lives in
 * rules/grants.ts; this module is the single Foundry-coupled layer shared
 * by the creator, advancement dialog and talent picker.
 */

import {
	parameterisedBase,
	resolveParameterised,
	suggestedSubjects,
	talentGrantPayload,
	type GrantPayload,
	type PackTalentSnapshot,
} from "../../rules/grants";

/** Case-insensitive name match against the talents compendium pack. */
export async function findPackTalentDoc(
	name: string,
): Promise<(PackTalentSnapshot & { id?: string }) | null> {
	const pack = game.packs?.get("rogue-trader.talents");
	if (!pack) return null;
	const docs = (await pack.getDocuments()) as unknown as Array<
		PackTalentSnapshot & { id?: string }
	>;
	const lower = name.toLowerCase();
	return docs.find((d) => d.name?.toLowerCase() === lower) ?? null;
}

/**
 * Build a talent grant payload cloning the pack doc (meh0). Missing pack
 * docs fall back to a bare item with a console note — never silent.
 */
export async function talentGrant(
	name: string,
	options: { grantedBy?: string } = {},
): Promise<GrantPayload> {
	const doc = await findPackTalentDoc(name);
	if (!doc) {
		console.warn(
			`rogue-trader | talent "${name}" not found in rogue-trader.talents; granting a bare item`,
		);
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
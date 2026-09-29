/**
 * Shared sheet rich-text enrichment (bead lku8).
 *
 * Every sheet rendered its description/notes with the same
 * `foundry.applications.ux.TextEditor.enrichHTML(html, { secrets, relativeTo })`
 * call. `secrets` hides `@UUID[..]{#secret}` content from non-owners and
 * `relativeTo` resolves relative links against the owning document.
 *
 * `secrets` defaults to FALSE (Foundry's own default) so a caller that does
 * not opt in behaves exactly as before; item sheets pass
 * `{ secrets: document.isOwner }`.
 */
export async function enrichText(
	html: unknown,
	relativeTo: unknown,
	options: { secrets?: boolean } = {},
): Promise<string> {
	return foundry.applications.ux.TextEditor.enrichHTML(String(html ?? ""), {
		secrets: options.secrets ?? false,
		relativeTo: relativeTo as foundry.abstract.Document.Any,
	});
}

/**
 * Item-sheet description enrichment (bead pe92): the one call every item
 * sheet repeated verbatim — enrich `system.description` against the document
 * with owner-only secrets. Kept as a helper, not a base class (see
 * sheet/context.ts for why shared bases break tsc).
 */
export async function itemDescriptionHTML(document: unknown): Promise<string> {
	const doc = document as {
		system: { description?: string };
		isOwner: boolean;
	};
	return enrichText(doc.system.description ?? "", document, {
		secrets: doc.isOwner,
	});
}

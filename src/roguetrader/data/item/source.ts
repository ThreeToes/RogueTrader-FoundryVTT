/**
 * Shared source-attribution field (bead zzlq): every extracted compendium
 * entry records where it came from — `system.source.book` is the books.yaml
 * slug (machine id; display names resolve via books.yaml — never put a slug
 * where a title belongs) and `system.source.page` is the book's PRINTED page
 * number. Extraction convention (no silent drops): every extracted entry
 * carries it; hand-curated values keep their page+line curation comments.
 */
export function sourceField() {
	return new foundry.data.fields.SchemaField({
		/** books.yaml slug (e.g. "rt_core"); "" = unattributed (pre-zzlq). */
		book: new foundry.data.fields.StringField({ initial: "" }),
		/** Printed page number in that book; 0 = unattributed. */
		page: new foundry.data.fields.NumberField({
			integer: true,
			min: 0,
			initial: 0,
		}),
	});
}

export interface SourceData {
	book: string;
	page: number;
}

/** Type-safe accessor shape for documents that embed the source field. */
export interface SourcedItem {
	system?: { source?: Partial<SourceData> };
}
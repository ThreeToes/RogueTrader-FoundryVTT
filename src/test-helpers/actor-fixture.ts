/**
 * Shared document-ish actor fixture for roll-pipeline tests.
 *
 * `items` must be iterable (the funnel's item-effects contributor iterates it)
 * AND support .get(id) like a Foundry Collection.
 *
 * Ownership (bead qiuo): the roll pipeline refuses an actor the current user
 * does not own, and the port fails CLOSED, so a fixture that is meant to be
 * rollable must say so. Tests that want a refusal pass `isOwner: false`.
 *
 * Writable documents (bead c9s3): real actors are documents and the ports
 * THROW when a write cannot be performed, so a fixture that exercises the
 * condition/damage paths must be writable; pass `writable: true` for those.
 */
export function actorFixture(
	options: {
		items?: unknown[];
		isOwner?: boolean;
		writable?: boolean;
		system?: Record<string, unknown>;
	} = {},
) {
	const { items = [], isOwner = true, writable = false, system = {} } = options;
	const collection = Object.assign([...items], {
		get: (id: string) => items.find((i) => (i as { id?: string }).id === id),
	});
	const doc: Record<string, unknown> = {
		name: "Tester",
		type: "explorer",
		uuid: "Actor.test",
		items: collection,
		isOwner,
		system: {
			characteristics: {
				ws: { value: 40, unnatural: 1 },
				bs: { value: 50, unnatural: 1 },
				wp: { value: 45, unnatural: 1 },
				ag: { value: 35, unnatural: 1 },
				per: { value: 30, unnatural: 1 },
				fel: { value: 30, unnatural: 1 },
				int: { value: 55, unnatural: 1 },
				t: { value: 40, unnatural: 1 },
			},
			wounds: { value: 0, max: 14 },
			...system,
		},
	};
	if (writable) {
		doc.update = async () => undefined;
		doc.createEmbeddedDocuments = async () => [];
		doc.deleteEmbeddedDocuments = async () => [];
	}
	return doc as never;
}
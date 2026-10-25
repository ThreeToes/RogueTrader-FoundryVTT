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
 *
 * Recorded writes (bead nzwa): a suite that asserts on WHAT was written (the
 * Actors port's `update` payload — the fear Insanity track, the damage-card
 * wounds) passes `recordUpdates: true` and reads the log back through
 * `actorUpdateLog(actor)`. The recorded patch is applied to the fixture
 * document the way the real adapter applies it (dotted paths and nested
 * object payloads both land, merging rather than replacing sibling fields),
 * so the document is left in the state a real one would be.
 */

/** Where a `recordUpdates` fixture keeps its write log. A symbol keeps the
 *  log off the document surface production code reads. */
const UPDATE_LOG = Symbol("rogue-trader.test.updateLog");

type Patch = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Merge `patch` into `target` in place, the way a document update does. */
function mergeInto(target: Record<string, unknown>, patch: Patch): void {
	for (const [key, value] of Object.entries(patch)) {
		if (isRecord(value) && isRecord(target[key])) mergeInto(target[key], value);
		else target[key] = value;
	}
}

/**
 * Apply one write payload: dotted paths (`"system.insanity": 4`) walk to the
 * leaf, plain keys merge into the document.
 */
function recordPatch(actor: Record<string, unknown>, patch: Patch): void {
	for (const [key, value] of Object.entries(patch)) {
		const path = key.split(".");
		const leaf = path.pop() as string;
		if (path.length === 0) {
			if (isRecord(value) && isRecord(actor[leaf]))
				mergeInto(actor[leaf], value);
			else actor[leaf] = value;
			continue;
		}
		let cursor = actor;
		for (const step of path) {
			if (!isRecord(cursor[step])) cursor[step] = {};
			cursor = cursor[step] as Record<string, unknown>;
		}
		if (isRecord(value) && isRecord(cursor[leaf]))
			mergeInto(cursor[leaf], value);
		else cursor[leaf] = value;
	}
}

export function actorFixture(
	options: {
		items?: unknown[];
		/** ActiveEffects on the document (carried conditions live here). */
		effects?: unknown[];
		isOwner?: boolean;
		writable?: boolean;
		/** Writable AND recording: every write is logged (see
		 *  `actorUpdateLog`) and applied to the document. */
		recordUpdates?: boolean;
		/** Document name. Omit for "Tester"; pass `null` for an ANONYMOUS
		 *  document, so the apply paths' refusal copy falls back to the uuid
		 *  (some suites pin that fallback). */
		name?: string | null;
		uuid?: string;
		system?: Record<string, unknown>;
	} = {},
) {
	const {
		items = [],
		effects = [],
		isOwner = true,
		writable = false,
		recordUpdates = false,
		name = "Tester",
		uuid = "Actor.test",
		system = {},
	} = options;
	const collection = Object.assign([...items], {
		get: (id: string) => items.find((i) => (i as { id?: string }).id === id),
	});
	const doc: Record<string, unknown> = {
		...(name === null ? {} : { name }),
		type: "explorer",
		uuid,
		items: collection,
		effects: [...effects],
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
	if (writable || recordUpdates) {
		doc.createEmbeddedDocuments = async () => [];
		doc.deleteEmbeddedDocuments = async () => [];
	}
	if (recordUpdates) {
		const log: Patch[] = [];
		(doc as Record<PropertyKey, unknown>)[UPDATE_LOG] = log;
		doc.update = async (patch: Patch = {}) => {
			log.push(patch);
			recordPatch(doc, patch);
		};
	} else if (writable) {
		doc.update = async () => undefined;
	}
	return doc as never;
}

/**
 * The write log of a fixture built with `recordUpdates: true`, in call order.
 * The array is LIVE: later writes append to the same reference. A fixture
 * without recording answers an empty log.
 */
export function actorUpdateLog(actor: unknown): Patch[] {
	const log = (actor as Record<PropertyKey, unknown> | null | undefined)?.[
		UPDATE_LOG
	];
	return Array.isArray(log) ? (log as Patch[]) : [];
}

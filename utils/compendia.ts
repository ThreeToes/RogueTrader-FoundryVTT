// New packer: YAML sources -> Foundry 14 native LevelDB compendium packs.
//
// IMPORTANT: authoring sources are LOCAL ONLY - src/packs/ is gitignored so
// no copyrighted game content (RT book skill/talent lists etc.) is ever
// committed. The pipeline works fine with an empty src/packs/ (no packs are
// emitted); locally authored YAML is packed the same way.
//
// Format verified against a Foundry-migrated pack (old nedb .db auto-migration):
// - each pack is a plain classic-level DB at release/packs/<pack>
// - valueEncoding json; documents keyed `!items!<16-char id>` (abstract-level
//   sublevel prefix for the items collection)
// - document shape: {_id, name, type, system, effects: [], _stats:{coreVersion}}

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import yaml from "yaml";

const PACK_SRC = "./src/packs";
const PACK_DEST = "./release/packs";

/** Foundry randomID charset (16 chars). */
const ID_CHARS =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Stable ids: honor an explicit _id in the YAML, else deterministic from name. */
export function documentId(name: string, declared?: string): string {
	if (declared) return declared;
	// Deterministic hash of the name so rebuilds keep the same ids.
	let hash = 0;
	for (const char of name) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	let id = "";
	for (let i = 0; i < 16; i++) {
		id += ID_CHARS[hash % ID_CHARS.length];
		// xorshift-ish step so consecutive names do not map to similar ids
		hash ^= hash << 13;
		hash ^= hash >>> 17;
		hash ^= hash << 5;
		hash >>>= 0;
	}
	return id;
}

/**
 * Legacy authored sources declare `type: Item` (generic nedb-era marker) or
 * omit the type. Map those to the real item type the system registers,
 * otherwise the emitted document has no data model and no sheet, and opening
 * it from a compendium crashes (DocumentSheetConfig.getSheetClassesForSubType).
 */
const FOLDER_TYPE_DEFAULTS: Record<string, string> = {
	skills: "skill",
	talents: "talent",
	aptitudes: "aptitude",
	careers: "career",
};

/** Work out the real item type for an authored entry. */
export function resolveEntryType(
	entry: Record<string, unknown>,
	folder: string,
): string {
	const declared = typeof entry.type === "string" ? entry.type : "";
	if (declared && declared !== "Item") return declared;
	if (folder === "weapons") {
		// Weapon sources distinguish only by system.class (melee vs ranged).
		const weaponClass = (entry.system as { class?: string } | undefined)?.class;
		return weaponClass === "melee" ? "melee-weapon" : "ranged-weapon";
	}
	return FOLDER_TYPE_DEFAULTS[folder] ?? "gear";
}

/**
 * Packs whose documents are RollTables rather than Items. Foundry LevelDB
 * packs key each collection by document class: items live under `!items!`,
 * roll tables under `!tables!`.
 */
export const TABLE_PACKS: ReadonlySet<string> = new Set([
	"criticals",
	"psychicphenomena",
	"creationtables",
]);

/**
 * Packs whose documents are Actors (bead et3x). Foundry LevelDB packs store
 * actors under the `!actors!` sublevel with embedded collections split out
 * per sublevel name (verified against Foundry 14.366 core,
 * dist/database/backend/server-document.mjs::_getSublevelNames + batchWrite:
 * sublevel names are the collection hierarchy joined with ".", keys are
 * "!<sublevelName>!<dbKey>", and an actor's embedded items live at
 * `!actors.items!<actorId>.<itemId>` while the actor doc carries only the id
 * array). Orphaned embedded records are deleted on connect
 * (deleteOrphanDocuments), so every item record must belong to a stored
 * actor.
 */
export const ACTOR_PACKS: ReadonlySet<string> = new Set(["npcs"]);

/**
 * LevelDB key builders for Actor packs (et3x). Verified against Foundry
 * 14.366 core (server-document.mjs): sublevel names join the document
 * hierarchy with "." (actors, actors.items, ...), keys are
 * `!<sublevelName>!<dbKey>`, and an embedded record's dbKey is its parent id
 * chain joined with "." (`<actorId>.<itemId>`).
 */
export function actorKey(actorId: string): string {
	return `!actors!${actorId}`;
}

export function actorItemKey(actorId: string, itemId: string): string {
	return `!actors.items!${actorId}.${itemId}`;
}

/** Where one pack's item lives, for compendium-source stamping (et3x). */
export interface ItemSourceIndexEntry {
	/** Pack folder (== compendium name). */
	pack: string;
	/** Deterministic document id (documentId(name)). */
	id: string;
	/** Resolved item type (FOLDER_TYPE_DEFAULTS + folder rules). */
	type: string;
	/** The pack's full authored entry, so embedded clones inherit real
	 * system data (a bare {name} would produce a dataless item that breaks
	 * NPC rolls — bead z4aa). */
	entry: Record<string, unknown>;
}

/** name -> every pack declaring that item name. */
export type ItemSourceIndex = Map<string, ItemSourceIndexEntry[]>;

/** A single authored result row: string shorthand or a partial result. */
type ResultRow =
	| string
	| {
			text?: string;
			weight?: number;
			range?: [number, number];
			/** System flags carried on the result (bead mby6: Table 1-5 rows
			 * carry the structured profitFactor/shipPoints values so creators
			 * can read them programmatically after a draw). */
			flags?: Record<string, unknown>;
	  };

/**
 * Build the `results` array for a RollTable source. Rows are auto-ranged
 * cumulatively (d10 severity order); explicit `range`/`weight` override.
 * A table with no results but a `pending` count gets clearly-labelled
 * placeholder rows so the scaffold is rollable but never silently wrong.
 */
export function buildTableResults(entry: {
	results?: ResultRow[];
	pending?: number;
	name?: string;
}): Array<Record<string, unknown>> {
	const authored = Array.isArray(entry.results) ? entry.results : [];
	const rows: Array<{
		text?: string;
		weight?: number;
		range?: [number, number];
		flags?: Record<string, unknown>;
	}> =
		authored.length > 0
			? authored.map((r) => (typeof r === "string" ? { text: r } : r))
			: Array.from(
					{ length: Math.max(0, Number(entry.pending ?? 0)) },
					(_, i) => ({
						text: `Critical effect pending extraction (severity ${i + 1})`,
					}),
				);

	let next = 1;
	return rows.map((row, i) => {
		const weight = Math.max(1, Number(row.weight ?? 1));
		const end = Array.isArray(row.range) ? row.range[1] : next + weight - 1;
		const start = Array.isArray(row.range) ? row.range[0] : next;
		next = end + 1;
		return {
			_id: documentId(`${entry.name ?? "table"}:${i}`),
			type: 0, // CONST.TABLE_RESULT_TYPES.TEXT
			text: row.text ?? "",
			img: null,
			documentCollection: null,
			documentId: null,
			weight,
			range: [start, end],
			flags: row.flags ?? {},
		};
	});
}

/** Shape a YAML entry into a Foundry RollTable source document. */
export function toTableSourceDocument(entry: Record<string, unknown>) {
	const name = String(entry.name ?? "unnamed");
	return {
		_id: documentId(name, entry._id as string | undefined),
		name,
		formula: typeof entry.formula === "string" ? entry.formula : "1d10",
		replacement: entry.replacement ?? true,
		displayRoll: entry.displayRoll ?? true,
		description: typeof entry.description === "string" ? entry.description : "",
		results: buildTableResults(
			entry as { results?: ResultRow[]; pending?: number; name?: string },
		),
		img: entry.img ?? null,
		folder: null,
		sort: 0,
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
}

/** Shape a YAML entry into a Foundry Item source document. */
function toSourceDocument(entry: Record<string, unknown>, folder: string) {
	const id = documentId(
		String(entry.name ?? "unnamed"),
		entry._id as string | undefined,
	);
	// Top-level `description` is authoring sugar: Foundry item sheets read
	// `system.description` (Gear/itemDescription template), so nest it there
	// when the entry didn't already provide one.
	const system: Record<string, unknown> = { ...(entry.system ?? {}) };
	if (
		!system.description &&
		typeof entry.description === "string" &&
		entry.description
	) {
		system.description = entry.description;
	}
	return {
		_id: id,
		name: entry.name,
		type: resolveEntryType(entry, folder),
		system,
		effects: Array.isArray(entry.effects) ? entry.effects : [],
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
}

/**
 * Build a name -> sources index across every Item pack so actor-pack
 * embedded items can be stamped with their compendium source uuid
 * (Compendium.rogue-trader.<pack>.<id>). Table and actor packs are skipped.
 */
export async function buildItemSourceIndex(
	dirs: Array<{ name: string }>,
): Promise<ItemSourceIndex> {
	const index: ItemSourceIndex = new Map();
	for (const dir of dirs) {
		if (TABLE_PACKS.has(dir.name) || ACTOR_PACKS.has(dir.name)) continue;
		let files: string[] = [];
		try {
			files = (await readdir(path.join(PACK_SRC, dir.name))).filter((f) =>
				f.endsWith(".yaml"),
			);
		} catch {
			continue;
		}
		for (const file of files) {
			const entries = await readYamlEntries(path.join(PACK_SRC, dir.name, file));
			for (const entry of entries) {
				const name = String(entry.name ?? "");
				if (!name) continue;
				const list = index.get(name) ?? [];
				list.push({
					pack: dir.name,
					id: documentId(name, entry._id as string | undefined),
					type: resolveEntryType(entry, dir.name),
					entry,
				});
				index.set(name, list);
			}
		}
	}
	return index;
}

/** Parse a YAML file into its entries (shared by pack + index building). */
async function readYamlEntries(
	file: string,
): Promise<Array<Record<string, unknown>>> {
	const contents = await readFile(file, "utf8");
	const documents = yaml.parseAllDocuments(contents) as Array<{
		toJSON: () => Record<string, unknown>;
		errors: Array<Error>;
	}>;
	const out: Array<Record<string, unknown>> = [];
	for (const parsed of documents) {
		// Loud failure (bead gjn6 finding): the yaml lib collects parse errors
		// on the Document and STILL yields a (corrupted) tree. Never ship that.
		if (parsed.errors.length > 0) {
			throw new Error(
				`compendia: YAML parse error in ${file}: ` +
					parsed.errors.map((e) => e.message.split("\n")[0]).join(" | "),
			);
		}
		const value = (parsed as unknown as { toJSON: () => unknown }).toJSON?.call(
			parsed,
		);
		const entries = Array.isArray(value) ? value : [value];
		for (const entry of entries) {
			if (entry) out.push(entry as Record<string, unknown>);
		}
	}
	return out;
}

/**
 * Shape one embedded item of an actor-pack entry into a Foundry Item source
 * document, stamping its compendium source. Linking rules (bead et3x, owner
 * request "link things appropriately to the compendium"):
 * - `fromPack: <pack>` pins the source pack explicitly;
 * - else the name must resolve to exactly one pack in the item source index;
 * - `standalone: true` opts out with intent (one-off item that exists in no
 *   pack);
 * - anything else is a loud THROW — a silently-unlinked statblock item is a
 *   bug, not a warning.
 */
export function toEmbeddedItemDocument(
	entry: Record<string, unknown>,
	index: ItemSourceIndex,
	seenIds: Set<string>,
): Record<string, unknown> {
	const name = String(entry.name ?? "unnamed");
	// The compendium-source uuid resolves against sourceName (defaults to the
	// item's own name) so specialisation clones can link to their base pack
	// entry — e.g. an NPC's "Common Lore (Imperium)" skill item links to the
	// skills pack's "Common Lore" catalog item (bead z4aa).
	const sourceName =
		typeof entry.sourceName === "string" && entry.sourceName
			? entry.sourceName
			: name;
	const fromPack =
		typeof entry.fromPack === "string" && entry.fromPack
			? entry.fromPack
			: null;
	const standalone = entry.standalone === true;
	const candidates = index.get(sourceName) ?? [];
	let resolved: ItemSourceIndexEntry | null = null;
	if (fromPack) {
		resolved =
			candidates.find((c) => c.pack === fromPack) ?? {
				pack: fromPack,
				// Deterministic id from the name, matching how that pack would
				// have emitted the item.
				id: documentId(sourceName),
				type: "gear",
				// No authored entry available — the authoring entry's own system
				// data carries the clone.
				entry: {},
			};
	} else if (candidates.length === 1) {
		resolved = candidates[0];
	} else if (candidates.length > 1) {
		throw new Error(
			`compendia: embedded item "${name}" is ambiguous across packs [${candidates.map((c) => c.pack).join(", ")}] — declare fromPack: <pack> on the entry`,
		);
	} else if (!standalone) {
		throw new Error(
			`compendia: embedded item "${sourceName}" matches no compendium pack — add it to a pack, declare fromPack, or mark standalone: true`,
		);
	}

	const doc =
		resolved && !standalone
			? // Linked: clone the PACK's real system data (type resolution via
			  // the source pack's folder rules), then apply the authoring
			  // entry's name/overrides on top (specialisations, ladder, AP).
			  toSourceDocument(
				{
					...resolved.entry,
					...(entry.name ? { name: entry.name } : {}),
					system: {
						...(resolved.entry.system ?? {}),
						...(entry.system ?? {}),
					},
				},
				resolved.pack,
			)
			: toSourceDocument(entry, resolved?.pack ?? "npcs");
	// Duplicate names within one actor would collide on the deterministic id.
	if (seenIds.has(String(doc._id))) {
		doc._id = documentId(`${name}#${seenIds.size}`);
	}
	seenIds.add(String(doc._id));
	if (resolved) {
		doc.flags = {
			...(doc.flags as Record<string, unknown>),
			"rogue-trader": {
				...((doc.flags as Record<string, unknown>)["rogue-trader"] as
					| Record<string, unknown>
					| undefined),
				compendiumSource: `Compendium.rogue-trader.${resolved.pack}.${resolved.id}`,
			},
		};
		if (sourceName !== name) {
			((doc.flags as Record<string, unknown>)[
				"rogue-trader"
			] as Record<string, unknown>).sourceName = sourceName;
		}
	}
	return doc;
}

/**
 * Shape a YAML entry into a Foundry Actor source document (bead et3x).
 * Authoring shape: {name, type: <actor subtype, default npc>, system,
 * items: [embedded item entries], img?, prototypeToken?, flags?}.
 */
export function toActorSourceDocument(
	entry: Record<string, unknown>,
	index: ItemSourceIndex,
): { actor: Record<string, unknown>; embedded: Array<Record<string, unknown>> } {
	const name = String(entry.name ?? "unnamed");
	const seenIds = new Set<string>();
	const embedded = (Array.isArray(entry.items) ? entry.items : []).map(
		(raw) => {
			const itemEntry =
				typeof raw === "string" ? { name: raw } : (raw as Record<string, unknown>);
			return toEmbeddedItemDocument(itemEntry, index, seenIds);
		},
	);
	const actor: Record<string, unknown> = {
		_id: documentId(name, entry._id as string | undefined),
		name,
		type: typeof entry.type === "string" && entry.type ? entry.type : "npc",
		system: entry.system ?? {},
		// Embedded collections are stored as ids; records live in sublevels.
		items: embedded.map((d) => String(d._id)),
		effects: [],
		folder: null,
		sort: 0,
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
	if (typeof entry.img === "string" && entry.img) actor.img = entry.img;
	if (entry.prototypeToken) actor.prototypeToken = entry.prototypeToken;
	return { actor, embedded };
}

async function buildPack(
	folder: string,
	ClassicLevelCtor: typeof ClassicLevel,
	itemIndex: ItemSourceIndex,
): Promise<number> {
	const isTablePack = TABLE_PACKS.has(folder);
	const isActorPack = ACTOR_PACKS.has(folder);
	const packPath = path.resolve(PACK_DEST, folder);

	// Recreate: our builds fully own the LevelDB dir (gitignored artifacts).
	await rm(packPath, { recursive: true, force: true });
	await mkdir(packPath, { recursive: true });

	const database = new ClassicLevelCtor(packPath, {
		keyEncoding: "utf8",
		valueEncoding: "json",
	});
	await database.open();

	const files = await readdir(path.join(PACK_SRC, folder));
	const sourceFiles = files.filter((file) => file.endsWith(".yaml"));

	const batch = database.batch();
	let count = 0;

	for (const file of sourceFiles) {
		const entries = await readYamlEntries(path.join(PACK_SRC, folder, file));
		for (const source of entries) {
			if (isActorPack) {
				// Foundry stores Actor docs under the `!actors!` sublevel with
				// embedded items split into `!actors.items!<actorId>.<itemId>`
				// records; the actor doc carries only the id array (et3x, core
				// _getSublevelNames + deleteOrphanDocuments verified).
				const { actor, embedded } = toActorSourceDocument(source, itemIndex);
				const actorId = String(actor._id);
				batch.put(actorKey(actorId), actor as unknown as string);
				for (const item of embedded) {
					batch.put(
						actorItemKey(actorId, String(item._id)),
						item as unknown as string,
					);
				}
				count++;
				continue;
			}
			const doc: Record<string, unknown> = isTablePack
				? toTableSourceDocument(source)
				: toSourceDocument(source, folder);
			if (isTablePack) {
				// Foundry stores RollTable results as an EMBEDDED collection:
				// the table doc carries only the result ids, and each result
				// record lives in the "tables.results" sublevel (abstract-level
				// sublevel separator is "!"). Inline results are dropped by
				// Foundry on load ("9 embedded results records...undefined").
				const results = doc.results as Array<Record<string, unknown>>;
				const tableId = String(doc._id);
				batch.put(`!tables!${tableId}`, {
					...doc,
					results: results.map((r) => String(r._id)),
				} as unknown as string);
				for (const r of results) {
					batch.put(
						`!tables.results!${tableId}.${String(r._id)}`,
						r as unknown as string,
					);
				}
				count++;
				continue;
			}
			batch.put(
				`!items!${String(doc._id)}`,
				doc as unknown as string,
			);
			count++;
		}
	}

	await batch.write();
	await database.close();
	return count;
}

/**
 * Governance check (bead 8uh): an authored pack folder that has no packs[]
 * entry in the dev manifest is invisible in Foundry. Warn (do not fail).
 */
export async function warnUnregisteredPacks(): Promise<void> {
	const manifestPath = "./system-manifests/dev.json";
	if (!existsSync(manifestPath)) return;
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
		packs?: Array<{ name?: string }>;
	};
	const registered = new Set(
		(manifest.packs ?? []).map((pack) => pack.name).filter(Boolean),
	);
	const folders = await listPackFolders();
	const packFolders: string[] = [];
	for (const folder of folders) {
		const files = await readdir(path.join(PACK_SRC, folder));
		if (!files.some((file) => file.endsWith(".yaml"))) continue;
		packFolders.push(folder);
	}
	for (const folder of packFolders) {
		if (!registered.has(folder)) {
			console.warn(
				`[packs] WARNING: pack "${folder}" has no entry in system-manifests/dev.json and will be invisible in Foundry. Add to "packs":\n` +
					`    { "name": "${folder}", "label": "${folder}", "system": "rogue-trader", "path": "packs/${folder}", "type": "Item" }`,
			);
		}
	}
}

/**
 * Pack folders under PACK_SRC (dot-prefixed machine-local dirs excluded).
 * A MISSING src/packs is the normal CI state (the dir is gitignored):
 * yield no folders rather than throwing, matching the documented
 * "pipeline works fine with an empty src/packs" contract.
 */
async function listPackFolders(): Promise<string[]> {
	try {
		const entries = await readdir(PACK_SRC, { withFileTypes: true });
		return entries
			.filter((d) => d.isDirectory() && !d.name.startsWith("."))
			.map((d) => d.name);
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return [];
		throw error;
	}
}

async function main() {
	const folders = await listPackFolders();

	await warnUnregisteredPacks();

	// Item-name index across every Item pack, so actor-pack embedded items
	// can be stamped with Compendium.rogue-trader.<pack>.<id> sources (et3x).
	const itemIndex = await buildItemSourceIndex(folders.map((name) => ({ name })));

	for (const folder of folders) {
		const sourceFiles = (await readdir(path.join(PACK_SRC, folder))).filter(
			(file) => file.endsWith(".yaml"),
		);
		if (sourceFiles.length === 0) continue;
		const count = await buildPack(folder, ClassicLevel, itemIndex);
		// Legacy nedb artifact: Foundry prefers the LevelDB dir when CURRENT
		// exists, but delete the stale .db so there is a single source of truth.
		await rm(path.resolve(PACK_DEST, `${folder}.db`), { force: true });
		console.log(`[packs] ${folder}: ${count} documents -> LevelDB`);
	}
}

/** Build entry used by `bun run build` (utils/build.ts). */
export async function bundlePacks(): Promise<void> {
	await main();
}

if (import.meta.main) {
	await bundlePacks();
}

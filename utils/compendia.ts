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
]);

/** A single authored result row: string shorthand or a partial result. */
type ResultRow =
	| string
	| {
			text?: string;
			weight?: number;
			range?: [number, number];
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

async function buildPack(
	folder: string,
	ClassicLevelCtor: typeof ClassicLevel,
): Promise<number> {
	const isTablePack = TABLE_PACKS.has(folder);
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
		const contents = await readFile(path.join(PACK_SRC, folder, file), "utf8");
		const documents = yaml.parseAllDocuments(contents) as Array<{
			toJSON: () => Record<string, unknown>;
			errors: Array<Error>;
		}>;
		for (const parsed of documents) {
			// Loud failure (bead gjn6 finding): the yaml lib collects parse
			// errors on the Document and STILL yields a (corrupted) tree —
			// e.g. "special: Plasma drive: provides..." silently parses as a
			// nested mapping {"Plasma drive": "..."}. Never ship that.
			if (parsed.errors.length > 0) {
				throw new Error(
					`compendia: YAML parse error in ${path.join(PACK_SRC, folder, file)}: ` +
						parsed.errors.map((e) => e.message.split("\n")[0]).join(" | "),
				);
			}
			const value = (
				parsed as unknown as { toJSON: () => unknown }
			).toJSON?.call(parsed);
			// Sources may be a top-level array of entries or ---separated docs.
			const entries = Array.isArray(value) ? value : [value];
			for (const entry of entries) {
				if (!entry) continue;
				const source = entry as Record<string, unknown>;
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
					`${isTablePack ? "!tables!" : "!items!"}${String(doc._id)}`,
					doc as unknown as string,
				);
				count++;
			}
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
	const folders = (await readdir(PACK_SRC, { withFileTypes: true }))
		.filter((d) => d.isDirectory() && !d.name.startsWith("."))
		.map((d) => d.name);
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

async function main() {
	const folders = (await readdir(PACK_SRC, { withFileTypes: true }))
		.filter((d) => d.isDirectory() && !d.name.startsWith("."))
		.map((d) => d.name);

	await warnUnregisteredPacks();

	for (const folder of folders) {
		const sourceFiles = (await readdir(path.join(PACK_SRC, folder))).filter(
			(file) => file.endsWith(".yaml"),
		);
		if (sourceFiles.length === 0) continue;
		const count = await buildPack(folder, ClassicLevel);
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

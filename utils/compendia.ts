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
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import yaml from "yaml";

const PACK_SRC = "./src/packs";
const PACK_DEST = "./release/packs";

/** Foundry randomID charset (16 chars). */
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Stable ids: honor an explicit _id in the YAML, else deterministic from name. */
function documentId(name: string, declared?: string): string {
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

/** Shape a YAML entry into a Foundry Item source document. */
function toSourceDocument(entry: Record<string, unknown>) {
	const id = documentId(
		String(entry.name ?? "unnamed"),
		entry._id as string | undefined,
	);
	return {
		_id: id,
		name: entry.name,
		type: "Item",
		system: entry.system ?? {},
		effects: Array.isArray(entry.effects) ? entry.effects : [],
		description: typeof entry.description === "string" ? entry.description : "",
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
}

async function buildPack(
	folder: string,
	ClassicLevelCtor: typeof ClassicLevel,
): Promise<number> {
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
		const contents = await readFile(
			path.join(PACK_SRC, folder, file),
			"utf8",
		);
		const documents = yaml.parseAllDocuments(contents) as Array<{
			toJSON: () => Record<string, unknown>;
		}>;
		for (const parsed of documents) {
			const value = (parsed as unknown as { toJSON: () => unknown }).toJSON?.call(parsed);
			// Sources may be a top-level array of entries or ---separated docs.
			const entries = Array.isArray(value) ? value : [value];
			for (const entry of entries) {
				if (!entry) continue;
				const doc = toSourceDocument(
					entry as Record<string, unknown>,
				);
				batch.put(`!items!${doc._id}`, doc);
				count++;
			}
		}
	}

	await batch.write();
	await database.close();
	return count;
}

async function main() {
	const folders = (await readdir(PACK_SRC, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name);

	for (const folder of folders) {
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
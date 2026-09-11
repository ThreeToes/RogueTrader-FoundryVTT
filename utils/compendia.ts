// New packer: YAML sources -> Foundry 14 native LevelDB compendium packs.
//
// IMPORTANT: authoring sources are LOCAL ONLY - src/packs/ is gitignored so
// no copyrighted game content (RT book skill/talent lists etc.) is ever
// committed. The pipeline works fine with an empty src/packs/ (no packs are
// emitted); locally authored YAML is packed the same way.
//
// Pack sources are per-system: src/packs/rogue_trader/<pack>/<pack>.yaml
// (bead iw26) so the private content repo can hold future 40k systems side
// by side. This packer packs the rogue-trader system only.
//
// Format verified against a Foundry-migrated pack (old nedb .db auto-migration):
// - each pack is a plain classic-level DB at release/rogue_trader/packs/<pack>
// - valueEncoding json; documents keyed `!items!<16-char id>` (abstract-level
//   sublevel prefix for the items collection)
// - document shape: {_id, name, type, system, effects: [], _stats:{coreVersion}}

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import yaml from "yaml";

const PACK_SRC = "./src/packs/rogue_trader";
const PACK_DEST = "./release/rogue_trader/packs";

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
 * Compendium folder groupings (bead nsqt).
 *
 * Foundry 14 supports Folder documents inside compendium packs
 * (CompendiumFolderCollection): folder docs live under the pack DB's
 * `!folders!` sublevel (verified dist/database/backend/compendium-folder.mjs
 * — `sublevels.folders` — and client compendium-collection.mjs loading
 * `metadata.folders`), each item carries `folder: <folderId>`, and the
 * Folder schema (common/documents/folder.mjs) is name/type/folder/sorting/
 * sort/color/flags/_stats with folder.type a PRIMARY type ("Item", not the
 * system's melee-weapon/ranged-weapon subtypes — CONST.FOLDER_DOCUMENT_TYPES).
 *
 * Groups derive from the books' own section headers, not invented taxonomy:
 * - weapons: by weaponFamily (the Weapon Training group, registry keys),
 *   labelled with the Core Rulebook Ch V section headers (printed pages
 *   in the comments below). "Thrown Weapons" is the one authoring label —
 *   the family spans the book's "Grenades and Missiles" (p125) AND thrown
 *   weapons (Bolas, Knife, Spear-thrower), so no single book header fits.
 * - armour: hand-mapped per entry (rt_core Table 5-7 sections p137-139;
 *   FC Table 3-8, p93 — "artificer armour is highly modified power
 *   armour", FC p95). "Exotic Armour" is an authoring label for the FC
 *   armours that match no rt_core section.
 * - gear: by source page bands (book TOC: Weapon Upgrades 133, Ammunition
 *   135, Unusual Ammo 136, Gear 139) + the name suffixes the pack already
 *   carries; FC gear (its "Gear" section starts p94).
 * - tools: the whole pack is the book's "Tools" section (p143-146).
 *
 * A top-level `group:` key on a yaml entry overrides the derivation and
 * supports nesting with "/" (e.g. `group: Pistols/Las`). Unmapped entries
 * fail loudly (emit throws) — never silently drop, per conventions.
 */
const WEAPON_GROUP_LABELS: Record<string, string> = {
	// Core Rulebook Ch V section headers (printed pp117-132).
	las: "Las Weapons",
	sp: "Solid Projectile Weapons",
	bolt: "Bolt Weapons",
	melta: "Melta Weapons",
	plasma: "Plasma Weapons",
	flame: "Flame Weapons",
	primitive: "Primitive Weapons",
	launcher: "Launchers",
	exotic: "Exotic Weapons",
	chain: "Chain Weapons",
	power: "Power Weapons",
	shock: "Shock Weapons",
	// Authoring label: family spans "Grenades and Missiles" (p125) plus
	// thrown weapons proper (Bolas, Knife, Spear-thrower).
	thrown: "Thrown Weapons",
};

/** Armour name → folder label (rt_core pp137-139 sections; FC p93). */
const ARMOUR_GROUPS: Record<string, string> = {
	// rt_core Table 5-7: Primitive Armour (p137).
	"Heavy Leathers/Furs": "Primitive Armour",
	"Grox Hide/Chainmail": "Primitive Armour",
	"Feudal World Plate": "Primitive Armour",
	"Burnscour Beast Hide": "Primitive Armour",
	// rt_core Table 5-7: Flak Armour (p137).
	"Flak Helmet": "Flak Armour",
	"Flak Cloak": "Flak Armour",
	"Flak Coat": "Flak Armour",
	"Guard Flak Armour": "Flak Armour",
	// rt_core Table 5-7: Mesh Armour (p138).
	"Mesh Cowl": "Mesh Armour",
	"Xeno Mesh": "Mesh Armour",
	"Mesh Combat Cloak": "Mesh Armour",
	"Mesh Vest": "Mesh Armour",
	// rt_core Table 5-7: Carapace Armour (p138).
	"Carapace Helm": "Carapace Armour",
	"Enforcer Light Carapace": "Carapace Armour",
	"Carapace Chestplate": "Carapace Armour",
	"Storm Trooper Carapace": "Carapace Armour",
	// rt_core Table 5-7: Power Armour (p139).
	"Advanced Helmet Systems": "Power Armour",
	"Armoured Bodyglove": "Power Armour",
	"Light Power Armour": "Power Armour",
	"Power Armour": "Power Armour",
	// FC Table 3-8 (p93): artificer armour is modified power armour (p95);
	// the rest match no rt_core section (authoring label).
	"Artificer Armour": "Power Armour",
	"Artificer Armour (Consecrated)": "Power Armour",
	"Vaporian Mirror Armour": "Exotic Armour",
	"Engine Armour": "Exotic Armour",
	"Sabbat-pattern Helm": "Exotic Armour",
};

/**
 * Gear folder by source band (book TOC printed pages: Weapon Upgrades 133,
 * Ammunition 135, Unusual Ammo 136, Gear 139; FC "Gear" 94). The 136 page
 * overlap between Ammunition and Unusual Ammo is split by the name suffixes
 * the gear pack already carries.
 */
const GEAR_PAGE_GROUPS: Array<{
	book: string;
	min: number;
	max: number;
	label: string;
}> = [
	{ book: "rt_core", min: 133, max: 134, label: "Weapon Upgrades" },
	{ book: "rt_core", min: 139, max: 140, label: "Gear" },
	{ book: "faith_and_coin", min: 94, max: 101, label: "Gear" },
];

/** Packs the grouper covers; every other pack stays ungrouped. */
const GROUPED_PACKS: ReadonlySet<string> = new Set([
	"weapons",
	"armour",
	"gear",
	"tools",
]);

/**
 * Derive an item's compendium folder label (or null for root). Authoring
 * `group:` wins; then per-pack derivation; nothing mapped = null. Throws on
 * a `group:` override that is not a non-empty string, and on weapons/armour
 * entries the derivation cannot place (loud failure, per conventions).
 */
export function resolveEntryGroup(
	entry: Record<string, unknown>,
	pack: string,
): string | null {
	const override = entry.group;
	if (override !== undefined) {
		if (typeof override !== "string" || !override.trim()) {
			throw new Error(
				`grouping: ${pack}/${String(entry.name)}: "group:" must be a non-empty string (use null to force root)`,
			);
		}
		return override.trim();
	}
	if (!GROUPED_PACKS.has(pack)) return null;
	const system = (entry.system ?? {}) as Record<string, unknown>;
	if (pack === "weapons") {
		const family = String(system.weaponFamily ?? "");
		const label = WEAPON_GROUP_LABELS[family];
		if (!label) {
			throw new Error(
				`grouping: weapons/${String(entry.name)}: no folder label for weaponFamily "${family}" — extend WEAPON_GROUP_LABELS (loud failure)`,
			);
		}
		return label;
	}
	if (pack === "armour") {
		const label = ARMOUR_GROUPS[String(entry.name ?? "")];
		if (!label) {
			throw new Error(
				`grouping: armour/${String(entry.name)}: unmapped — extend ARMOUR_GROUPS (loud failure)`,
			);
		}
		return label;
	}
	const source = ((entry.system ?? {}) as { source?: { book?: string; page?: number } })
		.source ?? (entry.source as { book?: string; page?: number } | undefined) ?? {};
	const book = String(source.book ?? "");
	const page = Number(source.page ?? NaN);
	if (pack === "gear") {
		const name = String(entry.name ?? "");
		// Hand-set curation (bead nsqt): every entry carries a comment citing
		// where it was verified.
		// Backpack: the printed Table 5-13: Gear row sits on p140 (file 0141),
		// but the yaml cite reads p135 — flagged on bead nn96 for the cite
		// audit; grouped here by name so the band map need not lie about pages.
		if (name === "Backpack") return "Gear";
		if (name.includes("(Unusual Ammunition)")) return "Unusual Ammunition";
		if (name.includes("(Ammunition)")) return "Ammunition";
		for (const band of GEAR_PAGE_GROUPS) {
			if (book === band.book && page >= band.min && page <= band.max) {
				return band.label;
			}
		}
		throw new Error(
			`grouping: gear/${name}: unmapped for ${book} p${page} — extend GEAR_PAGE_GROUPS (loud failure)`,
		);
	}
	if (pack === "tools") return "Tools";
	return null;
}

/** Deterministic _id for a compendium folder (label + owning pack). */
export function folderId(pack: string, label: string): string {
	return documentId(`folder:${pack}:${label}`);
}

/**
 * Shape a folder label into a Foundry Folder source document. `type` is the
 * PRIMARY document type the pack holds ("Item" — not system subtypes like
 * melee-weapon; CONST.FOLDER_DOCUMENT_TYPES). `parent` is the _id of the
 * containing folder, or null.
 */
export function toFolderSourceDocument(
	pack: string,
	label: string,
	parent: string | null,
	sort: number,
): Record<string, unknown> {
	return {
		_id: folderId(pack, label),
		name: label.split("/").pop() ?? label,
		type: "Item",
		description: "",
		folder: parent,
		sorting: "a",
		sort,
		color: null,
		flags: {},
		_stats: { coreVersion: 14 },
	};
}

/**
 * Build the folder set for one pack: unique group labels → folder docs with
 * parent links for "/"-nested labels, plus the per-item folder _id stamp.
 * Insertion order keeps folder sort stable across rebuilds.
 */
export function buildPackFolders(
	pack: string,
	entries: Array<Record<string, unknown>>,
): { folders: Array<Record<string, unknown>>; byLabel: Map<string, string> } {
	const labels = new Set<string>();
	for (const entry of entries) {
		const group = resolveEntryGroup(entry, pack);
		if (group) labels.add(group);
	}
	// Create parents before children so "/"-nested labels get their parents.
	const ordered = [...labels].sort((a, b) => {
		const depth = a.split("/").length - b.split("/").length;
		return depth !== 0 ? depth : a.localeCompare(b);
	});
	const byLabel = new Map<string, string>();
	const folders: Array<Record<string, unknown>> = [];
	let sort = 0;
	for (const label of ordered) {
		const parts = label.split("/");
		const parentKey =
			parts.length > 1 ? byLabel.get(parts.slice(0, -1).join("/")) : undefined;
		if (parts.length > 1 && parentKey === undefined) {
			throw new Error(
				`grouping: ${pack}: group "${label}" has no parent folder — add a "${parts.slice(0, -1).join("/")}" group (loud failure)`,
			);
		}
		const doc = toFolderSourceDocument(pack, label, parentKey ?? null, sort);
		byLabel.set(label, String(doc._id));
		folders.push(doc);
		sort += 10;
	}
	return { folders, byLabel };
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
export const ACTOR_PACKS: ReadonlySet<string> = new Set(["npcs", "vehicles"]);

export function actorKey(actorId: string): string {
	return `!actors!${actorId}`;
}

export function actorItemKey(actorId: string, itemId: string): string {
	return `!actors.items!${actorId}.${itemId}`;
}

/**
 * Journal packs (bead rb5g): rules/lore-reference compendiums. Foundry
 * LevelDB stores JournalEntry docs under `!journal!<id>` with their embedded
 * pages split into `!journal.pages!<journalId>.<pageId>` records (same
 * pattern as actors/actors.items, _getSublevelNames verified).
 */
export const JOURNAL_PACKS: ReadonlySet<string> = new Set([
	"rules",
	"lore",
	"intothemaw",
]);

export function journalKey(journalId: string): string {
	return `!journal!${journalId}`;
}

export function journalPageKey(journalId: string, pageId: string): string {
	return `!journal.pages!${journalId}.${pageId}`;
}

/** One resolvable link target: pack key + document id. */
export interface LinkTarget {
	pack: string;
	id: string;
}

/** Name -> link targets, across every pack (items, actors, journals). */
export type LinkIndex = Map<string, LinkTarget[]>;

/**
 * Resolve `[[name]]` / `[[name|label]]` authoring links in journal page
 * text to Foundry @UUID links (Compendium.rogue-trader.<pack>.<id>).
 * Unresolvable names stay literal with a loud warning — never silent.
 */
export function resolveLinks(text: string, index: LinkIndex): string {
	return text.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, name, label) => {
		const targets = index.get(String(name).trim()) ?? [];
		if (targets.length === 0) {
			console.warn(
				`compendia: journal link "[[${name}]]" matches no compendium document — left as plain text (loud failure, bead rb5g/lore)`,
			);
			return label ? `[${name}]` : name;
		}
		if (targets.length > 1) {
			console.warn(
				`compendia: journal link "[[${name}]]" is ambiguous across packs [${targets.map((t) => t.pack).join(", ")}] — using the first`,
			);
		}
		const t = targets[0];
		const linkLabel = (label ?? name).trim();
		return `@UUID[Compendium.rogue-trader.${t.pack}.${t.id}]{${linkLabel}}`;
	});
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
 * Source-attribution audit (bead zzlq): every Item entry should carry
 * system.source {book, page}. Missing = warn per pack (not a hard failure:
 * pre-zzlq authoring may lag), so extraction beads see the debt loudly.
 */
function auditSourceAttribution(
	packKey: string,
	entries: Array<Record<string, unknown>>,
): void {
	const missing = entries
		.filter((entry) => {
			const source = (entry.system as { source?: { book?: string; page?: number } })
				?.source;
			return !source?.book || !source.page;
		})
		.map((entry) => String(entry.name ?? "unnamed"));
	if (missing.length > 0) {
		console.warn(
			`[packs] ${packKey}: ${missing.length}/${entries.length} entries missing system.source ` +
				`(bead zzlq): ${missing.join(", ")}`,
		);
	}
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
		if (
			TABLE_PACKS.has(dir.name) ||
			ACTOR_PACKS.has(dir.name) ||
			JOURNAL_PACKS.has(dir.name)
		)
			continue;
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

/**
 * Build the link index for journal-page `[[name]]` links (bead rb5g/lore):
 * EVERY pack contributes — item entries by name, actor entries (npcs
 * statblocks), journal entries, and RollTable docs.
 */
export async function buildLinkIndex(
	dirs: Array<{ name: string }>,
): Promise<LinkIndex> {
	const index: LinkIndex = new Map();
	const add = (name: string, pack: string, entry?: Record<string, unknown>) => {
		if (!name) return;
		const list = index.get(name) ?? [];
		list.push({
			pack,
			id: documentId(name, entry?._id as string | undefined),
		});
		index.set(name, list);
	};
	for (const dir of dirs) {
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
				add(String(entry.name ?? ""), dir.name, entry);
				// Actor packs: embedded items are link targets too (e.g. an NPC
				// species' own statblock items) — index them under the pack.
				for (const item of Array.isArray(entry.items) ? entry.items : []) {
					const raw = typeof item === "string" ? { name: item } : item;
					if (raw && raw.name) add(String(raw.name), dir.name);
				}
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
/** Shape a rules.yaml entry into a JournalEntry source document + pages. */
export function toJournalSourceDocument(
	entry: Record<string, unknown>,
	linkIndex: LinkIndex,
): { journal: Record<string, unknown>; pages: Array<Record<string, unknown>> } {
	const name = String(entry.name ?? "unnamed");
	const rawPages = Array.isArray(entry.pages) ? entry.pages : [];
	let sort = 0;
	const pages = rawPages.map((raw) => {
		const pageEntry =
			typeof raw === "string"
				? { name: raw, text: raw }
				: (raw as Record<string, unknown>);
		const pageName = String(pageEntry.name ?? "unnamed");
		const text = String(pageEntry.text ?? "");
		sort += 1;
		// Ownership is authoring-controlled (bead wdeq): the journal entry's
		// `ownership` field flows to every page; a page may override it.
		// Fallback {default: 0} = GM-only (what an adventure pack like
		// intothemaw wants); rules/lore author entries as {default: 2}.
		const pageOwnership = (pageEntry.ownership as Record<string, unknown>) ??
			(entry.ownership as Record<string, unknown>) ?? { default: 0 };
		return {
			_id: documentId(`${name} — ${pageName}`, pageEntry._id as string | undefined),
			name: pageName,
			type: "text",
			title: { show: true, level: 2 },
			text: { format: 1, content: resolveLinks(text, linkIndex), markdown: undefined },
			src: "",
			image: { caption: "" },
			video: null,
			document: null,
			sort,
			category: "",
			ownership: pageOwnership,
			flags: {},
			_stats: { coreVersion: 14 },
		};
	});
	const journalOwnership = (entry.ownership as Record<string, unknown>) ?? {
		default: 0,
	};
	const journal: Record<string, unknown> = {
		_id: documentId(name, entry._id as string | undefined),
		name,
		pages: pages.map((p) => String(p._id)),
		category: null,
		folder: null,
		sort: 0,
		ownership: journalOwnership,
		_stats: { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
	if (typeof entry.img === "string" && entry.img) journal.img = entry.img;
	return { journal, pages };
}

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
	linkIndex: LinkIndex,
): Promise<number> {
	const isTablePack = TABLE_PACKS.has(folder);
	const isJournalPack = JOURNAL_PACKS.has(folder);
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

	// Read every yaml file once, up front. Grouping (bead nsqt) needs the
	// pack's full entry set so "/"-nested group parents resolve regardless of
	// which file holds them, and item documents need their folder _id stamps.
	const fileEntries = new Map<string, Array<Record<string, unknown>>>();
	for (const file of sourceFiles) {
		const entries = await readYamlEntries(path.join(PACK_SRC, folder, file));
		if (!isActorPack && !isTablePack && !isJournalPack) {
			auditSourceAttribution(
				`${folder}/${file.replace(/\.yaml$/, "")}`,
				entries,
			);
		}
		fileEntries.set(file, entries);
	}

	// Folder emission: Item packs only. Folder docs go under `!folders!<id>`;
	// item docs carry `folder: <id>` (see toFolderSourceDocument for the
	// Foundry-14 verification notes).
	let folderStamps = new Map<string, string>();
	if (!isTablePack && !isActorPack && !isJournalPack) {
		const { folders: packFolders, byLabel } = buildPackFolders(
			folder,
			[...fileEntries.values()].flat(),
		);
		for (const f of packFolders) {
			batch.put(`!folders!${String(f._id)}`, f as unknown as string);
		}
		folderStamps = byLabel;
		count += packFolders.length;
	}

	for (const entries of fileEntries.values()) {
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
			if (isJournalPack) {
				// Foundry stores JournalEntry docs under `!journal!` with their
				// embedded pages split into `!journal.pages!<journalId>.<pageId>`
				// records (same embedded-collection pattern as actors, et3x).
				const { journal, pages } = toJournalSourceDocument(source, linkIndex);
				const journalId = String(journal._id);
				batch.put(journalKey(journalId), journal as unknown as string);
				for (const page of pages) {
					batch.put(
						journalPageKey(journalId, String(page._id)),
						page as unknown as string,
					);
				}
				count++;
				continue;
			}
			const doc: Record<string, unknown> = isTablePack
				? toTableSourceDocument(source)
				: toSourceDocument(source, folder);
			if (folderStamps.size > 0) {
				// Stamp the compendium folder (bead nsqt): root documents carry
				// folder: null, grouped ones their folder's _id.
				const group = resolveEntryGroup(source, folder);
				doc.folder = group ? (folderStamps.get(group) ?? null) : null;
			}
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
 * A MISSING src/packs/rogue_trader is the normal CI state (the dir is gitignored):
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
	// Journal-page [[name]] link index across every pack (rb5g/lore).
	const linkIndex = await buildLinkIndex(folders.map((name) => ({ name })));

	for (const folder of folders) {
		const sourceFiles = (await readdir(path.join(PACK_SRC, folder))).filter(
			(file) => file.endsWith(".yaml"),
		);
		if (sourceFiles.length === 0) continue;
		const count = await buildPack(folder, ClassicLevel, itemIndex, linkIndex);
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

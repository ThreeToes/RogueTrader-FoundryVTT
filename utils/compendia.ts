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
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ClassicLevel } from "classic-level";
import yaml from "yaml";
import { vehicleTokenFootprint } from "../src/roguetrader/rules/vehicle-tokens";

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
	// Origin Path (epic 1gb7): chart entries + the trait rows they resolve to.
	origins: "origin",
	"origin-traits": "origintrait",
	// Heirloom grant templates (Table 1-2, epic 1gb7 follow-up).
	heirlooms: "heirloom",
	// Insanity/corruption content (epic 1g2t) + the mutations tables: typed
	// rows with kind/tableKey/roll fields. Without these the builder falls back
	// to "gear" and Foundry's TypeDataModel silently drops those fields.
	madness: "madnessentry",
	mutations: "mutation",
	// Ship threshold/reference tables (bead vkde): the same kind+threshold
	// lookup idiom as the gametables pack, so the ship tables reuse
	// `game-table` instead of falling back to plain Gear (which dropped
	// rating/threshold silently — same bug class as madness/mutations above).
	shiptables: "game-table",
	// Ship & Warrant Path options (Into the Storm pp33-44): a dedicated Item
	// type so the per-row key/col + SP/PF mechanics survive Foundry's schema.
	warrant: "warrant-option",
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
	if (folder === "gametables") {
		// Game reference tables (planet/system generation rows): dedicated
		// `game-table` type so they are not plain Gear and can attach to
		// planet actors (owner ask).
		return "game-table";
	}
	return FOLDER_TYPE_DEFAULTS[folder] ?? "gear";
}

/**
 * Concept packs (bead 8ubu) hold several source YAML files in ONE physical
 * pack. Type + grouping resolution stays keyed by the historical pack name,
 * which is now the source file STEM (e.g. items/weapons.yaml -> "weapons"),
 * so the existing derivation tables keep working. ALIASES folds the few
 * stems that differ from their resolver key (the `ships` pack holds
 * components.yaml + ships.yaml).
 */
const SOURCE_ALIASES: Readonly<Record<string, string>> = {
	components: "ships",
};

/** Source file stem -> resolver key (the historical pack name). */
export function sourceKey(stem: string): string {
	return SOURCE_ALIASES[stem] ?? stem;
}

/**
 * Source key -> the concept folder it nests under inside a merged pack
 * (bead 8ubu). Each consolidation bead adds its entries; null keeps the
 * intra-source label at the root (or nothing when both are null).
 */
const SOURCE_TOP_LABELS: Readonly<Record<string, string | null>> = {
	// Actor concept pack (bead imiq): one pack holds starship + vehicle
	// actors; these nest the faction labels / the vehicle root.
	starships: "Starships",
	vehicles: "Vehicles",
	// Afflictions concept pack (bead 2qfk): mutations + madness.
	mutations: "Mutations",
	madness: "Madness",
	// Equipment concept pack (bead n7hu): personal arms and gear.
	weapons: "Weapons",
	armour: "Armour",
	gear: "Gear",
	drugs: "Drugs",
	tools: "Tools",
	cybernetics: "Cybernetics",
	"tau-armoury": "Tau Armoury",
	heirlooms: "Heirlooms",
	// Character-options concept pack (bead 4tj1).
	skills: "Skills",
	talents: "Talents",
	aptitudes: "Aptitudes",
	careers: "Careers",
	traits: "Traits",
	"origin-traits": "Origin Traits",
	origins: "Origins",
	psychicpowers: "Psychic Powers",
	navigatorpowers: "Navigator Powers",
	// Ships concept pack (bead i2xg): hulls/components nest under one label,
	// ship tables get their own folder.
	ships: "Hulls & Components",
	shiptables: "Ship Tables",
	// RollTable concept pack (bead j9pg).
	criticals: "Critical Hits",
	creationtables: "Creation Tables",
	psychicphenomena: "Psychic Phenomena",
	// Tau units authoring file (bead o2gx). The npcs pack groups by NPC_GROUPS
	// keyed on the entry NAME, which only covers npcs.yaml; entries from another
	// authoring file in the same pack resolve their group against that file's
	// stem instead, so without this the drones landed at the pack root (the
	// loose "Tau * Drone" rows seen in the compendium).
	"tau-drones": "Tau",
};

/**
 * Final folder label for one entry: the concept label with the intra-source
 * label nested beneath it (`Weapons/Las Weapons`). When only one side exists
 * it is used as-is, so single-source packs are unchanged.
 */
export function conceptFolderLabel(
	source: string,
	intra: string | null,
	topLabels: Readonly<Record<string, string | null>> = SOURCE_TOP_LABELS,
): string | null {
	const top = topLabels[source] ?? null;
	if (!top) return intra;
	if (!intra || intra === top) return top;
	return `${top}/${intra}`;
}

/**
 * Full concept folder label for one entry — the intra-source label with the
 * concept prefix applied. This is the value `buildPackFolders` keys byLabel
 * with, so document `folder` stamping must use it (not the bare
 * resolveEntryGroup result) or concept-pack documents land at the root while
 * their folders sit empty (bead 8ubu follow-up).
 */
export function resolveEntryFolder(
	entry: Record<string, unknown>,
	source: string,
): string | null {
	return conceptFolderLabel(source, resolveEntryGroup(entry, source));
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
	// Hostile Acquisitions Table 2-16 (bead dfb8, printed pp61-62). The
	// Footfall voidsuit is a voidsuit, not a rt_core section match.
	"Augmetic Engine-Plate": "Exotic Armour",
	"Mesh-Weave Clothing": "Exotic Armour",
	"Pressure Carapace": "Exotic Armour",
	"Voidsuit (Footfall)": "Exotic Armour",
	"Xenos Chitin Armour": "Exotic Armour",
	// Hostile Acquisitions Table 2-17 armour upgrades (bead dfb8, printed
	// pp63-64) — their own section in the book.
	"Advanced Materials (Armour Upgrade)": "Armour Upgrades",
	"Concealed Weapon (Armour Upgrade)": "Armour Upgrades",
	"Deflective Construction (Armour Upgrade)": "Armour Upgrades",
	"Impact Gel Cells (Armour Upgrade)": "Armour Upgrades",
	"Lathe-wrought (Armour Upgrade)": "Armour Upgrades",
	"Lumen-heraldry (Armour Upgrade)": "Armour Upgrades",
	"Nightshroud Layer (Armour Upgrade)": "Armour Upgrades",
	"Power Assisted (Armour Upgrade)": "Armour Upgrades",
	"Reflec Coating (Armour Upgrade)": "Armour Upgrades",
	"Servo-manipulators (Armour Upgrade)": "Armour Upgrades",
	"Tool Mount (Armour Upgrade)": "Armour Upgrades",
	// Into the Storm Table 3-9 Fields (bead dfb8, printed pp130-131) — force
	// fields live in the armour pack (they occupy the armour "slot"); the
	// book groups them as their own "Fields" section.
	"Archeotech Shield": "Fields",
	"Conversion Field (Locke-pattern)": "Fields",
	"Displacer Field (Mars-pattern)": "Fields",
	"Eldar Forceshield": "Fields",
	"Power Field (Ryza-pattern)": "Fields",
	"Refractor Field": "Fields",
	"Salvation Shield": "Fields",
	// Into the Storm Table 3-20 Ork Armour (bead dfb8, printed p145) — the
	// book's "Ork Armour" section; Table 3-22 Kroot Leathers (p146).
	"'Ard Hat": "Ork & Kroot Armour",
	"Boss Pole": "Ork & Kroot Armour",
	"'Eavy Armor": "Ork & Kroot Armour",
	"Iron Gob": "Ork & Kroot Armour",
	"Squighide Coat and Leggins": "Ork & Kroot Armour",
	"Kroot Leathers": "Ork & Kroot Armour",
	// Soul Reaver Table 4-5 Dark Eldar Armour and Fields (bead dfb8, printed
	// pp114-115) — the book's own "Armour and Force Fields" section.
	"Xenohide Tunic": "Dark Eldar Armour & Fields",
	"Xenohide Cloak": "Dark Eldar Armour & Fields",
	"Kabalite Armour": "Dark Eldar Armour & Fields",
	"Ghostplate Armour": "Dark Eldar Armour & Fields",
	"Wychsuit": "Dark Eldar Armour & Fields",
	"Shadow Field": "Dark Eldar Armour & Fields",
	"Clone Field": "Dark Eldar Armour & Fields",
	// Faith and Coin relic (bead dfb8, printed p104) — a force field.
	"The Halo of the Devoted": "Fields",
	// Into the Storm Table 3-8 (bead dfb8, printed p129).
	"Flexsteel Suit": "Exotic Armour",
	"Delphis Mark II \"Ironclad\" Heavy Power Armour": "Power Armour",
	'"Frost" Thermal Armour': "Exotic Armour",
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
	// FC relics Table 3-14 (bead dfb8, printed pp104-107).
	{ book: "faith_and_coin", min: 102, max: 107, label: "Relics" },
	// Hostile Acquisitions Ch II (bead dfb8): weapon upgrades Table 2-14
	// (printed p57), unusual ammunition Table 2-15 (p59), gear and tools
	// Table 2-18 (p65). Bands cover the table pages their entries cite.
	{ book: "hostile_acquisitions", min: 57, max: 58, label: "Weapon Upgrades" },
	{ book: "hostile_acquisitions", min: 59, max: 61, label: "Unusual Ammunition" },
	{ book: "hostile_acquisitions", min: 64, max: 66, label: "Gear" },
	// Into the Storm Ch III (bead dfb8): weapon upgrades Table 3-6 (printed
	// p127), clothing Table 3-11 (printed pp132-133), Kroot gear Table 3-22
	// (printed p146).
	{ book: "into_the_storm", min: 127, max: 128, label: "Weapon Upgrades" },
	{ book: "into_the_storm", min: 132, max: 146, label: "Gear" },
];

/** Packs the grouper covers; every other pack stays ungrouped. */
const GROUPED_PACKS: ReadonlySet<string> = new Set([
	"weapons",
	"armour",
	"gear",
	"tools",
	"ships",
	"gametables",
	"npcs",
]);

/**
 * Ship pack grouping (bead 5lbn owner ask): ships.yaml by hullClass for
 * ship docs, npc:true vessels in their own "NPC Vessels" folder; the
 * components pack by the componentType taxonomy (essential categories,
 * weapon families, then the supplemental/archeotech/xenotech groupings).
 * Unmapped values fail loudly per conventions.
 */
const SHIP_COMPONENT_GROUP_LABELS: Readonly<Record<string, string>> = {
	"plasma-drive": "Plasma Drives",
	"warp-engine": "Warp Engines",
	"geller-field": "Gellar Fields",
	"void-shield": "Void Shields",
	bridge: "Bridges",
	"life-sustainer": "Life Sustainers",
	"crew-quarters": "Crew Quarters",
	"augur-array": "Augur Arrays",
	macrobattery: "Macrobatteries",
	lance: "Lances",
	"nova-cannon": "Nova Cannons",
	"torpedo-tube": "Torpedo Tubes",
	"landing-bay": "Landing Bays",
	supplemental: "Supplemental Components",
	archeotech: "Archeotech Components",
	xenotech: "Xeno-tech Components",
};

const SHIP_HULL_CLASS_LABELS: Readonly<Record<string, string>> = {
	transport: "Transports",
	raider: "Raiders",
	frigate: "Frigates",
	"light cruiser": "Light Cruisers",
	cruiser: "Cruisers",
	battlecruiser: "Battlecruisers",
	"grand-cruiser": "Grand Cruisers",
	"heavy cruiser": "Heavy Cruisers",
	battleship: "Battleships",
	"space station": "Space Stations",
};

/**
 * Game-tables pack grouping (bead 5lbn owner ask: "group the game tables
 * sensibly"): by the source books' own chapter structures — 96 kinds is
 * un-navigable in one flat list. kind -> folder label; unmapped fails
 * loudly.
 */
const GAME_TABLE_GROUPS: Readonly<Record<string, string>> = {
	// Stars of Inequity Ch I: World Generator (Tables 1-1..1-27)
	"soi-star": "SOI I — World Generator",
	"soi-system-feature": "SOI I — World Generator",
	"soi-system-element": "SOI I — World Generator",
	"soi-derelict-origin": "SOI I — World Generator",
	"soi-graveyard-origin": "SOI I — World Generator",
	"soi-body": "SOI I — World Generator",
	"soi-planet-body": "SOI I — World Generator",
	"soi-gravity": "SOI I — World Generator",
	"soi-orbital": "SOI I — World Generator",
	"soi-atmosphere": "SOI I — World Generator",
	"soi-atmo-comp": "SOI I — World Generator",
	"soi-climate": "SOI I — World Generator",
	"soi-habitability": "SOI I — World Generator",
	"soi-territories-count": "SOI I — World Generator",
	"soi-base-terrain": "SOI I — World Generator",
	"soi-territory-trait": "SOI I — World Generator",
	"soi-resource-presence": "SOI I — World Generator",
	"soi-resource-abundance": "SOI I — World Generator",
	"soi-resource-depletion": "SOI I — World Generator",
	"soi-mineral": "SOI I — World Generator",
	"soi-organic": "SOI I — World Generator",
	"soi-additional-resource": "SOI I — World Generator",
	"soi-xenos-ruins": "SOI I — World Generator",
	"soi-landmark": "SOI I — World Generator",
	"soi-inhabitants": "SOI I — World Generator",
	"soi-development": "SOI I — World Generator",
	"soi-bestial-archetype": "SOI I — World Generator",
	"soi-bestial-nature": "SOI I — World Generator",
	// Stars of Inequity Ch II: Planetside Adventures (Tables 2-1..2-37)
	"soi-call-to-adventure": "SOI II — Planetside Adventures",
	"soi-profit-motive": "SOI II — Planetside Adventures",
	"soi-encounter-site": "SOI II — Planetside Adventures",
	"soi-danger": "SOI II — Planetside Adventures",
	"soi-hazard": "SOI II — Planetside Adventures",
	"soi-complication": "SOI II — Planetside Adventures",
	"soi-treasure-type": "SOI II — Planetside Adventures",
	"soi-treasure-base": "SOI II — Planetside Adventures",
	"soi-treasure-trait": "SOI II — Planetside Adventures",
	"soi-craftsmanship": "SOI II — Planetside Adventures",
	"soi-exp-armour": "SOI II — Planetside Adventures",
	"soi-exp-gear": "SOI II — Planetside Adventures",
	"soi-fortuitous": "SOI II — Planetside Adventures",
	"soi-artefact-origin": "SOI II — Planetside Adventures",
	// Stars of Inequity Ch III: Populating the Expanse (Tables 3-1..3-12)
	"soi-colony-cost": "SOI III — Colonial Endeavours",
	"soi-colony-size": "SOI III — Colonial Endeavours",
	"soi-colony-growth": "SOI III — Colonial Endeavours",
	"soi-colony-leader": "SOI III — Colonial Endeavours",
	"soi-quirk": "SOI III — Colonial Endeavours",
	"soi-infra-req": "SOI III — Colonial Endeavours",
	"soi-hireling-quality": "SOI III — Colonial Endeavours",
	"soi-outsource-time": "SOI III — Colonial Endeavours",
	"soi-nepotism": "SOI III — Colonial Endeavours",
	"soi-rep-personality": "SOI III — Colonial Endeavours",
	"soi-calamity": "SOI III — Colonial Endeavours",
	"soi-severity": "SOI III — Colonial Endeavours",
	// Navis Primer: the five-stage warp travel sequence
	"warp-voyage-duration": "Navis Primer — Warp Travel",
	"warp-duration-gm": "Navis Primer — Warp Travel",
	"warp-estimate-navigator": "Navis Primer — Warp Travel",
	"warp-route-stability": "Navis Primer — Warp Travel",
	"warp-encounter": "Navis Primer — Warp Travel",
	"warp-hallucination": "Navis Primer — Warp Travel",
	"warp-incursion": "Navis Primer — Warp Travel",
	"warp-reentry": "Navis Primer — Warp Travel",
	"warp-trial": "Navis Primer — Warp Travel",
	// Navis Primer: astropathic choirs
	"astropathic-signal": "Navis Primer — Astropaths",
	"astropath-coherency": "Navis Primer — Astropaths",
	"astropath-decipher": "Navis Primer — Astropaths",
	"astropath-interception": "Navis Primer — Astropaths",
	"astropath-responder": "Navis Primer — Astropaths",
	"astropath-warp-effect": "Navis Primer — Astropaths",
	// Navis Primer: familiars, orks, psychic phenomena
	"familiar-availability": "Navis Primer — Familiars & Orks",
	"familiar-temperament": "Navis Primer — Familiars & Orks",
	"familiar-feature": "Navis Primer — Familiars & Orks",
	"familiar-psychic-feature": "Navis Primer — Familiars & Orks",
	"familiar-quest": "Navis Primer — Familiars & Orks",
	"ork-characteristic": "Navis Primer — Familiars & Orks",
	"powa-burst": "Navis Primer — Familiars & Orks",
	"weird-fing": "Navis Primer — Familiars & Orks",
	// Core Rulebook reference tables (Ch IX: Playing the Game, etc.)
	"test-difficulty": "Core Rulebook — Reference",
	"skill-tests": "Core Rulebook — Reference",
	"characteristic-tests": "Core Rulebook — Reference",
	"movement": "Core Rulebook — Reference",
	"size": "Core Rulebook — Reference",
	"encounter-difficulty": "Core Rulebook — Reference",
	"dispositions": "Core Rulebook — Reference",
	"exploration-challenge": "Core Rulebook — Reference",
	"investigation-benchmark": "Core Rulebook — Reference",
	"investigation-reliability": "Core Rulebook — Reference",
	"availability-population": "Core Rulebook — Reference",
	"availability-time": "Core Rulebook — Reference",
	// Into the Storm Ch V: vehicles
	"vehicle-critical": "Into the Storm — Vehicles",
	terrain: "Into the Storm — Vehicles",
	// Battlefleet Koronus Ch III: Ork ships
	"ork-ship-upgrade": "Battlefleet Koronus — Ork Ships",
	// GM Kit: Svard system vessels
	"npc-vessel-hull": "GM Kit — Svard Vessels",
	"npc-vessel-essential": "GM Kit — Svard Vessels",
	"npc-vessel-weapon": "GM Kit — Svard Vessels",
	"npc-vessel-additional": "GM Kit — Svard Vessels",
};

/**
 * npcs pack grouping (bead g0vv owner ask): loose faction/type folders —
 * "Chaos & Daemons", "Human/Criminal" etc. Name → folder label; unmapped names
 * fail loudly (same convention as the other packs).
 */
const NPC_GROUPS: Readonly<Record<string, string>> = {
	// Imperial civilians & soldiery
	Bloodskinner: "Imperial Civilians",
	Colonist: "Imperial Civilians",
	Adept: "Imperial Civilians",
	Entertainer: "Imperial Civilians",
	Voidfarer: "Imperial Civilians",
	"Hired Gun": "Criminals & Underworld",
	Scum: "Criminals & Underworld",
	Renegade: "Criminals & Underworld",
	"Mutant Abomination": "Mutant",
	"Mutant Outcast": "Mutant",
	"Free Trader Captain": "Imperial Civilians",
	"Navy Officer": "Imperial Navy",
	"Void Pirate Captain": "Criminals & Underworld",
	"Oathsworn Bodyguard": "Criminals & Underworld",
	// Warp predators & daemons
	"Warp Predator (Ebon Geist)": "Chaos & Daemons",
	"T'Zar the Broker (Herald of Tzeentch)": "Chaos & Daemons",
	"The Luminary (Herald of Slaanesh)": "Chaos & Daemons",
	"The Carrier (Daemon Vessel of Nurgle)": "Chaos & Daemons",
	// Psykers
	"Warp Witch": "Psykers & Wyrds",
	"Wyrd Gunslinger": "Psykers & Wyrds",
	"Warp Guide": "Psykers & Wyrds",
	// Servitors & machines
	"Battle Servitor (Charron-Pattern)": "Servitor & Machine",
	"Grapplehawk (Falax-Pattern)": "Servitor & Machine",
	"Servitor Drone": "Servitor & Machine",
	"Servo Skull": "Servitor & Machine",
	// Eldar
	"Eldar Corsair": "Eldar",
	"Eldar Warlock": "Eldar",
	"Eldar Farseer": "Eldar",
	"Eldar Corsair Void Dreamer": "Eldar",
	"Baharrudor (Eldar Outcast)": "Eldar",
	// Orks & Greenskin-adjacent
	"Ork Freebooter": "Ork",
	"Morgaash (Ork Warlord)": "Ork",
	// Kroot
	"Kroot Mercenary": "Kroot",
	// Rak'Gol
	"Rak'Gol Techno-Shaman": "Rak'Gol",
	"Rak'Gol Marauder (warrior caste)": "Rak'Gol",
	"Stryxis Merchant": "Stryxis",
	"Stryxis Vat-brute": "Stryxis",
	"Saynay Sorcerer": "Chaos & Daemons",
	"Clawed Fiend": "Dark Eldar Arena Beasts",
	Khymera: "Dark Eldar Arena Beasts",
	Razorwing: "Dark Eldar Arena Beasts",
	// Genestealer cult
	Genestealer: "Genestealer Cult",
	Broodlord: "Genestealer Cult",
	// SOI bestial creatures
	"Apex Predator (SOI bestial archetype)": "Creatures & Beasts",
	"Behemoth (SOI bestial archetype)": "Creatures & Beasts",
	"Ptera-beast (SOI bestial archetype)": "Creatures & Beasts",
	"Shadowed Stalker (SOI bestial archetype)": "Creatures & Beasts",
	"Venomous Terror (SOI bestial archetype)": "Creatures & Beasts",
	// Named NPCs — grouped by the adventure/faction they appear in
	// (the lore/intothemaw journals [[link]] these by name).
	"Hadarak Fel": "Named NPCs/Into the Maw (rt_core Ch XV)",
	"Lady Ash": "Named NPCs/Into the Maw (rt_core Ch XV)",
	Pyrexia: "Named NPCs/Into the Maw (rt_core Ch XV)",
	"Magos-Commodore Gnothis Trannarch":
		"Named NPCs/Explorator Fleet KX-557.V (SOI)",
	"Tech-Priest Ulmir Arvein": "Named NPCs/Explorator Fleet KX-557.V (SOI)",
	"Corsair-Captain Jalthas Mettiere":
		"Named NPCs/Corsair-Captain Mettiere (SOI)",
	"Ilistaneth Anturien (Crow Spirits Craftmaster)":
		"Named NPCs/Crow Spirits (EA)",
	"Yanveb Drallat": "Named NPCs/Corsair-Captain Mettiere (SOI)",
	Cymian: "Named NPCs/Corsair-Captain Mettiere (SOI)",
	Kanrak: "Named NPCs/Corsair-Captain Mettiere (SOI)",
	"Kaptin Skelkap Graffletz": "Named NPCs/Kaptin Graffletz (SOI)",
	Skabgob: "Named NPCs/Kaptin Graffletz (SOI)",
	"Master Shaper Te'Logk": "Named NPCs/The Forsaken Kindred (SOI)",
	"Stalker Hrrithck": "Named NPCs/The Forsaken Kindred (SOI)",
	"Master Shaper Ashak Kor (Misthound Kindred)":
		"Named NPCs/The Forsaken Kindred (SOI)",
	"Culexus Assassin": "Imperium — Agents of the Throne",
};

function npcGroupLabel(entry: Record<string, unknown>): string | null {
	const name = String(entry.name ?? "");
	const label = NPC_GROUPS[name];
	if (!label) {
		throw new Error(
			`grouping: npcs/${name}: no folder label — extend NPC_GROUPS (loud failure)`,
		);
	}
	return label;
}

function shipGroupLabel(entry: Record<string, unknown>): string | null {
	const type = String(entry.type ?? "");
	const system = (entry.system ?? {}) as Record<string, unknown>;
	if (type === "ship-complication") return "Ship Complications";
	if (type === "ship") {
		if (system.npc === true) return "NPC Vessels";
		const hullClass = String(system.hullClass ?? "").toLowerCase();
		if (!hullClass) return null;
		const label = SHIP_HULL_CLASS_LABELS[hullClass];
		if (!label) {
			throw new Error(
				`grouping: ships/${String(entry.name)}: no folder label for hullClass "${hullClass}" — extend SHIP_HULL_CLASS_ORDER (loud failure)`,
			);
		}
		return label;
	}
	if (type === "ship-component" || type === "ship-weapon-component") {
		const componentType = String(system.componentType ?? "");
		const label = SHIP_COMPONENT_GROUP_LABELS[componentType];
		if (!label) {
			throw new Error(
				`grouping: ships/${String(entry.name)}: no folder label for componentType "${componentType}" — extend SHIP_COMPONENT_GROUP_LABELS (loud failure)`,
			);
		}
		return label;
	}
	return null;
}

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
	if (pack === "ships") return shipGroupLabel(entry);
	if (pack === "npcs") return npcGroupLabel(entry);
	if (pack === "gametables") {
		const kind = String((entry.system ?? {}).kind ?? "");
		const label = GAME_TABLE_GROUPS[kind];
		if (!label) {
			throw new Error(
				`grouping: gametables/${String(entry.name)}: no folder label for kind "${kind}" — extend GAME_TABLE_GROUPS (loud failure)`,
			);
		}
		return label;
	}
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
	folderType = "Item",
): Record<string, unknown> {
	return {
		_id: folderId(pack, label),
		name: label.split("/").pop() ?? label,
		type: folderType,
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
	folderType = "Item",
	sourceOf: (entry: Record<string, unknown>) => string = () => pack,
	topLabels: Readonly<Record<string, string | null>> = SOURCE_TOP_LABELS,
): { folders: Array<Record<string, unknown>>; byLabel: Map<string, string> } {
	const labels = new Set<string>();
	for (const entry of entries) {
		const source = sourceOf(entry);
		const group = conceptFolderLabel(
			source,
			resolveEntryGroup(entry, source),
			topLabels,
		);
		if (group) labels.add(group);
	}
	// Create parents before children so "/"-nested labels get their parents.
	// Parent labels are IMPLIED by child labels ("A/B" implies "A") — expand
	// the label set to include every parent prefix, so a nested group whose
	// parent no entry maps to directly still gets its folder (bead g0vv:
	// named-NPC adventure folders under "Named NPCs").
	for (const label of [...labels]) {
		const parts = label.split("/");
		for (let i = 1; i < parts.length; i++) {
			labels.add(parts.slice(0, i).join("/"));
		}
	}
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
		const doc = toFolderSourceDocument(pack, label, parentKey ?? null, sort, folderType);
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
export const TABLE_PACKS: ReadonlySet<string> = new Set(["rolltables"]);

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
export const ACTOR_PACKS: ReadonlySet<string> = new Set([
	"npcs",
	"vessels",
]);

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
	/** Resolved document type (item subtype), for `[[<type>:Name]]` links. */
	type?: string;
}

/** Name -> link targets, across every pack (items, actors, journals). */
export type LinkIndex = Map<string, LinkTarget[]>;

/**
 * Resolve `[[name]]` / `[[name|label]]` authoring links in journal page
 * text to Foundry @UUID links (Compendium.rogue-trader.<pack>.<id>). A name
 * that exists in more than one pack can be qualified `[[pack:Name]]` (e.g.
 * `[[madness:Tainted]]`); the prefix is only treated as a pack when it names
 * a real pack, so names containing colons keep working. Unresolvable names
 * stay literal with a loud warning — never silent.
 */
export function resolveLinks(text: string, index: LinkIndex): string {
	const packs = new Set<string>();
	for (const targets of index.values()) {
		for (const target of targets) packs.add(target.pack);
	}
	return text.replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_m, rawName, label) => {
		const raw = String(rawName).trim();
		const colon = raw.indexOf(":");
		const prefix = colon > 0 ? raw.slice(0, colon).trim() : "";
		const rest = colon > 0 ? raw.slice(colon + 1).trim() : raw;
		let name = raw;
		let targets: LinkTarget[] = [];
		if (colon > 0 && packs.has(prefix)) {
			// Pack-qualified: [[pack:Name]].
			name = rest;
			targets = (index.get(name) ?? []).filter((t) => t.pack === prefix);
		} else if (colon > 0) {
			// Type-qualified: [[trait:Fear]] — needed once several same-name
			// entries share one merged concept pack (bead 4tj1).
			const byType = (index.get(rest) ?? []).filter((t) => t.type === prefix);
			if (byType.length > 0) {
				name = rest;
				targets = byType;
			} else {
				targets = index.get(raw) ?? [];
			}
		} else {
			targets = index.get(name) ?? [];
		}
		if (targets.length === 0) {
			console.warn(
				`compendia: journal link "[[${rawName}]]" matches no compendium document — left as plain text (loud failure, bead rb5g/lore)`,
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
	/** Physical pack folder (== compendium name, for the source uuid). */
	pack: string;
	/** Source file key (stem/alias) the entry was authored in. `fromPack:`
	 * references this, so concept packs need no fromPack rewrite; defaults to
	 * `pack` when unset (legacy/tests). */
	source?: string;
	/** Deterministic document id (documentId(name)). */
	id: string;
	/** Resolved item type (declared type, FOLDER_TYPE_DEFAULTS, source rules). */
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
	const entryFlags = (entry.flags ?? {}) as Record<string, unknown>;
	const rtFlags = (entryFlags["rogue-trader"] ?? {}) as Record<string, unknown>;
	return {
		_id: id,
		name: entry.name,
		type: resolveEntryType(entry, folder),
		system,
		effects: Array.isArray(entry.effects) ? entry.effects : [],
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: {
			...entryFlags,
			// Build-time provenance (bead n7hu): the source YAML key inside a
			// merged concept pack, so runtime consumers can bucket a document by
			// its original source (e.g. the creator's acquisition groups).
			"rogue-trader": { ...rtFlags, source: folder } as Record<string, unknown>,
		},
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
			const key = sourceKey(file.replace(/\.yaml$/, ""));
			for (const entry of entries) {
				const name = String(entry.name ?? "");
				if (!name) continue;
				const list = index.get(name) ?? [];
				list.push({
					pack: dir.name,
					source: key,
					id: documentId(name, entry._id as string | undefined),
					type: resolveEntryType(entry, key),
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
	const add = (
		name: string,
		pack: string,
		type?: string,
		entry?: Record<string, unknown>,
	) => {
		if (!name) return;
		const list = index.get(name) ?? [];
		list.push({
			pack,
			id: documentId(name, entry?._id as string | undefined),
			type,
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
			const isItemPack =
				!TABLE_PACKS.has(dir.name) &&
				!ACTOR_PACKS.has(dir.name) &&
				!JOURNAL_PACKS.has(dir.name);
			const key = sourceKey(file.replace(/\.yaml$/, ""));
			for (const entry of entries) {
				const type = isItemPack
					? resolveEntryType(entry, key)
					: typeof entry.type === "string"
						? entry.type
						: undefined;
				add(String(entry.name ?? ""), dir.name, type, entry);
				// Actor packs: embedded items are link targets too (e.g. an NPC
				// species' own statblock items) — index them under the pack.
				for (const item of Array.isArray(entry.items) ? entry.items : []) {
					const raw = typeof item === "string" ? { name: item } : item;
					if (raw && raw.name) add(String(raw.name), dir.name, undefined, raw);
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
/**
 * Authored statblock items with NO pack entry yet (bead r8rx audit).
 *
 * These are real entries — RT core traits and talents, plus Speak Language
 * specialisations the book lists as skill groups — that the packs simply do
 * not carry. The NPCs that use them declare `fromPack`, so the resolver
 * correctly THROWS, which is how 21 NPCs came to ship with an empty loadout
 * before the legacy-section support above landed.
 *
 * Rather than leave the build broken or quietly soften the link check, the
 * names are recorded HERE and packed as standalone items carrying their own
 * authored data. This is a WORK LIST, not an amnesty: adding the real pack
 * entry means deleting the line, and any name NOT on it still fails loudly.
 *
 * "Improved Natural Weapons" is listed with its `(Claws)` variant because the
 * pack carries the base "Natural Weapons" trait, which is a DIFFERENT entry
 * (the improved form is stronger) — linking to it would be wrong data.
 */
const KNOWN_MISSING_PACK_ENTRIES = new Set([
	// Resolved by the owner supplying the verbatim book text (2026-09-22): the
	// traits and talents below are now REAL pack entries, so only the GM-only
	// Speak Language forms remain here. Kept in the set so the packer still
	// packs them as standalone instead of failing — that is their intended end
	// state, not a gap.
	"Speak Language (Kroot)",
	"Speak Language (Daemonic)",
	"Speak Language (Daemonic Tongues)",
]);

/**
 * Punctuation-insensitive name key: lowercase, alphanumerics only.
 *
 * Exists because the authored statblocks and the packs spell the same entry
 * differently — the pack holds "Dark-sight" and "Tech-Use", the NPCs say
 * "Dark Sight" and "Tech Use". Both refer to one entry, and a hyphen is not a
 * rules distinction.
 */
function nameKey(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalised lookup over an ItemSourceIndex, cached per index.
 *
 * A WeakMap rather than a rebuild per item: the resolver runs once per
 * embedded item and there are over a thousand of them.
 */
const normalisedIndexCache = new WeakMap<
	ItemSourceIndex,
	Map<string, ItemSourceIndexEntry[]>
>();

function normalisedLookup(
	index: ItemSourceIndex,
	name: string,
): ItemSourceIndexEntry[] {
	let map = normalisedIndexCache.get(index);
	if (!map) {
		map = new Map();
		for (const [key, entries] of index) {
			const k = nameKey(key);
			map.set(k, [...(map.get(k) ?? []), ...entries]);
		}
		normalisedIndexCache.set(index, map);
	}
	return map.get(nameKey(name)) ?? [];
}

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
	// Specialisation / ladder fallback (bead r8rx audit).
	//
	// An authored statblock names the item as the SHEET shows it — "Common Lore
	// (Imperium)", "Acrobatics (+20)", "Fear (2)" — while the pack holds the
	// base entry ("Common Lore", "Acrobatics", "Fear"). The resolver already
	// documents `sourceName` as the link for exactly this, but 21 NPCs never set
	// it, and the packer then THREW on every one of them — which is how those 21
	// came to ship with `items: []` and no loadout at all (the throw predates the
	// loud-failure guard that now catches it).
	//
	// Rather than hand-edit 21 statblocks (and have the next one drift back), the
	// base name is DERIVED as a fallback: strip a trailing "(+N)" ladder and a
	// trailing parenthetical specialisation, and retry. This is a fallback only —
	// it runs when the authored name resolves to nothing, and if the stripped
	// name resolves to nothing either, the loud failure below still fires.
	const baseNameCandidates: string[] = [];
	{
		let base = sourceName;
		for (let i = 0; i < 2; i++) {
			const next = base
				.replace(/\s*\(\+?\d+\)\s*$/, "")
				.replace(/\s*\([^)]*\)\s*$/, "")
				.trim();
			if (next === base || !next) break;
			base = next;
			baseNameCandidates.push(base);
		}
	}
	const lookup = (key: string) => index.get(key) ?? [];
	let candidates = lookup(sourceName);
	let usedSourceName = sourceName;
	// `standalone: true` means the author has said "this item exists in no pack".
	// The fallbacks below exist to FIND a pack entry, so running them for a
	// standalone item is wrong — it turned a deliberate opt-out into an
	// "ambiguous across packs" throw (Hatred (Psykers) matched the bare
	// "Hatred" in two packs). Skip them entirely.
	if (!standalone && candidates.length === 0) {
		for (const base of baseNameCandidates) {
			const found = lookup(base);
			if (found.length > 0) {
				candidates = found;
				usedSourceName = base;
				break;
			}
		}
	}
	// Last resort: the same name spelled with different punctuation
	// ("Dark Sight" vs the pack's "Dark-sight", "Tech Use" vs "Tech-Use").
	if (!standalone && candidates.length === 0) {
		for (const variant of [sourceName, ...baseNameCandidates]) {
			const found = normalisedLookup(index, variant);
			if (found.length > 0) {
				candidates = found;
				usedSourceName = variant;
				break;
			}
		}
	}
	let resolved: ItemSourceIndexEntry | null = null;
	// A recorded content gap behaves like `standalone`: pack the authored item
	// with its own data instead of failing. See KNOWN_MISSING_PACK_ENTRIES.
	const knownMissing =
		KNOWN_MISSING_PACK_ENTRIES.has(name) ||
		// An explicit `sourceName` already strips the ladder suffix, so it is
		// the most likely member of the list ("Speak Language (Eldar) (+10)"
		// declares sourceName "Speak Language (Eldar)").
		KNOWN_MISSING_PACK_ENTRIES.has(sourceName) ||
		baseNameCandidates.some((b) => KNOWN_MISSING_PACK_ENTRIES.has(b));
	if (standalone) {
		// Link NOTHING. Every branch below exists to FIND a pack entry, so none
		// of them may run — including the ambiguity check, which is meaningless
		// for an item that links to nothing. Running it anyway made two NPCs'
		// standalone `Fieldcraft` trait items throw "ambiguous across packs"
		// once the traits pack gained a Fieldcraft that collides with the
		// APTITUDE of the same name.
		resolved = null;
	} else if (fromPack) {
		// `fromPack` names the SOURCE file key (the historical pack name), so a
		// concept pack can pin an item without rewriting every reference. A
		// miss is a loud failure (bead szgv): the old fallback fabricated a
		// dataless `gear` item — the exact silent-degradation bug this
		// resolver exists to prevent (z4aa).
		const match = candidates.find((c) => (c.source ?? c.pack) === fromPack);
		if (!match && !knownMissing) {
			throw new Error(
				`compendia: embedded item "${name}" declares fromPack: ${fromPack}, but "${usedSourceName}" is not in that source — correct fromPack, add the item to a pack, or mark standalone: true`,
			);
		}
		resolved = match ?? null;
	} else if (candidates.length === 1) {
		resolved = candidates[0];
	} else if (candidates.length > 1) {
		throw new Error(
			`compendia: embedded item "${name}" is ambiguous across packs [${candidates.map((c) => c.pack).join(", ")}] — declare fromPack: <pack> on the entry`,
		);
	} else if (!standalone) {
		throw new Error(
			`compendia: embedded item "${usedSourceName}" matches no compendium pack — add it to a pack, declare fromPack, or mark standalone: true`,
		);
	}

	const doc =
		resolved && !standalone
			? // Linked: clone the PACK's real system data (type resolution via
			  // the SOURCE key's folder rules — the historical pack name, which is
			  // what FOLDER_TYPE_DEFAULTS is keyed by; the physical pack id is the
			  // same for single-source packs but NOT for a merged concept pack),
			  // then apply the authoring entry's name/overrides on top
			  // (specialisations, ladder, AP).
			  toSourceDocument(
					{
						...resolved.entry,
						...(entry.name ? { name: entry.name } : {}),
						system: {
							...(resolved.entry.system ?? {}),
							...(entry.system ?? {}),
						},
					},
					resolved.source ?? resolved.pack,
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

/**
 * NPC inventory ships READY (owner ask): a compendium NPC's embedded weapons
 * and gear arrive "carried" and its armour "worn". Without this every
 * statblock attack needed a manual equip toggle AND the NPC's armour soaked
 * nothing (the target-side damage path counts only WORN armour). An explicit
 * equipState authored on the embedded item still wins. Non-physical items
 * (skills, talents, traits, powers) have no equip state and are left alone.
 */
const NPC_EQUIP_STATE: Readonly<Record<string, string>> = {
	armour: "worn",
	"ranged-weapon": "carried",
	"melee-weapon": "carried",
	gear: "carried",
	tool: "carried",
	ammunition: "carried",
	"force-field": "carried",
	"weapon-modification": "carried",
	"armour-modification": "carried",
};

function equipNpcInventoryItem(doc: Record<string, unknown>): void {
	const state = NPC_EQUIP_STATE[String(doc.type ?? "")];
	if (!state) return;
	const system = { ...((doc.system as Record<string, unknown>) ?? {}) };
	if (system.equipState) return;
	system.equipState = state;
	doc.system = system;
}

/**
 * Legacy authoring sections (bead r8rx audit).
 *
 * 21 NPCs in npcs.yaml author their loadout as `system.skills` /
 * `system.talents` / `system.traits` / `system.weapons` / `system.armour` /
 * `system.gear` instead of a top-level `items` array. This packer only ever
 * read `entry.items`, so those entries packed `items: []` — verified in the
 * built LevelDB — and Foundry's schema clean then dropped the `system.*`
 * copies as undeclared, because Character declares none of those keys. The NPC
 * imported with NO skills, talents, traits, weapons or armour at all.
 *
 * Rather than migrate 21 hand-authored statblocks (error-prone, and the shape
 * would drift back), the legacy location is accepted here as an alias and the
 * consumed keys are REMOVED from the packed `system` so the compendium stops
 * shipping dead authoring data.
 *
 * NPC ONLY, deliberately: `system.armour` is an armour ITEM on an npc but the
 * FACING NUMBERS on a vehicle, and `system.traits` is a string array on a
 * vehicle too. Reading those as loadout sections on any other type would turn
 * a tank's armour plating into an embedded Item.
 *
 * NOW DEAD CODE (2026-09-22): src/packs/.extraction-src/convert-npc-loadouts.mjs
 * migrated all 21 entries to a top-level `items` array, so no pack entry
 * carries these keys in `system` any more. Kept because the owner said to deal
 * with the transform later — DELETE THIS BLOCK (and the npc loadout keys from
 * the pack-schema guard's allowlist) when that happens; the guard
 * "every actor entry with an authored loadout packs real items" covers the
 * behaviour either way.
 */
const LEGACY_LOADOUT_SECTIONS = [
	"skills",
	"talents",
	"traits",
	"weapons",
	"armour",
	"gear",
] as const;

export function toActorSourceDocument(
	entry: Record<string, unknown>,
	index: ItemSourceIndex,
	folderId: string | null = null,
): { actor: Record<string, unknown>; embedded: Array<Record<string, unknown>> } {
	const name = String(entry.name ?? "unnamed");
	const seenIds = new Set<string>();
	const actorType =
		typeof entry.type === "string" && entry.type ? entry.type : "npc";
	const system = { ...((entry.system as Record<string, unknown>) ?? {}) };

	// Authored loadout: the modern top-level `items` array, plus (npc only) the
	// legacy `system.*` sections. See LEGACY_LOADOUT_SECTIONS.
	const authored: unknown[] = Array.isArray(entry.items) ? [...entry.items] : [];
	if (actorType === "npc") {
		for (const section of LEGACY_LOADOUT_SECTIONS) {
			const value = system[section];
			if (value === undefined || value === null) continue;
			delete system[section];
			// `armour` is a single object; the rest are arrays.
			if (Array.isArray(value)) authored.push(...value);
			else authored.push(value);
		}
	}

	const embedded = authored.map((raw) => {
		const itemEntry =
			typeof raw === "string" ? { name: raw } : (raw as Record<string, unknown>);
		return toEmbeddedItemDocument(itemEntry, index, seenIds);
	});
	if (actorType === "npc") {
		for (const doc of embedded) equipNpcInventoryItem(doc);
	}
	const actor: Record<string, unknown> = {
		_id: documentId(name, entry._id as string | undefined),
		name,
		type: actorType,
		system,
		// Embedded collections are stored as ids; records live in sublevels.
		items: embedded.map((d) => String(d._id)),
		effects: [],
		folder: folderId,
		sort: 0,
		_stats: entry._stats ?? { coreVersion: 14 },
		flags: entry.flags ?? {},
	};
	if (typeof entry.img === "string" && entry.img) actor.img = entry.img;
	if (entry.prototypeToken) actor.prototypeToken = entry.prototypeToken;
	if (actorType === "vehicle") {
		// Bead yyd1: bake the size-category footprint into the compendium actor
		// so an imported vehicle lands at the right token size. An explicit
		// authored width/height still wins (the mapping is the default).
		const authored = (actor.prototypeToken ?? {}) as Record<string, unknown>;
		const { width, height } = vehicleTokenFootprint(
			(entry.system as { size?: string } | undefined)?.size,
		);
		actor.prototypeToken = {
			...authored,
			width: (authored.width as number | undefined) ?? width,
			height: (authored.height as number | undefined) ?? height,
		};
	}
	return { actor, embedded };
}

/** Minimal put/write batch surface the duplicate-key guard wraps. */
export interface PutBatch {
	put(key: string, value: string): void;
	write(): Promise<void>;
}

/**
 * Guard against silent document loss (bead 3e6u): LevelDB keys are unique,
 * so two entries that resolve to the same id overwrite each other with no
 * warning — and documentId is name-based, so that is exactly what happens
 * for same-name entries with no explicit `_id`. Fail loudly instead.
 */
export function guardedBatch(raw: PutBatch, pack: string): PutBatch {
	const seen = new Set<string>();
	return {
		put(key: string, value: string): void {
			if (seen.has(key)) {
				throw new Error(
					`compendia: ${pack}: duplicate document key "${key}" — two entries resolve to the same id (documentId is name-based). Give one an explicit "_id" (16 alphanumeric characters).`,
				);
			}
			seen.add(key);
			raw.put(key, value);
		},
		write: () => raw.write(),
	};
}

/**
 * Sidecar asset directories carried into the built system (bead v2cn, revived
 * for the portrait rollout). Art lives beside the pack YAMLs inside the
 * PRIVATE packs repo; the built system needs it on a path Foundry can serve,
 * so each pack's asset dirs are mirrored to `release/rogue_trader/private/
 * <pack>/` and referenced as `systems/rogue-trader/private/<pack>/<file>`.
 *
 * WHY NOT INSIDE `packs/<pack>/` (learned the hard way): Foundry OWNS pack
 * directories. A compendium data migration rewrites that LevelDB dir and
 * anything else living in it is destroyed — every portrait 404'd after the
 * first world launch.
 *
 * WHY THIS BEATS `asset/`: art from the books or the web is third-party
 * copyright. The public release is built with no `src/packs` clone, so nothing
 * mirrors there and `private/` never reaches the public zip
 * (release-public.yaml also refuses an artifact containing it).
 */
export const PACK_ASSET_DIRS = ["portraits"] as const;

/** Private (non-pack) asset root inside the built system. */
export const PACK_PRIVATE_DEST = "./release/rogue_trader/private";

/**
 * Mirror a pack's asset dirs from its private source folder into its built
 * private folder. Runs AFTER the pack's LevelDB is written (buildPack wipes
 * the pack dir first). The destination is replaced wholesale so a deleted
 * portrait cannot linger in a build. Returns the dir names actually copied.
 */
export async function mirrorPackAssets(
	sourcePackDir: string,
	packPrivateDir: string,
): Promise<string[]> {
	const copied: string[] = [];
	for (const dir of PACK_ASSET_DIRS) {
		const src = path.join(sourcePackDir, dir);
		if (!existsSync(src)) continue;
		const dest = path.join(packPrivateDir, dir);
		await rm(dest, { recursive: true, force: true });
		await mkdir(path.dirname(dest), { recursive: true });
		await cp(src, dest, { recursive: true });
		copied.push(dir);
	}
	return copied;
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

	const batch = guardedBatch(database.batch(), folder);
	let count = 0;

	// Read every yaml file once, up front. Grouping (bead nsqt) needs the
	// pack's full entry set so "/"-nested group parents resolve regardless of
	// which file holds them, and item documents need their folder _id stamps.
	const fileEntries = new Map<string, Array<Record<string, unknown>>>();
	// entry -> source file key (stem, aliased): drives type + folder grouping
	// for concept packs holding several source files (bead 8ubu). Identity map
	// because the same entry objects are reused below.
	const sourceByEntry = new Map<Record<string, unknown>, string>();
	for (const file of sourceFiles) {
		const entries = await readYamlEntries(path.join(PACK_SRC, folder, file));
		if (!isActorPack && !isTablePack && !isJournalPack) {
			auditSourceAttribution(
				`${folder}/${file.replace(/\.yaml$/, "")}`,
				entries,
			);
		}
		const key = sourceKey(file.replace(/\.yaml$/, ""));
		for (const entry of entries) sourceByEntry.set(entry, key);
		fileEntries.set(file, entries);
	}
	const sourceOf = (entry: Record<string, unknown>): string =>
		sourceByEntry.get(entry) ?? folder;

	// Folder emission: Item packs only. Folder docs go under `!folders!<id>`;
	// item docs carry `folder: <id>` (see toFolderSourceDocument for the
	// Foundry-14 verification notes).
	let folderStamps = new Map<string, string>();
	if (!isActorPack && !isJournalPack) {
		// Table packs get folders too (bead j9pg): Folder.type is the pack's
		// primary document class, so a RollTable pack nests under RollTable.
		const { folders: packFolders, byLabel } = buildPackFolders(
			folder,
			[...fileEntries.values()].flat(),
			isTablePack ? "RollTable" : "Item",
			sourceOf,
		);
		for (const f of packFolders) {
			batch.put(`!folders!${String(f._id)}`, f as unknown as string);
		}
		folderStamps = byLabel;
		count += packFolders.length;
	}

	// Folder emission for actor packs (bead 5lbn): same folder idiom as
	// Item packs, but Folder.type is the pack's PRIMARY document type
	// ("Actor"). Authoring `group:` on the yaml entries drives the labels.
	let actorFolderStamps = new Map<string, string>();
	if (isActorPack) {
		const { folders: packFolders, byLabel } = buildPackFolders(
			folder,
			[...fileEntries.values()].flat(),
			"Actor",
			sourceOf,
		);
		for (const f of packFolders) {
			batch.put(`!folders!${String(f._id)}`, f as unknown as string);
		}
		actorFolderStamps = byLabel;
		count += packFolders.length;
	}

	for (const entries of fileEntries.values()) {
		for (const entry of entries) {
			if (isActorPack) {
				// Foundry stores Actor docs under the `!actors!` sublevel with
				// embedded items split into `!actors.items!<actorId>.<itemId>`
				// records; the actor doc carries only the id array (et3x, core
				// _getSublevelNames + deleteOrphanDocuments verified).
				const group = resolveEntryFolder(entry, sourceOf(entry));
				const { actor, embedded } = toActorSourceDocument(
					entry,
					itemIndex,
					group ? (actorFolderStamps.get(group) ?? null) : null,
				);
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
				const { journal, pages } = toJournalSourceDocument(entry, linkIndex);
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
				? toTableSourceDocument(entry)
				: toSourceDocument(entry, sourceOf(entry));
			if (folderStamps.size > 0) {
				// Stamp the compendium folder (bead nsqt): root documents carry
				// folder: null, grouped ones their folder's _id.
				const group = resolveEntryFolder(entry, sourceOf(entry));
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

	// Pack art (bead v2cn): mirrored OUTSIDE the pack dir, which Foundry owns
	// and rewrites during compendium migrations.
	const mirrored = await mirrorPackAssets(
		path.join(PACK_SRC, folder),
		path.join(PACK_PRIVATE_DEST, folder),
	);
	if (mirrored.length > 0) {
		console.log(
			`[packs] ${folder}: mirrored ${mirrored.join(", ")}/ -> private/${folder}`,
		);
	}
	return count;
}

/** Path of the privately-held pack-declaration fragment (bead: manifest fragment). */
export const MANIFEST_PACKS_YAML = "./src/packs/rogue_trader/manifest-packs.yaml";

/** Read the packs array from the fragment; null when absent (no packs clone). */
export async function readManifestPacks(): Promise<
	Array<Record<string, unknown>> | null
> {
	if (!existsSync(MANIFEST_PACKS_YAML)) return null;
	const parsed = yaml.parse(await readFile(MANIFEST_PACKS_YAML, "utf8")) as {
		packs?: Array<Record<string, unknown>>;
	};
	if (!Array.isArray(parsed.packs) || parsed.packs.length === 0) {
		throw new Error(
			`compendia: ${MANIFEST_PACKS_YAML} must hold a non-empty top-level "packs" array`,
		);
	}
	return parsed.packs;
}

/**
 * Governance check (bead 8uh): an authored pack folder with no entry in the
 * privately-held pack-declaration fragment (manifest-packs.yaml, bead:
 * manifest fragment) never reaches the shipped manifest and is invisible in
 * Foundry. Warn (do not fail).
 */
export async function warnUnregisteredPacks(): Promise<void> {
	const fragment = await readManifestPacks();
	if (!fragment) return;
	const registered = new Set(
		fragment
			.map((pack) => String(pack.name ?? ""))
			.filter(Boolean),
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
				`[packs] WARNING: pack "${folder}" has no entry in ${MANIFEST_PACKS_YAML} and will be invisible in Foundry. Add to "packs":\n` +
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

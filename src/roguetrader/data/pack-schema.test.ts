/**
 * Pack entries must not carry `system` keys their data model does not declare
 * (bead r8rx follow-up).
 *
 * WHY THIS GUARD EXISTS: Foundry's TypeDataModel cleans input against the
 * declared schema, so an undeclared `system` key is SILENTLY DROPPED on load.
 * Nothing in the pipeline complains — the pack builds, the tests pass, and the
 * field is simply gone in the world. That is the exact failure the repo's own
 * source-attribution doc calls out ("Extraction convention (no silent drops):
 * every extracted entry carries it").
 *
 * Found by auditing every pack against its model. Results at the time of
 * writing, and they are NOT all the same kind of problem:
 *
 *   1. npcs.yaml, 21 entries — SEVERE, and a real data loss. These NPCs author
 *      their whole loadout in `system.skills/talents/traits/weapons/armour`
 *      and have NO top-level `items` array, but the packer builds embedded
 *      documents from `entry.items` (utils/compendia.ts, toActorSourceDocument).
 *      So they packed `items: []` — verified in the built LevelDB — and then
 *      Foundry dropped the `system.*` copies too. The NPC imported with NO
 *      skills, talents, traits, weapons or armour at all. The other 43 NPCs in
 *      the same file use the correct top-level `items` shape.
 *
 *      FIXED: the packer now reads the legacy `system.*` sections as an alias
 *      and REMOVES them from the packed `system`, so those keys no longer
 *      reach a live actor at all. They remain listed below because they are
 *      still undeclared SCHEMA fields — that is what makes them safe as an
 *      authoring-only location — and the loadout-resolution guard at the
 *      bottom of this file is what now protects the behaviour.
 *   2. FIXED (this change): ships.yaml (ship, ship-complication),
 *      components.yaml (ship-component, ship-weapon-component) and
 *      starships.yaml (starship) all set `system.source`, and none of those
 *      models declared it — 367 entries lost their provenance silently.
 *      `sourceField()` is now on all five models.
 *   3. FIXED (this change): starships.yaml sets `system.hullClass`; StarshipActor
 *      declared it in TypeScript but never in the SCHEMA, so it was dropped
 *      while the ship sheet read it and always got undefined. 41 entries.
 *   4. navigatorpowers.yaml sets `prerequisite` / `characteristicNote`;
 *      NavigatorPower declares neither. 23 entries.
 *
 * THE ALLOWLIST IS A WORK LIST, NOT AN AMNESTY. Each entry names what is wrong
 * and which of the four categories it is, so the guard cannot quietly absorb a
 * NEW undeclared key — only the known ones pass. Fixing a category means
 * deleting its line here, and the guard then enforces it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import {
	ACTOR_MODELS,
	ITEM_MODELS,
	loadSchema,
} from "../../test-helpers/registered-models";

const PACK_ROOT = "src/packs/rogue_trader";
const HAS_PACKS = existsSync(PACK_ROOT);

/**
 * Known undeclared keys, keyed `<file>::<type>`. Every line is a bug that is
 * recorded, not accepted — see the header for the category of each.
 */
const KNOWN: Readonly<Record<string, readonly string[]>> = {
	// The npc loadout keys (skills/talents/traits/weapons/armour/gear) used to be
	// listed here: 21 NPCs authored them in `system.*`, where Foundry dropped
	// them. convert-npc-loadouts.mjs moved every one into the top-level `items`
	// array, so no entry carries them any more and the entry is gone — which
	// also means the guard now ENFORCES that they never come back.
	//
	// (2) RESOLVED: `strength` on the five landing bays is now a declared field on
	// ShipComponent. battlefleet_koronus Table 1-9: Starship Weapons (printed
	// p35) prints a Strength column for the Landing Bays rows, and their text
	// says "Landing bays come equipped with one squadron per point of Strength" —
	// so it was never a mis-type, it was a missing field.
	//
	// (4) RESOLVED: `prerequisite` and `characteristicNote` are now declared on
	// NavigatorPower. Both were authored on all 23 entries from the start and
	// silently dropped; the model's own header already described the note as the
	// source of the per-power Characteristic, so the sentence pointed at data no
	// reader could reach. Nothing is left on this allowlist — it now enforces
	// every pack key.
};

/** Every pack YAML file, as `<dir>/<file>`. */
function packFiles(): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(PACK_ROOT)) {
		const dir = `${PACK_ROOT}/${entry}`;
		if (!statSync(dir).isDirectory()) continue;
		for (const file of readdirSync(dir)) {
			if (file.endsWith(".yaml")) out.push(`${entry}/${file}`);
		}
	}
	return out.sort();
}

describe.skipIf(!HAS_PACKS)("pack system keys match their data model", () => {
	/** type -> declared top-level schema keys. */
	async function schemas(): Promise<Map<string, Set<string>>> {
		const map = new Map<string, Set<string>>();
		for (const [type, entry] of Object.entries({
			...ITEM_MODELS,
			...ACTOR_MODELS,
		})) {
			map.set(type, new Set(Object.keys(await loadSchema(entry))));
		}
		return map;
	}

	test("no entry carries an undeclared system key", async () => {
		const known = await schemas();
		const offenders: string[] = [];
		let checked = 0;
		for (const rel of packFiles()) {
			let docs: unknown;
			try {
				docs = parse(readFileSync(`${PACK_ROOT}/${rel}`, "utf8"));
			} catch {
				continue;
			}
			if (!Array.isArray(docs)) continue;
			for (const doc of docs as Array<Record<string, unknown>>) {
				const system = doc?.system as Record<string, unknown> | undefined;
				const type = doc?.type as string | undefined;
				if (!system || !type) continue;
				const declared = known.get(type);
				// Unknown types (roll tables, journals) have no model here.
				if (!declared) continue;
				checked++;
				const allowed = new Set(KNOWN[`${rel}::${type}`] ?? []);
				const undeclared = Object.keys(system)
					.filter((k) => !declared.has(k) && !allowed.has(k))
					.sort();
				if (undeclared.length) {
					offenders.push(
						`${rel} [${type}] ${String(doc.name)}: ${undeclared.join(", ")}`,
					);
				}
			}
		}
		// Guard against the walk silently finding nothing.
		expect(checked).toBeGreaterThan(500);
		expect(offenders).toEqual([]);
	});

	test("the allowlist only names keys that are still undeclared", async () => {
		// Stops the allowlist rotting: once a model declares the field, the
		// allowlist line is stale and must be removed, so the guard starts
		// enforcing it for real.
		const known = await schemas();
		const stale: string[] = [];
		for (const [key, keys] of Object.entries(KNOWN)) {
			const type = key.split("::")[1];
			const declared = known.get(type);
			if (!declared) continue;
			for (const field of keys) {
				if (declared.has(field)) stale.push(`${key}: ${field} is now declared`);
			}
		}
		expect(stale).toEqual([]);
	});

	test("the allowlist has no entries for files or types that do not exist", () => {
		// A typo'd allowlist key would silently allow nothing while looking
		// like it was covering something.
		const files = new Set(packFiles());
		const bogus = Object.keys(KNOWN).filter(
			(key) => !files.has(key.split("::")[0]),
		);
		expect(bogus).toEqual([]);
	});

	test("every actor entry with an authored loadout packs real items", async () => {
		// THE GUARD FOR THE SEVERE CASE. 21 NPCs used to pack `items: []` while
		// carrying a full authored loadout in `system.*`, and NOTHING complained:
		// the pack built, the tests passed, and the NPC imported empty. This
		// runs the REAL packer and asserts the outcome that matters — authored
		// loadout in, embedded items out — so the failure cannot return silently.
		//
		// It must go through `toActorSourceDocument` rather than reading the
		// source YAML: the legacy sections live in `system.*`, so a check on the
		// file's own `items` array would flag all 104 correctly-authored entries.
		const { buildItemSourceIndex, toActorSourceDocument } = await import(
			"../../../utils/compendia"
		);
		const LOADOUT = ["skills", "talents", "traits", "weapons", "armour", "gear"];
		const dirs = readdirSync(PACK_ROOT)
			.filter((d) => statSync(`${PACK_ROOT}/${d}`).isDirectory())
			.map((name) => ({ name }));
		const index = await buildItemSourceIndex(dirs);

		const offenders: string[] = [];
		let checked = 0;
		for (const rel of packFiles()) {
			let docs: unknown;
			try {
				docs = parse(readFileSync(`${PACK_ROOT}/${rel}`, "utf8"));
			} catch {
				continue;
			}
			if (!Array.isArray(docs)) continue;
			for (const doc of docs as Array<Record<string, unknown>>) {
				const system = doc?.system as Record<string, unknown> | undefined;
				const type = doc?.type as string | undefined;
				if (!system || !type) continue;
				// NPCs only, mirroring the packer's own scoping: `system.armour` is
				// an armour ITEM on an npc but the FACING NUMBERS on a vehicle, and
				// `system.traits` is a declared stat on both ships and vehicles.
				// Those types have no loadout in `system.*`, so checking them here
				// would flag 60 correctly-authored vessels.
				if (type !== "npc") continue;
				const authored =
					LOADOUT.some((k) => system[k] != null) ||
					(Array.isArray(doc.items) && doc.items.length > 0);
				if (!authored) continue;
				checked++;
				try {
					const { embedded } = toActorSourceDocument(doc, index, null);
					if (embedded.length === 0) {
						offenders.push(`${rel} ${String(doc.name)}: authored loadout, 0 items`);
					}
				} catch (error) {
					offenders.push(
						`${rel} ${String(doc.name)}: ${(error as Error).message.slice(0, 90)}`,
					);
				}
			}
		}
		// 68 today (64 in npcs.yaml + 4 tau-drones). A floor rather than an exact
		// count, so adding NPCs does not churn this test — but a collapse to near
		// zero would mean the walk stopped finding entries.
		expect(checked).toBeGreaterThan(50);
		expect(offenders).toEqual([]);
	});
});

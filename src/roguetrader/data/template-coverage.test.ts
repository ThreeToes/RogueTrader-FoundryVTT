/**
 * template.json guard (beads wosb Item half, fi3o Actor half).
 *
 * Every Item and Actor sub-type with a registered TypeDataModel has its
 * `system` defaults owned by defineSchema(), so template.json's legacy mixins
 * and per-type system blocks were duplication at best. Both halves have now
 * been slimmed; this file stops them growing back.
 *
 * WHAT TEMPLATE.JSON STILL LEGITIMATELY CARRIES, and why (the bead's
 * "document what's load-bearing and keep it"):
 *   - `types` per document class. NOT what builds the Create Actor dialog —
 *     that is `game.documentTypes`, the registry of types supported by the
 *     active world (bead vnz3: the dialog offered `pc`, which is absent from
 *     this list). dh2j's "Foundry builds the create dialog from template.json"
 *     predates the documentTypes migration (4nr5) and is superseded by it, so
 *     this list is a legacy declaration kept ALIGNED with the registered
 *     models rather than a creation gate. Actor.types omits `pc` (retired by
 *     ow8w) and `planet` (created by planet-creator.ts) — asserted explicitly
 *     below so a NEW registered type that is merely forgotten fails loudly.
 *   - `prototypeToken` per Actor type — a DOCUMENT-level property, so a
 *     TypeDataModel cannot supply it. This part of dh2j's vehicle fix stands,
 *     and is why these survive (bar1 = system.structuralIntegrity).
 *   - `vehicle.armour` — a real, non-default pre-population of the six
 *     facings. Everything else in the old blocks either was not in the model
 *     at all (bio/experience/aptitudes/skills/initiative/psy) or matched the
 *     model's own default exactly.
 *
 * Actor model specs live in ../test-helpers/registered-models.ts.
 */
import { describe, expect, test } from "bun:test";
import {
	ACTOR_MODELS,
	ITEM_MODELS,
	loadSchema,
	schemaDefaults,
	type Schema,
} from "../../test-helpers/registered-models";

const readJson = async (relative: string): Promise<Record<string, unknown>> =>
	JSON.parse(
		await Bun.file(new URL(`../../../${relative}`, import.meta.url)).text(),
	);

type Block = Record<string, unknown>;
const template = (await readJson("template.json")) as {
	Actor: Block & { types: string[] };
	Item: Block & { types: string[] };
};

/** Field paths a model declares, nested SchemaFields included. */
function pathsOf(schema: Schema, prefix = ""): string[] {
	return Object.entries(schema ?? {}).flatMap(([key, field]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return field?.fields ? pathsOf(field.fields, path) : [path];
	});
}
const declares = (paths: string[], field: string): boolean =>
	paths.some((p) => p === field || p.startsWith(`${field}.`));

/**
 * Non-system keys template.json may still set on an Actor type. Anything here
 * is load-bearing and documented; everything else must be a model field.
 */
const ACTOR_TOP_LEVEL_ALLOWED = new Set(["prototypeToken"]);
/** Per-type exceptions that are NOT top-level but are real, non-default data. */
const ACTOR_SYSTEM_KEEP: Record<string, string[]> = {
	// TypedObjectField of facing -> NumberField(initial 0). Foundry's default is
	// an EMPTY map, so removing this would leave a fresh vehicle with no facing
	// keys rather than six zeroed ones.
	vehicle: ["armour"],
};

describe("template.json Item section (bead wosb)", () => {
	test("carries no Item defaults — the TypeDataModels own them", () => {
		expect(Object.keys(template.Item).sort()).toEqual(["types"]);
		expect(template.Item.templates).toBeUndefined();
	});

	test("the legacy v9 type names are gone", () => {
		for (const dead of [
			"criticalInjury",
			"cybernetic",
			"forceField",
			"malignancy",
			"mentalDisorder",
			"specialAbility",
			"weapon",
			"weaponModification",
			"madness",
		]) {
			expect(template.Item.types).not.toContain(dead);
		}
	});

	test("every listed Item type has a registered DataModel", () => {
		expect(template.Item.types.filter((t) => !(t in ITEM_MODELS))).toEqual([]);
	});

	test("every registered Item type is listed", () => {
		expect(
			Object.keys(ITEM_MODELS).filter((t) => !template.Item.types.includes(t)),
		).toEqual([]);
	});

	test("the models still declare what the Item mixins supplied", async () => {
		// 'equipment' supplied craftsmanship/description/availability/weight;
		// 'itemDescription' supplied description/source. (A path counts when
		// declared at any depth: `source` is a SchemaField -> source.book.)
		const former: Array<[string, string[]]> = [
			["gear", ["craftsmanship", "description", "availability", "weight"]],
			["armour", ["craftsmanship", "description", "availability", "weight"]],
			["mutation", ["description", "source"]],
			["talent", ["description", "source"]],
			["aptitude", ["description", "source"]],
			["trait", ["benefit", "shortDescription", "description", "effects"]],
		];
		for (const [type, fields] of former) {
			const paths = pathsOf(await loadSchema(ITEM_MODELS[type]));
			for (const field of fields) {
				expect(declares(paths, field), `${type} declares ${field}`).toBe(true);
			}
		}
	});

	test("the Item mixin DEFAULT VALUES survive on the models", async () => {
		const gear = schemaDefaults(await loadSchema(ITEM_MODELS.gear));
		expect(gear.get("craftsmanship")).toBe("common");
		expect(gear.get("availability")).toBe("common");
		expect(gear.get("weight")).toBe(0);
	});
});

describe("template.json Actor section (bead fi3o)", () => {
	test("the legacy mixins are gone", () => {
		// characteristics/skills/initiative/wounds/fatigue/fate/psy were v9
		// shapes: the Character model uses characteristics.ws.value (not
		// characteristics.weaponSkill.base), has no `skills` field at all
		// (skills are Items), and no `initiative`/`psy` (it has psyker/
		// psyRating/sustainedPowers).
		expect(template.Actor.templates).toBeUndefined();
		for (const mixin of [
			"characteristics",
			"skills",
			"initiative",
			"wounds",
			"fatigue",
			"fate",
			"psy",
		]) {
			expect(template.Actor[mixin]).toBeUndefined();
		}
	});

	test("every Actor block key is either a model field or an allowlisted top-level key", async () => {
		const offenders: string[] = [];
		for (const [type, model] of Object.entries(ACTOR_MODELS)) {
			const block = template.Actor[type] as Block | undefined;
			if (!block) continue;
			const paths = pathsOf(await loadSchema(model));
			const keep = new Set(ACTOR_SYSTEM_KEEP[type] ?? []);
			for (const key of Object.keys(block)) {
				if (keep.has(key)) continue;
				if (ACTOR_TOP_LEVEL_ALLOWED.has(key)) continue;
				if (!declares(paths, key)) offenders.push(`${type}.${key}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("no per-type Actor block still carries system defaults", () => {
		// The blocks exist ONLY to carry the load-bearing top-level keys
		// (prototypeToken) and the documented vehicle.armour exception.
		for (const [type, block] of Object.entries(template.Actor)) {
			if (type === "types") continue;
			const allowed = new Set([
				...ACTOR_TOP_LEVEL_ALLOWED,
				...(ACTOR_SYSTEM_KEEP[type] ?? []),
			]);
			const extra = Object.keys(block as Block).filter((k) => !allowed.has(k));
			expect(extra, `${type} carries only load-bearing keys`).toEqual([]);
		}
	});

	test("every listed Actor type has a registered DataModel", () => {
		expect(template.Actor.types.filter((t) => !(t in ACTOR_MODELS))).toEqual([]);
	});

	test("the registered-but-unlisted Actor types are the intentional ones", () => {
		// `types` is a legacy declaration, NOT the creation gate: the Create
		// Actor dialog reads game.documentTypes (bead vnz3). It is still kept
		// aligned with the registry so the file stays truthful, and this pins
		// the two deliberate omissions:
		//   pc     - the legacy character type, retired by ow8w
		//   planet - created by planet-creator.ts, not the dialog
		// A third name appearing here means someone registered an Actor type and
		// forgot the list.
		const unlisted = Object.keys(ACTOR_MODELS)
			.filter((t) => !template.Actor.types.includes(t))
			.sort();
		expect(unlisted).toEqual(["pc", "planet"]);
	});

	test("prototypeToken is retained for every type that had one", () => {
		// The load-bearing half of the old blocks. Losing these silently
		// changes token defaults (bar1 attribute, actorLink, sight).
		const expected: Record<string, unknown> = {
			explorer: { actorLink: true, bar1: { attribute: "wounds" } },
			npc: { bar1: { attribute: "wounds" } },
			dynasty: { actorLink: true, sight: { enabled: false } },
			starship: {
				actorLink: true,
				bar1: { attribute: "hullIntegrity" },
				sight: { enabled: false },
			},
			vehicle: {
				bar1: { attribute: "system.structuralIntegrity" },
				sight: { enabled: false },
			},
		};
		for (const [type, token] of Object.entries(expected)) {
			expect(
				(template.Actor[type] as Block).prototypeToken,
				`${type} prototypeToken`,
			).toEqual(token);
		}
	});

	test("vehicle.armour keeps its pre-populated facings", () => {
		// The one genuine non-default survivor: Foundry's TypedObjectField
		// default is an empty map.
		expect((template.Actor.vehicle as Block).armour).toEqual({
			front: 0,
			left: 0,
			right: 0,
			rear: 0,
			top: 0,
			bottom: 0,
		});
	});

	test("the models still declare the Actor fields the blocks supplied", async () => {
		// Everything removed from the blocks must still exist on the model,
		// or a default really did go missing.
		const former: Array<[string, string[]]> = [
			["explorer", ["insanity", "corruption", "size"]],
			["npc", ["faction", "subfaction", "npcType", "threatLevel", "notes"]],
			[
				"vehicle",
				[
					"structuralIntegrity",
					"handling",
					"speed",
					"size",
					"vehicleClass",
					"traits",
					"crew",
					"mountedWeapons",
					"description",
				],
			],
		];
		for (const [type, fields] of former) {
			const paths = pathsOf(await loadSchema(ACTOR_MODELS[type]));
			for (const field of fields) {
				expect(declares(paths, field), `${type} declares ${field}`).toBe(true);
			}
		}
	});
});

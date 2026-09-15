/**
 * template.json Item-section guard (bead wosb).
 *
 * Stage 1 of bead 4nr5 gave every Item sub-type a registered TypeDataModel
 * (CONFIG.Item.dataModels), so `defineSchema()` owns the defaults. That made
 * template.json's legacy Item half pure duplication — and active
 * MISINFORMATION: several per-type blocks still described the v9 field shapes
 * (`talent.prerequisites`/`aptitudes`/`benefit`/`starter`/`cost`,
 * `armour.type`/`isAdditive`/`part`) that the models deliberately replaced
 * (`prereqTalent`/`category`, `armourPoints`/`protectionType`), i.e. defaults
 * for fields nothing reads. Verified before removal: zero references to any of
 * those names outside the templates themselves.
 *
 * The Item section is now just the type list. This test fails if:
 *   - template.json grows Item defaults back (mixins or per-type blocks);
 *   - it lists a type with no registered model — a legacy name, for which
 *     Foundry would fall back to template.json for defaults;
 *   - a registered type is missing from the list;
 *   - system.json's documentTypes declares a type the list omits.
 *
 * Actor templates are deliberately still present (deferred with the same
 * live-world QA requirement, bead wosb).
 */
import { describe, expect, test } from "bun:test";

await import("../../../test-helpers/foundry-schema-stub");

type Field = { fields?: Record<string, Field> };
type Schema = Record<string, Field>;

/**
 * Registered Item types -> [module file, exported class]. Mirrors
 * SHEET_REGISTRY.Item in sheet/init.ts (which is inside an init function and
 * so cannot be imported here). A rename in either place fails this test
 * loudly, which is the point.
 */
const REGISTERED: Record<string, [string, string]> = {
	gear: ["gear", "Gear"],
	"ranged-weapon": ["ranged-weapon", "RangedWeapon"],
	"melee-weapon": ["melee-weapon", "MeleeWeapon"],
	armour: ["armour", "Armour"],
	skill: ["skill", "Skill"],
	talent: ["talent", "Talent"],
	career: ["career", "Career"],
	ship: ["starship", "Starship"],
	"ship-complication": ["starship", "ShipComplication"],
	"ship-component": ["ship-component", "ShipComponent"],
	"ship-weapon-component": ["ship-component", "ShipWeaponComponent"],
	"game-table": ["game-table", "GameTable"],
	psychicpower: ["psychic-power", "PsychicPower"],
	navigatorpower: ["navigator-power", "NavigatorPower"],
	origintrait: ["origin-trait", "OriginTrait"],
	origin: ["origin", "Origin"],
	heirloom: ["heirloom", "Heirloom"],
	mutation: ["mutation", "Mutation"],
	madnessentry: ["madness", "MadnessEntry"],
	trait: ["trait", "Trait"],
	ammunition: ["ammunition", "Ammunition"],
	"force-field": ["force-field", "ForceField"],
	"weapon-modification": ["weapon-modification", "WeaponModification"],
	"armour-modification": ["armour-modification", "ArmourModification"],
	// Plain-Gear sub-types: no extra schema, registered against the Gear model.
	aptitude: ["gear", "Gear"],
	tool: ["gear", "Gear"],
	drug: ["gear", "Gear"],
	"special-ability": ["gear", "Gear"],
};

const readJson = async (relative: string): Promise<Record<string, unknown>> =>
	JSON.parse(
		await Bun.file(new URL(`../../../../${relative}`, import.meta.url)).text(),
	);

const template = (await readJson("template.json")) as {
	Item: { types: string[] } & Record<string, unknown>;
};
// The SHIPPED manifest: utils/build.ts copies system-manifests/dev.json to
// release/rogue_trader/system.json. The root system.json is a known-stale
// duplicate (bead v7wo) and must not be used as the source of truth here.
const system = await readJson("system-manifests/dev.json");

/** Flattened field paths a model declares (nested SchemaFields included). */
async function schemaPaths(file: string, className: string): Promise<string[]> {
	return [...(await schemaDefaults(file, className)).keys()];
}

/** Flattened field path -> declared `initial` value. */
async function schemaDefaults(
	file: string,
	className: string,
): Promise<Map<string, unknown>> {
	const module = (await import(`./${file}`)) as Record<string, unknown>;
	const model = module[className] as { defineSchema: () => Schema };
	const out = new Map<string, unknown>();
	const walk = (schema: Schema, prefix = ""): void => {
		for (const [key, field] of Object.entries(schema ?? {})) {
			const path = prefix ? `${prefix}.${key}` : key;
			const nested = (field as { fields?: Schema })?.fields;
			if (nested) walk(nested, path);
			else out.set(path, (field as { opts?: { initial?: unknown } })?.opts?.initial);
		}
	};
	walk(model.defineSchema());
	return out;
}

describe("template.json Item section (bead wosb)", () => {
	test("carries no Item defaults — the TypeDataModels own them", () => {
		// Any per-type block or `templates` mixin here is duplication at best,
		// and a stale v9 field shape at worst.
		expect(Object.keys(template.Item).sort()).toEqual(["types"]);
		expect(template.Item.templates).toBeUndefined();
		for (const legacy of [
			"armour",
			"talent",
			"trait",
			"gear",
			"mutation",
			"weapon",
		]) {
			expect(template.Item[legacy]).toBeUndefined();
		}
	});

	test("the legacy v9 type names are gone", () => {
		// These names have no registered model; keeping them would invite
		// Foundry to fall back to template.json defaults for a dead type.
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

	test("every listed type has a registered DataModel", () => {
		const unregistered = template.Item.types.filter(
			(type) => !(type in REGISTERED),
		);
		expect(unregistered).toEqual([]);
	});

	test("every registered type is listed", () => {
		const missing = Object.keys(REGISTERED).filter(
			(type) => !template.Item.types.includes(type),
		);
		expect(missing).toEqual([]);
	});

	test("the shipped manifest declares no type the list omits", () => {
		// The manifest is what Foundry reads for htmlFields/filePathFields;
		// a type there but not in template.json means the two declarations
		// have drifted apart.
		const documentTypes = (system.documentTypes ?? {}) as {
			Item?: Record<string, unknown>;
		};
		const declared = Object.keys(documentTypes.Item ?? {});
		const missing = declared.filter(
			(type) => !template.Item.types.includes(type),
		);
		expect(missing).toEqual([]);
	});

	/** True when the schema declares `field`, structured fields included. */
	const declares = (paths: string[], field: string): boolean =>
		paths.some((p) => p === field || p.startsWith(`${field}.`));

	test("the mixin DEFAULT VALUES survive on the models", async () => {
		// Declaring the field is not enough — the default must match, or new
		// items would silently change shape now that the template no longer
		// supplies one. The deleted 'equipment' mixin defaulted
		// craftsmanship/availability to "common" and weight to 0.
		const gear = await schemaDefaults("gear", "Gear");
		expect(gear.get("craftsmanship")).toBe("common");
		expect(gear.get("availability")).toBe("common");
		expect(gear.get("weight")).toBe(0);
		// 'itemDescription' defaulted description to ""; the models keep it
		// (HTMLField's own default when no explicit initial is declared).
		const mutation = await schemaDefaults("mutation", "Mutation");
		expect(mutation.has("description")).toBe(true);
	});

	test("the models really do declare the fields the mixins used to", async () => {
		// The invariant that makes the removal safe: 'equipment' supplied
		// craftsmanship/description/availability/weight; 'itemDescription'
		// supplied description/source. Every model that consumed a mixin must
		// still declare those paths itself. (A path counts when the model
		// declares it at any depth: `source` is a SchemaField, so it appears
		// as source.book / source.page.)
		// The recorded pre-removal mapping: which live types consumed which
		// mixin in the deleted section, and which fields were declared inline.
		// These are the models that must still declare those paths themselves.
		const FORMER_TEMPLATE_FIELDS: Array<[string, string[]]> = [
			["gear", ["craftsmanship", "description", "availability", "weight"]],
			["tool", ["craftsmanship", "description", "availability", "weight"]],
			["drug", ["craftsmanship", "description", "availability", "weight"]],
			["armour", ["craftsmanship", "description", "availability", "weight"]],
			["mutation", ["description", "source"]],
			["talent", ["description", "source"]],
			["aptitude", ["description", "source"]],
			// `trait` declared these inline rather than via a mixin.
			["trait", ["benefit", "shortDescription", "description", "effects"]],
		];
		for (const [type, fields] of FORMER_TEMPLATE_FIELDS) {
			const [file, className] = REGISTERED[type];
			const paths = await schemaPaths(file, className);
			for (const field of fields) {
				expect(declares(paths, field), `${type} declares ${field}`).toBe(true);
			}
		}
	});
});

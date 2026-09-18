/**
 * The authoritative type -> DataModel map, for tests that check the shipped
 * manifest and template.json agree with what is actually registered (beads
 * wosb, pwpu).
 *
 * This mirrors SHEET_REGISTRY in sheet/init.ts, which lives inside an init
 * function and so cannot be imported here. A rename in either place fails
 * these tests loudly, which is the point.
 *
 * Model specifiers are relative to THIS file and loaded through `loadSchema`,
 * so callers never need to reason about paths (a dynamic import() inside a
 * test resolves relative to the test file, not to the helper).
 */
import { StubHtmlField } from "./foundry-schema-stub";

await import("./foundry-schema-stub");

export interface ModelEntry {
	/** Import specifier, relative to this helper. */
	spec: string;
	className: string;
}

/** Registered Item sub-types -> model. */
export const ITEM_MODELS: Record<string, ModelEntry> = {
	gear: { spec: "../roguetrader/data/item/gear", className: "Gear" },
	"ranged-weapon": { spec: "../roguetrader/data/item/ranged-weapon", className: "RangedWeapon" },
	"melee-weapon": { spec: "../roguetrader/data/item/melee-weapon", className: "MeleeWeapon" },
	armour: { spec: "../roguetrader/data/item/armour", className: "Armour" },
	battlesuit: { spec: "../roguetrader/data/item/battlesuit", className: "Battlesuit" },
	"battlesuit-system": {
		spec: "../roguetrader/data/item/battlesuit-system",
		className: "BattlesuitSystem",
	},
	skill: { spec: "../roguetrader/data/item/skill", className: "Skill" },
	talent: { spec: "../roguetrader/data/item/talent", className: "Talent" },
	career: { spec: "../roguetrader/data/item/career", className: "Career" },
	ship: { spec: "../roguetrader/data/item/starship", className: "Starship" },
	"ship-complication": { spec: "../roguetrader/data/item/starship", className: "ShipComplication" },
	"ship-component": { spec: "../roguetrader/data/item/ship-component", className: "ShipComponent" },
	"ship-weapon-component": { spec: "../roguetrader/data/item/ship-component", className: "ShipWeaponComponent" },
	"game-table": { spec: "../roguetrader/data/item/game-table", className: "GameTable" },
	psychicpower: { spec: "../roguetrader/data/item/psychic-power", className: "PsychicPower" },
	navigatorpower: { spec: "../roguetrader/data/item/navigator-power", className: "NavigatorPower" },
	origintrait: { spec: "../roguetrader/data/item/origin-trait", className: "OriginTrait" },
	origin: { spec: "../roguetrader/data/item/origin", className: "Origin" },
	heirloom: { spec: "../roguetrader/data/item/heirloom", className: "Heirloom" },
	mutation: { spec: "../roguetrader/data/item/mutation", className: "Mutation" },
	madnessentry: { spec: "../roguetrader/data/item/madness", className: "MadnessEntry" },
	trait: { spec: "../roguetrader/data/item/trait", className: "Trait" },
	ammunition: { spec: "../roguetrader/data/item/ammunition", className: "Ammunition" },
	"force-field": { spec: "../roguetrader/data/item/force-field", className: "ForceField" },
	"weapon-modification": { spec: "../roguetrader/data/item/weapon-modification", className: "WeaponModification" },
	"armour-modification": { spec: "../roguetrader/data/item/armour-modification", className: "ArmourModification" },
	// Plain-Gear sub-types: no extra schema, registered against the Gear model.
	aptitude: { spec: "../roguetrader/data/item/gear", className: "Gear" },
	tool: { spec: "../roguetrader/data/item/gear", className: "Gear" },
	drug: { spec: "../roguetrader/data/item/gear", className: "Gear" },
	"special-ability": { spec: "../roguetrader/data/item/gear", className: "Gear" },
};

/** Registered Actor types -> model. */
export const ACTOR_MODELS: Record<string, ModelEntry> = {
	// "pc" is the pre-rename character type, kept registered until the ow8w
	// ready-migration has run; it shares the Character model.
	pc: { spec: "../roguetrader/data/actor/character", className: "Character" },
	explorer: { spec: "../roguetrader/data/actor/character", className: "Character" },
	npc: { spec: "../roguetrader/data/actor/character", className: "Character" },
	vehicle: { spec: "../roguetrader/data/actor/vehicle", className: "Vehicle" },
	dynasty: { spec: "../roguetrader/data/actor/dynasty", className: "Dynasty" },
	starship: { spec: "../roguetrader/data/actor/starship-actor", className: "StarshipActor" },
	planet: { spec: "../roguetrader/data/actor/planet-actor", className: "PlanetActor" },
};

type Field = { fields?: Record<string, Field> };
export type Schema = Record<string, Field>;

/** Load a model's defineSchema() (the stub must already be installed). */
export async function loadSchema(entry: ModelEntry): Promise<Schema> {
	const module = (await import(entry.spec)) as Record<string, unknown>;
	const model = module[entry.className] as { defineSchema: () => Schema };
	if (!model?.defineSchema) {
		throw new Error(
			`${entry.spec} does not export a model class named "${entry.className}"`,
		);
	}
	return model.defineSchema();
}

/** Flattened field path -> declared `initial` value. */
export function schemaDefaults(schema: Schema): Map<string, unknown> {
	const out = new Map<string, unknown>();
	const walk = (fields: Schema, prefix = ""): void => {
		for (const [key, field] of Object.entries(fields ?? {})) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (field?.fields) walk(field.fields, path);
			else out.set(path, (field as { opts?: { initial?: unknown } })?.opts?.initial);
		}
	};
	walk(schema);
	return out;
}

/**
 * The model's HTMLField paths, as Foundry's documentTypes `htmlFields` expects
 * them: relative to `system`, nested SchemaFields included (e.g.
 * "life.motivation", "levels.novice").
 */
export function htmlFieldPaths(schema: Schema): string[] {
	const out: string[] = [];
	const walk = (fields: Schema, prefix = ""): void => {
		for (const [key, field] of Object.entries(fields ?? {})) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (field?.fields) walk(field.fields, path);
			else if (field instanceof StubHtmlField) out.push(path);
		}
	};
	walk(schema);
	return out;
}

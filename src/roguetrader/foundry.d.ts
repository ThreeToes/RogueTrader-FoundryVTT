/**
 * Foundry type configuration (epic kof0, bead rt9z).
 *
 * Two declaration merges. Both exist because fvtt-types cannot know this
 * system's document types or its boot phase, and without them a large class of
 * code is untypeable.
 *
 * 1. AssumeHookRan = "ready"
 *    `game` is typed as `Games[GameHooks]`, and with nothing assumed it is
 *    `UninitializedGame` — every property optional. That makes
 *    `game.i18n.localize(...)` an error in ~89 places in the sheet layer alone.
 *    Declaring `ready` says "assume the system is past the ready hook", which is
 *    the mechanism fvtt-types documents for this and ships itself as its
 *    `fvtt-types/lenient` entry.
 *
 *    Safe here because the only code that runs before ready is
 *    bootstrap/config.ts, and it already optional-chains its one i18n call.
 *
 * 2. DataModelConfig — this system's document types
 *    fvtt-types narrows `Item.type` / `Actor.type` to `"base" | ModuleSubType`
 *    because it cannot know what the system registers, so `item.type === "skill"`
 *    is a TS2367 ("no overlap") and `item.system` is `UnknownSystem` — which is
 *    why the codebase is full of `as unknown as { … }` accessors.
 *    Declaring the type -> DataModel map here gives `type` a real union and
 *    `system` the real model.
 *
 * KEEPING THIS IN SYNC: bootstrap/sheet-registry.ts is the runtime source of
 * truth for the same mapping. foundry-types.test.ts asserts the two agree, so a
 * document type added to the registry cannot silently go missing here.
 */

import type { Character } from "./data/actor/character";
import type { Dynasty } from "./data/actor/dynasty";
import type { PlanetActor } from "./data/actor/planet-actor";
import type { CacheActor } from "./data/actor/cache";
import type { StarshipActor } from "./data/actor/starship-actor";
import type { Vehicle } from "./data/actor/vehicle";
import type { Ammunition } from "./data/item/ammunition";
import type { Armour } from "./data/item/armour";
import type { ArmourModification } from "./data/item/armour-modification";
import type { Battlesuit } from "./data/item/battlesuit";
import type { BattlesuitSystem } from "./data/item/battlesuit-system";
import type { Career } from "./data/item/career";
import type { ForceField } from "./data/item/force-field";
import type { GameTable } from "./data/item/game-table";
import type { Gear } from "./data/item/gear";
import type { Heirloom } from "./data/item/heirloom";
import type { MadnessEntry } from "./data/item/madness";
import type { MeleeWeapon } from "./data/item/melee-weapon";
import type { Mutation } from "./data/item/mutation";
import type { NavigatorPower } from "./data/item/navigator-power";
import type { Origin } from "./data/item/origin";
import type { OriginTrait } from "./data/item/origin-trait";
import type { PsychicPower } from "./data/item/psychic-power";
import type { RangedWeapon } from "./data/item/ranged-weapon";
import type {
	ShipComponent,
	ShipWeaponComponent,
} from "./data/item/ship-component";
import type { ShipComplication, Starship } from "./data/item/starship";
import type { Skill } from "./data/item/skill";
import type { Talent } from "./data/item/talent";
import type { Trait } from "./data/item/trait";
import type { WarrantOption } from "./data/item/warrant-option";
import type { WeaponModification } from "./data/item/weapon-modification";

declare global {
	interface AssumeHookRan {
		ready: never;
	}
}

declare module "fvtt-types/configuration" {
	interface DataModelConfig {
		Item: {
			gear: typeof Gear;
			"ranged-weapon": typeof RangedWeapon;
			"melee-weapon": typeof MeleeWeapon;
			armour: typeof Armour;
			battlesuit: typeof Battlesuit;
			"battlesuit-system": typeof BattlesuitSystem;
			skill: typeof Skill;
			talent: typeof Talent;
			career: typeof Career;
			ship: typeof Starship;
			"ship-complication": typeof ShipComplication;
			"ship-component": typeof ShipComponent;
			"ship-weapon-component": typeof ShipWeaponComponent;
			"game-table": typeof GameTable;
			psychicpower: typeof PsychicPower;
			navigatorpower: typeof NavigatorPower;
			origintrait: typeof OriginTrait;
			origin: typeof Origin;
			"warrant-option": typeof WarrantOption;
			heirloom: typeof Heirloom;
			mutation: typeof Mutation;
			madnessentry: typeof MadnessEntry;
			trait: typeof Trait;
			// Plain-Gear subtypes (bead 5p8): no extra schema, they reuse Gear.
			aptitude: typeof Gear;
			ammunition: typeof Ammunition;
			"force-field": typeof ForceField;
			"weapon-modification": typeof WeaponModification;
			"armour-modification": typeof ArmourModification;
			tool: typeof Gear;
			drug: typeof Gear;
			"special-ability": typeof Gear;
		};
		Actor: {
			// The legacy "pc" model (bead ow8w) is dropped from CONFIG at ready
			// but documents of that type still parse during boot.
			pc: typeof Character;
			explorer: typeof Character;
			npc: typeof Character;
			vehicle: typeof Vehicle;
			dynasty: typeof Dynasty;
			starship: typeof StarshipActor;
			planet: typeof PlanetActor;
			cache: typeof CacheActor;
		};
	}
}

export {};

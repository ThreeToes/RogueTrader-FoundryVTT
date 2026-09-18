import { Character } from "../data/actor/character";
import { Vehicle } from "../data/actor/vehicle";
import { Ammunition } from "../data/item/ammunition";
import { Armour } from "../data/item/armour";
import { Battlesuit } from "../data/item/battlesuit";
import { BattlesuitSystem } from "../data/item/battlesuit-system";
import { ForceField } from "../data/item/force-field";
import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { PsychicPower } from "../data/item/psychic-power";
import { NavigatorPower } from "../data/item/navigator-power";
import { OriginTrait } from "../data/item/origin-trait";
import { Origin } from "../data/item/origin";
import { WarrantOption } from "../data/item/warrant-option";
import { Heirloom } from "../data/item/heirloom";
import { Mutation } from "../data/item/mutation";
import { MadnessEntry } from "../data/item/madness";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { Skill } from "../data/item/skill";
import { Talent } from "../data/item/talent";
import { Trait } from "../data/item/trait";
import { Career } from "../data/item/career";
import { Starship, ShipComplication } from "../data/item/starship";
import {
	ShipComponent,
	ShipWeaponComponent,
} from "../data/item/ship-component";
import { ArmourModification } from "../data/item/armour-modification";
import { WeaponModification } from "../data/item/weapon-modification";
import { attachRegistriesToConfig } from "../registry";
import { migrateLegacyActors, withoutLegacyCharacterTypes } from "../migrations";
import {
	rollDamageForCard,
	rollSkill,
	rollTest,
	rollSkillUntrained,
	rollWeaponAttack,
	rollPsychicPower,
	rollNavigatorPower,
	rollFearTest,
	performRoll,
	rollSnapOut,
} from "../rules/adapter";
import type { DamageApplyFlag, DamageRollFlag } from "../rules/chat-flags";
import {
	applyDamageWithCriticals,
	postCriticalCard,
} from "../rules/criticals";
import { missingSkillGrants } from "../rules/default-skills";
import {
	STATUS_IMG,
	SYSTEM_STATUSES,
} from "../rules/conditions";
import { testContributors } from "../rules/funnel";
import {
	HOMEBREW_SETTING,
	parseHomebrewProfile,
} from "../rules/homebrew";
import type { OriginTraitDef } from "../rules/origin-traits";
import {
	setOriginEntries,
	setHeirloomEntries,
	type HeirloomEntry,
	type HeirloomGrantKind,
	type OriginEntry,
	type OriginMechanics,
	type OriginRow,
	type OriginVariant,
} from "../origins";
import { talentEffectHandlers } from "../rules/talent-effects";
import {
	isWarrantRow,
	setWarrantEntries,
	type WarrantEntry,
	type WarrantRow,
} from "../rules/warrant";
import { CharacterSheet } from "./actor/character-sheet";
import { CharacterCreator } from "./actor/character-creator";
import { ShipCreator } from "./actor/ship-creator";
import { WarrantCreator } from "./actor/warrant-creator";
import { VehicleSheet } from "./actor/vehicle-sheet";
import { DynastySheet } from "./actor/dynasty-sheet";
import { Dynasty } from "../data/actor/dynasty";
import { StarshipActor } from "../data/actor/starship-actor";
import { PlanetActor } from "../data/actor/planet-actor";
import { ShipSheet } from "./actor/ship-sheet";
import { PlanetSheet } from "./actor/planet-sheet";
import { PlanetCreator } from "./actor/planet-creator";
import { NpcSheet } from "./actor/npc-sheet";
import { registerConfigHelper } from "./handlebars";
import { ArmourSheet } from "./item/armour-sheet";
import { GearSheet } from "./item/gear-sheet";
import { ShipComponentSheet } from "./item/ship-component-sheet";
import { ShipComplicationSheet } from "./item/ship-complication-sheet";
import { ShipHullSheet } from "./item/ship-hull-sheet";
import { GameTable } from "../data/item/game-table";
import { GameTableSheet } from "./item/game-table-sheet";
import { PsychicPowerSheet } from "./item/psychic-power-sheet";
import { NavigatorPowerSheet } from "./item/navigator-power-sheet";
import { SkillSheet } from "./item/skill-sheet";
import { TalentSheet } from "./item/talent-sheet";
import { TraitSheet } from "./item/trait-sheet";
import { CareerSheet } from "./item/career-sheet";
import { WeaponSheet } from "./item/weapon-sheet";
import { registerSharedPartials } from "./partials";
import { getCharacterOptionDocs, getPackDocuments } from "./pack-resolve";
import { trackDefaultGrants } from "./default-grants";

/**
 * Actor-directory context-menu entry (v14 ContextMenuEntry shape). The menu
 * array is built once and shared across every entry, so per-target behaviour
 * lives in `condition`: ContextMenu.render(target) evaluates each entry's
 * condition(target) and only renders the ones that pass (fvtt-types
 * ux/context-menu.d.mts). This is how a creator entry is offered only on its
 * own actor type (bead ugd2).
 */
type DirectoryEntryOption = {
	label: string;
	icon: string;
	onClick: (event?: PointerEvent, element?: HTMLElement) => void;
	condition?: (element?: HTMLElement) => boolean;
};

/**
 * Resolve the world actor behind a directory entry context-menu target (the
 * element the menu was triggered for). v14 entry markup carries data-entry-id
 * (document-partial.hbs); older cores used data-document-id.
 */
function resolveEntryActor(
	element?: HTMLElement,
): foundry.documents.Actor | undefined {
	const entryEl = element?.closest<HTMLElement>(
		"[data-entry-id], [data-document-id]",
	);
	const resolvedId =
		entryEl?.dataset.entryId ??
		entryEl?.dataset.documentId ??
		element?.dataset?.documentId;
	if (!resolvedId) return undefined;
	return (
		game.actors as unknown as { get: (id: string) => unknown }
	).get(resolvedId) as foundry.documents.Actor | undefined;
}

// 6a1x: any sheet constructor. never[] params (not unknown[]) so concrete
// ApplicationV2 constructors with specific optional options objects are
// assignable without per-call casts (never is assignable to everything).
type AnySheetCtor = new (...args: never[]) => object;

let commonSkillCatalog: object[] = [];
// DamageApplyFlag / DamageRollFlag live in rules/chat-flags.ts (bead mvu2).

/**
 * Apply the wounds shown on a damage chat card to the flagged target
 * (bead ncc). Consumes the card's data-only kernel outcome; guards
 * double-application via the message flag; ownership enforced here.
 */
async function applyDamageFromCard(button: HTMLButtonElement): Promise<void> {
	const messageEl = button.closest<HTMLElement>(".message");
	const messageId = messageEl?.dataset.messageId;
	const message = messageId
		? (foundry.documents.ChatMessage.get(messageId) as unknown as {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
			})
		: undefined;
	const data = message?.flags?.["rogue-trader"]?.damageApply as
		| DamageApplyFlag
		| undefined;
	if (!message || !data || data.applied) {
		// Fallback: the button itself carries the outcome (data-target /
		// data-wounds) - usable even when the message flag is missing, e.g.
		// on cards created before the flag existed.
		const fallbackWounds = Number(button.dataset.wounds ?? 0);
		const fallbackTarget = button.dataset.target;
		if (!fallbackTarget || !fallbackWounds) return;
		applyToTarget(fallbackTarget, fallbackWounds, message, button).catch(
			(error) => console.error("rogue-trader: apply-damage failed", error),
		);
		return;
	}
	await applyToTarget(
		data.targetUuid ?? "",
		Number(data.wounds ?? 0),
		message,
		button,
		{ ...data },
	);
}

/** Shared apply path: resolve target, enforce ownership, clamp, update. */
async function applyToTarget(
	targetUuid: string,
	woundsAmount: number,
	message:
		| {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
		  }
		| undefined,
	button: HTMLButtonElement,
	existing?: DamageApplyFlag,
): Promise<void> {
	const target = targetUuid
		? (foundry.utils.fromUuidSync(targetUuid) as unknown as {
				system?: { wounds?: { value: number; max: number } };
				isOwner?: boolean;
				update: (u: object) => Promise<void>;
			} | null)
		: null;
	const wounds = target?.system?.wounds;
	if (!target || !wounds) return;
	// Only the defender's owner (or a GM) may apply the wounds.
	const user = game as unknown as { user?: { isGM?: boolean } };
	if (!target.isOwner && !user.user?.isGM) return;

	const effective: DamageApplyFlag = { ...(existing ?? {}) };
	button.disabled = true;
	// Wounds first, then Critical Damage for whatever runs past 0 (bead ks3k).
	// The card carries the damage type + hit location so the right critical
	// table is used; a card posted before that flag existed falls back to
	// Impact/Body rather than refusing to apply the damage.
	const outcome = await applyDamageWithCriticals({
		actor: target,
		damage: Number(woundsAmount ?? 0),
		damageType: effective.damageType ?? "Impact",
		location: effective.location ?? "",
	});
	if (message) {
		await message.update({
			flags: {
				"rogue-trader": {
					damageApply: {
						...effective,
						wounds: woundsAmount,
						targetUuid,
						applied: true,
					},
				},
			},
		});
	}
	await postCriticalCard(
		target as unknown as { uuid?: string },
		outcome,
		{
			damageType: effective.damageType ?? "Impact",
			location: effective.location ?? "",
		},
	);
	ui.notifications?.info(
		game.i18n.format("DAMAGE.APPLIED", { wounds: outcome.woundsApplied }),
	);
}

/**
 * Roll damage from the to-hit card's button (owner redesign): reads the
 * damageRoll flag set at attack time, guards double-rolls via the
 * rolled marker, and delegates to the adapter's damage flow.
 */
async function rollDamageButton(button: HTMLButtonElement): Promise<void> {
	const messageEl = button.closest<HTMLElement>(".message");
	const messageId = messageEl?.dataset.messageId;
	const message = messageId
		? (foundry.documents.ChatMessage.get(messageId) as unknown as {
				flags?: Record<string, Record<string, unknown>>;
				update: (u: object) => Promise<void>;
			})
		: undefined;
	const data = message?.flags?.["rogue-trader"]?.damageRoll as
		| {
				attackerUuid?: string;
				weaponUuid?: string;
				targetUuid?: string | null;
				rolled?: boolean;
		  }
		| undefined;
	if (!message || !data || data.rolled) return;
	button.disabled = true;
	await rollDamageForCard(data as never);
	await message.update({
		flags: {
			"rogue-trader": {
				damageRoll: { ...data, rolled: true },
			},
		},
	});
}

/**
 * System statuses (bead q1ql, p0af): transient conditions (Shock/Fear
 * outcomes, Stunned, On Fire...) as Foundry-native token markers. The pure
 * registry lives in rules/conditions.ts; carried as ActiveEffects whose
 * system.testModifier change the funnel's "effect" contributor already
 * consumes. REPLACES the core defaults wholesale (p0af): the stock
 * D&D-flavoured statuses have no meaning here and clutter the HUD; our
 * "unconscious"/"stunned" ids intentionally shadow the core ones.
 */
function registerSystemStatuses(): void {
	(CONFIG as unknown as { statusEffects?: unknown[] }).statusEffects =
		SYSTEM_STATUSES.map((status) => ({
			id: status.id,
			name: game.i18n?.localize(status.labelKey) ?? status.id,
			img: STATUS_IMG[status.id] ?? "icons/svg/aura.svg",
			statuses: [status.id],
		}));
}

export function sheetInit() {
	Hooks.once("init", () => {
		attachRegistriesToConfig();
		registerSharedPartials();
		registerSystemStatuses();

		// Public roll API for modules/macros (bead mvu2): the full roll set
		// plus performRoll for module-defined request kinds.
		const git = game as unknown as { rogueTrader?: Record<string, unknown> };
		git.rogueTrader ??= {};
		git.rogueTrader.performRoll = performRoll;
		git.rogueTrader.rollTest = rollTest;
		git.rogueTrader.rollSkill = rollSkill;
		git.rogueTrader.rollSkillUntrained = rollSkillUntrained;
		git.rogueTrader.rollWeaponAttack = rollWeaponAttack;
		git.rogueTrader.rollPsychicPower = rollPsychicPower;
		git.rogueTrader.rollNavigatorPower = rollNavigatorPower;
		git.rogueTrader.rollFearTest = rollFearTest;
		git.rogueTrader.rollSnapOut = rollSnapOut;

		// Module extension point for test modifiers (funnel v2, see rules/funnel.ts).
		const rtc = CONFIG as unknown as {
			ROGUE_TRADER?: {
				testContributors?: typeof testContributors;
				talentEffectHandlers?: typeof talentEffectHandlers;
				homebrew?: { getProfile?: () => unknown };
				originTraits?: { getDefs?: () => unknown };
				madness?: { getRows?: () => unknown };
			};
		};
		rtc.ROGUE_TRADER ??= {};
		rtc.ROGUE_TRADER.testContributors = testContributors;
		rtc.ROGUE_TRADER.talentEffectHandlers = talentEffectHandlers;

		// Homebrew seam (bead 9if): world setting stores the house-rule
		// profile; the funnel reads it through this provider. GM-configurable
		// (Configure Settings -> Rogue Trader -> Homebrew profile JSON).
		game.settings?.register(game.system?.id ?? "rogue-trader", HOMEBREW_SETTING, {
			name: "HOMEBREW.PROFILE_NAME",
			hint: "HOMEBREW.PROFILE_HINT",
			scope: "world",
			config: true,
			type: String,
			default: "",
		});
		rtc.ROGUE_TRADER.homebrew = {
			getProfile: () =>
				parseHomebrewProfile(
					(game.settings as unknown as {
						get: (ns: string, key: string) => unknown;
					}).get(game.system?.id ?? "rogue-trader", HOMEBREW_SETTING),
				),
		};

		// Origin traits cache (bead tgq9): the funnel contributor is sync, so
		// pack definitions pre-warm at ready (commonSkillCatalog pattern).
		let originTraitDefs: OriginTraitDef[] = [];
		Hooks.once("ready", () => {
			getCharacterOptionDocs("origintrait").then((rawDocs) => {
				const docs = rawDocs as Array<foundry.documents.Item>;
				originTraitDefs = docs.map((doc) => {
					const s = doc.system as unknown as Record<string, unknown>;
					return {
						name: doc.name ?? "",
						originKey: String(s.originKey ?? ""),
						traitKey: String(s.traitKey ?? ""),
						kind: (String(s.kind ?? "note") as OriginTraitDef["kind"]),
						testKey: String(s.testKey ?? ""),
						value: Number(s.value ?? 0),
						grantKind: String(s.grantKind ?? ""),
						text: String(s.description ?? s.shortDescription ?? ""),
					};
				});
			});
		});
		rtc.ROGUE_TRADER.originTraits = {
			getDefs: () => originTraitDefs,
		};

		// Origin Path chart cache (epic 1gb7): the chart content lives in the
		// `origins` pack; warm the pure module's pool at ready so the creator
		// and sheet resolve entries synchronously.
		Hooks.once("ready", () => {
			getCharacterOptionDocs("origin").then((rawDocs) => {
				const docs = rawDocs as Array<foundry.documents.Item>;
				setOriginEntries(
					docs.map((doc) => {
						const s = doc.system as unknown as Record<string, unknown>;
						return {
							key: String(s.key ?? ""),
							row: String(s.row ?? "home-world") as OriginRow,
							col: Number(s.col ?? 0),
							name: doc.name ?? "",
							description: String(s.description ?? ""),
							effect: s.effect ? String(s.effect) : undefined,
							mechanics: (s.mechanics ?? {}) as OriginMechanics,
							variants: Array.isArray(s.variants)
								? (s.variants as OriginVariant[])
								: undefined,
						} as OriginEntry;
					}),
				);
			});
		});

		// Heirloom grant templates (Table 1-2, epic 1gb7 follow-up): the
		// per-heirloom grant payloads live in the `equipment` pack (bead n7hu);
		// warm the pure module's pool at ready.
		Hooks.once("ready", () => {
			getPackDocuments("rogue-trader.equipment").then((rawDocs) => {
				// The equipment pack also holds arms/gear; keep the heirloom types.
				const docs = (rawDocs as Array<foundry.documents.Item>).filter(
					(doc) => doc.type === "heirloom",
				);
				setHeirloomEntries(
					docs.map((doc) => {
						const s = doc.system as unknown as Record<string, unknown>;
						const range = (s.range ?? {}) as { low?: number; high?: number };
						const grant = (s.grant ?? {}) as Record<string, unknown>;
						return {
							key: String(s.key ?? ""),
							name: doc.name ?? "",
							range: [Number(range.low ?? 0), Number(range.high ?? 0)],
							table: s.table ? String(s.table) : undefined,
							grant: {
								kind: String(grant.kind ?? "pack-item") as HeirloomGrantKind,
								pack: grant.pack ? String(grant.pack) : undefined,
								item: grant.item ? String(grant.item) : undefined,
								craftsmanship: grant.craftsmanship
									? String(grant.craftsmanship)
									: undefined,
								rename: grant.rename ? String(grant.rename) : undefined,
								noteText: grant.noteText
									? String(grant.noteText)
									: undefined,
							},
						} satisfies HeirloomEntry;
					}),
				);
			});
		});

		// Ship & Warrant Path option pool (epic 1d2n): the chart content lives
		// in the `warrant` pack; warm the pure module's pool at ready so the
		// creator and the Dynasty sheet resolve options synchronously.
		Hooks.once("ready", () => {
			getPackDocuments("rogue-trader.warrant").then((rawDocs) => {
				const docs = (rawDocs as Array<foundry.documents.Item>).filter(
					(doc) => doc.type === "warrant-option",
				);
				setWarrantEntries(
					docs
						.map((doc) => {
							const s = doc.system as unknown as Record<string, unknown>;
							const mechanics = (s.mechanics ?? {}) as {
								shipPoints?: unknown;
								profitFactor?: unknown;
								notes?: unknown[];
							};
							return {
								key: String(s.key ?? ""),
								row: String(s.row ?? "") as WarrantRow,
								col: Number(s.col ?? 0),
								name: doc.name ?? "",
								description: String(s.description ?? ""),
								mechanics: {
									shipPoints: Number(mechanics.shipPoints ?? 0),
									profitFactor: Number(mechanics.profitFactor ?? 0),
									notes: (mechanics.notes ?? []).map(String),
								},
							} satisfies WarrantEntry;
						})
						.filter((entry) => entry.key && isWarrantRow(entry.row)),
				);
			});
		});

		// Madness track rows (epic 1g2t): the sheet's trauma/malignancy tests
		// read the track rows. Afflictions are owned Items (epic nt8k) whose
		// effects feed the item-effects funnel directly, so no def cache is
		// needed here any more.
		let madnessRows: Array<{
			kind: string;
			rollMin: number;
			rollMax: number;
			degree: string;
			modifier: number;
		}> = [];
		Hooks.once("ready", () => {
			getPackDocuments("rogue-trader.afflictions").then((madnessRaw) => {
				// The afflictions pack also holds mutations; keep the madness rows.
				const madnessDocs = (
					madnessRaw as Array<foundry.documents.Item>
				).filter((doc) => doc.type === "madnessentry");
				madnessRows = madnessDocs.map((doc) => {
					const s = doc.system as unknown as Record<string, unknown>;
					return {
						kind: String(s.kind ?? ""),
						rollMin: Number(s.rollMin ?? 0),
						rollMax: Number(s.rollMax ?? 999),
						degree: String(s.degree ?? ""),
						modifier: Number(s.modifier ?? 0),
					};
				});
			});
		});
		rtc.ROGUE_TRADER.madness = { getRows: () => madnessRows };

		// Data-driven document registration (bead 6a1x): one entry per document
		// type = { model, sheet, label }. The data-model loop feeds
		// CONFIG.*.dataModels; the sheet loop registers each sheet as
		// makeDefault via DocumentSheetConfig. Adding a type is one table line.
		// A type with no `sheet` registers its data model only (raw document
		// types: starship hull/complications/components, legacy "pc").
		//
		// Plain-Gear reuse (beads r7w, 5p8): compendium-sourced aptitudes and
		// the plain-Gear subtypes have no extra schema (all Gear fields have
		// initials) and reuse the Gear model + generic sheet so opening them
		// does not crash DocumentSheetConfig. (Pre-table these types were
		// registered twice with different labels; DocumentSheetConfig keys
		// registrations by scope + sheet class, so the later
		// ROGUE_TRADER.GEAR.SHEET label won — the table keeps that final state.)
		type SheetEntry = {
			model: unknown;
			sheet?: AnySheetCtor;
			label?: string;
		};
		const SHEET_REGISTRY: Record<
			"Item" | "Actor",
			Record<string, SheetEntry>
		> = {
			Item: {
				gear: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				"ranged-weapon": {
					model: RangedWeapon,
					sheet: WeaponSheet,
					label: "ROGUE_TRADER.WEAPON.SHEET",
				},
				"melee-weapon": {
					model: MeleeWeapon,
					sheet: WeaponSheet,
					label: "ROGUE_TRADER.WEAPON.SHEET",
				},
				armour: { model: Armour, sheet: ArmourSheet, label: "ROGUE_TRADER.ARMOUR.SHEET" },
				// Tau battlesuits (bead rojm): worn armour plus Hard Points, Size,
				// Strength, Primary Systems and a recommended loadout — the Tau
				// Character Guide profile block (printed p38). Rendered by the armour
				// sheet, which adds the battlesuit section for this type.
				battlesuit: {
					model: Battlesuit,
					sheet: ArmourSheet,
					label: "TYPES.Item.battlesuit",
				},
				// Tau battlesuit systems (bead i0dc): Primary/Support/Signature/Weapon
				// Systems, with the category Table 1-5 names and the Hard Point cost
				// the suit's budget is spent on.
				"battlesuit-system": {
					model: BattlesuitSystem,
					sheet: GearSheet,
					label: "TYPES.Item.battlesuit-system",
				},
				skill: { model: Skill, sheet: SkillSheet, label: "ROGUE_TRADER.SKILL.SHEET" },
				talent: { model: Talent, sheet: TalentSheet, label: "ROGUE_TRADER.TALENT.SHEET" },
				career: { model: Career, sheet: CareerSheet, label: "TYPES.Item.career" },
				// Starship hulls (bead 5lbn follow-up): dedicated hull sheet (the
				// statline + pre-installed component lists; the ship creator
				// instantiates those by name with loud failures).
				ship: { model: Starship, sheet: ShipHullSheet, label: "TYPES.Item.ship" },
				"ship-complication": {
					model: ShipComplication,
					sheet: ShipComplicationSheet,
					label: "TYPES.Item.ship-complication",
				},
				"ship-component": { model: ShipComponent, sheet: ShipComponentSheet, label: "TYPES.Item.ship-component" },
				"ship-weapon-component": { model: ShipWeaponComponent, sheet: ShipComponentSheet, label: "TYPES.Item.ship-weapon-component" },
				// Game reference tables (planet/system generation rows):
				// dedicated type so they are not plain Gear; attach to planet
				// actors as embedded documents.
				"game-table": { model: GameTable, sheet: GameTableSheet, label: "TYPES.Item.game-table" },
				// Compendium-sourced aptitudes are description-only items; reuse
				// the Gear model (all fields have initials) and its generic sheet
				// (bead r7w).
				aptitude: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				psychicpower: {
					model: PsychicPower,
					sheet: PsychicPowerSheet,
					label: "TYPES.Item.psychicpower",
				},
				// Navigator powers (bead sa6, Ch. VII): distinct type, no Focus
				// Power Test / Psy Rating / phenomena (book p178).
				navigatorpower: {
					model: NavigatorPower,
					sheet: NavigatorPowerSheet,
					label: "TYPES.Item.navigatorpower",
				},
				// Origin traits, mutations, madness, ammunition, force fields and
				// weapon modifications reuse the Gear model + generic sheet.
				origintrait: { model: OriginTrait, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				// Origin Path chart entries (epic 1gb7; moved out of rules/origins.ts).
				origin: { model: Origin, sheet: GearSheet, label: "TYPES.Item.origin" },
				"warrant-option": {
					model: WarrantOption,
					sheet: GearSheet,
					label: "TYPES.Item.warrant-option",
				},
				// Heirloom grant templates (Table 1-2, epic 1gb7 follow-up).
				heirloom: { model: Heirloom, sheet: GearSheet, label: "TYPES.Item.heirloom" },
				mutation: { model: Mutation, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				madnessentry: { model: MadnessEntry, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				// Rulebook traits (bead 25ii): innate creature features. Always
				// live in effectsAreLive (no equip state); mechanical traits feed
				// the funnel via their effect rows (bead zyv1).
				trait: { model: Trait, sheet: TraitSheet, label: "TYPES.Item.trait" },
				ammunition: { model: Ammunition, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				"force-field": { model: ForceField, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				"weapon-modification": {
					model: WeaponModification,
					sheet: GearSheet,
					label: "ROGUE_TRADER.GEAR.SHEET",
				},
				// Armour upgrades (bead dfb8, Hostile Acquisitions Table 2-17):
				// mirrors weapon-modification — Gear model + `upgrades` string.
				"armour-modification": {
					model: ArmourModification,
					sheet: GearSheet,
					label: "ROGUE_TRADER.GEAR.SHEET",
				},
				// No extra schema needed: reuse the Gear model for the plain-Gear
				// subtypes the packs reference (bead 5p8 scope note).
				tool: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				drug: { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
				"special-ability": { model: Gear, sheet: GearSheet, label: "ROGUE_TRADER.GEAR.SHEET" },
			},
			Actor: {
				// Legacy "pc": model kept until the ready-migration has run, no
				// sheet registration (bead ow8w deletes it post-migration).
				pc: { model: Character },
				// "explorer" = the character type (owner: rename of the legacy
				// DH2 "acolyte" and the creator-made "pc"); pc is migrated at
				// ready (ow8w) but keeps its dataModel until the migration has run.
				explorer: {
					model: Character,
					sheet: CharacterSheet,
					label: "ROGUE_TRADER.CHARACTER.SHEET",
				},
				npc: { model: Character, sheet: NpcSheet, label: "NPC.SHEET" },
				vehicle: { model: Vehicle, sheet: VehicleSheet, label: "ROGUE_TRADER.VEHICLE.SHEET" },
				// Group record for Profit Factor / Ship Points (bead gjvg).
				dynasty: { model: Dynasty, sheet: DynastySheet, label: "DYNASTY.SHEET" },
				// Starship actor (bead kwd): dedicated starship sheet.
				starship: { model: StarshipActor, sheet: ShipSheet, label: "STARSHIP.SHEET" },
				// Planet actor (owner ask, planet tables): SOI world record.
				planet: { model: PlanetActor, sheet: PlanetSheet, label: "TYPES.Actor.planet" },
			},
		};
		for (const [type, entry] of Object.entries(SHEET_REGISTRY.Item)) {
			(CONFIG.Item.dataModels as unknown as Record<string, unknown>)[type] =
				entry.model;
		}
		for (const [type, entry] of Object.entries(SHEET_REGISTRY.Actor)) {
			(CONFIG.Actor.dataModels as unknown as Record<string, unknown>)[type] =
				entry.model;
		}
		registerConfigHelper();

		const registerSheet = (
			documentClass:
				| typeof foundry.documents.Item
				| typeof foundry.documents.Actor,
			 sheet: AnySheetCtor,
			 types: [string, ...string[]],
			 label: string,
		) => {
			foundry.applications.apps.DocumentSheetConfig.registerSheet(
				documentClass,
				game.system?.id ?? "rogue-trader",
				sheet as never,
				{
					types,
					makeDefault: true,
					label,
				},
			);
		};
		for (const documentClass of [
			foundry.documents.Item,
			foundry.documents.Actor,
		] as const) {
			const className = documentClass.name as "Item" | "Actor";
			for (const [type, entry] of Object.entries(
				SHEET_REGISTRY[className],
			)) {
				if (!entry.sheet) continue;
				registerSheet(
					documentClass,
					entry.sheet,
					[type],
					entry.label ?? `TYPES.${className}.${type}`,
				);
			}
		}
		// Apply-damage button on attack damage cards (bead ncc): an
		// adapter-layer action that consumes the displayed outcome - the flag
		// carries the computed wounds; nothing is recomputed here. Delegated
		// listener (registered once) so it works regardless of which chat
		// render hook fires.
		Hooks.once("ready", () => {
			document.body.addEventListener("click", (event) => {
				const target = event.target as HTMLElement | null;
				const applyButton = target?.closest<HTMLButtonElement>(
					"button.apply-damage",
				);
				if (applyButton) {
					if (!applyButton.disabled) {
						applyDamageFromCard(applyButton).catch((error) =>
							console.error("rogue-trader: apply-damage failed", error),
						);
					}
					return;
				}
				// Manual damage roll from the to-hit card (owner redesign).
				const damageButton = target?.closest<HTMLButtonElement>(
					"button.rt-roll-damage",
				);
				if (!damageButton || damageButton.disabled) return;
				rollDamageButton(damageButton).catch((error) =>
					console.error("rogue-trader: damage roll failed", error),
				);
			});
		});

		// Pre-warm the skills pack for the createActor grant hook (the sheet
		// backfill path loads the pack on demand and does not need this cache).
		// Legacy character-type migration (bead ow8w): pc/acolyte -> explorer,
		// clone-recreate at ready (GM-only, logs old->new ids).
		Hooks.once("ready", () => {
			migrateLegacyActors()
				.catch((error) =>
					console.error(
						"rogue-trader | legacy-actor migration crashed:",
						error,
					))
				.finally(() => {
					// The legacy "pc" model must exist through boot (legacy documents
					// parse before ready) but must NOT keep being offered, so drop it
					// from the live config once the migration has run.
					const cfg = CONFIG as unknown as {
						Actor?: { dataModels?: Record<string, unknown> };
					};
					delete cfg.Actor?.dataModels?.pc;
					// Bead vnz3: deleting the dataModel does NOT rebuild the type
					// registry the Create Actor dropdown reads, so "pc" kept showing
					// up as a raw, unlocalised entry. The registry is
					// game.documentTypes (an ARRAY of names) — NOT
					// game.system.documentTypes (an object MAP), which is what the
					// previous code filtered behind an `Array.isArray` guard that
					// was therefore always false and silently did nothing. Strip the
					// legacy names from both, so either source is covered.
					const registry = game.documentTypes as unknown as
						| Record<string, unknown>
						| undefined;
					if (registry) {
						registry.Actor = withoutLegacyCharacterTypes(registry.Actor);
					}
					const system = game.system as unknown as {
						documentTypes?: Record<string, unknown>;
					};
					if (system.documentTypes) {
						system.documentTypes.Actor = withoutLegacyCharacterTypes(
							system.documentTypes.Actor,
						);
					}
				});
		});
		Hooks.once("ready", () => {
			getCharacterOptionDocs("skill").then((rawDocs) => {
				const docs = rawDocs as Array<foundry.documents.Item>;
				commonSkillCatalog = docs.map(
					(doc) =>
						doc.toObject() as {
							type: string;
							name: string;
							system: {
								common?: boolean;
								characteristic: string;
								ladder: number;
							};
						},
				);
			});
		});

		Hooks.on("createActor", async (actor, _options, userId) => {
			// Only the creating user embeds the grants (avoids double-fire).
			if (userId !== (game as { userId?: string }).userId) return;
			if (actor.type !== "explorer" && actor.type !== "npc") return;
			// Only brand-new blank actors: NPC statblocks and compendium imports
			// come with items and must not receive defaults.
			if (actor.items.size > 0) return;
			if (commonSkillCatalog.length === 0) return;
			// Race-safe vs the sheet backfill: skip skills the actor already has
			// (TOCTOU on items.size when both paths run near-simultaneously).
			const grants = missingSkillGrants(
				commonSkillCatalog,
				actor.items.map((i) => i.name ?? ""),
			);
			if (grants.length === 0) return;
			const grantPromise = actor.createEmbeddedDocuments("Item", grants);
			// Creator flow waits for the defaults before its own merge (bead
			// t093: Actor.create resolves before async hook handlers finish).
			trackDefaultGrants(actor.uuid ?? "", grantPromise);
			await grantPromise;
		});

		// Character creator (bead ay0): "Create Explorer (Origin Path)" entry
		// on the Actors directory ENTRY context menu (right-click an actor).
		// Foundry v13/v14 (AppV2 sidebar): per-Document hook is
		// `getActorContextOptions` (getDocumentContextOptions pattern); the
		// generic per-class hook is `getEntryContextAbstractSidebarTab` and
		// the legacy cores use `getActorDirectoryEntryContext`. Register all
		// three defensively — the callback ignores its arguments, so a double
		// fire (if two names exist on one core) is harmless: it only pushes
		// into whatever array the firing hook passed.
		// Permission model (bead ay0): each creator entry is offered ONLY on
		// its own actor type (per-target condition below, bead ugd2) and opens
		// that actor in update-in-place mode, which needs no actor-creation
		// permission. The canCreateActors guard is kept as a defensive
		// fallback (unreachable while the condition resolves).
		// Hoisted above both menu entries (bead 9cre follow-up) so the ship
		// creator's entry shares the same check.
		const user = game.user as unknown as {
			isGM?: boolean;
			hasPermission?: (p: string) => boolean;
		};
		// The context menu builds one array shared across entries, so the
		// element check happens at callback time, not menu-build time.
		const canCreateActors = Boolean(
			user?.isGM || user?.hasPermission?.("ACTOR_CREATE"),
		);
		const creatorEntry = (
			_app: unknown,
			entryOptions: DirectoryEntryOption[],
		) => {
			entryOptions.push({
				label: "CREATOR.MENU",
				icon: "fa-solid fa-user-plus",
				// Offered ONLY on Explorer entries (bead ugd2).
				condition: (element?: HTMLElement) =>
					resolveEntryActor(element)?.type === "explorer",
				// v14 ContextMenuCallback: onClick(event, target) — the first
				// arg is the PointerEvent, the second is the element the menu
				// was triggered for (core source foundry.mjs ContextMenuCallback).
				onClick: (_event?: PointerEvent, element?: HTMLElement) => {
					// condition guarantees an Explorer entry, so the creator updates
					// that actor in place. The permission guard is a defensive
					// fallback only (unreachable while the condition holds).
					const candidate = resolveEntryActor(element);
					const actor = (
						candidate?.system as { characteristics?: unknown } | undefined
					)?.characteristics
						? candidate
						: undefined;
					if (!actor && !canCreateActors) {
						ui.notifications?.warn(
							game.i18n!.localize("CREATOR.NO_CREATE_PERMISSION"),
						);
						return;
					}
					new CharacterCreator({
						actor,
					} as never).render({ force: true } as never);
				},
			});
		};
		const hooksOn = Hooks as unknown as {
			on: (name: string, fn: unknown) => void;
		};
		hooksOn.on("getActorContextOptions", creatorEntry);
		hooksOn.on("getEntryContextAbstractSidebarTab", creatorEntry);
		hooksOn.on("getActorDirectoryEntryContext", creatorEntry);

		// Ship creator (bead 9cre): "Create Ship (wizard)" on the Actors
		// directory menu, mirroring the character-creator entry. Offered ONLY
		// on Starship entries (bead ugd2); opens in update-in-place mode.
		const shipCreatorEntry = (
			_app: unknown,
			entryOptions: DirectoryEntryOption[],
		) => {
			entryOptions.push({
				label: "SHIP_CREATOR.MENU",
				icon: "fa-solid fa-rocket",
				condition: (element?: HTMLElement) =>
					resolveEntryActor(element)?.type === "starship",
				onClick: (_event?: PointerEvent, element?: HTMLElement) => {
					const actor = resolveEntryActor(element);
					const isStarship = actor && (actor.type as string) === "starship";
					if (!isStarship && !canCreateActors) {
						ui.notifications?.warn(
							game.i18n!.localize("CREATOR.NO_CREATE_PERMISSION"),
						);
						return;
					}
					new ShipCreator({
						actor: isStarship ? actor : undefined,
					} as never).render({ force: true } as never);
				},
			});
		};
		hooksOn.on("getActorContextOptions", shipCreatorEntry);
		hooksOn.on("getEntryContextAbstractSidebarTab", shipCreatorEntry);
		hooksOn.on("getActorDirectoryEntryContext", shipCreatorEntry);

		// Planet creator (owner ask, planet tables): "Create Planet (wizard)"
		// on the Actors directory menu, same model as the ship creator.
		// Offered ONLY on Planet entries (bead ugd2); opens in place.
		const planetCreatorEntry = (
			_app: unknown,
			entryOptions: DirectoryEntryOption[],
		) => {
			entryOptions.push({
				label: "PLANET_CREATOR.MENU",
				icon: "fa-solid fa-globe",
				condition: (element?: HTMLElement) =>
					resolveEntryActor(element)?.type === "planet",
				onClick: (_event?: PointerEvent, element?: HTMLElement) => {
					const actor = resolveEntryActor(element);
					const isPlanet = actor && (actor.type as string) === "planet";
					if (!isPlanet && !canCreateActors) {
						ui.notifications?.warn(
							game.i18n!.localize("CREATOR.NO_CREATE_PERMISSION"),
						);
						return;
					}
					new PlanetCreator({
						actor: isPlanet ? actor : undefined,
					} as never).render({ force: true } as never);
				},
			});
		};
		hooksOn.on("getActorContextOptions", planetCreatorEntry);
		hooksOn.on("getEntryContextAbstractSidebarTab", planetCreatorEntry);
		hooksOn.on("getActorDirectoryEntryContext", planetCreatorEntry);

		// Ship & Warrant Path creator (epic 1d2n, bead d7a9): "Create Warrant"
		// on the Actors directory menu, offered ONLY on Dynasty entries (bead
		// ugd2 gate). Writes the picks + summed SP/PF onto that dynasty.
		const warrantCreatorEntry = (
			_app: unknown,
			entryOptions: DirectoryEntryOption[],
		) => {
			entryOptions.push({
				label: "WARRANT_CREATOR.MENU",
				icon: "fa-solid fa-scroll",
				condition: (element?: HTMLElement) =>
					resolveEntryActor(element)?.type === "dynasty",
				onClick: (_event?: PointerEvent, element?: HTMLElement) => {
					const actor = resolveEntryActor(element);
					const isDynasty = actor && (actor.type as string) === "dynasty";
					if (!isDynasty && !canCreateActors) {
						ui.notifications?.warn(
							game.i18n!.localize("CREATOR.NO_CREATE_PERMISSION"),
						);
						return;
					}
					new WarrantCreator({
						actor: isDynasty ? actor : undefined,
					} as never).render({ force: true } as never);
				},
			});
		};
		hooksOn.on("getActorContextOptions", warrantCreatorEntry);
		hooksOn.on("getEntryContextAbstractSidebarTab", warrantCreatorEntry);
		hooksOn.on("getActorDirectoryEntryContext", warrantCreatorEntry);
	});
}

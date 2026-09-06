import { Character } from "../data/actor/character";
import { Vehicle } from "../data/actor/vehicle";
import { Ammunition } from "../data/item/ammunition";
import { Armour } from "../data/item/armour";
import { ForceField } from "../data/item/force-field";
import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { PsychicPower } from "../data/item/psychic-power";
import { NavigatorPower } from "../data/item/navigator-power";
import { OriginTrait } from "../data/item/origin-trait";
import { Mutation } from "../data/item/mutation";
import { MadnessEntry } from "../data/item/madness";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { Skill } from "../data/item/skill";
import { Talent } from "../data/item/talent";
import { Career } from "../data/item/career";
import { Starship, ShipComplication } from "../data/item/starship";
import {
	ShipComponent,
	ShipWeaponComponent,
} from "../data/item/ship-component";
import { WeaponModification } from "../data/item/weapon-modification";
import { attachRegistriesToConfig } from "../registry";
import { migrateLegacyActors } from "../migrations";
import { rollDamageForCard, rollSkill, rollTest } from "../rules/adapter";
import { missingSkillGrants } from "../rules/default-skills";
import { testContributors } from "../rules/funnel";
import {
	HOMEBREW_SETTING,
	parseHomebrewProfile,
} from "../rules/homebrew";
import type { OriginTraitDef } from "../rules/origin-traits";
import { talentEffectHandlers } from "../rules/talent-effects";
import { CharacterSheet } from "./actor/character-sheet";
import { CharacterCreator } from "./actor/character-creator";
import { VehicleSheet } from "./actor/vehicle-sheet";
import { DynastySheet } from "./actor/dynasty-sheet";
import { Dynasty } from "../data/actor/dynasty";
import { StarshipActor } from "../data/actor/starship-actor";
import { ShipSheet } from "./actor/ship-sheet";
import { NpcSheet } from "./actor/npc-sheet";
import { registerConfigHelper } from "./handlebars";
import { ArmourSheet } from "./item/armour-sheet";
import { GearSheet } from "./item/gear-sheet";
import { PsychicPowerSheet } from "./item/psychic-power-sheet";
import { NavigatorPowerSheet } from "./item/navigator-power-sheet";
import { SkillSheet } from "./item/skill-sheet";
import { TalentSheet } from "./item/talent-sheet";
import { CareerSheet } from "./item/career-sheet";
import { WeaponSheet } from "./item/weapon-sheet";
import { registerSharedPartials } from "./partials";
import { getPackDocuments } from "./pack-resolve";
import { trackDefaultGrants } from "./default-grants";

type AnySheetCtor = new (...args: unknown[]) => object;

let commonSkillCatalog: object[] = [];

interface DamageApplyFlag {
	wounds?: number;
	targetUuid?: string;
	applied?: boolean;
}

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

	const current = Number(wounds.value ?? 0);
	const applied = Math.min(Number(woundsAmount ?? 0), current);
	const next = Math.max(0, current - applied);
	button.disabled = true;
	await target.update({ system: { wounds: { value: next } } });
	if (message) {
		await message.update({
			flags: {
				"rogue-trader": {
					damageApply: {
						...existing,
						wounds: woundsAmount,
						targetUuid,
						applied: true,
					},
				},
			},
		});
	}
	ui.notifications?.info(
		game.i18n.format("DAMAGE.APPLIED", { wounds: applied }),
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

export function sheetInit() {
	Hooks.once("init", () => {
		attachRegistriesToConfig();
		registerSharedPartials();

		// Public roll API for modules/macros: game.rogueTrader.rollTest(actor, key, opts)
		const git = game as unknown as { rogueTrader?: Record<string, unknown> };
		git.rogueTrader ??= {};
		git.rogueTrader.rollTest = rollTest;
		git.rogueTrader.rollSkill = rollSkill;

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
			getPackDocuments("rogue-trader.origin-traits").then((rawDocs) => {
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

		CONFIG.Item.dataModels.gear = Gear;
		CONFIG.Item.dataModels["ranged-weapon"] = RangedWeapon;
		CONFIG.Item.dataModels["melee-weapon"] = MeleeWeapon;
		CONFIG.Item.dataModels.armour = Armour;
		CONFIG.Item.dataModels.skill = Skill;
		CONFIG.Item.dataModels.talent = Talent;
		CONFIG.Item.dataModels.career = Career;
		// Starship hulls + complications (bead sl31, Chapter VIII).
		CONFIG.Item.dataModels.ship = Starship;
		CONFIG.Item.dataModels["ship-complication"] = ShipComplication;
		CONFIG.Item.dataModels["ship-component"] = ShipComponent;
		CONFIG.Item.dataModels["ship-weapon-component"] = ShipWeaponComponent;
		// Compendium-sourced aptitudes are description-only items; reuse the
		// Gear model (all fields have initials) and its generic sheet so opening
		// them does not crash DocumentSheetConfig (bead r7w).
		CONFIG.Item.dataModels.aptitude = Gear;
		CONFIG.Item.dataModels.psychicpower = PsychicPower;
		// Navigator powers (bead sa6, Ch. VII): distinct type, no Focus Power
		// Test / Psy Rating / phenomena (book p178).
		CONFIG.Item.dataModels.navigatorpower = NavigatorPower;
		CONFIG.Item.dataModels.origintrait = OriginTrait;
		CONFIG.Item.dataModels.mutation = Mutation;
		CONFIG.Item.dataModels.madness = MadnessEntry;
		CONFIG.Item.dataModels.ammunition = Ammunition;
		CONFIG.Item.dataModels["force-field"] = ForceField;
		CONFIG.Item.dataModels["weapon-modification"] = WeaponModification;
		// No extra schema needed: reuse the Gear model for the plain-Gear
		// subtypes the packs reference (bead 5p8 scope note).
		CONFIG.Item.dataModels.tool = Gear;
		CONFIG.Item.dataModels.drug = Gear;
		CONFIG.Item.dataModels["special-ability"] = Gear;
		CONFIG.Actor.dataModels.pc = Character;
		// "explorer" = the character type (owner: rename of the legacy DH2
		// "acolyte" and the creator-made "pc"); pc is migrated at ready (ow8w)
		// but keeps its dataModel until the migration has run.
		CONFIG.Actor.dataModels.explorer = Character;
		CONFIG.Actor.dataModels.npc = Character;
		CONFIG.Actor.dataModels.vehicle = Vehicle;
		// Group record for Profit Factor / Ship Points (bead gjvg).
		CONFIG.Actor.dataModels.dynasty = Dynasty;
		// Starship actor (bead kwd): dedicated starship sheet.
		CONFIG.Actor.dataModels.starship = StarshipActor;
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

		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			["gear"],
			"ROGUE_TRADER.GEAR.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			WeaponSheet as unknown as AnySheetCtor,
			["ranged-weapon", "melee-weapon"],
			"ROGUE_TRADER.WEAPON.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			ArmourSheet as unknown as AnySheetCtor,
			["armour"],
			"ROGUE_TRADER.ARMOUR.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			SkillSheet as unknown as AnySheetCtor,
			["skill"],
			"ROGUE_TRADER.SKILL.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			TalentSheet as unknown as AnySheetCtor,
			["talent"],
			"ROGUE_TRADER.TALENT.SHEET",
		);
		registerSheet(
			foundry.documents.Item,
			CareerSheet as unknown as AnySheetCtor,
			["career"],
			"TYPES.Item.career",
		);
		registerSheet(
			foundry.documents.Item,
			PsychicPowerSheet as unknown as AnySheetCtor,
			["psychicpower"],
			"TYPES.Item.psychicpower",
		);
		registerSheet(
			foundry.documents.Item,
			NavigatorPowerSheet as unknown as AnySheetCtor,
			["navigatorpower"],
			"TYPES.Item.navigatorpower",
		);
		// Origin traits: plain-Gear reuse (fields have initials) so opening
		// them does not crash DocumentSheetConfig (pattern of bead r7w).
		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			["origintrait"],
			"TYPES.Item.origintrait",
		);
		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			["mutation"],
			"TYPES.Item.mutation",
		);
		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			["madnessentry"],
			"TYPES.Item.madnessentry",
		);
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
		registerSheet(
			foundry.documents.Item,
			GearSheet as unknown as AnySheetCtor,
			[
				"aptitude",
				"ammunition",
				"force-field",
				"weapon-modification",
				"tool",
				"drug",
				"special-ability",
				"origintrait",
				"mutation",
				"madnessentry",
			],
			"ROGUE_TRADER.GEAR.SHEET",
		);

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
					// The create-actor dropdown lists dataModel keys, so the
					// legacy "pc" model keeps offering "Player Character". The
					// model must exist through boot (legacy docs parse before
					// ready) — drop it once migration has run, from both the
					// live config and any cached documentTypes list.
					const cfg = CONFIG as unknown as {
						Actor?: { dataModels?: Record<string, unknown> };
					};
					delete cfg.Actor?.dataModels?.pc;
					const system = game.system as unknown as {
						documentTypes?: Record<string, string[]>;
					};
					if (Array.isArray(system.documentTypes?.Actor)) {
						system.documentTypes.Actor = system.documentTypes.Actor.filter(
							(t) => t !== "pc" && t !== "acolyte",
						);
					}
				});
		});
		Hooks.once("ready", () => {
			getPackDocuments("rogue-trader.skills").then((rawDocs) => {
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
		registerSheet(
			foundry.documents.Actor,
			CharacterSheet as unknown as AnySheetCtor,
			["explorer"],
			"ROGUE_TRADER.CHARACTER.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			NpcSheet as unknown as AnySheetCtor,
			["npc"],
			"NPC.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			VehicleSheet as unknown as AnySheetCtor,
			["vehicle"],
			"ROGUE_TRADER.VEHICLE.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			DynastySheet as unknown as AnySheetCtor,
			["dynasty"],
			"DYNASTY.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			ShipSheet as unknown as AnySheetCtor,
			["starship"],
			"STARSHIP.SHEET",
		);

		// Character creator (bead ay0): "Create Explorer (Origin Path)" entry
		// on the Actors directory ENTRY context menu (right-click an actor).
		// Foundry v13/v14 (AppV2 sidebar): per-Document hook is
		// `getActorContextOptions` (getDocumentContextOptions pattern); the
		// generic per-class hook is `getEntryContextAbstractSidebarTab` and
		// the legacy cores use `getActorDirectoryEntryContext`. Register all
		// three defensively — the callback ignores its arguments, so a double
		// fire (if two names exist on one core) is harmless: it only pushes
		// into whatever array the firing hook passed.
		const creatorEntry = (
			_app: unknown,
			entryOptions: Array<{
				// v14: ContextMenuEntry#name is deprecated -> #label (the
				// "backwards-compatible support removed in v16" warning on
				// right-click, reported 2026-09-05).
				label: string;
				icon: string;
				callback: (element?: HTMLElement) => void;
			}>,
		) => {
			// Permission model (bead ay0): finishing the wizard creates a world
			// actor ONLY when opened without an actor target; opened on an
			// actor entry it UPDATES that actor in place, which needs no
			// actor-creation permission. So the entry is offered on actor
			// entries to everyone; the creation-only open (no actor resolved)
			// is limited to users who can create actors (GM, or players with
			// "Create New Actors") so players never hit the hard server error.
			const user = game.user as unknown as {
				isGM?: boolean;
				hasPermission?: (p: string) => boolean;
			};
			// The context menu builds one array shared across entries, so the
			// element check happens at callback time, not menu-build time.
			const canCreateActors = Boolean(
				user?.isGM || user?.hasPermission?.("ACTOR_CREATE"),
			);
			entryOptions.push({
				label: "CREATOR.MENU",
				icon: "fa-solid fa-user-plus",
				callback: (element?: HTMLElement) => {
					// When invoked from an actor entry, pre-load that actor so the
					// creator updates it in place instead of making a new one.
					// v14 entry markup carries data-entry-id (document-partial.hbs);
					// older cores used data-document-id.
					const entryEl = element?.closest<HTMLElement>(
						"[data-entry-id], [data-document-id]",
					);
					const resolvedId =
						entryEl?.dataset.entryId ??
						entryEl?.dataset.documentId ??
						element?.dataset?.documentId;
					const actor = resolvedId
						? ((game.actors as unknown as {
								get: (id: string) => unknown;
							}).get(resolvedId) as foundry.documents.Actor | undefined)
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
	});
}

import { Character } from "../data/actor/character";
import { Vehicle } from "../data/actor/vehicle";
import { Ammunition } from "../data/item/ammunition";
import { Armour } from "../data/item/armour";
import { ForceField } from "../data/item/force-field";
import { Gear } from "../data/item/gear";
import { MeleeWeapon } from "../data/item/melee-weapon";
import { PsychicPower } from "../data/item/psychic-power";
import { RangedWeapon } from "../data/item/ranged-weapon";
import { Skill } from "../data/item/skill";
import { Talent } from "../data/item/talent";
import { Career } from "../data/item/career";
import { WeaponModification } from "../data/item/weapon-modification";
import { attachRegistriesToConfig } from "../registry";
import { rollDamageForCard, rollSkill, rollTest } from "../rules/adapter";
import { defaultSkillItems } from "../rules/default-skills";
import { testContributors } from "../rules/funnel";
import { talentEffectHandlers } from "../rules/talent-effects";
import { CharacterSheet } from "./actor/character-sheet";
import { CharacterCreator } from "./actor/character-creator";
import { VehicleSheet } from "./actor/vehicle-sheet";
import { registerConfigHelper } from "./handlebars";
import { ArmourSheet } from "./item/armour-sheet";
import { GearSheet } from "./item/gear-sheet";
import { PsychicPowerSheet } from "./item/psychic-power-sheet";
import { SkillSheet } from "./item/skill-sheet";
import { TalentSheet } from "./item/talent-sheet";
import { CareerSheet } from "./item/career-sheet";
import { WeaponSheet } from "./item/weapon-sheet";

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
			};
		};
		rtc.ROGUE_TRADER ??= {};
		rtc.ROGUE_TRADER.testContributors = testContributors;
		rtc.ROGUE_TRADER.talentEffectHandlers = talentEffectHandlers;

		CONFIG.Item.dataModels.gear = Gear;
		CONFIG.Item.dataModels["ranged-weapon"] = RangedWeapon;
		CONFIG.Item.dataModels["melee-weapon"] = MeleeWeapon;
		CONFIG.Item.dataModels.armour = Armour;
		CONFIG.Item.dataModels.skill = Skill;
		CONFIG.Item.dataModels.talent = Talent;
		CONFIG.Item.dataModels.career = Career;
		// Compendium-sourced aptitudes are description-only items; reuse the
		// Gear model (all fields have initials) and its generic sheet so opening
		// them does not crash DocumentSheetConfig (bead r7w).
		CONFIG.Item.dataModels.aptitude = Gear;
		CONFIG.Item.dataModels.psychicpower = PsychicPower;
		CONFIG.Item.dataModels.ammunition = Ammunition;
		CONFIG.Item.dataModels["force-field"] = ForceField;
		CONFIG.Item.dataModels["weapon-modification"] = WeaponModification;
		// No extra schema needed: reuse the Gear model for the plain-Gear
		// subtypes the packs reference (bead 5p8 scope note).
		CONFIG.Item.dataModels.tool = Gear;
		CONFIG.Item.dataModels.drug = Gear;
		CONFIG.Item.dataModels["special-ability"] = Gear;
		CONFIG.Actor.dataModels.pc = Character;
		CONFIG.Actor.dataModels.npc = Character;
		CONFIG.Actor.dataModels.vehicle = Vehicle;
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
			],
			"ROGUE_TRADER.GEAR.SHEET",
		);

		// Pre-warm the skills pack for the createActor grant hook (the sheet
		// backfill path loads the pack on demand and does not need this cache).
		Hooks.once("ready", () => {
			const pack = game.packs.get("rogue-trader.skills");
			if (!pack) return;
			pack.getDocuments().then((docs) => {
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
			if (actor.type !== "pc" && actor.type !== "npc") return;
			// Only brand-new blank actors: NPC statblocks and compendium imports
			// come with items and must not receive defaults.
			if (actor.items.size > 0) return;
			if (commonSkillCatalog.length === 0) return;
			await actor.createEmbeddedDocuments(
				"Item",
				defaultSkillItems(commonSkillCatalog),
			);
		});
		registerSheet(
			foundry.documents.Actor,
			CharacterSheet as unknown as AnySheetCtor,
			["pc", "npc"],
			"ROGUE_TRADER.CHARACTER.SHEET",
		);
		registerSheet(
			foundry.documents.Actor,
			VehicleSheet as unknown as AnySheetCtor,
			["vehicle"],
			"ROGUE_TRADER.VEHICLE.SHEET",
		);

		// Character creator (bead ay0): "Create Explorer (Origin Path)" entry
		// on the Actors directory context menu. Hook name not yet in
		// fvtt-types' hook map — registered defensively.
		(Hooks as unknown as {
			on: (name: string, fn: (app: unknown, options: Array<{
				name: string;
				icon: string;
				callback: () => void;
			}>) => void) => void;
		}).on(
			"getActorDirectoryEntryContext",
			(_app, entryOptions) => {
				entryOptions.push({
					name: "CREATOR.MENU",
					icon: "fa-solid fa-user-plus",
					callback: () => {
						new CharacterCreator().render({ force: true } as never);
					},
				});
			},
		);
	});
}

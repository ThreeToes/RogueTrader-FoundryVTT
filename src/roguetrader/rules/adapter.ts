import type { Actor } from "fvtt-types/documents";
import { equipStateOf, systemOf } from "../data/accessors";
import {
	locationForHit,
	parseDamageFormula,
	resolveDamage,
	rtCore,
} from "../../rules-engine/src/index";
import { DamageType, normaliseDamageType } from "../data/item/damage-types";
import { bodyLocationLabelKey } from "./labels";
import {
	applyTearing,
	collectRollMechanicEffects,
	collectTalentDamageEffects,
} from "./talent-effects";
import type { DamageRollFlag } from "./chat-flags";
import { isWeaponType } from "../data/accessors";

/**
 * Thin Foundry adapter: the ONLY runtime Foundry-coupled rolling code.
 * Sheets/buttons call these; everything below this layer is pure kernel.
 *
 * Bead mvu2: the dialog -> funnel -> kernel -> card roll sequences moved to
 * rules/roll-system.ts (discriminated-union requests + handler registry);
 * this module keeps the damage pipeline (weapon damage rolls, apply-damage
 * flow) and re-exports the roll API for the established import paths.
 */
export {
	rollTest,
	rollSkill,
	rollSkillUntrained,
	rollWeaponAttack,
	rollPsychicPower,
	rollNavigatorPower,
	performRoll,
} from "./roll-system";
export type {
	RollRequest,
	RollKind,
	RollTestOptions,
	CharacteristicRollRequest,
	SkillRollRequest,
	WeaponRollRequest,
	PsychicRollRequest,
	NavigatorRollRequest,
} from "./roll-system";

/**
 * Quick damage roll from the sheet's weapon row: rolls a fresh d100 for the
 * hit location plus the weapon damage and posts the damage card directly
 * (no to-hit test). Carry gating matches rollWeaponAttack.
 */
export async function rollWeaponDamage(
	actor: Actor,
	weaponId: string,
): Promise<void> {
	const item = actor.items.get(weaponId);
	const type = item?.type as string | undefined;
	if (!item || !isWeaponType(type)) {
		ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
		return;
	}
	// Carry gating matches the to-hit attack gate.
	if (equipStateOf(item) !== "carried") {
		ui.notifications?.warn(
			game.i18n.format("ROLL.NOT_CARRIED", { weapon: item.name }),
		);
		return;
	}
	// Hit location needs a d100; a direct damage roll has no to-hit test, so
	// roll a throwaway d100 purely for the location table.
	const locationRoll = new foundry.dice.Roll("1d100");
	await locationRoll.evaluate();
	const target = (
		game as unknown as {
			user?: { targets?: Set<{ actor?: Actor }> };
		}
	).user?.targets
		?.values()
		?.next()?.value?.actor;
	await postWeaponDamage(
		actor,
		(target ?? actor) as Actor,
		item as foundry.documents.Item,
		locationRoll.total ?? 0,
	);
}

// DamageRollFlag moved to rules/chat-flags.ts (bead mvu2).

/**
 * Damage roll triggered from the to-hit card's button (owner redesign).
 * Consumes the flag data set at attack time; rolls the weapon's damage
 * formula, picks the hit location, resolves vs armour/toughness and
 * posts the damage card with the apply-damage button.
 */
export async function rollDamageForCard(data: DamageRollFlag): Promise<void> {
	const attacker = data.attackerUuid
		? (foundry.utils.fromUuidSync(data.attackerUuid) as unknown as Actor | null)
		: null;
	const weapon = data.weaponUuid
		? (foundry.utils.fromUuidSync(
				data.weaponUuid,
			) as unknown as foundry.documents.Item | null)
		: null;
	if (!attacker || !weapon) return;
	const target = data.targetUuid
		? (foundry.utils.fromUuidSync(data.targetUuid) as unknown as Actor | null)
		: null;
	await postWeaponDamage(
		attacker,
		(target ?? attacker) as Actor,
		weapon,
		data.hitRoll ?? 0,
		data.critical === true,
	);
}

/**
 * b02/1h2 damage handoff: roll the weapon's damage formula, determine hit
 * location from the to-hit tens digit, resolve via the kernel against the
 * target's worn armour and toughness bonus, and post the damage card. The
 * card is display-only - no HP mutation (apply-damage buttons later).
 *
 * Bead fjw: talent damage effects (kind "damage-flat" / "critical-damage",
 * e.g. Crushing Blow, Crack Shot) are collected from the attacker's owned
 * talents and fed into the kernel request; the card shows the breakdown.
 */
async function postWeaponDamage(
	attacker: Actor,
	target: Actor,
	weapon: foundry.documents.Item,
	hitRoll = 0,
	isCritical = false,
): Promise<void> {
	const weaponSys = weapon.system as unknown as {
		damage?: string;
		damageType?: string;
		penetration?: number;
	};
	// RT notation allows a trailing damage-type suffix ("1d10+4 E") which
	// Foundry's Roll parser rejects - strip it first (bead 6tr); the parsed
	// type also backfills weapons that never had the schema field set.
	const parsed = parseDamageFormula(weaponSys.damage || "1d5");
	const damageType =
		normaliseDamageType(weaponSys.damageType) ??
		parsed.type ??
		DamageType.Impact;
	const damageTypeLabelKey = `DAMAGE_TYPE.${damageType.toUpperCase()}_SHORT`;
	const { formula } = parsed;
	const damageRoll = new foundry.dice.Roll(formula);
	await damageRoll.evaluate();
	let damageTotal = damageRoll.total ?? 0;

	// Righteous Fury trigger (RT core, VERIFY wording): a natural 10 on a
	// damage die. Inspect the rolled dice terms - the kernel cannot see the
	// Foundry roll, so the trigger is reported as a boolean flag.
	const dieTerms =
		(
			damageRoll as unknown as {
				terms?: Array<{
					class?: string;
					faces?: number;
					results?: Array<{ result: number; discarded?: boolean }>;
				}>;
			}
		).terms ?? [];
	const righteousFuryTriggered = dieTerms.some(
		(term) =>
			term.class === "Die" &&
			term.faces === 10 &&
			(term.results ?? []).some((r) => !r.discarded && r.result === 10),
	);

	// Roll-mechanic weapon qualities (bead gci0): Tearing rolls one extra
	// damage die (lowest result discarded — book wording, NOT roll-twice);
	// Toxic/Blast are post-resolution prompts shown on the card.
	const mechanics = collectRollMechanicEffects(attacker, {
		weaponId: weapon.id ?? undefined,
		attackType: (weapon.type as string) === "melee-weapon" ? "melee-weapon" : "ranged-weapon",
	});
	const qualityNotes: string[] = [];
	if (mechanics.tearing) {
		const dieTerm = dieTerms.find(
			(term) => term.class === "Die" && (term.faces ?? 0) > 0,
		);
		const faces = dieTerm?.faces ?? 10;
		const baseResults = (dieTerm?.results ?? [])
			.filter((r) => !r.discarded)
			.map((r) => r.result);
		const extraRoll = new foundry.dice.Roll(`1d${faces}`);
		await extraRoll.evaluate();
		const extra = extraRoll.total ?? 0;
		const tearing = applyTearing(baseResults, extra, faces);
		if (tearing.added > 0) {
			damageTotal += tearing.added;
		}
		qualityNotes.push(
			game.i18n!.format("CHAT.QUALITY_TEARING", {
				discarded: tearing.discarded,
			}),
		);
	}
	if (mechanics.blast !== null) {
		qualityNotes.push(
			game.i18n!.format("CHAT.QUALITY_BLAST", { rating: mechanics.blast }),
		);
	}
	// Toxic is conditional on the hit actually wounding (book: "anyone that
	// takes Damage from a Toxic weapon, after reduction for Armour and
	// Toughness Bonus"); the note is added after resolveDamage below.

	const location = locationForHit(hitRoll ?? 0, rtCore);
	const wornArmour = target.items.filter(
		(i) =>
			(i.type as string) === "armour" &&
			equipStateOf(i) === "worn",
	);
	// Bead xof: primitive-armour rule inputs — armourPrimitive from the worn
	// armour's protectionType (any piece covering the location), weaponPrimitive
	// from the weapon's boolean field or its "primitive" special quality.
	const armourPrimitive = wornArmour.some((i) => {
		const sys = i.system as unknown as {
			protectionType?: string;
			armourAt(loc: string): number;
		};
		return sys.protectionType === "primitive" && sys.armourAt(location) > 0;
	});
	const weaponSys2 = weapon.system as unknown as {
		primitive?: boolean;
		special?: string[];
	};
	const weaponPrimitive =
		weaponSys2.primitive === true ||
		(weaponSys2.special ?? []).includes("primitive");
	const armourValue = Math.max(
		0,
		...wornArmour.map((i) =>
			(i.system as unknown as { armourAt(loc: string): number }).armourAt(
				location,
			),
		),
	);
	const toughnessBonus = Math.floor(
		((systemOf(target)).characteristics.t?.value ?? 0) /
			10,
	);

	// Talent damage effects (bead fjw): damage-flat joins the roll before
	// soak; critical-damage applies only when the to-hit was critical.
	// Both are item-sourced talent effects, condition-guarded via flags.
	const attackType =
		(weapon.type as string) === "melee-weapon" ? "melee-weapon" : "ranged-weapon";
	const talentDamage = collectTalentDamageEffects(attacker, {
		attackType,
		// Bead 2k5: the attacking weapon's own damage effects apply; note
		// the weapon item id is needed for per-item matching.
		weaponId: weapon.id ?? undefined,
	});
	// Card breakdown: flat damage always; critical-damage rows only on a
	// critical hit (they are gated in the kernel by isCritical).
	const damageContributors = isCritical
		? [...talentDamage.damage, ...talentDamage.critical]
		: [...talentDamage.damage];

	const damage = resolveDamage({
		roll: damageTotal,
		penetration: weaponSys.penetration ?? 0,
		// Bead xof: wire the primitive-armour rule through at runtime.
		weaponPrimitive,
		armourPrimitive,
		toughnessBonus,
		location,
		armourValue,
		flatDamage: talentDamage.damage.reduce(
			(sum, mod) => sum + mod.value,
			0,
		),
		criticalDamage: talentDamage.critical.reduce(
			(sum, mod) => sum + mod.value,
			0,
		),
		isCritical,
		righteousFuryTriggered,
		profile: rtCore,
	});

	const locationLabelKey = bodyLocationLabelKey(location);
	// Toxic (bead gci0, book wording): the Toughness-test prompt only when
	// the hit dealt damage after armour + Toughness reduction.
	if (mechanics.toxic && damage.wounds > 0) {
		qualityNotes.push(game.i18n!.localize("CHAT.QUALITY_TOXIC"));
	}
	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/rogue-trader/template/chat/damage.hbs",
		{
			title: `${attacker.name} → ${target.name} — ${weapon.name}`,
			hitSuccess: true,
			locationLabelKey,
			damageTypeLabelKey,
			damage,
			// Bead atx: talent damage contributors shown as breakdown rows.
			damageContributors,
			// Bead gci0: roll-mechanic quality notes (Tearing/Toxic/Blast);
			// Toxic only when the hit dealt damage after soak.
			qualityNotes,
			isCriticalHit: isCritical,
			targetUuid: target.uuid,
		},
	);

	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor: attacker }),
		content,
		// Apply-damage button data (bead ncc): the card stays a data-only
		// kernel consumer - the flag carries the displayed outcome so the
		// click handler never recomputes, plus an application marker so the
		// button cannot fire twice.
		flags: {
			"rogue-trader": {
				damageApply: {
					wounds: damage.wounds,
					targetUuid: target.uuid,
					applied: false,
				},
			},
		},
	});
}

/** Toggle a power in/out of the sustained list (bead sa6, book p157). */
export async function toggleSustainedPower(
	actor: Actor,
	itemUuid: string,
	itemName: string,
): Promise<void> {
	const system = systemOf(actor);
	const current = system.sustainedPowers ?? [];
	const sustained = current.some((p) => p.itemUuid === itemUuid);
	const next = sustained
		? current.filter((p) => p.itemUuid !== itemUuid)
		: [...current, { itemUuid, name: itemName }];
	await actor.update({ system: { sustainedPowers: next } });
}

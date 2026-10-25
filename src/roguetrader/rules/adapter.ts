import { messageFlagNamespace } from "../../ffg/application/chat-flags";
import type { ActorView } from "../../ffg/domain/model/actor";
import * as damageDice from "../../ffg/application/damage-dice";
import type {
	ConfigPort,
	Dice,
	DiceResult,
	I18n,
	Ports,
} from "../../ffg/application/ports";
import {
	type AttackProfile,
} from "../../ffg/domain/model/attack";
import { TEMPLATE_ROOT } from "../../ffg/domain/template-root";
import { actorView } from "../../ffg/infrastructure/foundry/actor-view";
import {
	type DamageRequest,
	locationForHit,
	type Modifier,
	parseDamageFormula,
	resolveDamage,
} from "../../rules-engine/index";
import { equipStateOf, systemOf } from "../data/accessors";
import {
	normaliseDamageType,
	DamageType,
} from "../data/item/damage-types";
import { chatCardTitleDoc } from "../presentation/chat-doc-links";
// Bead x4ly: `documentFromUuid` lives with the wrapper edge (presentation),
// which is the layer allowed to bind the Foundry resolution port; the adapter
// consumes it for the fired-ordnance resolution and re-exports it unchanged.
import { documentFromUuid } from "../presentation/damage-rolls";
import { type ArmourItemLike, armourValueAt } from "../sheet/actor/view-models";
import { postCard } from "./chat-flags";
import { effectiveProfile } from "./homebrew";
import { bodyLocationLabelKey, conditionLabel } from "./labels";
import {
	decrementQuantity,
	type FireMode,
	type RateOfFireLike,
	shotsForFireMode,
} from "./ordnance";
import {
	applyTearing,
	collectRollMechanicEffects,
	collectTalentDamageEffects,
	collectTargetTraitDamageEffects,
	type RollMechanics,
	type TalentDamageCollection,
	targetToughnessMultiplier,
} from "./talent-effects";
import { toxicActivates, toxicToughnessPenalty } from "./toxic";

export type {
	CharacteristicRollRequest,
	InitiativeRollRequest,
	NavigatorRollRequest,
	PsychicRollRequest,
	RollKind,
	RollRequest,
	RollTestOptions,
	ShipRepairRollRequest,
	ShipWeaponRollRequest,
	SkillRollRequest,
	WeaponRollRequest,
} from "./roll-system";
/**
 * Thin Foundry adapter: the ONLY runtime Foundry-coupled rolling code.
 * Sheets/buttons call these; everything below this layer is pure kernel.
 *
 * Bead mvu2: the dialog -> funnel -> kernel -> card roll sequences moved to
 * the roll pipeline (presentation/rolls/pipeline.ts, one handler per kind;
 * the request union + handler contract lives in the roll-contract.ts files
 * at ffg/application and rules level) — rules/roll-system.ts is now only a
 * compatibility shim re-exporting those. This module keeps the damage
 * pipeline (weapon damage rolls, apply-damage flow) and re-exports the roll
 * API for the established import paths.
 */
export {
	performRoll,
	rollAction,
	rollFearTest,
	rollInitiativeAction,
	rollNavigatorPower,
	rollPsychicPower,
	rollShipAction,
	rollShipRepair,
	rollShipSalvo,
	rollSkill,
	rollSkillUntrained,
	rollSnapOut,
	rollTest,
	rollToxicToughnessTest,
	rollWeaponAttack,
} from "./roll-system";

/**
 * Foundry-bound damage-roll wrappers (bead x4ly): `rollWeaponDamage`,
 * `rollDamageForCard` and `documentFromUuid` moved to
 * `presentation/damage-rolls.ts` — the wrapper edge is where binding the
 * global `getPorts()` belongs, so the adapter below takes a `Ports` value
 * instead of reading a global. Re-exported here so every established import
 * path (sheet/actor/shared-actions.ts, chat-actions.ts) keeps working.
 */
export {
	documentFromUuid,
	rollDamageForCard,
	rollWeaponDamage,
} from "../presentation/damage-rolls";

// DamageRollFlag moved to rules/chat-flags.ts (bead mvu2).
/**

/**
 * Ammo auto-consume funnel application (epic ui4b, bead 65sq): with the
 * toggle ON (ports.config.homebrew(), the same seam as the fire-mode bonus),
 * the fired ordnance's quantity is decremented by the shots spent THROUGH
 * the items port (loud-failure convention, bead c9s3 — a failed write
 * throws), via the shared decrementQuantity helper (bead 9b95 F1 — one
 * read/write/announce path for the auto-consume AND the manual −1 chip).
 *
 * "Shots spent" (bead 9b95 F6, book RoF semantics — Core Rulebook Tables
 * 5-5/5-6): single = 1; burst / full = the launcher's own rateOfFire value
 * when the attack context carries the mode (threaded from the to-hit dialog
 * onto the damageRoll flag); with NO mode available (the sheet quick-damage
 * path) it is 1 ONLY for a single-shot-only launcher, otherwise the consume
 * is REFUSED LOUDLY (ROLL.AMMO_ROF_UNRESOLVED + no write) — we never
 * silently consume 1 for a launcher whose printed RoF says otherwise.
 *
 * Permission posture (bead 9b95 F5): the write is the shooter's bookkeeping,
 * with the SAME gate as the manual −1 chip — port.permissions.canRoll on
 * the attacker (owner/GM; fails closed, bead qiuo). A NON-owner clicking the
 * damage button still rolls and posts the card (today's behaviour) but the
 * consume is SKIPPED: no write, no permission throw, no permanently
 * unrollable (dead) card.
 *
 * Returns false ONLY when the toggle is ON and the ordnance is exhausted
 * (quantity <= 0) or the item cannot resolve: the caller must refuse the hit
 * via the SAME warn-and-refuse path an unloaded launcher takes
 * (ROLL.LAUNCHER_UNLOADED). Every other "no" in here (toggle off, non-owner,
 * unresolvable RoF) still returns true — the damage rolls as before.
 */
async function consumeFiredOrdnance(
	// Bead x4ly: the whole port set is caller-bound (bound once in
	// postWeaponDamage), not a global getPorts() read.
	ports: Ports,
	attacker: Actor,
	profile: AttackProfile,
	fireMode: FireMode | null | undefined,
): Promise<boolean> {
	const fired = profile.fired;
	if (!fired?.uuid) return true;
	const effective = effectiveProfile(ports.config);
	if (!effective.ammoAutoConsume) return true;
	// F5 (bead 9b95): the ownership gate — a non-owner firing skips the
	// consume (no write, no card death); the damage itself still posts.
	if (!ports.permissions.canRoll(attacker)) return true;
	const item = documentFromUuid(fired.uuid) as {
		name?: string;
		system?: { quantity?: number };
		update?: (data: object) => Promise<void>;
	} | null;
	// Loud, not silent: the profile claims a fired item that no longer
	// resolves — refusing to pretend the shot was free (bead c9s3).
	if (typeof item?.update !== "function") {
		throw new Error(
			`consumeFiredOrdnance — fired item "${fired.uuid}" did not resolve to an updatable document; the shot was NOT consumed`,
		);
	}
	// The launcher's own RoF block rides the profile's source item (the fire
	// profile derives from the loaded ordnance, but RoF stays on the
	// launcher — bead 4obp).
	const rateOfFire = (
		profile.source as {
			system?: { rateOfFire?: RateOfFireLike };
		}
	).system?.rateOfFire;
	const shots = shotsForFireMode(fireMode, rateOfFire);
	if (shots === null) {
		// Loud refusal (bead 9b95 F6): the shots cannot be resolved honestly,
		// so the auto-consume is skipped — never a silent "1" for a burst
		// launcher. The damage still rolls (today's behaviour).
		ports.notify.warn("ROLL.AMMO_ROF_UNRESOLVED", {
			weapon: profile.name,
		});
		return true;
	}
	const next = await decrementQuantity(item, {
		onEmpty: "refuse",
		shots,
		weaponName: profile.name,
		ports: { notify: ports.notify, items: ports.items },
	});
	if (next === null) return false;
	// The damage card's usage chip renders straight from profile.fired —
	// keep the stamp in step with the write so the chip shows the
	// post-consume remainder rather than a stale pre-shot quantity.
	fired.quantity = next;
	return true;
}

/**
 * The damage type as carried on the profile/card (bead d3yc): the canonical
 * enum when the profile normalises, or the literal recovered from the parsed
 * notation suffix (rules-engine parseDamageFormula).
 */
type DamageTypeLike =
	| DamageType
	| "Energy"
	| "Impact"
	| "Rending"
	| "Explosive";

/**
 * Parsed damage notation for the card + the kernel roll (bead d3yc step,
 * formerly inlined in postWeaponDamage): RT notation allows a trailing
 * damage-type suffix ("1d10+4 E") which Foundry's Roll parser rejects —
 * strip it first (bead 6tr); the parsed type also backfills profiles that
 * never had a type set. A mutation attack may print ALTERNATIVES ("1d10+2 R
 * (or E)", Corrosive Bile p369): the first is the default and the rest are
 * surfaced on the card.
 */
function resolveDamageNotation(
	i18n: I18n,
	profile: AttackProfile,
): {
	damageType: DamageTypeLike;
	damageTypeLabelKey: string;
	damageTypeAlternatives: string;
	formula: string;
} {
	const parsed = parseDamageFormula(profile.damage || "1d5");
	const damageType =
		normaliseDamageType(profile.damageTypes[0]) ??
		parsed.type ??
		DamageType.Impact;
	const damageTypeLabelKey = `DAMAGE_TYPE.${damageType.toUpperCase()}_SHORT`;
	// A mutation attack can print damage-type ALTERNATIVES (Corrosive Bile,
	// Core p369: "1d10+2 R (or E)"). The card resolves against the first, so
	// the remaining choices are shown beside it rather than dropped silently.
	const damageAlternatives = profile.damageTypes.slice(1).filter(Boolean);
	const damageTypeAlternatives =
		damageAlternatives.length > 0
			? `${i18n.t("CHAT.DAMAGE_TYPE_OR")} ${damageAlternatives.join(" / ")}`
			: "";
	return {
		damageType,
		damageTypeLabelKey,
		damageTypeAlternatives,
		formula: parsed.formula,
	};
}

/**
 * Roll-mechanic quality step (bead d3yc, formerly inlined in
 * postWeaponDamage): Tearing rolls one extra damage die (lowest result
 * discarded — book wording, NOT roll-twice) and bumps the total; Blast,
 * unparryable and full-action restrictions are VISIBLE card notes — neither
 * restriction is enforced by the pipeline (the target's reaction stays a
 * manual decision), so it must be shown or the rule would be silently lost:
 * Corrosive Bile "can be dodged, but not parried" and "Using it is a full
 * action". Toxic is conditional on the hit actually wounding (book: "anyone
 * that takes Damage from a Toxic weapon, after reduction for Armour and
 * Toughness Bonus"); its note is added after resolveDamage (the gate is
 * toxicActivates, rules/toxic.ts).
 */
async function applyRollQualityMechanics(
	dice: Dice,
	i18n: I18n,
	damageRoll: DiceResult,
	mechanics: RollMechanics,
	profile: AttackProfile,
): Promise<{ damageTotal: number; qualityNotes: string[]; rolls: unknown[] }> {
	let damageTotal = damageRoll.total;
	const qualityNotes: string[] = [];
	// Bead wvkd: every die the step rolls is carried out for the card to
	// attach — the damage roll itself plus Tearing's extra die, so the
	// animation shows the dice the breakdown talks about.
	const rolls: unknown[] = [...(damageRoll.rolls ?? [])];
	if (mechanics.tearing) {
		// The DAMAGE die's results only (bead k98i): a mixed formula's other
		// terms are not damage dice, so Tearing must not discard one of them.
		const { faces, results: baseResults } = damageDice.tearingBase(damageRoll);
		const extra = await dice.roll(`1d${faces}`);
		const tearing = applyTearing(baseResults, extra.total, faces);
		if (tearing.added > 0) {
			damageTotal += tearing.added;
		}
		rolls.push(...(extra.rolls ?? []));
		qualityNotes.push(
			i18n.t("CHAT.QUALITY_TEARING", {
				discarded: tearing.discarded,
			}),
		);
	}
	if (mechanics.blast !== null) {
		qualityNotes.push(
			i18n.t("CHAT.QUALITY_BLAST", { rating: mechanics.blast }),
		);
	}
	// Printed attack restrictions (bead kam1).
	if (!profile.parryable) {
		qualityNotes.push(i18n.t("CHAT.ATTACK_UNPARRYABLE"));
	}
	if (profile.action === "full") {
		qualityNotes.push(i18n.t("CHAT.ATTACK_FULL_ACTION"));
	}
	return { damageTotal, qualityNotes, rolls };
}

/**
 * Righteous Fury extra damage dice (Core Rulebook pp249-250, bead 8ssh owner
 * decisions 2026-10-21): the kernel only FLAGS a triggering hit (damage.ts
 * docblock — the adapter resolves it), and the attacker rolls ONE additional
 * damage die (1d10 per the weapon) and adds it to the Damage total, looping
 * while the NEW die is a natural 10. Each extra die joins the total soaks
 * against Armour/Toughness normally (decision 2 — the re-resolution happens
 * at the call site). The vehicle path (Core Rulebook p218 — 1d5 on the
 * Vehicle Critical Hit Chart INSTEAD of the extra die) is OUT OF SCOPE here.
 */
async function rollRighteousFuryDice(dice: Dice): Promise<{
	added: number;
	rolls: unknown[];
}> {
	let added = 0;
	// Bead wvkd's contract: every die the step rolls rides out for the card to
	// attach, so Dice So Nice! animates exactly the dice the breakdown shows.
	const rolls: unknown[] = [];
	for (;;) {
		const extra = await dice.roll("1d10");
		added += extra.total;
		rolls.push(...(extra.rolls ?? []));
		// The loop condition rides the natural-10 trigger detector (bead k98i):
		// only a NEW die showing a natural 10 keeps the chain going.
		if (!damageDice.righteousFuryTriggered(extra)) break;
	}
	return { added, rolls };
}

/**
 * Target soak inputs (bead d3yc step, formerly inlined in postWeaponDamage):
 * the worn armour's value/primitive at the hit location, the weapon's
 * primitive input and the Toughness Bonus the kernel soaks against.
 *
 * Bead xof: primitive-armour rule inputs — armourPrimitive from the worn
 * armour's protectionType (any piece covering the location), weaponPrimitive
 * from the weapon's boolean field or its "primitive" special quality.
 *
 * Bead zyv1: target-side trait damage machinery. Unnatural Toughness (×N)
 * multiplies the TB; Machine is modelled in the pack as armour items and
 * needs no extra handling here. The multiplier rule lives in the rules layer
 * (targetToughnessMultiplier): max of the canonical characteristics.t.unnatural
 * field and the trait tb-multiplier effects, so the same book trait carried
 * both ways never double-counts.
 */
function collectTargetArmour(
	target: Actor,
	profile: AttackProfile,
	location: ReturnType<typeof locationForHit>,
): {
	armourValue: number;
	armourPrimitive: boolean;
	weaponPrimitive: boolean;
	toughnessBonus: number;
	traitReduction: Modifier[];
} {
	const wornArmour = target.items.filter(
		(i) => (i.type as string) === "armour" && equipStateOf(i) === "worn",
	);
	const armourPrimitive = wornArmour.some((i) => {
		const sys = i.system as unknown as {
			protectionType?: string;
			armourAt(loc: string): number;
		};
		return sys.protectionType === "primitive" && sys.armourAt(location) > 0;
	});
	const weaponPrimitive =
		profile.primitive ||
		profile.qualities.some((q) => q.toLowerCase() === "primitive");
	// Bead pbsv: the per-location AP max is shared with the sheet view model
	// (view-models.ts armourValueAt); the worn filter above stays here because
	// armourPrimitive needs the same subset.
	const armourValue = armourValueAt(
		wornArmour as unknown as ArmourItemLike[],
		location,
	);
	const naturalToughnessBonus = Math.floor(
		systemOf(target).effectiveCharacteristicValue("t") / 10,
	);
	// Bead nyns: ONE view for the target per soak step — the trait collection
	// and the multiplier read the same copy of the read model instead of the
	// whole inventory being rebuilt for each call.
	const view = actorView(target);
	const traitDamage = collectTargetTraitDamageEffects(view);
	const toughnessBonus =
		naturalToughnessBonus * targetToughnessMultiplier(view, traitDamage);
	return {
		armourValue,
		armourPrimitive,
		weaponPrimitive,
		toughnessBonus,
		traitReduction: traitDamage.reduction,
	};
}

/**
 * Attacker talent damage effects (bead fjw step, formerly inlined in
 * postWeaponDamage): damage-flat joins the roll before soak;
 * critical-damage applies only when the to-hit was critical. Both are
 * item-sourced talent effects, condition-guarded via flags.
 */
function collectAttackerTalentDamage(
	// Bead nyns: pure in the view — postWeaponDamage builds ONE attacker view
	// per damage roll and threads it here (and into collectRollMechanicEffects).
	attackerView: ActorView,
	profile: AttackProfile,
	// Bead gqz2: the to-hit dialog's condition flags (e.g. { charging: true }),
	// threaded via the damageRoll flag. Without them, guardPasses never saw a
	// flag on the damage channel and a guarded damage-flat row (e.g. "while
	// charging") was silently inert.
	conditionFlags?: Record<string, boolean>,
): TalentDamageCollection {
	return collectTalentDamageEffects(attackerView, {
		attackType: profile.attackType,
		// Bead 2k5: the attacking weapon's own damage effects apply; note
		// the item id is needed for per-item matching.
		weaponId: profile.id ?? undefined,
		...(conditionFlags ? { flags: conditionFlags } : {}),
	});
}

/**
 * Card posting step (bead d3yc, formerly inlined in postWeaponDamage): the
 * display-only damage card plus the apply-damage button flag so the click
 * handler never recomputes, plus an application marker so the button cannot
 * fire twice.
 */
async function postDamageCard(
	config: ConfigPort,
	i18n: I18n,
	attacker: Actor,
	target: Actor,
	profile: AttackProfile,
	card: {
		damage: ReturnType<typeof resolveDamage>;
		location: ReturnType<typeof locationForHit>;
		notation: {
			damageType: DamageTypeLike;
			damageTypeLabelKey: string;
			damageTypeAlternatives: string;
		};
		damageContributors: Modifier[];
		qualityNotes: string[];
		/** Evaluated damage dice to attach to the card (bead wvkd). */
		rolls: unknown[];
		toxicActivated: boolean;
		isCritical: boolean;
	},
): Promise<void> {
	const locationLabelKey = bodyLocationLabelKey(card.location);
	// Bead 0u0o: gqz2 threaded the to-hit dialog's condition flags into the
	// damage channel, which also put the raw registry slug on each guarded
	// contributor row (e.g. "(charging)" on the card). Resolve the label
	// through the same seam the TestDialog uses so the card shows a
	// human-readable condition; the template keeps rendering what it is
	// given. Kernel data above this point stays untouched — this is a
	// display-step rewrite only.
	const damageContributors = card.damageContributors.map((mod) =>
		mod.condition
			? { ...mod, condition: i18n.t(conditionLabel(mod.condition)) }
			: mod,
	);
	await postCard(
		attacker,
		`${TEMPLATE_ROOT}chat/damage.hbs`,
		{
			title: `${attacker.name} → ${target.name} — ${profile.name}`,
			// Bead qg4z: the weapon name (last title segment) links to its pack
			// doc; the attacker → target part stays plain text.
			titleDoc: await chatCardTitleDoc({
				prefix: `${attacker.name} → ${target.name} — `,
				name: profile.name,
				kind: "weapon",
			}),
			hitSuccess: true,
			locationLabelKey,
			damageTypeLabelKey: card.notation.damageTypeLabelKey,
			damageTypeAlternatives: card.notation.damageTypeAlternatives,
			damage: card.damage,
			// Bead atx: talent damage contributors shown as breakdown rows
			// (conditions localized for display — bead 0u0o).
			damageContributors,
			// Bead gci0: roll-mechanic quality notes (Tearing/Toxic/Blast);
			// Toxic only when the hit dealt damage after soak.
			qualityNotes: card.qualityNotes,
			// Bead d8bc: the Toughness-test prompt behind the damage-dealt
			// gate — the penalty is computed once (−5 per damage point) and
			// the button routes through the shared Test machinery.
			toxic: card.toxicActivated
				? {
						targetUuid: target.uuid,
						wounds: card.damage.wounds,
						penalty: toxicToughnessPenalty(card.damage.wounds),
						prompt: i18n.t("CHAT.TOXIC_PROMPT", {
							penalty: toxicToughnessPenalty(card.damage.wounds),
							wounds: card.damage.wounds,
						}),
					}
				: null,
			isCriticalHit: card.isCritical,
			targetUuid: target.uuid,
			// Bead 4obp: the usage chip — what fired + the remaining quantity
			// (the fired item's Gear.quantity), with the one-click spend button.
			// Manual tracking: the chip never auto-consumes (bead mrl4 owns that).
			fired: profile.fired ?? null,
		},
		// Apply-damage button data (bead ncc): the card stays a data-only
		// kernel consumer - the flag carries the displayed outcome so the
		// click handler never recomputes.
		{
			// Namespace from the profile (bead p7jv): RT's value is
			// "rogue-trader", so the wire format is unchanged.
			[messageFlagNamespace(config)]: {
				damageApply: {
					wounds: card.damage.wounds,
					targetUuid: target.uuid,
					applied: false,
					// Bead ks3k: the apply step converts damage past 0 Wounds into
					// Critical Damage, which needs the type and the hit location.
					damageType: String(card.notation.damageType ?? "Impact"),
					location: card.location,
				},
			},
		},
		// Bead wvkd: the evaluated damage dice (plus Tearing's extra die) ride
		// the message so the card is roll-type and Dice So Nice! animates it.
		card.rolls,
	);
}

/**
 * b02/1h2 damage handoff: roll the weapon's damage formula, determine hit
 * location by reversing the to-hit roll's digits and reading the resulting
 * value against the profile's Table 9-6 bands (locationForHit — a rolled 23
 * reads as "32", a body hit), resolve via the kernel against the
 * target's worn armour and toughness bonus, and post the damage card. The
 * card is display-only - no HP mutation (apply-damage buttons later).
 *
 * Bead fjw: talent damage effects (kind "damage-flat" / "critical-damage",
 * e.g. Crushing Blow, Crack Shot) are collected from the attacker's owned
 * talents and fed into the kernel request; the card shows the breakdown.
 *
 * Bead d3yc: decomposed into named steps (resolveDamageNotation,
 * applyRollQualityMechanics, collectTargetArmour, collectAttackerTalentDamage,
 * postDamageCard) — a pure restructuring, no behaviour change; `ports` is
 * bound once and reused. Bead x4ly: exported for the presentation wrappers
 * (rules/adapter re-exports their names the other way), which now take the
 * full port set.
 */
export async function postWeaponDamage(
	attacker: Actor,
	target: Actor,
	profile: AttackProfile,
	// Card damage: the to-hit roll feeds the location table. Sheet quick
	// damage: null — the throwaway 1d100 location die is rolled HERE, below
	// (bead 9b95 F7) so an exhausted launcher refuses without burning a die.
	hitRoll: number | null,
	// Bead x4ly: required — the ports param cannot legally follow an optional,
	// and both callers (the presentation wrappers) pass it explicitly.
	isCritical: boolean,
	// F6 (bead 9b95): the attack dialog's fire mode, threaded via the
	// damageRoll flag; absent on the sheet quick-damage path — then the
	// consume falls back to the launcher's RoF (single-shot-only = 1).
	fireMode: FireMode | null | undefined,
	// Bead gqz2: the to-hit dialog's condition flags, stamped onto the
	// damageRoll flag by the weapon handler's after-hook; the talent-damage
	// collector guards its rows on them. Absent on the sheet quick-damage
	// path (no dialog ran) — unguarded rows apply, guarded ones stay off.
	conditionFlags: Record<string, boolean> | undefined,
	// Bead x4ly: the whole port set is caller-bound — the presentation
	// wrappers bind the global, a second system binds its own — never a
	// getPorts() read from inside the rules layer.
	ports: Ports,
): Promise<void> {
	// Bead 4obp: an UNLOADED launcher has no damage of its own (the book
	// prints "—"; the profile carries damage from the loaded ordnance only).
	// Warn and refuse — no "—" garbage card, no prompt fallback (owner
	// decision, epic nlsh D5).
	if (profile.unusable) {
		ports.notify.warn("ROLL.LAUNCHER_UNLOADED", { weapon: profile.name });
		return;
	}
	// Epic ui4b (bead 65sq): both fire paths (card damage button + sheet quick
	// damage) converge HERE, where the profile already carries the fired
	// ordnance stamp (bead 4obp) — so the auto-consume write lives at this one
	// hook. A refusal (toggle ON, quantity exhausted) aborts the damage the
	// same way an unloaded launcher does.
	if (
		!(await consumeFiredOrdnance(
			ports,
			attacker,
			profile,
			fireMode,
		))
	)
		return;
	// Bead 9b95 F7: the sheet quick-damage path's throwaway 1d100 location
	// die is rolled only AFTER the consume/refuse gates — an exhausted
	// launcher refuses without burning a die.
	const resolvedHitRoll = hitRoll ?? (await ports.dice.roll("1d100")).total;
	// Step d3yc-1: the notation — suffix strip (bead 6tr), type normalise
	// and the card's type labels (see resolveDamageNotation).
	const notation = resolveDamageNotation(ports.i18n, profile);
	const damageRoll = await ports.dice.roll(notation.formula);
	// Righteous Fury trigger (RT core, VERIFY wording): a natural 10 on a
	// damage die. The dice port reports the terms, so the kernel need not see
	// a Foundry roll (bead k98i).
	const righteousFuryTriggered = damageDice.righteousFuryTriggered(damageRoll);
	// Roll-mechanic weapon qualities (bead gci0): Tearing rolls one extra
	// damage die (lowest result discarded — book wording, NOT roll-twice);
	// Toxic/Blast are post-resolution prompts shown on the card.
	// Bead nyns: the attacker's view is built ONCE per damage roll and
	// reused by collectAttackerTalentDamage below.
	const attackerView = actorView(attacker);
	const mechanics = collectRollMechanicEffects(attackerView, {
		weaponId: profile.id ?? undefined,
		attackType: profile.attackType,
		// The attacking profile's own qualities: a mutation attack carries
		// Tearing in its `attack.qualities`, not in a weapon system.special.
		special: profile.qualities,
	});
	// Step d3yc-2: quality mechanics on the roll — Tearing bumps the total
	// and Blast/unparryable/full-action become card notes (see
	// applyRollQualityMechanics).
	const {
		damageTotal: rolledDamageTotal,
		qualityNotes,
		rolls,
	} = await applyRollQualityMechanics(
		ports.dice,
		ports.i18n,
		damageRoll,
		mechanics,
		profile,
	);
	// Righteous Fury (bead 8ssh) re-resolves with the extra dice folded in,
	// so the damage total is mutable past this point.
	let damageTotal = rolledDamageTotal;

	// Bead yojf: the kernel profile resolves through ports.config.profile()
	// instead of a direct rtCore import, so a sibling module swaps one binding.
	const ruleProfile = ports.config.profile();
	const location = locationForHit(resolvedHitRoll ?? 0, ruleProfile);
	// Step d3yc-3: the target's soak inputs — worn armour value/primitive
	// flags and the (trait-multiplied) Toughness Bonus (see
	// collectTargetArmour).
	const soak = collectTargetArmour(target, profile, location);

	// Step d3yc-4: attacker talent damage effects (bead fjw): damage-flat
	// joins the roll before soak; critical-damage applies only when the to-hit
	// was critical; both are condition-guarded via flags (see
	// collectAttackerTalentDamage).
	const talentDamage = collectAttackerTalentDamage(
		attackerView,
		profile,
		conditionFlags,
	);
	// Card breakdown: flat damage always; critical-damage rows only on a
	// critical hit (they are gated in the kernel by isCritical); trait
	// damage-reduction rows always (they soak regardless of the hit type).
	const damageContributors = [
		...(isCritical ? talentDamage.critical : []),
		...talentDamage.damage,
		...soak.traitReduction,
	];

	const damageRequest: DamageRequest = {
		roll: damageTotal,
		penetration: profile.penetration,
		// Bead xof: wire the primitive-armour rule through at runtime.
		weaponPrimitive: soak.weaponPrimitive,
		armourPrimitive: soak.armourPrimitive,
		toughnessBonus: soak.toughnessBonus,
		location,
		armourValue: soak.armourValue,
		flatDamage: talentDamage.damage.reduce((sum, mod) => sum + mod.value, 0),
		flatReduction: soak.traitReduction.reduce((sum, mod) => sum + mod.value, 0),
		criticalDamage: talentDamage.critical.reduce(
			(sum, mod) => sum + mod.value,
			0,
		),
		isCritical,
		righteousFuryTriggered,
		profile: ruleProfile,
	};
	// First pass: base damage, no Righteous Fury dice. The kernel's flag is
	// the trigger gate (enabled + triggered + the hit actually damaged — the
	// profile's "damaging-hit" trigger), so nothing rolls when the hit is
	// fully soaked or the damage.righteousFury knob is OFF (bead 8ssh decision
	// 5: off suppresses the whole effect, on produces it).
	let damage = resolveDamage(damageRequest);
	if (damage.righteousFury) {
		// Bead 8ssh (Core Rulebook pp249-250): the extra damage die(s) join the
		// total BEFORE the re-resolution (decision 2), so they soak against
		// armour/Toughness normally; the added amount is a visible contributor
		// row, the confirming second attack roll is GM-called (decision 3 —
		// no auto-confirm is built), and the vehicle path (p218) stays out of
		// scope (decision 4; see rollRighteousFuryDice).
		const fury = await rollRighteousFuryDice(ports.dice);
		damageTotal += fury.added;
		rolls.push(...fury.rolls);
		damageRequest.roll = damageTotal;
		damage = resolveDamage(damageRequest);
		damageContributors.push({
			id: "righteous-fury",
			source: { type: "effect", label: "CHAT.RIGHTEOUS_FURY" },
			label: ports.i18n.t("CHAT.RIGHTEOUS_FURY"),
			value: fury.added,
		});
		qualityNotes.push(ports.i18n.t("CHAT.RIGHTEOUS_FURY_GM_CALLED"));
	}

	// Step d3yc-5: the toxic gate + the card (see postDamageCard). Toxic
	// (beads gci0 + d8bc, owner rule text): the Toughness-test gate only
	// when the hit dealt damage after Armour + Toughness reduction (zero
	// damage = no poison); the GM-facing note is the CHAT.QUALITY_TOXIC line
	// (1d10 Impact, no reduction — Core Rulebook printed p117; per-toxin
	// extras stay GM-facing prose).
	const toxicActivated = toxicActivates(mechanics.toxic, damage.wounds);
	if (toxicActivated) {
		qualityNotes.push(ports.i18n.t("CHAT.QUALITY_TOXIC"));
	}
	await postDamageCard(ports.config, ports.i18n, attacker, target, profile, {
		damage,
		location,
		notation,
		damageContributors,
		qualityNotes,
		// Bead wvkd: the dice behind the card's numbers, so Dice So Nice! can
		// animate them.
		rolls,
		toxicActivated,
		isCritical,
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

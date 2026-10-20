import { equipStateOf, ownedItemResolver, systemOf } from "../data/accessors";
import {
	locationForHit,
	parseDamageFormula,
	resolveDamage,
	type Modifier,
} from "../../rules-engine/index";
import { DamageType, normaliseDamageType } from "../data/item/damage-types";
import { actorView } from "../../ffg/infrastructure/foundry/actor-view";
import type { DiceResult, Ports } from "../../ffg/application/ports";
import { getPorts } from "../infrastructure/foundry/ports";
import * as damageDice from "../../ffg/application/damage-dice";
import { bodyLocationLabelKey } from "./labels";
import {
	applyTearing,
	collectRollMechanicEffects,
	collectTalentDamageEffects,
	collectTargetTraitDamageEffects,
	targetToughnessMultiplier,
	type RollMechanics,
	type TalentDamageCollection,
} from "./talent-effects";
import { postCard, type DamageRollFlag } from "./chat-flags";
import { effectiveProfile } from "./homebrew";
import { chatCardTitleDoc } from "../presentation/chat-doc-links";
import {
	type FireMode,
	type RateOfFireLike,
	decrementQuantity,
	shotsForFireMode,
} from "./ordnance";
import { toxicActivates, toxicToughnessPenalty } from "./toxic";
import { messageFlagNamespace } from "../../ffg/application/chat-flags";
import {
	type AttackProfile,
	attackProfileOf,
} from "../../ffg/domain/model/attack";
import { TEMPLATE_ROOT } from "../../ffg/domain/template-root";

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
	rollTest,
	rollSkill,
	rollSkillUntrained,
	rollWeaponAttack,
	rollPsychicPower,
	rollNavigatorPower,
	rollFearTest,
	rollSnapOut,
	rollShipSalvo,
	rollShipAction,
	rollShipRepair,
	rollToxicToughnessTest,
	rollAction,
	performRoll,
	rollInitiativeAction,
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
	ShipWeaponRollRequest,
	ShipRepairRollRequest,
	InitiativeRollRequest,
} from "./roll-system";

/**
 * Quick damage roll from the sheet's weapon row: rolls a fresh d100 for the
 * hit location plus the weapon damage and posts the damage card directly
 * (no to-hit test). Carry gating matches rollWeaponAttack.
 */
/**
 * Resolve a uuid stored on a chat flag to a document.
 *
 * fvtt-types types `fromUuidSync`'s parameter as a template-literal UUID union,
 * but a flag carries an arbitrary string, so the cast belongs at this one
 * boundary rather than at each call site.
 */
function documentFromUuid(uuid: string): unknown {
	return foundry.utils.fromUuidSync(uuid as never);
}

export async function rollWeaponDamage(
	actor: Actor,
	weaponId: string,
): Promise<void> {
	const ports = getPorts();
	const item = actor.items.get(weaponId);
	// Bead 6l68: the item gate comes FIRST — attackProfileOf tolerates
	// null/undefined only as an incidental detail of its signature, and we
	// do not rely on it. The profile is resolved from a verified item.
	if (!item) {
		ports.notify.warn("ROLL.UNKNOWN_ITEM");
		return;
	}
	// Bead kam1: a MUTATION with a printed attack block (Corrosive Bile) is an
	// attack too, so it resolves through the same profile as a weapon. Bead
	// 4obp: the launcher's fire profile derives from its LOADED ordnance —
	// unloaded = unusable and the damage roll below refuses.
	// Bead huaf/ujtg: the owner resolver doubles as the mod resolver —
	// attached weapon modifications (pen-flat/primitive-clear) fold in here.
	const profile = attackProfileOf(
		item as never,
		ownedItemResolver(actor),
		ownedItemResolver(actor) as never,
	);
	if (!profile) {
		ports.notify.warn("ROLL.UNKNOWN_ITEM");
		return;
	}
	// Carry gating matches the to-hit attack gate; innate attacks (mutations)
	// are part of the body and are never equipped.
	if (!profile.innate && equipStateOf(item) !== "carried") {
		ports.notify.warn("ROLL.NOT_CARRIED", { weapon: item.name ?? "" });
		return;
	}
	// Hit location needs a d100; a direct damage roll has no to-hit test, so
	// the throwaway d100 is rolled INSIDE postWeaponDamage (bead 9b95 F7:
	// after the consume/refuse gates) — pass null to let it roll.
	const target = ports.targets.actor() as Actor | null;
	await postWeaponDamage(actor, (target ?? actor) as Actor, profile, null);
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
		? (documentFromUuid(data.attackerUuid) as Actor | null)
		: null;
	const weapon = data.weaponUuid
		? (documentFromUuid(data.weaponUuid) as foundry.documents.Item | null)
		: null;
	// Bead 4obp: resolve the launcher's loaded ordnance against its owning
	// actor (embedded weapons carry .actor; unowned items cannot have loaded
	// ordnance resolved at all).
	const owner = (weapon as { actor?: foundry.documents.Actor | null } | null)
		?.actor;
	// Bead 6l68: the document gates come FIRST — a missing resolvee returns
	// outright instead of calling attackProfileOf on a null/undefined weapon
	// and reading its tolerance as the contract.
	if (!attacker || !weapon) return;
	// Bead huaf/ujtg: the owner resolver doubles as the mod resolver.
	const profile = attackProfileOf(
		weapon as never,
		owner ? ownedItemResolver(owner) : undefined,
		owner ? (ownedItemResolver(owner) as never) : undefined,
	);
	if (!profile) return;
	const ports = getPorts();
	if (profile.unusable) {
		ports.notify.warn("ROLL.LAUNCHER_UNLOADED", { weapon: profile.name });
		return;
	}
	const target = data.targetUuid
		? (documentFromUuid(data.targetUuid) as Actor | null)
		: null;
	await postWeaponDamage(
		attacker,
		(target ?? attacker) as Actor,
		profile,
		data.hitRoll ?? 0,
		data.critical === true,
		// Bead 9b95 F6: the to-hit dialog's fire mode, stamped onto the flag.
		data.fireMode,
	);
}

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
	attacker: Actor,
	profile: AttackProfile,
	fireMode: FireMode | null | undefined,
): Promise<boolean> {
	const fired = profile.fired;
	if (!fired?.uuid) return true;
	const ports = getPorts();
	const effective = effectiveProfile();
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
	ports: Ports,
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
			? `${ports.i18n.t("CHAT.DAMAGE_TYPE_OR")} ${damageAlternatives.join(" / ")}`
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
	ports: Ports,
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
		const extra = await ports.dice.roll(`1d${faces}`);
		const tearing = applyTearing(baseResults, extra.total, faces);
		if (tearing.added > 0) {
			damageTotal += tearing.added;
		}
		rolls.push(...(extra.rolls ?? []));
		qualityNotes.push(
			ports.i18n.t("CHAT.QUALITY_TEARING", {
				discarded: tearing.discarded,
			}),
		);
	}
	if (mechanics.blast !== null) {
		qualityNotes.push(
			ports.i18n.t("CHAT.QUALITY_BLAST", { rating: mechanics.blast }),
		);
	}
	// Printed attack restrictions (bead kam1).
	if (!profile.parryable) {
		qualityNotes.push(ports.i18n.t("CHAT.ATTACK_UNPARRYABLE"));
	}
	if (profile.action === "full") {
		qualityNotes.push(ports.i18n.t("CHAT.ATTACK_FULL_ACTION"));
	}
	return { damageTotal, qualityNotes, rolls };
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
	const armourValue = Math.max(
		0,
		...wornArmour.map((i) =>
			(i.system as unknown as { armourAt(loc: string): number }).armourAt(
				location,
			),
		),
	);
	const naturalToughnessBonus = Math.floor(
		systemOf(target).effectiveCharacteristicValue("t") / 10,
	);
	const traitDamage = collectTargetTraitDamageEffects(actorView(target));
	const toughnessBonus =
		naturalToughnessBonus *
		targetToughnessMultiplier(actorView(target), traitDamage);
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
	attacker: Actor,
	profile: AttackProfile,
): TalentDamageCollection {
	return collectTalentDamageEffects(actorView(attacker), {
		attackType: profile.attackType,
		// Bead 2k5: the attacking weapon's own damage effects apply; note
		// the item id is needed for per-item matching.
		weaponId: profile.id ?? undefined,
	});
}

/**
 * Card posting step (bead d3yc, formerly inlined in postWeaponDamage): the
 * display-only damage card plus the apply-damage button flag so the click
 * handler never recomputes, plus an application marker so the button cannot
 * fire twice.
 */
async function postDamageCard(
	ports: Ports,
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
			// Bead atx: talent damage contributors shown as breakdown rows.
			damageContributors: card.damageContributors,
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
						prompt: ports.i18n.t("CHAT.TOXIC_PROMPT", {
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
			[messageFlagNamespace(ports)]: {
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
 * bound once and reused.
 */
async function postWeaponDamage(
	attacker: Actor,
	target: Actor,
	profile: AttackProfile,
	// Card damage: the to-hit roll feeds the location table. Sheet quick
	// damage: null — the throwaway 1d100 location die is rolled HERE, below
	// (bead 9b95 F7) so an exhausted launcher refuses without burning a die.
	hitRoll: number | null,
	isCritical = false,
	// F6 (bead 9b95): the attack dialog's fire mode, threaded via the
	// damageRoll flag; absent on the sheet quick-damage path — then the
	// consume falls back to the launcher's RoF (single-shot-only = 1).
	fireMode?: FireMode | null,
): Promise<void> {
	const ports = getPorts();
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
	if (!(await consumeFiredOrdnance(attacker, profile, fireMode))) return;
	// Bead 9b95 F7: the sheet quick-damage path's throwaway 1d100 location
	// die is rolled only AFTER the consume/refuse gates — an exhausted
	// launcher refuses without burning a die.
	const resolvedHitRoll = hitRoll ?? (await ports.dice.roll("1d100")).total;
	// Step d3yc-1: the notation — suffix strip (bead 6tr), type normalise
	// and the card's type labels (see resolveDamageNotation).
	const notation = resolveDamageNotation(ports, profile);
	const damageRoll = await ports.dice.roll(notation.formula);
	// Righteous Fury trigger (RT core, VERIFY wording): a natural 10 on a
	// damage die. The dice port reports the terms, so the kernel need not see
	// a Foundry roll (bead k98i).
	const righteousFuryTriggered = damageDice.righteousFuryTriggered(damageRoll);
	// Roll-mechanic weapon qualities (bead gci0): Tearing rolls one extra
	// damage die (lowest result discarded — book wording, NOT roll-twice);
	// Toxic/Blast are post-resolution prompts shown on the card.
	const mechanics = collectRollMechanicEffects(actorView(attacker), {
		weaponId: profile.id ?? undefined,
		attackType: profile.attackType,
		// The attacking profile's own qualities: a mutation attack carries
		// Tearing in its `attack.qualities`, not in a weapon system.special.
		special: profile.qualities,
	});
	// Step d3yc-2: quality mechanics on the roll — Tearing bumps the total
	// and Blast/unparryable/full-action become card notes (see
	// applyRollQualityMechanics).
	const { damageTotal, qualityNotes, rolls } = await applyRollQualityMechanics(
		ports,
		damageRoll,
		mechanics,
		profile,
	);

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
	const talentDamage = collectAttackerTalentDamage(attacker, profile);
	// Card breakdown: flat damage always; critical-damage rows only on a
	// critical hit (they are gated in the kernel by isCritical); trait
	// damage-reduction rows always (they soak regardless of the hit type).
	const damageContributors = [
		...(isCritical ? talentDamage.critical : []),
		...talentDamage.damage,
		...soak.traitReduction,
	];

	const damage = resolveDamage({
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
	});

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
	await postDamageCard(ports, attacker, target, profile, {
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

import { equipStateOf, ownedItemResolver, systemOf } from "../data/accessors";
import {
	locationForHit,
	parseDamageFormula,
	resolveDamage,
} from "../../rules-engine/index";
import { DamageType, normaliseDamageType } from "../data/item/damage-types";
import { actorView } from "../../ffg/infrastructure/foundry/actor-view";
import { getPorts } from "../infrastructure/foundry/ports";
import * as damageDice from "../../ffg/application/damage-dice";
import { bodyLocationLabelKey } from "./labels";
import {
	applyTearing,
	collectRollMechanicEffects,
	collectTalentDamageEffects,
	collectTargetTraitDamageEffects,
	targetToughnessMultiplier,
} from "./talent-effects";
import { postCard, type DamageRollFlag } from "./chat-flags";
import { resolveAmmoAutoConsume, type HomebrewProfile } from "./homebrew";
import {
	type FireMode,
	type RateOfFireLike,
	decrementQuantity,
	shotsForFireMode,
} from "./ordnance";
import { toxicActivates, toxicToughnessPenalty } from "./toxic";
import { messageFlagNamespace } from "../../ffg/application/chat-flags";
import { type AttackProfile, attackProfileOf } from "../../ffg/domain/model/attack";

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
	rollShipRepair,
	rollToxicToughnessTest,
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
	ShipWeaponRollRequest,
	ShipRepairRollRequest,
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
	// Bead kam1: a MUTATION with a printed attack block (Corrosive Bile) is an
	// attack too, so it resolves through the same profile as a weapon. Bead
	// 4obp: the launcher's fire profile derives from its LOADED ordnance —
	// unloaded = unusable and the damage roll below refuses.
	const profile = attackProfileOf(item as never, ownedItemResolver(actor));
	if (!item || !profile) {
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
	await postWeaponDamage(
		actor,
		(target ?? actor) as Actor,
		profile,
		null,
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
	const profile = attackProfileOf(weapon as never, owner ? ownedItemResolver(owner) : undefined);
	if (!attacker || !profile) return;
	if (profile.unusable) {
		getPorts().notify.warn("ROLL.LAUNCHER_UNLOADED", { weapon: profile.name });
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
	const homebrew = ports.config.homebrew() as HomebrewProfile | null;
	if (!resolveAmmoAutoConsume(homebrew)) return true;
	// F5 (bead 9b95): the ownership gate — a non-owner firing skips the
	// consume (no write, no card death); the damage itself still posts.
	if (!ports.permissions.canRoll(attacker)) return true;
	const item = documentFromUuid(fired.uuid) as
		| {
				name?: string;
				system?: { quantity?: number };
				update?: (data: object) => Promise<void>;
		  }
		| null;
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
	const resolvedHitRoll =
		hitRoll ?? (await ports.dice.roll("1d100")).total;
	// RT notation allows a trailing damage-type suffix ("1d10+4 E") which
	// Foundry's Roll parser rejects - strip it first (bead 6tr); the parsed
	// type also backfills profiles that never had a type set. A mutation attack
	// may print ALTERNATIVES ("1d10+2 R (or E)", Corrosive Bile p369): the
	// first is the default and the rest are surfaced on the card.
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
			? `${getPorts().i18n.t("CHAT.DAMAGE_TYPE_OR")} ${damageAlternatives.join(" / ")}`
			: "";
	const { formula } = parsed;
	const damageRoll = await getPorts().dice.roll(formula);
	let damageTotal = damageRoll.total;

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
	const qualityNotes: string[] = [];
	if (mechanics.tearing) {
		// The DAMAGE die's results only (bead k98i): a mixed formula's other
		// terms are not damage dice, so Tearing must not discard one of them.
		const { faces, results: baseResults } = damageDice.tearingBase(damageRoll);
		const extra = (await getPorts().dice.roll(`1d${faces}`)).total;
		const tearing = applyTearing(baseResults, extra, faces);
		if (tearing.added > 0) {
			damageTotal += tearing.added;
		}
		qualityNotes.push(
			getPorts().i18n.t("CHAT.QUALITY_TEARING", {
				discarded: tearing.discarded,
			}),
		);
	}
	if (mechanics.blast !== null) {
		qualityNotes.push(
			getPorts().i18n.t("CHAT.QUALITY_BLAST", { rating: mechanics.blast }),
		);
	}
	// Printed attack restrictions (bead kam1). Neither is enforced by the
	// pipeline (the target's reaction stays a manual decision), so they must
	// be VISIBLE here or the rule would be silently lost: Corrosive Bile
	// "can be dodged, but not parried" and "Using it is a full action".
	if (!profile.parryable) {
		qualityNotes.push(getPorts().i18n.t("CHAT.ATTACK_UNPARRYABLE"));
	}
	if (profile.action === "full") {
		qualityNotes.push(getPorts().i18n.t("CHAT.ATTACK_FULL_ACTION"));
	}
	// Toxic is conditional on the hit actually wounding (book: "anyone that
	// takes Damage from a Toxic weapon, after reduction for Armour and
	// Toughness Bonus"); the note + test button are added after resolveDamage
	// below (the gate is toxicActivates, rules/toxic.ts).

	// Bead yojf: the kernel profile resolves through ports.config.profile()
	// instead of a direct rtCore import, so a sibling module swaps one binding.
	const ruleProfile = getPorts().config.profile();
	const location = locationForHit(resolvedHitRoll ?? 0, ruleProfile);
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
		(systemOf(target)).effectiveCharacteristicValue("t") / 10,
	);
	// Bead zyv1: target-side trait damage machinery. Unnatural Toughness
	// (×N) multiplies the TB; Machine is modelled in the pack as armour items
	// and needs no extra handling here. The multiplier rule lives in the
	// rules layer (targetToughnessMultiplier): max of the canonical
	// characteristics.t.unnatural field and the trait tb-multiplier effects,
	// so the same book trait carried both ways never double-counts.
	const traitDamage = collectTargetTraitDamageEffects(actorView(target));
	const toughnessBonus =
		naturalToughnessBonus * targetToughnessMultiplier(actorView(target), traitDamage);

	// Talent damage effects (bead fjw): damage-flat joins the roll before
	// soak; critical-damage applies only when the to-hit was critical.
	// Both are item-sourced talent effects, condition-guarded via flags.
	const attackType = profile.attackType;
	const talentDamage = collectTalentDamageEffects(actorView(attacker), {
		attackType,
		// Bead 2k5: the attacking weapon's own damage effects apply; note
		// the item id is needed for per-item matching.
		weaponId: profile.id ?? undefined,
	});
	// Card breakdown: flat damage always; critical-damage rows only on a
	// critical hit (they are gated in the kernel by isCritical); trait
	// damage-reduction rows always (they soak regardless of the hit type).
	const damageContributors = [
		...(isCritical ? talentDamage.critical : []),
		...talentDamage.damage,
		...traitDamage.reduction,
	];

	const damage = resolveDamage({
		roll: damageTotal,
		penetration: profile.penetration,
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
		flatReduction: traitDamage.reduction.reduce(
			(sum, mod) => sum + mod.value,
			0,
		),
		criticalDamage: talentDamage.critical.reduce(
			(sum, mod) => sum + mod.value,
			0,
		),
		isCritical,
		righteousFuryTriggered,
		profile: ruleProfile,
	});

	const locationLabelKey = bodyLocationLabelKey(location);
	// Toxic (beads gci0 + d8bc, owner rule text): the Toughness-test gate only
	// when the hit dealt damage after Armour + Toughness reduction (zero
	// damage = no poison). The card carries the computed −5-per-damage-point
	// penalty and a button that routes the victim's Toughness Test through
	// the shared Test machinery (visible funnel contributor); the GM-facing
	// note on secondary effects is the CHAT.QUALITY_TOXIC line (1d10 Impact,
	// no reduction — Core Rulebook printed p117; per-toxin extras stay
	// GM-facing prose).
	const toxicActivated = toxicActivates(mechanics.toxic, damage.wounds);
	if (toxicActivated) {
		qualityNotes.push(getPorts().i18n.t("CHAT.QUALITY_TOXIC"));
	}
	await postCard(
		attacker,
		"systems/rogue-trader/template/chat/damage.hbs",
		{
			title: `${attacker.name} → ${target.name} — ${profile.name}`,
			hitSuccess: true,
			locationLabelKey,
			damageTypeLabelKey,
			damageTypeAlternatives,
			damage,
			// Bead atx: talent damage contributors shown as breakdown rows.
			damageContributors,
			// Bead gci0: roll-mechanic quality notes (Tearing/Toxic/Blast);
			// Toxic only when the hit dealt damage after soak.
			qualityNotes,
			// Bead d8bc: the Toughness-test prompt behind the damage-dealt
			// gate — the penalty is computed once (−5 per damage point) and
			// the button routes through the shared Test machinery.
			toxic: toxicActivated
				? {
						targetUuid: target.uuid,
						wounds: damage.wounds,
						penalty: toxicToughnessPenalty(damage.wounds),
						prompt: getPorts().i18n.t("CHAT.TOXIC_PROMPT", {
							penalty: toxicToughnessPenalty(damage.wounds),
							wounds: damage.wounds,
						}),
					}
				: null,
			isCriticalHit: isCritical,
			targetUuid: target.uuid,
			// Bead 4obp: the usage chip — what fired + the remaining quantity
			// (the fired item's Gear.quantity), with the one-click spend button.
			// Manual tracking: the chip never auto-consumes (bead mrl4 owns that).
			fired: profile.fired ?? null,
		},
		// Apply-damage button data (bead ncc): the card stays a data-only
		// kernel consumer - the flag carries the displayed outcome so the
		// click handler never recomputes, plus an application marker so the
		// button cannot fire twice.
		{
			// Namespace from the profile (bead p7jv): RT's value is
			// "rogue-trader", so the wire format is unchanged.
			[messageFlagNamespace(ports)]: {
				damageApply: {
					wounds: damage.wounds,
					targetUuid: target.uuid,
					applied: false,
					// Bead ks3k: the apply step converts damage past 0 Wounds into
					// Critical Damage, which needs the type and the hit location.
					damageType: String(damageType ?? "Impact"),
					location,
				},
			},
		},
	);
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

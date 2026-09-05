import type { Actor } from "fvtt-types/documents";
import type { Character } from "../../data/actor/character";
import {
	locationForHit,
	type Modifier,
	parseDamageFormula,
	resolveDamage,
	resolveTest,
	rtCore,
	sumModifiers,
	type TestOutcome,
} from "../../rules-engine/src/index";
import { DamageType, normaliseDamageType } from "../data/item/damage-types";
import {
	effectivePsyRating,
	focusPowerAutoFailFloor,
	phenomenaRollModifier,
	phenomenaTableName,
	shouldRollPhenomena,
	psyRatingBonus,
} from "./psychic";
import { resolvePower } from "./power-resolution";
import { collectTestModifiers, mergeModifiers, type TestKind } from "./funnel";
import { bodyLocationLabelKey } from "./labels";
import { collectTalentDamageEffects } from "./talent-effects";
import { TestDialog } from "./test-dialog";

/**
 * Thin Foundry adapter: the ONLY runtime Foundry-coupled rolling code.
 * Sheets/buttons call these; everything below this layer is pure kernel.
 */

export interface RollTestOptions {
	/** Dialog-provided or programmatic modifiers. */
	modifiers?: Modifier[];
	/** Bypass the modify dialog (fast-forward). */
	skipDialog?: boolean;
}

/**
 * Dialog contributors = caller modifiers + a funnel collection for the test
 * context, so talent/gear/item effects are visible (and editable-previewed)
 * in the dialog, not only on the chat card. Attack-context-dependent
 * contributors (fire-mode, condition flags) are chosen inside the dialog and
 * stay post-dialog only - the card shows the full breakdown. Ids survive the
 * dialog round-trip, so postTest's funnel merge dedupes instead of doubling.
 */
function dialogContributors(
	actor: Actor,
	kind: TestKind,
	key: string,
	modifiers: Modifier[],
	weapon: { type: string; special?: string[] } | null = null,
): Modifier[] {
	return mergeModifiers(
		modifiers,
		collectTestModifiers(actor, { kind, key, weapon }),
	);
}

/** Roll a characteristic test: dialog -> funnel -> kernel -> chat card. */
export async function rollTest(
	actor: Actor,
	key: string,
	options: RollTestOptions = {},
): Promise<void> {
	const system = actor.system as unknown as Character;
	const characteristic = system.characteristics[key];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key }),
		);
		return;
	}

	let modifiers = [...(options.modifiers ?? [])];
	const title = `${actor.name} — ${game.i18n.localize(`CHARACTERISTIC.${key.toUpperCase()}`)}`;

	if (!options.skipDialog) {
		const result = await TestDialog.show({
			title,
			baseTarget: characteristic.value,
			contributors: dialogContributors(actor, "characteristic", key, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	await postTest(
		actor,
		title,
		characteristic.value,
		modifiers,
		"characteristic",
		key,
	);
}

/**
 * Shared pipeline: dialog-free target assembly -> funnel -> kernel -> card.
 * Used by characteristic tests and skill tests alike.
 */
export async function postTest(
	actor: Actor,
	title: string,
	baseTarget: number,
	modifiers: Modifier[],
	kind: TestKind = "characteristic",
	key = title,
	weapon: { type: string; special?: string[] } | null = null,
	extras: {
		/** Extra template vars for the roll card (e.g. showDamageButton). */
		templateVars?: Record<string, unknown>;
		/** Extra message flags (e.g. rogue-trader.damageRoll button data). */
		flags?: Record<string, Record<string, unknown>>;
		/** Bead hyv: attack-context passed through to the funnel. */
		context?: {
			aimed?: boolean;
			fireMode?: "single" | "burst" | "full";
			flags?: Record<string, boolean>;
		};
		/** Profile override (bead sa6): e.g. Focus Power Tests auto-fail on
		 * rolls of 91+ (rt_core book p157). Profile data, not an if/else. */
		autoFailRoll?: number | null;
	} = {},
): Promise<{ outcome: TestOutcome; messageId: string | null }> {
	const collected = collectTestModifiers(
		actor,
		{ kind, key, weapon, ...extras.context },
		modifiers,
	);
	const totalModifier = sumModifiers(collected);
	const target = Math.min(100, Math.max(1, baseTarget + totalModifier));

	const roll = new foundry.dice.Roll("1d100");
	await roll.evaluate();
	const rollResult = roll.total ?? 0;

	const outcome = resolveTest({
		target,
		roll: rollResult,
		profile:
			extras.autoFailRoll !== undefined
				? { ...rtCore, autoFailRoll: extras.autoFailRoll }
				: rtCore,
	});
	const outcomeLabel = outcome.success
		? `${game.i18n.localize("ROLL.SUCCESS")} (+${outcome.degrees} ${game.i18n.localize("ROLL.DEGREES")})`
		: game.i18n.localize("ROLL.FAILURE");

	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/rogue-trader/template/chat/roll.hbs",
		{
			title,
			target,
			totalModifier,
			analysis: collected,
			roll: rollResult,
			outcomeLabel,
			outcomeClass: outcome.success ? "success" : "failure",
			critical: outcome.critical,
			isDouble: outcome.isDouble,
			...extras.templateVars,
		},
	);

	const message = (await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
		...(extras.flags ? { flags: extras.flags } : {}),
	})) as { id?: string } | undefined;
	return { outcome, messageId: message?.id ?? null };
}

/**
 * Untrained attempt of a basic skill: characteristic value with the RAW -10
 * penalty expressed as a funnel modifier (breakdown shows it explicitly).
 * Advanced skills cannot be attempted untrained (enforced by callers).
 */
export async function rollSkillUntrained(
	actor: Actor,
	label: string,
	characteristicKey: string,
	options: RollTestOptions = {},
): Promise<void> {
	const system = actor.system as unknown as Character;
	const characteristic = system.characteristics[characteristicKey];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", {
				key: characteristicKey,
			}),
		);
		return;
	}
	const kind = "skill" as const;
	const untrainedModifier: Modifier = {
		id: "untrained",
		source: { type: "skill", label: "Skill" },
		label: game.i18n.localize("ROLL.UNTRAINED"),
		value: -10,
	};
	let modifiers: Modifier[] = [untrainedModifier];
	const title = `${actor.name} — ${label}`;

	if (!options?.skipDialog) {
		const result = await TestDialog.show({
			title,
			baseTarget: characteristic.value,
			contributors: dialogContributors(actor, kind, characteristicKey, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	await postTest(
		actor,
		title,
		characteristic.value,
		modifiers,
		kind,
		characteristicKey,
	);
}

/** Roll a skill item test: target = characteristic value + ladder bonus. */
export async function rollSkill(
	actor: Actor,
	skillItemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	const item = actor.items.get(skillItemId);
	if (!item || item.type !== "skill") {
		ui.notifications?.warn(game.i18n.format("ROLL.UNKNOWN_SKILL"));
		return;
	}
	const system = actor.system as unknown as Character;
	const skill = item.system as unknown as {
		characteristic: string;
		ladder: number;
	};
	const characteristic = system.characteristics[skill.characteristic];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", {
				key: skill.characteristic,
			}),
		);
		return;
	}

	let modifiers = [...(options.modifiers ?? [])];
	const baseTarget = characteristic.value + (skill.ladder - 1) * 10;
	const title = `${actor.name} — ${item.name}`;

	if (!options.skipDialog) {
		// Bead 02u: skill tests show the same modify dialog as characteristics
		// and attacks so talent/other funnel contributors are visible.
		const result = await TestDialog.show({
			title,
			baseTarget,
			contributors: dialogContributors(actor, "skill", skill.characteristic, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	await postTest(
		actor,
		title,
		baseTarget,
		modifiers,
		"skill",
		skill.characteristic,
	);
}

/** Roll a weapon attack's to-hit test (v1: to-hit only, no damage, no equip gating). */ export async function rollWeaponAttack(
	actor: Actor,
	weaponId: string,
	options: RollTestOptions = {},
): Promise<void> {
	const item = actor.items.get(weaponId);
	const type = item?.type as string | undefined;
	if (!item || (type !== "melee-weapon" && type !== "ranged-weapon")) {
		ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
		return;
	}

	// Equip-state gate: attacks require the weapon to be carried (the ready
	// state for weapons; armour is worn and cannot attack).
	const equipState =
		(item.system as unknown as { equipState?: string }).equipState ?? "stowed";
	if (equipState !== "carried") {
		ui.notifications?.warn(
			game.i18n.format("ROLL.NOT_CARRIED", { weapon: item.name }),
		);
		return;
	}
	const system = actor.system as unknown as Character;
	const key = type === "melee-weapon" ? "ws" : "bs";
	const characteristic = system.characteristics[key];
	if (!characteristic) return;

	let { modifiers = [] } = options;
	const special = (
		(item.system as unknown as { special?: string[] }).special ?? []
	).map(String);
	// Bead hyv: attack-context (aim/fire-mode/charge) selected in the dialog.
	let attackContext: {
		aimed?: boolean;
		fireMode?: "single" | "burst" | "full";
		flags?: Record<string, boolean>;
	} | undefined;

	if (!options.skipDialog) {
		const result = await TestDialog.show({
			title: `${actor.name} — ${item.name}`,
			baseTarget: characteristic.value,
			contributors: dialogContributors(actor, "attack", key, modifiers, {
				type: String(type),
				special,
			}),
			// Bead hyv: attack-context selectors (fire mode, aim, charge).
			attackContext: {
				ranged: type === "ranged-weapon",
				melee: type === "melee-weapon",
			},
		});
		if (result === null) return;
		modifiers = result.modifiers;
		// Aim (+10 half / +20 full, p237): a verified book modifier contributed
		// by the dialog, shown in the breakdown like any other row.
		if (result.attack?.aimed) {
			modifiers = [
				...modifiers,
				{
					id: "attack:aim",
					source: { type: "dialog", label: "ROLL.AIM" },
					label: result.attack.aimFull ? "Aim (Full)" : "Aim (Half)",
					value: result.attack.aimFull ? 20 : 10,
				},
			];
		}
		attackContext = {
			aimed: result.attack?.aimed,
			fireMode: result.attack?.fireMode,
			flags: result.attack?.flags,
		};
	}

	// Damage flow (b02/1h2, owner redesign): the to-hit card carries a
	// "Roll Damage" button; damage rolls on click, not automatically.
	// The button's flag data is attached at attack time (data-only kernel:
	// the displayed to-hit outcome feeds the later damage location roll).
	const target = (
		game as unknown as {
			user?: { targets?: Set<{ actor?: Actor }> };
		}
	).user?.targets
		?.values()
		?.next()?.value?.actor;

	const { outcome, messageId } = await postTest(
		actor,
		`${actor.name} — ${item.name}`,
		characteristic.value,
		modifiers,
		"attack",
		key,
		{ type, special },
		{
			templateVars: { showDamageButton: true },
			context: attackContext,
		},
	);

	// Attach the damage-button flag now that the to-hit outcome exists
	// (data-only kernel: the displayed roll feeds the damage location).
	if (outcome.success && messageId) {
		const chatMessage = foundry.documents.ChatMessage.get(messageId) as
			| { update?: (u: object) => Promise<void> }
			| undefined;
		await chatMessage?.update?.({
			flags: {
				"rogue-trader": {
					damageRoll: {
						attackerUuid: actor.uuid,
						weaponUuid: item.uuid,
						targetUuid: target?.uuid ?? null,
						hitRoll: outcome.roll,
						// Bead fjw: critical hits (success + double, per the
						// profile's critOnDouble) gate critical-damage talents.
						critical: outcome.critical,
						rolled: false,
					},
				},
			},
		});
	}

	// Evasion (bead 97a): decision DIALOG again, but informational only
	// - it posts the defender's reaction test card and does NOT feed
	// the damage calculation (resolution stays manual for now).
	if (outcome.success && target && target !== actor) {
		try {
			await resolveEvasion(target, type);
		} catch (error) {
			console.error("rogue-trader: evasion roll failed", error);
		}
	}
}

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
	if (!item || (type !== "melee-weapon" && type !== "ranged-weapon")) {
		ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
		return;
	}
	const equipState =
		(item.system as unknown as { equipState?: string }).equipState ?? "stowed";
	if (equipState !== "carried") {
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

/** Card button data for the manual damage roll. */
interface DamageRollFlag {
	attackerUuid?: string;
	weaponUuid?: string;
	targetUuid?: string | null;
	hitRoll?: number;
	/** To-hit outcome was critical (gates critical-damage talent effects). */
	critical?: boolean;
	rolled?: boolean;
}

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
 * Evasion dialog + reaction roll (bead 97a, owner-requested restore).
 * INFORMATIONAL ONLY: posts the defender's reaction test card; it does
 * not modify or cancel the damage flow (manual resolution for now).
 * Rules flags VERIFY: reaction-per-round accounting is not tracked;
 * untrained fallback is characteristic-only at -10.
 */
async function resolveEvasion(
	defender: Actor,
	attackType: string,
): Promise<void> {
	// Vehicles have no reactions (SI damage is a separate follow-up).
	const system = defender.system as unknown as Character;
	if (!system?.wounds) return;

	const isMelee = attackType === "melee-weapon";
	const skillName = isMelee ? "Parry" : "Dodge";
	const owned = defender.items.find(
		(i) =>
			(i.type as string) === "skill" &&
			(i as { name?: string }).name === skillName,
	);

	const evasionLabel = game.i18n.localize("DIALOG.EVASION");
	const skillLabel = owned
		? ((owned as { name?: string }).name ?? skillName)
		: `${skillName} (${game.i18n.localize("ROLL.UNTRAINED")})`;
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${defender.name} — ${evasionLabel}` },
		content: `<p>${evasionLabel}: ${skillLabel}</p>`,
		buttons: [
			{
				action: "nothing",
				label: game.i18n.localize("EVASION.DO_NOTHING"),
				callback: () => "nothing",
			},
			{
				action: "react",
				label: skillLabel,
				callback: () => "react",
			},
		],
	});
	if (choice !== "react") return;

	// Roll the chosen reaction (the postTest card records the attempt; the
	// result is NOT fed into the damage calculation - manual resolution).
	const title = `${defender.name} — ${skillName}`;
	let modifiers: Modifier[] = [];

	if (owned) {
		const skill = owned.system as unknown as {
			characteristic: string;
			ladder: number;
		};
		const characteristic = system.characteristics[skill.characteristic];
		if (!characteristic) return;
		const baseTarget = characteristic.value + (skill.ladder - 1) * 10;
		// Bead 02u: show the modify dialog for the reaction roll too.
		const result = await TestDialog.show({
			title,
			baseTarget,
			contributors: dialogContributors(defender, "skill", skill.characteristic, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
		await postTest(
			defender,
			title,
			baseTarget,
			modifiers,
			"skill",
			skill.characteristic,
		);
		return;
	}

	modifiers = [
		{
			id: "untrained",
			source: { type: "skill", label: "Skill" },
			label: game.i18n.localize("ROLL.UNTRAINED"),
			value: -10,
		},
	];
	const untrainedResult = await TestDialog.show({
		title,
		baseTarget:
			system.characteristics[skillName === "Parry" ? "ws" : "ag"]?.value ?? 0,
		contributors: dialogContributors(
			defender,
			"skill",
			skillName === "Parry" ? "ws" : "ag",
			modifiers,
		),
	});
	if (untrainedResult === null) return;
	await postTest(
		defender,
		title,
		system.characteristics[skillName === "Parry" ? "ws" : "ag"]?.value ?? 0,
		untrainedResult.modifiers,
		"skill",
		skillName === "Parry" ? "ws" : "ag",
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
	const damageTotal = damageRoll.total ?? 0;

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

	const location = locationForHit(hitRoll ?? 0, rtCore);
	const wornArmour = target.items.filter(
		(i) =>
			(i.type as string) === "armour" &&
			(i.system as unknown as { equipState?: string }).equipState === "worn",
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
		((target.system as unknown as Character).characteristics.t?.value ?? 0) /
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

/**
 * Map the power's focusTest free-text ("Willpower", "Psyniscience") to a
 * Characteristic key. V1: Willpower -> wp, everything else falls back to wp
 * with a console note — routing Psyniscience (a Skill test) needs the skill
 * lookup flow and is deferred (UNVERIFIED IN WORLD).
 */
function focusTestKey(focusTest: string | undefined): string {
	if (focusTest && /willpower/i.test(focusTest)) return "wp";
	if (focusTest && /fellowship/i.test(focusTest)) return "fel";
	if (focusTest && /perception/i.test(focusTest)) return "per";
	console.warn(
		`rogue-trader | focusTest "${focusTest ?? ""}" is not a known characteristic; defaulting to Willpower`,
	);
	return "wp";
}

/**
 * Psychic power activation (bead sa6, rt_core Ch. VI). Flow per design bead
 * mso6: strength selection (Fettered/Unfettered/Push) -> Focus Power Test
 * through the shared pipeline (dialog -> funnel -> kernel -> chat card) ->
 * Psychic Phenomena on the book's trigger -> resolution registry handling.
 *
 * Book citations: Table 6-1 Psychic Strength + Focus Power Test prose
 * (book p157); 91+ always fails (p157); phenomena tables 6-2/6-3
 * (pp160-161, extracted into the psychicphenomena pack, bead 5p15).
 */
export async function rollPsychicPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	const item = actor.items.get(itemId);
	if (!item || (item.type as string) !== "psychicpower") {
		ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
		return;
	}
	const system = actor.system as unknown as Character;
	const power = item.system as unknown as {
		powerClass?: string;
		subtype?: string;
		focusTest?: string;
		damage?: string;
		name?: string;
	};
	const psyRating = system.psyRating ?? 0;
	if (psyRating < 1 && system.psyker !== true) {
		ui.notifications?.warn(game.i18n.localize("PSYCHIC_POWER.NOT_PSYKER"));
		return;
	}

	// Strength selection (Table 6-1): Fettered (half PR, no phenomena),
	// Unfettered (full PR, doubles trigger phenomena), Push (+1..+3 PR,
	// automatic phenomena at +5/+1). Push cap is +3/+4 per the book; the
	// sanctioned flag is not tracked on the actor yet — +3 is used and the
	// cap is homebrew-profile material later (UNVERIFIED IN WORLD: renegade
	// sorcerers need the +4 cap).
	const strength = options.skipDialog
		? "unfettered"
		: await promptStrength();
	if (!strength) return;
	// Push level is encoded in the prompt choice ("push:2"); default +1.
	const [strengthLevel, pushLevelsRaw] = strength.split(":");
	const pushLevels = strengthLevel === "push" ? Number(pushLevelsRaw ?? "1") || 1 : 0;

	const sustainedCount = system.sustainedPowers?.length ?? 0;
	const effPr = effectivePsyRating({
		psyRating,
		strength: strengthLevel as "fettered" | "unfettered" | "push",
		pushLevels,
		sustainedCount,
	});
	const psyBonus = psyRatingBonus(effPr);

	// Focus Power Test characteristic: the power's focusTest field names it
	// (usually Willpower, sometimes Psyniscience as a skill); default wp.
	const testKey = focusTestKey(power.focusTest);
	const characteristic = system.characteristics[testKey];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key: testKey }),
		);
		return;
	}

	const psyBonusModifier: Modifier = {
		id: "psy-rating",
		source: { type: "item", label: "SOURCE.FROM_POWERS" },
		label: game.i18n.localize("PSYCHIC_POWER.PSY_RATING_BONUS"),
		value: psyBonus,
	};
	const strengthLabel = game.i18n.localize(
		`PSYCHIC_POWER.STRENGTH_${strengthLevel.toUpperCase()}`,
	);
	const title = `${actor.name} — ${item.name} (${strengthLabel})`;

	let modifiers: Modifier[] = [psyBonusModifier];
	if (!options.skipDialog) {
		const result = await TestDialog.show({
			title,
			baseTarget: characteristic.value,
			contributors: dialogContributors(actor, "focus-power", testKey, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	const { outcome } = await postTest(
		actor,
		title,
		characteristic.value,
		modifiers,
		"focus-power",
		testKey,
		null,
		{ autoFailRoll: focusPowerAutoFailFloor() },
	);

	// Psychic Phenomena (Table 6-1 triggers, book p157).
	if (shouldRollPhenomena(strengthLevel as "fettered" | "unfettered" | "push", outcome)) {
		await rollPhenomena(actor, { pushLevels, sustainedCount });
	}

	// Success handling via the resolution registry (design mso6 addendum).
	if (outcome.success) {
		const resolution = resolvePower(power.subtype);
		if (resolution.damage && power.damage) {
			await postPowerDamage(actor, item.name ?? "", power.damage);
		}
	}
}

/**
 * Strength prompt (Table 6-1, book p157): Fettered / Unfettered / Push
 * +1..+3. Push levels are separate buttons; each callback encodes the level
 * in the returned value ("push:2"). Push cap is +3/+4 per the book; the
 * sanctioned flag is not tracked on the actor yet — +3 is used and the cap
 * is homebrew-profile material later (UNVERIFIED IN WORLD: renegade
 * sorcerers need the +4 cap).
 */
async function promptStrength(): Promise<string | null> {
	return (await foundry.applications.api.DialogV2.wait({
		window: {
			title: game.i18n.localize("PSYCHIC_POWER.STRENGTH_TITLE"),
		},
		content: `<p>${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PROMPT")}</p>`,
		buttons: [
			{
				action: "fettered",
				label: game.i18n.localize("PSYCHIC_POWER.STRENGTH_FETTERED"),
				callback: () => "fettered",
			},
			{
				action: "unfettered",
				label: game.i18n.localize("PSYCHIC_POWER.STRENGTH_UNFETTERED"),
				callback: () => "unfettered",
			},
			{
				action: "push1",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +1`,
				callback: () => "push:1",
			},
			{
				action: "push2",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +2`,
				callback: () => "push:2",
			},
			{
				action: "push3",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +3`,
				callback: () => "push:3",
			},
		],
	})) as string | null;
}

/**
 * Roll on the Psychic Phenomena table (or Perils of the Warp on 75+,
 * Table 6-2 book p160). Modifiers: +5 per push level, +10 per sustained
 * power (book p157). The chart result is the RAW roll + modifier; the
 * phenomena tables tile 1-100 with explicit ranges.
 */
async function rollPhenomena(
	actor: Actor,
	source: { pushLevels?: number; sustainedCount?: number },
): Promise<void> {
	const modifier = phenomenaRollModifier(source);
	const die = new foundry.dice.Roll("1d100");
	await die.evaluate();
	const raw = die.total ?? 0;
	const total = Math.min(100, raw + modifier);
	const tableName = phenomenaTableName(total);

	const pack = game.packs?.get("rogue-trader.psychicphenomena");
	if (!pack) {
		console.warn("rogue-trader | psychicphenomena pack missing");
		ui.notifications?.warn(game.i18n.localize("PSYCHIC_POWER.NO_TABLE"));
		return;
	}
	const tables = (await pack.getDocuments()) as unknown as Array<{
		name?: string;
		results?: Array<{ text?: string; range?: [number, number] }>;
	}>;
	const table = tables.find((t) => t.name === tableName);
	const result = table?.results?.find(
		(r) => total >= (r.range?.[0] ?? 0) && total <= (r.range?.[1] ?? 0),
	);
	const text = result?.text ?? game.i18n.localize("PSYCHIC_POWER.TABLE_MISS");
	const label = game.i18n.localize("PSYCHIC_POWER.PHENOMENA_ROLL");
	const content = `<div class="rogue-trader phenomena-roll"><h3>${label}: ${total}</h3><p>${text}</p></div>`;
	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
	});
}

/**
 * Damage-carrying subtypes (bolt/barrage/storm/zone) roll the power's
 * damage expression on success. Manual target application for now
 * (mirrors the weapon damage card's manual-resolution note).
 */
async function postPowerDamage(
	actor: Actor,
	powerName: string,
	damage: string,
): Promise<void> {
	const roll = new foundry.dice.Roll(damage);
	await roll.evaluate();
	const label = game.i18n.format("PSYCHIC_POWER.DAMAGE_ROLL", {
		power: powerName,
	});
	const content = `<div class="rogue-trader power-damage"><h3>${label}</h3><p>${damage}: <strong>${roll.total}</strong></p></div>`;
	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
	});
}

/**
 * Navigator power activation (bead sa6, rt_core Ch. VII book p178): a plain
 * Characteristic Test with the mastery bonus (+0/+10/+20 Novice/Adept/
 * Master) as a funnel-visible modifier. NO Focus Power Test, NO Psy Rating,
 * NEVER Psychic Phenomena/Perils (book p178).
 */
export async function rollNavigatorPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	const item = actor.items.get(itemId);
	if (!item || (item.type as string) !== "navigatorpower") {
		ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
		return;
	}
	const system = actor.system as unknown as Character;
	const power = item.system as unknown as {
		characteristic?: string;
		mastery?: string;
	};
	const key = power.characteristic ?? "per";
	const characteristic = system.characteristics[key];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key }),
		);
		return;
	}

	const mastery = power.mastery ?? "novice";
	const bonus =
		(
			item.system as unknown as {
				masteryBonusValue?: number;
			}
		).masteryBonusValue ?? 0;
	const masteryLabel = game.i18n.localize(`NAVIGATOR_POWER.${mastery.toUpperCase()}`);
	const masteryModifier: Modifier = {
		id: "navigator-mastery",
		source: { type: "item", label: "SOURCE.FROM_POWERS" },
		label: masteryLabel,
		value: bonus,
	};
	const title = `${actor.name} — ${item.name} (${masteryLabel})`;

	let modifiers: Modifier[] = [masteryModifier];
	if (!options.skipDialog) {
		const result = await TestDialog.show({
			title,
			baseTarget: characteristic.value,
			contributors: dialogContributors(actor, "characteristic", key, modifiers),
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	await postTest(actor, title, characteristic.value, modifiers, "characteristic", key);
}

/** Toggle a power in/out of the sustained list (bead sa6, book p157). */
export async function toggleSustainedPower(
	actor: Actor,
	itemUuid: string,
	itemName: string,
): Promise<void> {
	const system = actor.system as unknown as Character;
	const current = system.sustainedPowers ?? [];
	const sustained = current.some((p) => p.itemUuid === itemUuid);
	const next = sustained
		? current.filter((p) => p.itemUuid !== itemUuid)
		: [...current, { itemUuid, name: itemName }];
	await actor.update({ system: { sustainedPowers: next } });
}

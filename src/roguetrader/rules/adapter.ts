import type { Actor } from "fvtt-types/documents";
import {
	locationForHit,
	type Modifier,
	resolveDamage,
	resolveTest,
	rtCore,
	sumModifiers,
	type TestOutcome,
} from "../../../packages/rules-engine/src/index";
import type { Character } from "../../data/actor/character";
import { TestDialog } from "./test-dialog";
import { collectTestModifiers, type TestKind } from "./funnel";

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
			contributors: modifiers,
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	await postTest(actor, title, characteristic.value, modifiers, "characteristic", key);
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
): Promise<void> {
	const collected = collectTestModifiers(
		actor,
		{ kind, key, weapon },
		modifiers,
	);
	const totalModifier = sumModifiers(collected);
	const target = Math.min(100, Math.max(1, baseTarget + totalModifier));

	const roll = new foundry.dice.Roll("1d100");
	await roll.evaluate();
	const rollResult = roll.total ?? 0;

	const outcome = resolveTest({ target, roll: rollResult, profile: rtCore });
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
		},
	);

	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
	});
	return outcome;
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
	await postTest(
		actor,
		`${actor.name} — ${label}`,
		characteristic.value,
		[
			{
				id: "untrained",
				source: { type: "skill", label: "Skill" },
				label: game.i18n.localize("ROLL.UNTRAINED"),
				value: -10,
			},
		],
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

	const modifiers = [...(options.modifiers ?? [])];
	const baseTarget = characteristic.value + (skill.ladder - 1) * 10;
	await postTest(
		actor,
		`${actor.name} — ${item.name}`,
		baseTarget,
		modifiers,
		"skill",
		skill.characteristic,
	);
}

/** Roll a weapon attack's to-hit test (v1: to-hit only, no damage, no equip gating). */
export async function rollWeaponAttack(
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

	if (!options.skipDialog) {
		const result = await TestDialog.show({
			title: `${actor.name} — ${item.name}`,
			baseTarget: characteristic.value,
			contributors: modifiers,
		});
		if (result === null) return;
		modifiers = result.modifiers;
	}

	const outcome = await postTest(
		actor,
		`${actor.name} — ${item.name}`,
		characteristic.value,
		modifiers,
		"attack",
		key,
		{ type, special },
	);

	// Damage flow (b02/1h2): on a successful to-hit, roll the weapon damage
	// formula, pick location from the hit roll's tens digit (profile table),
	// and resolve vs the target's worn armour + toughness bonus. Display-only:
	// the card reports wounds; apply-damage buttons land later.
	if (outcome.success) {
		const target = (
			game as unknown as { targets?: Set<{ actor?: Actor }> }
		).targets?.values()?.next()?.value?.actor;
		await postWeaponDamage(actor, (target ?? actor) as Actor, item, outcome);
	}
}

/**
 * b02/1h2 damage handoff: roll the weapon's damage formula, determine hit
 * location from the to-hit tens digit, resolve via the kernel against the
 * target's worn armour and toughness bonus, and post the damage card. The
 * card is display-only - no HP mutation (apply-damage buttons later).
 */
async function postWeaponDamage(
	attacker: Actor,
	target: Actor,
	weapon: foundry.documents.Item,
	hit: TestOutcome,
): Promise<void> {
	const weaponSys = weapon.system as unknown as {
		damage?: string;
		penetration?: number;
	};
	const damageRoll = new foundry.dice.Roll(weaponSys.damage || "1d5");
	await damageRoll.evaluate();
	const damageTotal = damageRoll.total ?? 0;

	const location = locationForHit(hit.roll ?? 0, rtCore);
	const wornArmour = target.items.filter(
		(i) =>
			(i.type as string) === "armour" &&
			(i.system as unknown as { equipState?: string }).equipState === "worn",
	);
	const armourValue = Math.max(
		0,
		...wornArmour.map((i) =>
			(i.system as unknown as { armourAt(loc: string): number }).armourAt(
				location,
			),
		),
	);
	const toughnessBonus = Math.floor(
		(
			(target.system as unknown as Character).characteristics.t?.value ?? 0
		) / 10,
	);

	const damage = resolveDamage({
		roll: damageTotal,
		penetration: weaponSys.penetration ?? 0,
		toughnessBonus,
		location,
		armourValue,
		profile: rtCore,
	});

	const locationLabelKey = `BODY_LOCATION.${location.replace(/-(.)/g, (_, c: string) => c.toUpperCase())}`;
	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/rogue-trader/template/chat/damage.hbs",
		{
			title: `${attacker.name} → ${target.name} — ${weapon.name}`,
			hitSuccess: true,
			locationLabelKey,
			damage,
		},
	);

	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor: attacker }),
		content,
	});
}

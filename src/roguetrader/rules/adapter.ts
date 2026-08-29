import type { Actor } from "fvtt-types/documents";
import {
	type Modifier,
	resolveTest,
	rtCore,
	sumModifiers,
} from "../../../packages/rules-engine/src/index";
import type { Character } from "../../data/actor/character";
import { collectTestModifiers } from "./funnel";

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

	const modifiers = [...(options.modifiers ?? [])];

	if (!options.skipDialog) {
		const input = await foundry.applications.api.DialogV2.input({
			window: {
				title: `${actor.name} — ${game.i18n.localize(`CHARACTERISTIC.${key.toUpperCase()}`)}`,
			},
			content: `<input name="modifier" type="number" step="10" value="0" min="-100" max="100"
				placeholder="${game.i18n.localize("ROLL.MODIFIERS")}">`,
			ok: { label: "OK" },
		});
		if (input === null) return;
		const value = Number(input);
		if (Number.isFinite(value) && value !== 0) {
			modifiers.push({
				id: "dialog",
				source: { type: "dialog", label: game.i18n.localize("ROLL.DIALOG") },
				label: game.i18n.localize("ROLL.DIALOG"),
				value,
			});
		}
	}

	const title = `${actor.name} — ${game.i18n.localize(`CHARACTERISTIC.${key.toUpperCase()}`)}`;
	await postTest(actor, title, characteristic.value, modifiers);
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
): Promise<void> {
	const collected = collectTestModifiers(actor, title, modifiers);
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
	await postTest(actor, `${actor.name} — ${label}`, characteristic.value, [
		{
			id: "untrained",
			source: { type: "skill", label: "Skill" },
			label: game.i18n.localize("ROLL.UNTRAINED"),
			value: -10,
		},
	]);
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
	await postTest(actor, `${actor.name} — ${item.name}`, baseTarget, modifiers);
}

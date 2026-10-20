/**
 * Evasion (weapon after-hook) — extracted from rules/roll-system.ts
 * (epic kof0, phase 4).
 *
 * Evasion dialog + reaction roll (bead 97a, owner-requested restore).
 * INFORMATIONAL ONLY: posts the defender's reaction test card; it does not
 * modify or cancel the damage flow (manual resolution for now).
 * Rules flags VERIFY: reaction-per-round accounting is not tracked;
 * untrained fallback is characteristic-only with the profile's untrainedSkill
 * model (half the Characteristic round down, Core Rulebook p74, bead tval).
 */

import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type { RollBase } from "../../rules/roll-contract";
import { skillHandler } from "./characteristic-skill";
import { runRoll } from "./orchestrator";
import { findOwnedSkillItem, untrainedCharacteristicFor } from "./skill-lookup";

export async function resolveEvasion(
	defender: Actor,
	attack: { kind: "weapon"; itemId: string; actor: Actor } & RollBase,
): Promise<void> {
	const ports = getPorts();
	const attackType = attack.actor.items.get(attack.itemId)?.type as string;
	const system = systemOf(defender);
	if (!system?.wounds) return;

	const isMelee = attackType === "melee-weapon";
	const skillName = isMelee ? "Parry" : "Dodge";
	// Bead bw9x: the owned-skill lookup and the untrained fallback both read
	// the shared skill-lookup rule now.
	const owned = findOwnedSkillItem(defender, skillName);

	const evasionLabel = ports.i18n.t("DIALOG.EVASION");
	const skillLabel = owned
		? ((owned as { name?: string }).name ?? skillName)
		: `${skillName} (${ports.i18n.t("ROLL.UNTRAINED")})`;
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${defender.name} — ${evasionLabel}` },
		content: `<p>${evasionLabel}: ${skillLabel}</p>`,
		buttons: [
			{
				action: "nothing",
				label: ports.i18n.t("EVASION.DO_NOTHING"),
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

	// Roll the chosen reaction (the card records the attempt; the result is
	// NOT fed into the damage calculation - manual resolution).
	//
	// The re-entry is STATIC through orchestrator.ts with the skill handler
	// (bead 1uai): the old lazy ./perform import existed to break evasion ->
	// perform -> handlers -> weapon -> evasion, but the orchestrator core
	// never imports the handler registry, so the graph is acyclic without a
	// runtime import.
	await runRoll(
		{
			kind: "skill",
			actor: defender,
			...(owned
				? { itemId: owned.id ?? "" }
				: {
						characteristicKey: untrainedCharacteristicFor(skillName),
						label: skillName,
					}),
		},
		skillHandler,
	);
}
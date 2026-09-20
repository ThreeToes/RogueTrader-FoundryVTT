/**
 * Evasion (weapon after-hook) — extracted from rules/roll-system.ts
 * (epic kof0, phase 4).
 *
 * Evasion dialog + reaction roll (bead 97a, owner-requested restore).
 * INFORMATIONAL ONLY: posts the defender's reaction test card; it does not
 * modify or cancel the damage flow (manual resolution for now).
 * Rules flags VERIFY: reaction-per-round accounting is not tracked;
 * untrained fallback is characteristic-only at -10.
 */

import type { Actor } from "fvtt-types/documents";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type { RollBase } from "../../rules/roll-contract";

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
	const owned = defender.items.find(
		(i: { type?: string; name?: string }) =>
			i.type === "skill" && i.name === skillName,
	);

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
	// Lazy import: resolveEvasion re-enters the pipeline, and the pipeline
	// imports the handler registry, which imports weapon.ts (the only caller
	// of this module). A static import would close that cycle.
	const { performRoll } = await import("./perform");
	await performRoll({
		kind: "skill",
		actor: defender,
		...(owned
			? { itemId: owned.id ?? "" }
			: {
					characteristicKey: skillName === "Parry" ? "ws" : "ag",
					label: skillName,
				}),
	});
}

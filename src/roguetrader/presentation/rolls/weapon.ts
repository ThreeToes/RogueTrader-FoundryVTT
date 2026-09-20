/**
 * Weapon attack handler (rollWeaponAttack) — extracted from
 * rules/roll-system.ts (epic kof0, phase 4) and moved onto the ports.
 *
 * The to-hit test carries a "Roll Damage" button (b02/1h2 owner redesign):
 * damage rolls on click, not automatically. The attack-context selectors
 * (fire mode, aim, charge) are supplied to the dialog; the Aim bonus and its
 * Inaccurate cancellation come back as post-dialog rows.
 */

import type { Actor } from "fvtt-types/documents";
import { attackProfileOf } from "../../domain/model/attack";
import { equipStateOf, systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type { RollHandler } from "../../rules/roll-contract";
import { resolveEvasion } from "./evasion";

/** Weapon attack to-hit test (rollWeaponAttack). */
export const weaponHandler: RollHandler<"weapon"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		// Bead kam1: a mutation carrying a printed attack block (Corrosive Bile,
		// Core p369) attacks exactly like a weapon, from the same profile.
		const profile = attackProfileOf(item as never);
		if (!item || !profile) {
			ports.notify.warn("ROLL.UNKNOWN_SKILL");
			return null;
		}
		// Equip-state gate: attacks require the weapon to be carried (the
		// ready state for weapons; armour is worn and cannot attack). Innate
		// attacks belong to the body, so a mutation is never "carried".
		if (!profile.innate && equipStateOf(item) !== "carried") {
			ports.notify.warn("ROLL.NOT_CARRIED", { weapon: item.name });
			return null;
		}
		const system = systemOf(actor);
		const characteristic = system.characteristics[profile.characteristic];
		if (!characteristic) return null;
		return {
			title: `${actor.name} — ${item.name}`,
			baseTarget: characteristic.value,
			testKind: "attack",
			testKey: profile.characteristic,
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: { type: profile.attackType, special: profile.qualities },
			context: {},
			// The melee Charge checkbox sets the "charging" guard itself.
			...(profile.attackType === "melee-weapon"
				? { handledConditionFlags: ["charging"] }
				: {}),
			// Damage flow (b02/1h2, owner redesign): the to-hit card carries a
			// "Roll Damage" button; damage rolls on click, not automatically.
			templateVars: { showDamageButton: true },
		};
	},
	dialogConfig(_request, prepared) {
		// Bead hyv: attack-context selectors (fire mode, aim, charge).
		return {
			attackContext: {
				ranged: prepared.weapon?.type === "ranged-weapon",
				melee: prepared.weapon?.type === "melee-weapon",
			},
		};
	},
	postDialogModifiers(_request, prepared, dialog) {
		// Aim (+10 half / +20 full, p237): a verified book modifier
		// contributed by the dialog, shown in the breakdown like any other
		// row. Inaccurate (VERIFIED book p116, PDF p117): "No bonus is gained
		// from the use of the Aim Action" — the aim bonus never applies; an
		// aimed shot with an Inaccurate weapon shows an explicit 0-value row
		// so the cancellation is visible, not silent.
		if (!dialog.attack?.aimed) return [];
		const special = prepared.weapon?.special ?? [];
		if (special.includes("inaccurate")) {
			return [
				{
					id: "attack:aim-inaccurate",
					source: { type: "dialog", label: "WEAPON.SPECIAL" },
					label: "Inaccurate (no Aim bonus)",
					value: 0,
				},
			];
		}
		return [
			{
				id: "attack:aim",
				source: { type: "dialog", label: "ROLL.AIM" },
				label: dialog.attack.aimFull ? "Aim (Full)" : "Aim (Half)",
				value: dialog.attack.aimFull ? 20 : 10,
			},
		];
	},
	testContext(_request, _prepared, dialog) {
		if (!dialog?.attack) return {};
		return {
			aimed: dialog.attack.aimed,
			fireMode: dialog.attack.fireMode,
			flags: dialog.attack.flags,
		};
	},
	async after(request, _prepared, outcome, messageId) {
		const ports = getPorts();
		// Attach the damage-button flag now that the to-hit outcome exists
		// (data-only kernel: the displayed roll feeds the damage location).
		const target = ports.targets.actor() as Actor | undefined;
		if (outcome.success && messageId) {
			const item = request.actor.items.get(request.itemId);
			await ports.chat.update(messageId, {
				flags: {
					"rogue-trader": {
						damageRoll: {
							attackerUuid: request.actor.uuid,
							weaponUuid: item?.uuid,
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
		if (outcome.success && target && target !== request.actor) {
			try {
				await resolveEvasion(target, request);
			} catch (error) {
				console.error("rogue-trader: evasion roll failed", error);
			}
		}
	},
};

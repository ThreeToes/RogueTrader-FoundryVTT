/**
 * Navigator power activation handler (rollNavigatorPower) — extracted from
 * rules/roll-system.ts (epic kof0, phase 4) and moved onto the ports.
 */

import type { Modifier } from "../../../rules-engine/src/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type { RollHandler } from "../../rules/roll-contract";

/** Navigator power activation (rollNavigatorPower). */
export const navigatorHandler: RollHandler<"navigator"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		if (!item || (item.type as string) !== "navigatorpower") {
			ports.notify.warn("ROLL.UNKNOWN_SKILL");
			return null;
		}
		const system = systemOf(actor);
		const power = item.system as unknown as {
			characteristic?: string;
			mastery?: string;
		};
		const key = power.characteristic ?? "per";
		const characteristic = system.characteristics[key];
		if (!characteristic) {
			ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", { key });
			return null;
		}

		// Navigator power activation (bead sa6, Core Rulebook Ch. VII book
		// p178): a plain Characteristic Test with the mastery bonus
		// (+0/+10/+20 Novice/Adept/Master) as a funnel-visible modifier. NO
		// Focus Power Test, NO Psy Rating, NEVER Psychic Phenomena/Perils
		// (book p178).
		const mastery = power.mastery ?? "novice";
		const bonus =
			(item.system as unknown as { masteryBonusValue?: number })
				.masteryBonusValue ?? 0;
		const masteryLabel = ports.i18n.t(
			`NAVIGATOR_POWER.${mastery.toUpperCase()}`,
		);
		const masteryModifier: Modifier = {
			id: "navigator-mastery",
			source: { type: "item", label: "SOURCE.FROM_POWERS" },
			label: masteryLabel,
			value: bonus,
		};
		return {
			title: `${actor.name} — ${item.name} (${masteryLabel})`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: key,
			initialModifiers: [masteryModifier],
			weapon: null,
			context: {},
		};
	},
};

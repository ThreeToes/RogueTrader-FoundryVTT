/**
 * Characteristic and skill roll handlers — extracted from
 * rules/roll-system.ts (epic kof0, phase 4) and moved onto the ports.
 *
 * A skill test is either trained (a skill item, ladder steps of +10) or
 * untrained (raw characteristic with the −10 penalty as a visible funnel
 * modifier).
 */

import type { Modifier } from "../../../rules-engine/src/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import type {
	PreparedRoll,
	RollHandler,
	RollRequest,
} from "../../rules/roll-contract";

/** Characteristic test (rollTest). */
export const characteristicHandler: RollHandler<"characteristic"> = {
	async prepare(request) {
		const system = systemOf(request.actor);
		const characteristic = system.characteristics[request.key];
		if (!characteristic) {
			getPorts().notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", {
				key: request.key,
			});
			return null;
		}
		return {
			title: `${request.actor.name} — ${getPorts().i18n.t(`CHARACTERISTIC.${request.key.toUpperCase()}`)}`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: request.key,
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: null,
			context: {},
		};
	},
};

/** Skill test: trained (skill item) or untrained (raw characteristic -10). */
export const skillHandler: RollHandler<"skill"> = {
	async prepare(request) {
		if (request.itemId !== undefined) return prepareTrainedSkill(request);
		return prepareUntrainedSkill(request);
	},
};

async function prepareTrainedSkill(
	request: Extract<RollRequest, { kind: "skill" }>,
): Promise<PreparedRoll<"skill"> | null> {
	const ports = getPorts();
	const actor = request.actor;
	const item = actor.items.get(request.itemId ?? "");
	if (!item || (item.type as string) !== "skill") {
		ports.notify.warn("ROLL.UNKNOWN_SKILL");
		return null;
	}
	const system = systemOf(actor);
	const skill = item.system as unknown as {
		characteristic: string;
		ladder: number;
	};
	const characteristic = system.characteristics[skill.characteristic];
	if (!characteristic) {
		ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", {
			key: skill.characteristic,
		});
		return null;
	}
	// Bead r1k: skill tests carry the skill item's name so item effects
	// keyed "skill:<name>" (Medikit → Medicae etc.) apply to the right
	// tests only.
	const skillName = (item.name ?? "").toLowerCase();
	return {
		title: `${actor.name} — ${item.name}`,
		baseTarget: characteristic.value + (skill.ladder - 1) * 10,
		testKind: "skill",
		testKey: skill.characteristic,
		initialModifiers: [...(request.modifiers ?? [])],
		weapon: null,
		context: { skillName },
	};
}

async function prepareUntrainedSkill(
	request: Extract<RollRequest, { kind: "skill" }>,
): Promise<PreparedRoll<"skill"> | null> {
	const ports = getPorts();
	const actor = request.actor;
	const characteristicKey = request.characteristicKey ?? "";
	const system = systemOf(actor);
	const characteristic = system.characteristics[characteristicKey];
	if (!characteristic) {
		ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", {
			key: characteristicKey,
		});
		return null;
	}
	// Untrained attempt of a basic skill: characteristic value with the RAW
	// -10 penalty expressed as a funnel modifier (breakdown shows it
	// explicitly). Advanced skills cannot be attempted untrained (enforced
	// by callers).
	const untrainedModifier: Modifier = {
		id: "untrained",
		source: { type: "skill", label: "Skill" },
		label: ports.i18n.t("ROLL.UNTRAINED"),
		value: -10,
	};
	return {
		title: `${actor.name} — ${request.label ?? ""}`,
		baseTarget: characteristic.value,
		testKind: "skill",
		testKey: characteristicKey,
		initialModifiers: [untrainedModifier],
		weapon: null,
		context: {},
	};
}

/**
 * Characteristic and skill roll handlers — extracted from
 * rules/roll-system.ts (epic kof0, phase 4) and moved onto the ports.
 *
 * A skill test is either trained (a skill item, ladder steps of +10) or
 * untrained (the profile's untrainedSkill model — RT Core: HALF the governing
 * Characteristic, round down, Core Rulebook p74).
 */

import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import type { Modifier } from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { characteristicLabelKey } from "../../rules/labels";
import { effectiveProfile } from "../../rules/homebrew";
import { collectTestModifiers } from "../../rules/funnel";
import type {
	PreparedRoll,
	RollHandler,
	RollRequest,
} from "../../rules/roll-contract";

/**
 * Warn once per session that the flat-penalty model was selected without a
 * penalty (bead wxut.1 discovery 3). Once, because the read happens on every
 * untrained roll and the GM only needs to hear it once.
 */
let warnedFlatPenalty = false;
function warnUnconfiguredFlatPenalty(): void {
	if (warnedFlatPenalty) return;
	warnedFlatPenalty = true;
	console.warn(
		"rogue-trader | skills.untrainedSkill.model is \"flat-penalty\" but no skills.untrainedSkill.penalty is set — running the core half-characteristic model. Set a penalty to use flat-penalty.",
	);
}

export function resetUntrainedSkillWarningForTests(): void {
	warnedFlatPenalty = false;
}

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
			title: `${request.actor.name} — ${getPorts().i18n.t(characteristicLabelKey(request.key))}`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: request.key,
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: null,
			context: {},
		};
	},
};

/** Skill test: trained (skill item) or untrained (profile model). */
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
	// Untrained attempt of a basic skill — the model comes from the EFFECTIVE
	// profile (bead tval), never a hardcoded constant. Bead wxut.2 switched
	// this read from config.profile() to effectiveProfile(), because
	// untrainedSkill.model/penalty are GM-tunable registry knobs.
	const profile = effectiveProfile();
	const untrained = profile.untrainedSkill;

	// Discovery 3 (bead wxut.1): `skills.untrainedSkill.penalty` has NO core
	// value — the RT core model halves the characteristic, so nothing is
	// stored. A delta that switches the model to flat-penalty WITHOUT setting
	// a penalty is therefore NOT CONFIGURED, not "a penalty of zero": warn
	// once and run the core half-characteristic model rather than emitting
	// undefined into a funnel row (a silent modifier, which AGENTS.md calls a
	// bug).
	const flatPenalty =
		untrained.model === "flat-penalty" ? untrained.penalty : undefined;
	const unconfiguredFlatPenalty =
		untrained.model === "flat-penalty" && !Number.isFinite(flatPenalty);
	if (unconfiguredFlatPenalty) warnUnconfiguredFlatPenalty();
	// The model actually applied: flat-penalty only when a finite penalty is
	// set, otherwise the core half-characteristic path.
	const model = unconfiguredFlatPenalty ? "half-characteristic" : untrained.model;

	let baseTarget: number;
	let initialModifiers: Modifier[];
	// Fold-exclusion key (bead 3swn): the surrogate the half-characteristic
	// branch hands the pipeline as `testKey` so the characteristic-keyed rows
	// folded into the halved base cannot be applied a second time (see the
	// branch comment).
	const funnelKey = `untrained:${characteristicKey}`;
	if (model === "half-characteristic") {
		// Bead 3swn (owner ruling 2026-10-08): the half applies to the EFFECTIVE
		// characteristic — the stored value PLUS the characteristic-keyed
		// modifier rows the funnel applies to trained tests of the same
		// characteristic (mutations, gear, origin traits). Those rows are summed
		// here and folded in BEFORE halving; caller/dialog rows and "any test"
		// wildcard rows are situational modifiers that ride on top exactly as
		// the trained path gets them, so they stay excluded from the fold.
		//
		// The fold is enforced with the funnel-key SURROGATE above: the
		// pipeline's shared test step (and dialog) collect rows for
		// `prepared.testKey`, and keyed rows match on `testKey ===
		// context.key` — a surrogate the keyed rows cannot match keeps them out
		// of the post-prepare collections, while a wildcard (empty-key) row
		// matches ANY key and still applies. Equivalence with the trained path
		// holds by construction: the fold set is exactly the delta between a
		// funnel collection under the real key and one under the surrogate —
		// same ActorView, same test kind, no weapon — i.e. the same rows the
		// shared test step would collect, minus the surrogate-only collision
		// (an authored row keyed to the surrogate string is, in effect, asking
		// for the surrogate behaviour).
		const view = actorView(request.actor);
		const keyed = collectTestModifiers(view, {
			kind: "skill",
			key: characteristicKey,
		});
		const wild = collectTestModifiers(view, { kind: "skill", key: funnelKey });
		const wildcardIds = new Set(wild.map((mod) => mod.id));
		const characteristicDelta = keyed
			.filter((mod) => !wildcardIds.has(mod.id))
			.reduce((sum, mod) => sum + mod.value, 0);
		// Core Rulebook p74: an untrained Basic Skill Test uses HALF the
		// governing Characteristic, round down — the Sidebar "Treating Advanced
		// Skills as Basic Skills" (p74) uses the same rule, and the Dodge
		// example (p244: Ag 30 untrained → target 15) confirms it. The fold is
		// baked into the target: NO separate characteristic-modifier rows reach
		// the breakdown (the surrogate key keeps the funnel from applying them
		// a second time).
		baseTarget = Math.floor((characteristic.value + characteristicDelta) / 2);
		initialModifiers = [...(request.modifiers ?? [])];
	} else {
		// flat-penalty fallback for a sibling system: full characteristic with
		// the profile penalty as a visible funnel modifier (breakdown shows it
		// explicitly). Advanced skills cannot be attempted untrained (enforced
		// by callers).
		baseTarget = characteristic.value;
		initialModifiers = [
			{
				id: "untrained",
				// The label is an i18n KEY (bead vese): the TestDialog localizes the
				// source column, so a raw "Skill" string warned and never translated.
				source: { type: "skill", label: "SOURCE.FROM_SKILL" },
				label: ports.i18n.t("ROLL.UNTRAINED"),
				value: Number.isFinite(flatPenalty) ? (flatPenalty ?? 0) : 0,
			},
			...(request.modifiers ?? []),
		];
	}
	return {
		title: `${actor.name} — ${request.label ?? ""}`,
		baseTarget,
		testKind: "skill",
		// Half-characteristic: the fold surrogate (bead 3swn — characteristic
		// rows are already inside the halved base); flat-penalty: the real
		// characteristic key (the profile penalty rides as a visible row).
		testKey: model === "half-characteristic" ? funnelKey : characteristicKey,
		initialModifiers,
		weapon: null,
		context: {},
	};
}

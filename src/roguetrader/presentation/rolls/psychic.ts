/**
 * Psychic power activation handler (rollPsychicPower) — extracted from
 * rules/roll-system.ts (epic kof0, phase 4) and moved onto the ports.
 *
 * Covers the casting-mode resolution (epic 0hap: psyker vs sorcerer), the
 * Strength selection (Table 6-1: Fettered / Unfettered / Push), the Focus
 * Power Test auto-fail floor (bead sa6, book p157) and the post-roll
 * phenomena / damage / corruption follow-ups.
 */

import type { Modifier } from "../../../rules-engine/src/index";
import { systemOf } from "../../data/accessors";
import { actorView } from "../../infrastructure/foundry/actor-view";
import { getPorts } from "../../infrastructure/foundry/ports";
import {
	effectiveSorceryRank,
	resolveCasting,
	sorceryLearnable,
} from "../../rules/casting";
import { resolvePushCap, type HomebrewProfile } from "../../rules/homebrew";
import { resolvePower } from "../../rules/power-resolution";
import {
	effectivePsyRating,
	focusPowerAutoFailFloor,
	psyRatingBonus,
	shouldRollPhenomena,
	type StrengthLevel,
} from "../../rules/psychic";
import {
	applyPowerCorruption,
	focusTestKey,
	postPowerDamage,
	rollPhenomena,
} from "./psychic-support";
import type { RollHandler } from "../../rules/roll-contract";
import { collectSorceryRank } from "../../rules/talent-effects";
import { promptStrength } from "../roll-prompts";

/** Psychic power activation (rollPsychicPower). */
export const psychicHandler: RollHandler<"psychic"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		if (!item || (item.type as string) !== "psychicpower") {
			ports.notify.warn("ROLL.UNKNOWN_SKILL");
			return null;
		}
		const system = systemOf(actor);
		const power = item.system as unknown as {
			powerClass?: string;
			subtype?: string;
			focusTest?: string;
			focusTime?: string;
			damage?: string;
			name?: string;
			castAs?: string;
		};
		// Casting mode (epic 0hap): the owned power's castAs override, else the
		// actor's default (a non-psyker sorcerer casts as a sorcerer). Book-side
		// notation stays in the pack data; the substitution happens here.
		const casting = resolveCasting(power, {
			psyker: system.psyker,
			psyRating: system.psyRating,
			// Owned Sorcerer/Master Sorcerer talents win; the manual field is
			// the GM/homebrew fallback (epic 0hap).
			sorceryRank: effectiveSorceryRank(
				collectSorceryRank(actorView(actor)),
				system.sorceryRank,
			),
			sanctioned: system.sanctioned,
			corruption: system.corruption,
			// EA p85: unmodified Intelligence Bonus (no Unnatural multiplier).
			intelligenceBonus: Math.floor(
				(system.characteristics.int?.value ?? 0) / 10,
			),
		});
		if (
			casting.mode === "psychic" &&
			(system.psyRating ?? 0) < 1 &&
			system.psyker !== true
		) {
			ports.notify.warn("PSYCHIC_POWER.NOT_PSYKER");
			return null;
		}
		// EA p86: Free Action powers cannot be learned through Sorcery — a
		// sorcerous activation always requires a ritual gesture.
		if (casting.mode === "sorcery" && !sorceryLearnable(power.focusTime)) {
			ports.notify.warn("PSYCHIC_POWER.SORCERY_FREE_ACTION");
			return null;
		}

		// Strength selection (Table 6-1): Fettered (half PR, no phenomena),
		// Unfettered (full PR, doubles trigger phenomena), Push (+1..cap,
		// automatic phenomena). Push cap: sanctioned +3, renegades/sorcerers
		// +4 (book p157), overridable by the homebrew profile.
		const homebrew = ports.config.homebrew() as HomebrewProfile | null;
		const cap = resolvePushCap(homebrew, casting.sanctioned);
		const strength = request.skipDialog
			? "unfettered"
			: await promptStrength(cap);
		if (!strength) return null;
		// Push level is encoded in the prompt choice ("push:2"); default +1.
		const [strengthRaw, pushLevelsRaw] = strength.split(":");
		// One cast at the parse boundary, so every later read is typed.
		const strengthLevel = strengthRaw as StrengthLevel;
		const pushLevels =
			strengthLevel === "push"
				? Math.min(cap, Math.max(1, Number(pushLevelsRaw ?? "1") || 1))
				: 0;

		const sustainedCount = system.sustainedPowers?.length ?? 0;
		const effPr = effectivePsyRating({
			psyRating: casting.rating,
			strength: strengthLevel,
			pushLevels,
			sustainedCount,
		});
		const psyBonus = psyRatingBonus(effPr);

		// Focus Power Test characteristic: sorcery always uses Intelligence
		// (EA p85); otherwise the power's own focusTest (usually Willpower,
		// sometimes Psyniscience as a skill).
		const testKey = casting.testKeyOverride || focusTestKey(power.focusTest);
		const characteristic = system.characteristics[testKey];
		if (!characteristic) {
			ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", { key: testKey });
			return null;
		}

		const psyBonusModifier: Modifier = {
			id: "psy-rating",
			source: { type: "item", label: "SOURCE.FROM_POWERS" },
			label: ports.i18n.t("PSYCHIC_POWER.PSY_RATING_BONUS"),
			value: psyBonus,
		};
		const strengthLabel = ports.i18n.t(
			`PSYCHIC_POWER.STRENGTH_${strengthLevel.toUpperCase()}`,
		);
		return {
			title: `${actor.name} — ${item.name} (${strengthLabel})`,
			baseTarget: characteristic.value,
			testKind: "focus-power",
			testKey,
			initialModifiers: [psyBonusModifier],
			weapon: null,
			context: {},
			// Bead sa6: Focus Power Tests auto-fail on rolls of 91+ (book
			// p157). Profile data, not an if/else.
			autoFailRoll: focusPowerAutoFailFloor(),
			// after() needs the rolled strength for the phenomena trigger, and
			// the push + corruption modifiers (book p157; EA p86).
			kindData: {
				strength: strengthLevel,
				pushLevels,
				sustainedCount,
				corruption: casting.phenomenaFlat,
				mode: casting.mode,
			},
		};
	},
	async after(request, prepared, outcome, _messageId) {
		const item = request.actor.items.get(request.itemId);
		const power = item?.system as unknown as
			| { subtype?: string; damage?: string; name?: string }
			| undefined;
		const data = prepared.kindData;
		// Psychic Phenomena (Table 6-1 triggers, book p157).
		if (data && shouldRollPhenomena(data.strength, outcome)) {
			await rollPhenomena(request.actor, {
				pushLevels: data.pushLevels,
				sustainedCount: data.sustainedCount,
				// Sorcerer Corruption total, added FIRST (EA p86).
				corruption: data.corruption,
			});
		}
		// Success handling via the resolution registry (design mso6 addendum).
		if (outcome.success && power) {
			const resolution = resolvePower(power.subtype);
			if (resolution.damage && power.damage) {
				await postPowerDamage(request.actor, power.name ?? "", power.damage);
			}
		}
		// Corruption-on-manifest (epic 0hap): Summon Daemon grants 1d10+4 CP
		// (EA p83). Applied after a successful manifestation, mirroring damage.
		if (outcome.success && item) {
			await applyPowerCorruption(request.actor, item);
		}
	},
};

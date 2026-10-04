/**
 * System configuration (epic kof0, phase 5): everything that must be in place
 * before the first DataModel schema is built, plus the module extension points
 * and the homebrew setting.
 *
 * Split out of the former 983-line sheet/init.ts composition root. The namespace is
 * created (on first use) by registry.ts's createRegistries factory, so the
 * warmers can attach their providers without racing each other.
 */

import { attachRegistriesToConfig } from "../registry";
import { STATUS_IMG, SYSTEM_STATUSES } from "../rules/conditions";
import { testContributors } from "../rules/funnel";
import { HOMEBREW_SETTING, parseHomebrewProfile } from "../rules/homebrew";
import { talentEffectHandlers } from "../rules/talent-effects";
import { registerSharedPartials } from "../sheet/partials";

/** The system id, with a fallback for the pre-init window. */
export function systemId(): string {
	return game.system?.id ?? "rogue-trader";
}

/** The CONFIG.ROGUE_TRADER extension namespace, created on first use. */
export function rogueTraderConfig(): Record<string, unknown> {
	const config = CONFIG as unknown as {
		ROGUE_TRADER?: Record<string, unknown>;
	};
	config.ROGUE_TRADER ??= {};
	return config.ROGUE_TRADER;
}

/**
 * System statuses (bead q1ql, p0af): transient conditions (Shock/Fear
 * outcomes, Stunned, On Fire...) as Foundry-native token markers. The pure
 * registry lives in rules/conditions.ts; carried as ActiveEffects whose
 * system.testModifier change the funnel's "effect" contributor already
 * consumes. REPLACES the core defaults wholesale (p0af): the stock
 * D&D-flavoured statuses have no meaning here and clutter the HUD; our
 * "unconscious"/"stunned" ids intentionally shadow the core ones.
 */
function registerSystemStatuses(): void {
	(CONFIG as unknown as { statusEffects?: unknown[] }).statusEffects =
		SYSTEM_STATUSES.map((status) => ({
			id: status.id,
			name: game.i18n?.localize(status.labelKey) ?? status.id,
			img: STATUS_IMG[status.id] ?? "icons/svg/aura.svg",
			statuses: [status.id],
			// Foundry copies the status config onto the AE the HUD toggle
			// creates, so the test-penalty change rides along and the funnel's
			// "effect" contributor applies it with a visible breakdown — no
			// silent modifiers even when a condition is applied from the HUD
			// rather than via conditionEffectData (epic vr1o / bead c9nt).
			...(status.testPenalty !== 0
				? {
						changes: [
							{
								key: "system.testModifier",
								mode: 2, // CONST.ACTIVE_EFFECT_MODES.ADD
								value: status.testPenalty,
							},
						],
					}
				: {}),
		}));
}

/**
 * Rounds-based condition durations (bead u3i7): v14 core already ticks
 * rounds-dated ActiveEffects — Combat#onStartTurn refreshes the effect
 * registry (foundry.mjs:51944), the rounds remaining are recomputed as
 * `duration.value − (currentRound − start.round)`
 * (_prepareCombatBasedDuration, foundry.mjs:50141-50144), expiry defaults to
 * the "turnStart" event for any numbered duration (duration schema initial,
 * foundry.mjs:15802-15803) and isExpiryEvent("turnStart") only matches the
 * effect owner's own combatant turn (foundry.mjs:50635), and legacy
 * `{rounds: n}` source data is migrated to `{value, units}` on document
 * construction (BaseActiveEffect#migrateDuration, foundry.mjs:15965-15980) —
 * so conditionEffectData's shape needs no migration of our own. The one gap:
 * core's default expiryAction is "update" (foundry.mjs:218589-218593), which
 * only flags the expired effect (duration.expired = true, #updateExpiredEffects
 * foundry.mjs:49556) and leaves the condition marker on the token. Setting
 * "delete" routes expiry through core's own delete write path
 * (#deleteExpiredEffects, foundry.mjs:49572) so timed conditions auto-remove
 * at 0 on the owning combatant's turn start, as the bead outcome requires.
 * Encounter-length conditions carry no duration, so they are never in the
 * expired set — their removal stays with the deleteCombat cleanup
 * (presentation/combat-end.ts).
 */
function registerDurationAutomation(): void {
	const activeEffect = (CONFIG as unknown as {
		ActiveEffect?: { expiryAction?: string };
	}).ActiveEffect;
	if (!activeEffect) return; // pre-config bootstrap window: core reads the default
	activeEffect.expiryAction = "delete";
}

/** Registries, partials, statuses, extension points and the homebrew setting. */
export function registerSystemConfig(): void {
	attachRegistriesToConfig();
	registerSharedPartials();
	registerSystemStatuses();
	registerDurationAutomation();

	// Module extension point for test modifiers (funnel v2, see rules/funnel.ts).
	const rtc = rogueTraderConfig();
	rtc.testContributors = testContributors;
	rtc.talentEffectHandlers = talentEffectHandlers;

	// Homebrew seam (bead 9if): world setting stores the house-rule profile;
	// the funnel reads it through this provider. GM-configurable
	// (Configure Settings -> Rogue Trader -> Homebrew profile JSON).
	//
	// fvtt-types narrows the namespace parameter to "core"; a system id is a
	// legitimate value at runtime, so the settings surface is described here
	// once rather than cast at each call.
	const settings = game.settings as unknown as
		| {
				register(ns: string, key: string, data: object): void;
				get(ns: string, key: string): unknown;
		  }
		| undefined;
	settings?.register(systemId(), HOMEBREW_SETTING, {
		name: "HOMEBREW.PROFILE_NAME",
		hint: "HOMEBREW.PROFILE_HINT",
		scope: "world",
		config: true,
		type: String,
		default: "",
	});
	rtc.homebrew = {
		// parseHomebrewProfile tolerates undefined (returns NO_HOMEBREW), so an
		// absent settings API degrades to core rules rather than throwing.
		getProfile: () =>
			parseHomebrewProfile(settings?.get(systemId(), HOMEBREW_SETTING)),
	};
}

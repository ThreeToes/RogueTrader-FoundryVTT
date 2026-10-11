/**
 * System configuration (epic kof0, phase 5): everything that must be in place
 * before the first DataModel schema is built, plus the module extension points
 * and the homebrew settings.
 *
 * Split out of the former 983-line sheet/init.ts composition root. The namespace is
 * created (on first use) by registry.ts's createRegistries factory, so the
 * warmers can attach their providers without racing each other.
 */

import type { ProfileDelta } from "../../ffg/domain/rule-knobs";
import { RulesApp } from "../presentation/rules-app";
import { attachRegistriesToConfig } from "../registry";
import { STATUS_IMG, SYSTEM_STATUSES } from "../rules/conditions";
import { testContributors } from "../rules/funnel";
import {
	ACTIVE_PROFILE_ID_SETTING,
	activeProfileDelta,
	HOMEBREW_SETTING,
	registeredModuleRuleProfiles,
	registerModuleRuleProfile,
	RULE_PROFILES_SETTING,
} from "../rules/homebrew";
import { talentEffectHandlers } from "../rules/talent-effects";
import { registerSharedPartials } from "../sheet/partials";

/** The system id, with a fallback for the pre-init window. */
export function systemId(): string {
	return game.system?.id ?? "rogue-trader";
}

/**
 * The Configure Settings menu key that opens the rules app (bead wxut.4).
 *
 * The rule-profile settings themselves are `config: false` — a GM must never
 * hand-write a profile the app cannot render — so this button is the only
 * route in, and it is GM-restricted (`restricted: true`).
 */
export const RULES_APP_MENU_KEY = "rulesProfiles";

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
	const activeEffect = (
		CONFIG as unknown as {
			ActiveEffect?: { expiryAction?: string };
		}
	).ActiveEffect;
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

	// Module extension point for house-rule profiles (bead wxut.6, sharing tier
	// T2): a module calls this during ITS OWN init with
	// `{id, name, delta}`, where delta is knob-keyed data against the same
	// registry the rules app writes. The registry is pure and lives beside the
	// seam (rules/homebrew.ts); this only puts it on the namespace, exactly as
	// the two above are put there.
	//
	// A registration is VALIDATED HERE and refused LOUDLY: a bad shape or a delta
	// the registry does not describe is warned with the id and the offending
	// knob and never registered — a module that ships a typo must not quietly
	// run core rules, and init must never throw, so the warning is the failure.
	rtc.registerRuleProfile = registerModuleRuleProfile;
	// The READ half of the same seam: the rules app lists what modules
	// registered (read-only, activation only). A function, not a snapshot —
	// modules keep registering while the app is open.
	rtc.ruleProfiles = registeredModuleRuleProfiles;

	// Homebrew seam (bead 9if, profiles by bead wxut.3): world settings hold
	// the named house-rule profiles and the active profile's id; the rules seam
	// reads them through this provider. All three are `config: false` — the
	// rules app (bead wxut.4) edits them, not the native settings form, so a GM
	// cannot hand-write a profile the app cannot render.
	//
	// fvtt-types narrows the namespace parameter to "core"; a system id is a
	// legitimate value at runtime, so the settings surface is described here
	// once rather than cast at each call.
	const settings = game.settings as unknown as
		| {
				register(ns: string, key: string, data: object): void;
				registerMenu(ns: string, key: string, data: object): void;
				get(ns: string, key: string): unknown;
				set(ns: string, key: string, value: unknown): unknown;
		  }
		| undefined;
	// Retired pre-profile key: no longer on the settings form, but kept
	// registered so the clear below has a key Foundry accepts a read and a
	// write through (it refuses both for an unregistered key).
	settings?.register(systemId(), HOMEBREW_SETTING, {
		scope: "world",
		config: false,
		type: String,
		default: "",
	});
	settings?.register(systemId(), RULE_PROFILES_SETTING, {
		scope: "world",
		config: false,
		type: String,
		default: "",
	});
	settings?.register(systemId(), ACTIVE_PROFILE_ID_SETTING, {
		scope: "world",
		config: false,
		type: String,
		default: "",
	});
	clearLegacyHomebrewSetting(settings);
	registerRulesAppMenu(settings);
	rtc.homebrew = {
		// The seam READ (bootstrap/config.ts attaches the provider): the active
		// profile's knob-keyed DELTA, decoded and validated by
		// effectiveProfile() in rules/homebrew.ts — this side only looks
		// something up, it never merges. An absent settings API degrades to
		// core rules rather than throwing.
		getProfile: () => activeProfileDeltaFromSettings(settings),
	};
}

/** The slice of the settings surface the rule-profile seam needs. */
interface RuleProfileSettings {
	get(ns: string, key: string): unknown;
}

/** The settings surface plus the menu registration the rules app needs. */
interface SettingsMenuSurface extends RuleProfileSettings {
	set(ns: string, key: string, value: unknown): unknown;
	registerMenu(ns: string, key: string, data: object): void;
}

/**
 * Register the Configure Settings button that opens the rules app.
 *
 * `restricted: true` gates it to a GM: a house-rule profile is world
 * configuration, so a player must not be able to open it. Registration is
 * skipped when the settings surface is absent (a stripped harness) and never
 * allowed to break init — a missing button is not a broken system.
 */
export function registerRulesAppMenu(
	settings: SettingsMenuSurface | undefined,
): void {
	if (!settings) return;
	const label = (key: string): string =>
		game.i18n?.localize(key) ?? key;
	try {
		settings.registerMenu(systemId(), RULES_APP_MENU_KEY, {
			name: label("RULES.MENU_NAME"),
			label: label("RULES.MENU_LABEL"),
			hint: label("RULES.MENU_HINT"),
			icon: "fa-solid fa-sliders",
			// Foundry instantiates this class when the button is clicked; the app
			// takes no constructor arguments (registerMenu's type contract).
			type: RulesApp,
			restricted: true,
		});
	} catch (error) {
		console.warn(
			"rogue-trader | could not register the rules app menu:",
			error,
		);
	}
}

/** `RuleProfileSettings` plus the write the legacy clear needs. */
interface LegacyHomebrewSurface extends RuleProfileSettings {
	set(ns: string, key: string, value: unknown): unknown;
}

/** Report a failed legacy clear. Init must never throw, so this only warns. */
function warnLegacyClearFailure(error: unknown): void {
	console.warn(
		"rogue-trader | could not clear the retired homebrew setting:",
		error,
	);
}

/**
 * Clear the RETIRED legacy homebrew setting (owner ruling 2026-10-10).
 *
 * A world that still holds a pre-profile house-rule JSON has it CLEARED, not
 * migrated: live house rules reset to core rules and must be re-entered as a
 * named profile. Left alone when there is nothing to clear, and never allowed
 * to break init — a setting Foundry refuses to read or write only warns,
 * because the rules run perfectly well without the legacy value.
 *
 * Exported for its own unit test; `registerSystemConfig` calls it once at init.
 */
export function clearLegacyHomebrewSetting(
	settings: LegacyHomebrewSurface | undefined,
): void {
	if (!settings) return;
	try {
		const legacy = settings.get(systemId(), HOMEBREW_SETTING);
		if (legacy === null || legacy === undefined || legacy === "") return;
		// Foundry's set returns a Promise; the repo idiom is a bare .catch
		// (see bootstrap/hooks.ts) — the write's failure must not escape init.
		Promise.resolve(settings.set(systemId(), HOMEBREW_SETTING, "")).catch(
			(error: unknown) => warnLegacyClearFailure(error),
		);
	} catch (error) {
		warnLegacyClearFailure(error);
	}
}

/**
 * The `homebrew` provider body (bead wxut.3): read the two rule-profile
 * settings and hand back the ACTIVE profile's knob-keyed delta, or null when
 * there is none (core rules). An absent settings surface — or a key Foundry
 * refuses to read — degrades to null instead of throwing.
 *
 * This is the WORLD's side only (bead wxut.6): the module layer a module
 * registered at its own init is not a settings read, so `effectiveProfile`
 * composes it — module layer first, this delta second — rather than this
 * provider knowing about it. One merge, one place.
 */
export function activeProfileDeltaFromSettings(
	settings: RuleProfileSettings | undefined,
): ProfileDelta | null {
	if (!settings) return null;
	try {
		return activeProfileDelta(
			settings.get(systemId(), RULE_PROFILES_SETTING),
			settings.get(systemId(), ACTIVE_PROFILE_ID_SETTING),
		);
	} catch (error) {
		console.warn("rogue-trader | could not read the rule profiles:", error);
		return null;
	}
}

/**
 * System configuration (epic kof0, phase 5): everything that must be in place
 * before the first DataModel schema is built, plus the module extension points
 * and the homebrew setting.
 *
 * Split out of the 983-line sheet/init.ts composition root. This module is the
 * only place the CONFIG.ROGUE_TRADER namespace is created, so the warmers can
 * attach their providers without racing each other.
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
		}));
}

/** Registries, partials, statuses, extension points and the homebrew setting. */
export function registerSystemConfig(): void {
	attachRegistriesToConfig();
	registerSharedPartials();
	registerSystemStatuses();

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

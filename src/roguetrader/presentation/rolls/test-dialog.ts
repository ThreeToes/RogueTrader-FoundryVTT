/**
 * The TestDialog's house-rule indicator (epic wxut, child B7).
 *
 * WHY IT EXISTS: AGENTS.md — "Modifiers are visible ... silent modifiers are
 * bugs." A house-rule profile is a modifier on every roll in the world, so the
 * dialog that collects a roll's modifiers names the profile those numbers come
 * from (owner ruling 2026-10-10: name AND override count, with a click-through
 * to the rules app).
 *
 * WHAT IS PURE AND WHAT IS NOT: `testDialogProfileIndicator` is the decision —
 * read the two rule-profile settings, find the row in force, count what it
 * actually overrides, compose the localised header — and it takes the stored
 * values plus an i18n `format` seam, so it unit-tests without a Foundry
 * instance. `activeTestDialogProfileIndicator` and `openRulesApp` are the
 * Foundry-coupled edges beside it (the settings read and the rules-app window)
 * because the RT rules layer may not touch a Foundry global itself
 * (architecture.test.ts, FOUNDRY_COUPLED_RULES).
 *
 * WHICH RULES (bead w9sa.2): "what it actually overrides" is counted through
 * the app's core-vs-effective diff against the ACTIVE system's registry
 * (`ruleKnobs()`), which is RT's until a sibling system registers its own. A
 * dialog that counted Rogue Trader's knobs on a Dark Heresy world would show a
 * player a house rule that is not in force — the silent-modifier class AGENTS.md
 * calls a bug.
 */

import type { ProfileDelta } from "../../../ffg/domain/rule-knobs";
import { ruleKnobs } from "../../../ffg/domain/rule-knobs";
import { SYSTEM_ID_FALLBACK } from "../../../ffg/domain/system-id";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import {
	ACTIVE_PROFILE_ID_SETTING,
	RULE_PROFILES_SETTING,
} from "../../rules/homebrew";
import { RulesApp } from "../rules-app";
import {
	CORE_PROFILE_ID,
	type ModuleProfileRow,
	profileDiffRows,
	selectedProfile,
	stateFromSettings,
} from "../rules-view-model";

/** The TestDialog header's house-rule indicator. */
export interface TestDialogProfileIndicator {
	/** The active profile's stored name (its id when it has no name). */
	readonly name: string;
	/** How many knobs the active profile actually overrides. */
	readonly overrideCount: number;
	/**
	 * The localised header sentence, e.g. "House rules: Lethal (3 overrides)".
	 * Composed here (not in the template) so the wording lives in the lang
	 * files with its {name}/{count} placeholders.
	 */
	readonly label: string;
	/** The localised tooltip naming the click-through to the rules app. */
	readonly hint: string;
}

/** An i18n.format-like seam, injected so the builder stays pure. */
export type ProfileIndicatorFormat = (
	key: string,
	vars?: Record<string, unknown>,
) => string;

/**
 * The header view for the active profile, or null when CORE RULES are in
 * force — nothing is rendered then: no empty chip, no divider, no noise on a
 * world with no house rules.
 *
 * "In force" is the seam's own rule (`activeProfileDelta`, bead wxut.3): an
 * empty or unknown active id is core rules, and so is a profile that overrides
 * nothing (the app's rule 1 — an untouched profile stores an empty delta).
 */
export function testDialogProfileIndicator(
	storedProfiles: unknown,
	activeProfileId: unknown,
	format: ProfileIndicatorFormat,
	moduleProfiles: readonly ModuleProfileRow[] = [],
): TestDialogProfileIndicator | null {
	const state = stateFromSettings(storedProfiles, activeProfileId, moduleProfiles);
	// `selectedProfile`, not `selectedRow`: the latter searches the WORLD's rows
	// only, so a module profile in force (bead wxut.6) would resolve to nothing
	// and the indicator would vanish while that module's rules were running.
	const selected =
		state.activeId === CORE_PROFILE_ID
			? null
			: selectedProfile(state, state.activeId);
	if (!selected?.known) return null;
	const overrideCount = overrideCountFor(selected.delta);
	if (overrideCount === 0) return null;
	const name = selected.name;
	return {
		name,
		overrideCount,
		label: format(
			overrideCount === 1 ? "ROLL.HOUSE_RULES_ONE" : "ROLL.HOUSE_RULES",
			{ name, count: overrideCount },
		),
		hint: format("ROLL.HOUSE_RULES_HINT"),
	};
}

/**
 * How many knobs the delta actually overrides.
 *
 * Counted through the app's OWN core-vs-effective diff rather than by counting
 * delta keys, so the number the dialog shows is the number of rules that are
 * genuinely different from the Core Rulebook. Two consequences that are the
 * point: a knob stored with its core value is not an override (the app never
 * stores one, a hand-written profile may), and an unknown key — which the seam
 * warns about and ignores, so core rules keep running — is not an override
 * either.
 */
function overrideCountFor(delta: ProfileDelta): number {
	// The registry is the ACTIVE system's (bead w9sa.2), so the count is of the
	// rules actually in force — never of Rogue Trader's knobs by default.
	return profileDiffRows(delta, ruleKnobs()).filter(
		(row) => !row.unknown && row.overridden,
	).length;
}

// ---------------------------------------------------------------------------
// Foundry-coupled edges (see the module header)
// ---------------------------------------------------------------------------

/** The slice of the settings surface this module reads. */
interface SettingsSurface {
	get(ns: string, key: string): unknown;
}

/**
 * Read the two rule-profile settings through a narrowed global, so an absent
 * or stripped-down harness degrades to core rules (no indicator) instead of
 * throwing out of a dialog render. The settings namespace is the system id
 * with the pre-init fallback (ffg/domain/system-id.ts, bead 6f99) — the same
 * lines rules-app.ts and bootstrap/config.ts read (see template-root.ts for
 * the sibling-system caveat).
 */
export function activeTestDialogProfileIndicator(): TestDialogProfileIndicator | null {
	const globals = globalThis as {
		game?: { settings?: SettingsSurface; system?: { id?: string } };
	};
	const settings = globals.game?.settings;
	const systemId = globals.game?.system?.id ?? SYSTEM_ID_FALLBACK;
	if (!settings) return null;
	const read = (key: string): unknown => {
		try {
			return settings.get(systemId, key);
		} catch (error) {
			console.warn(`rogue-trader | could not read ${key}:`, error);
			return "";
		}
	};
	const moduleRows = readModuleProfileRegistrations();
	return testDialogProfileIndicator(
		read(RULE_PROFILES_SETTING),
		read(ACTIVE_PROFILE_ID_SETTING),
		(key, vars) => getPorts().i18n.t(key, vars),
		moduleRows,
	);
}

/**
 * Module-registered profiles (bead wxut.6), read off the namespace the same way
 * `rules-app.ts` reads them.
 *
 * WITHOUT this a module profile in force reads as CORE here:
 * `stateFromSettings` only resolves `activeId` against rows it knows about, so a
 * module id would silently mean "core rules" and the TestDialog would show no
 * indicator while a module's house rules were actually running — the
 * silent-modifier class AGENTS.md calls a bug. A missing or hostile namespace
 * degrades to an empty list, so a world with no modules is unaffected.
 */
function readModuleProfileRegistrations(): readonly ModuleProfileRow[] {
	const registrations = (
		globalThis as {
			CONFIG?: { ROGUE_TRADER?: { ruleProfiles?: () => unknown } };
		}
	).CONFIG?.ROGUE_TRADER?.ruleProfiles;
	if (typeof registrations !== "function") return [];
	try {
		const registered = registrations();
		return Array.isArray(registered)
			? (registered as readonly ModuleProfileRow[])
			: [];
	} catch (error) {
		console.warn(
			"rogue-trader | could not read module rule profiles:",
			error,
		);
		return [];
	}
}

/**
 * Open the rules app (bead wxut.4). The app takes no constructor arguments,
 * so the dialog needs no wiring of its own; the window is resizable.
 *
 * GM-ONLY, matching the menu button the app is registered with (bead wxut.4:
 * a house-rule profile is world configuration). The indicator itself is shown
 * to EVERYONE — a player is entitled to see which house rules their numbers
 * come from — but a player's click opens nothing rather than an editor whose
 * settings write they are not permitted to make.
 */
export async function openRulesApp(): Promise<void> {
	if (!isGM()) return;
	const app = new RulesApp();
	await app.render(true);
}

/** The acting user, read through a narrowed global (no user = not a GM). */
function isGM(): boolean {
	const globals = globalThis as { game?: { user?: { isGM?: unknown } } };
	return globals.game?.user?.isGM === true;
}

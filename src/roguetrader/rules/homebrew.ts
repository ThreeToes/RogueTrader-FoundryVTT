/**
 * Homebrew rules seam (bead 9if): data-driven house-rule overrides layered
 * over the rules engine WITHOUT touching core code.
 *
 * Shape: a `HomebrewProfile` data object stored in world settings (GM-
 * configurable); the funnel reads it through a provider attached at init
 * (CONFIG.ROGUE_TRADER.homebrew.getProfile). Pure resolution helpers live
 * here so tests cover the math without Foundry. Modules can register richer
 * providers via the same seam.
 *
 * Pilot rule: fire-mode BS bonuses (Core Rulebook p237 core values: Semi-Auto +10,
 * Full Auto +20 — the owner's motivating example for tuning).
 */

/** Homebrew overrides. Every field optional; absent = core rule applies. */
export interface HomebrewProfile {
	id: string;
	/** Fire-mode to-hit bonuses on attack tests (core: burst +10, full +20). */
	fireModeBonus?: { burst: number; full: number };
}

/** Core book values (Core Rulebook p237, verified in the attack-context contributor). */
export const CORE_FIRE_MODE_BONUS = { burst: 10, full: 20 } as const;

/** No homebrew active. */
export const NO_HOMEBREW: HomebrewProfile = { id: "rt-core" };

/**
 * Resolve the effective fire-mode bonus for an attack context. Pure: takes
 * the profile (or null/undefined for core rules) and the mode.
 */
export function resolveFireModeBonus(
	profile: HomebrewProfile | null | undefined,
	mode: "burst" | "full" | "single" | undefined,
): number | null {
	if (mode !== "burst" && mode !== "full") return null;
	if (profile?.fireModeBonus) {
		return mode === "burst"
			? profile.fireModeBonus.burst
			: profile.fireModeBonus.full;
	}
	return mode === "burst" ? CORE_FIRE_MODE_BONUS.burst : CORE_FIRE_MODE_BONUS.full;
}

/** Default settings key storing the JSON-serialized profile. */
export const HOMEBREW_SETTING = "homebrewProfile";

/** Parse a stored settings value; malformed data falls back to core (warns). */
export function parseHomebrewProfile(stored: unknown): HomebrewProfile {
	if (stored === null || stored === undefined || stored === "") {
		return NO_HOMEBREW;
	}
	if (typeof stored === "object") {
		return stored as HomebrewProfile;
	}
	try {
		const parsed = JSON.parse(String(stored)) as HomebrewProfile;
		if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
			return parsed;
		}
	} catch {
		// fall through to the warning below
	}
	console.warn("rogue-trader: malformed homebrew profile — using core rules.");
	return NO_HOMEBREW;
}
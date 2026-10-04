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

import {
	DEFAULT_SYSTEM_PROFILE,
	rtCore,
	type SystemProfile,
} from "../../ffg/domain/system-profile";
import type { Modifier } from "../../rules-engine/modifier";
import { testContributors } from "../../ffg/application/funnel";
import { getPorts } from "../infrastructure/foundry/ports";

// ---------------------------------------------------------------------------
// Built-in funnel contributor: attack action modifiers (bead hyv), hoisted out
// of the (now system-neutral) funnel into the RT module that owns the data
// (bead 8ycd). Values VERIFIED against the core action table (p237):
//   Semi-Auto Burst: "+10 to BS, additional hit for every two degrees"
//   Full Auto Burst: "+20 to BS, additional hit for every degree"
// Additional hits are out of scope here (to-hit modifier only). The core
// bonuses come from the profile seam (ports.config.profile()); the homebrew
// override comes from ports.config.homebrew() — data-driven house rules, no
// core-code edits (bead 9if).
// ---------------------------------------------------------------------------
testContributors.register("attack-context", (_view, context) => {
	if (context.kind !== "attack") return [];
	const homebrew = getPorts().config.homebrew() as HomebrewProfile | null;
	const mods: Modifier[] = [];
	if (context.fireMode === "burst") {
		const burst = resolveFireModeBonus(homebrew, "burst");
		if (burst !== null) {
			mods.push({
				id: "attack:fire-mode:burst",
				source: { type: "item", label: "ROLL.FIRE_MODE_BURST" },
				label: "Semi-Auto Burst",
				value: burst,
			});
		}
	}
	if (context.fireMode === "full") {
		const full = resolveFireModeBonus(homebrew, "full");
		if (full !== null) {
			mods.push({
				id: "attack:fire-mode:full",
				source: { type: "item", label: "ROLL.FIRE_MODE_FULL" },
				label: "Full Auto Burst",
				value: full,
			});
		}
	}
	return mods;
});

/** Homebrew overrides. Every field optional; absent = core rule applies. */
export interface HomebrewProfile {
	id: string;
	/** Fire-mode to-hit bonuses on attack tests (core: burst +10, full +20). */
	fireModeBonus?: { burst: number; full: number };
	/**
	 * Psychic Strength Push caps (epic 0hap; core Table 6-1 p157: sanctioned
	 * +3, renegades/sorcerers +4). Data-driven so a group can tune the cap
	 * without touching core rules.
	 */
	pushCap?: { sanctioned: number; other: number };
	/**
	 * Launcher ammunition auto-consume (epic ui4b): firing a loaded launcher
	 * decrements the loaded ordnance's quantity by the shots spent. Book-
	 * accurate default is FALSE (absent = core rule, the manual −1 chip); the
	 * funnel application lives in the sibling bead (65sq).
	 */
	ammoAutoConsume?: boolean;
}

/** Core book values (Core Rulebook p237) — RT profile data (bead yszf). */
export const CORE_FIRE_MODE_BONUS = rtCore.fireModeBonus;

/** Core Push caps (Table 6-1, Core Rulebook p157) — RT profile data. */
export const CORE_PUSH_CAP = rtCore.pushCap;

/** No homebrew active. */
export const NO_HOMEBREW: HomebrewProfile = { id: "rt-core" };

/**
 * Resolve the effective fire-mode bonus for an attack context. Pure: takes
 * the profile (or null/undefined for core rules) and the mode.
 */
export function resolveFireModeBonus(
	profile: HomebrewProfile | null | undefined,
	mode: "burst" | "full" | "single" | undefined,
	system: SystemProfile = DEFAULT_SYSTEM_PROFILE,
): number | null {
	if (mode !== "burst" && mode !== "full") return null;
	if (profile?.fireModeBonus) {
		return mode === "burst"
			? profile.fireModeBonus.burst
			: profile.fireModeBonus.full;
	}
	return mode === "burst" ? system.fireModeBonus.burst : system.fireModeBonus.full;
}

/**
 * Effective Push cap (epic 0hap). Pure: the profile override wins when it
 * carries a finite value, otherwise the core Table 6-1 cap (sanctioned +3,
 * renegade/sorcerer +4). Never below 1 (Push must grant at least +1).
 */
export function resolvePushCap(
	profile: HomebrewProfile | null | undefined,
	sanctioned: boolean,
	system: SystemProfile = DEFAULT_SYSTEM_PROFILE,
): number {
	const core = sanctioned ? system.pushCap.sanctioned : system.pushCap.other;
	const override = profile?.pushCap;
	if (!override) return core;
	const value = sanctioned ? override.sanctioned : override.other;
	return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : core;
}

/**
 * Resolve the ammo auto-consume toggle (epic ui4b). Pure: null/undefined/
 * missing flag all resolve to FALSE — the book-accurate default.
 */
export function resolveAmmoAutoConsume(
	profile: HomebrewProfile | null | undefined,
): boolean {
	return profile?.ammoAutoConsume === true;
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
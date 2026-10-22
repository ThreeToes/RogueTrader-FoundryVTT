/**
 * The port contract itself (bead w9sa.8, audit finding A1).
 *
 * `ConfigPort.profile()` used to be typed on RT's `SystemProfile`, so the shared
 * port demanded RT's own creation/advancement constants and a sibling system's
 * profile could not be returned through it at all. It is now
 * `RuleProfile & Partial<SystemBranding>` — the kernel rules profile every pure
 * resolver reads, plus the two optional system-branding fields.
 *
 * This file is Foundry-free, like the layer it tests, and pins BOTH halves of
 * that contract with plain objects: a bare kernel+branding profile (no RT
 * constant anywhere) and RT's own profile, through the same `ConfigPort` shape.
 */

import { describe, expect, it } from "bun:test";
import type { ConfigPort, ConfigProfile } from "./ports";
import { rtCore } from "../domain/system-profile";

/** The kernel fields a bare profile must carry to be a `RuleProfile` at all. */
const KERNEL_BASE = {
	id: "sibling-core",
	critOnDouble: false,
	autoFailRoll: 100,
	autoPassRoll: 1,
	primitiveArmourDouble: false,
	righteousFury: { enabled: true, trigger: "damaging-hit" },
	hitLocations: { "01-10": "head", "11-20": "right-arm" },
} as const;

/**
 * The bare sibling profile: the kernel, plus branding, plus NOTHING RT. Not one
 * of `characteristicBase`, `pointBuyBudget`, `fireModeBonus`, `pushCap`,
 * `untrainedSkill`, `eliteAdvanceBaseCost`, `penaltyPerDamagePoint`,
 * `repairTestModifier` or `ammoAutoConsume` — exactly the object the old
 * `profile(): SystemProfile` refused.
 */
const siblingProfile: ConfigProfile = {
	...KERNEL_BASE,
	messageFlagNamespace: "dark-heresy-2e",
	rollCardTemplate: "systems/dark-heresy-2e/template/chat/roll.hbs",
};

/** Build the narrowest possible `ConfigPort` around one profile. */
function configPortFor(profile: ConfigProfile): ConfigPort {
	return {
		homebrew: () => null,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
		profile: () => profile,
	};
}

describe("ConfigPort.profile's widened contract (bead w9sa.8)", () => {
	it("accepts a kernel + branding profile carrying no RT constant", () => {
		const profile = configPortFor(siblingProfile).profile();
		// Kernel reads resolve — the rules layer is not RT-specific.
		expect(profile.id).toBe("sibling-core");
		expect(profile.critOnDouble).toBe(false);
		expect(profile.hitLocations["01-10"]).toBe("head");
		// Branding reads resolve — the two fields that ARE "the system".
		expect(profile.messageFlagNamespace).toBe("dark-heresy-2e");
		expect(profile.rollCardTemplate).toBe(
			"systems/dark-heresy-2e/template/chat/roll.hbs",
		);
		// RT's rule data is genuinely absent, not defaulted to zero.
		for (const rtOnly of [
			"characteristicBase",
			"pointBuyBudget",
			"pointBuyMax",
			"creatorLastStep",
			"preSpentBaseline",
			"fireModeBonus",
			"pushCap",
			"untrainedSkill",
			"eliteAdvanceBaseCost",
			"penaltyPerDamagePoint",
			"repairTestModifier",
			"ammoAutoConsume",
		] as const) {
			expect(rtOnly in profile).toBe(false);
		}
	});

	it("still accepts RT's own SystemProfile — unchanged, and still identical", () => {
		// `configPortFor` takes a ConfigProfile, so this only COMPILES because
		// RT's SystemProfile still satisfies the widened contract field for field
		// (the application layer is typechecked, unlike these tests).
		const profile = configPortFor(rtCore).profile();
		// Identity, not equality: RT's object is the same object it always was,
		// so every consumer that still holds a reference to it is unaffected.
		expect(profile).toBe(rtCore);
		// The kernel and branding halves resolve exactly as they always did.
		expect(profile.critOnDouble).toBe(true);
		expect(profile.messageFlagNamespace).toBe("rogue-trader");
		expect(profile.rollCardTemplate).toContain("chat/roll.hbs");
		// What the widening COSTS, stated plainly: RT's creation/advancement
		// constants are no longer reachable THROUGH the port's type — the only
		// consumer that needed them is RT's own homebrew layer
		// (src/roguetrader/rules/homebrew.ts#effectiveProfile), which now states
		// RT's precondition instead of reading them off the shared seam.
		// Bead cmio.2: the constants moved onto the kernel vocabulary members.
		expect(rtCore.generation.base).toBe(25);
		expect(rtCore.fireModes.semiAutoBurst.modifier).toBe(10);
		expect(rtCore.fireModes.fullAutoBurst.modifier).toBe(20);
		expect(rtCore.psychicPush.caps).toEqual({ sanctioned: 3, other: 4 });
	});
});

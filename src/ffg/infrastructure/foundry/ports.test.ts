/**
 * The NEUTRAL Foundry config port (bead w9sa.8, audit finding A1).
 *
 * `ConfigPort.profile()` used to be typed on Rogue Trader's own `SystemProfile`,
 * which meant a sibling system's profile could not be returned through the
 * shared port at all — the biggest fork risk the w9sa.5 audit found. The port is
 * now the kernel `RuleProfile` plus OPTIONAL system branding, so this file pins
 * both halves of the contract:
 *
 *  • the NEUTRAL default still resolves the shared default profile (RT is
 *    byte-identical), and
 *  • a `dh2Core`-shaped KERNEL + BRANDING object — one carrying none of RT's
 *    creation/advancement constants — rides the `setConfigOverrides` seam and is
 *    readable by every consumer that only touches kernel fields.
 *
 * The Foundry globals are stubbed before the dynamic import because the ports
 * module touches the Foundry implementation set at load.
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {};

import { afterAll, describe, expect, test } from "bun:test";
import { locationForHit, resolveTest } from "../../../rules-engine/index";
import { messageFlagNamespace } from "../../application/chat-flags";
import type { ConfigProfile } from "../../application/ports";
import { dh2Core } from "../../domain/system-profile-dark-heresy";
import { DEFAULT_SYSTEM_PROFILE } from "../../domain/system-profile";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

/**
 * A sibling system's profile as the widened port accepts it: `dh2Core`'s
 * KERNEL-readable values plus its own branding — and NOT ONE of RT's
 * creation/advancement constants (`characteristicBase`, `pointBuyBudget`,
 * `fireModeBonus`, `pushCap`, `untrainedSkill`, `eliteAdvanceBaseCost`, ...),
 * which is precisely the shape the old `profile(): SystemProfile` refused.
 *
 * The four rule fields are written as literals rather than read off `dh2Core`
 * because `DarkHeresyProfile` deliberately types them `T | undefined`
 * (`system-profile-dark-heresy.ts`'s `Omit<RuleProfile, ...>` + `| undefined`
 * re-declarations) to pin what the book verifies. `dh2KernelMatchesDh2Core`
 * below asserts every literal equals the sibling's own value, so this fixture
 * cannot drift from it.
 *
 * `satisfies ConfigProfile` is the type-level half of the proof. A test file
 * sits outside both tsconfigs so bun strips it, but the annotation documents
 * (and would enforce) that the shape is assignable.
 */
const dh2KernelProfile = {
	// Printed p22: nothing about doubles — character Criticals come from damage
	// exceeding wounds (p232). RT, by contrast, IS crit-on-double.
	critOnDouble: false,
	// Printed p22: "if the result is 100, then the test automatically fails".
	autoFailRoll: 100,
	// Printed p22: "if the result of the percentile roll is 1, the test
	// automatically succeeds". DH1's remembered 01-05 does NOT apply.
	autoPassRoll: 1,
	// VERIFIED ABSENT (printed p227): Step Five subtracts Toughness bonus plus
	// Armour points; "Primitive (X)" is a WEAPON quality (p148), not an armour
	// rule.
	primitiveArmourDouble: false,
	righteousFury: dh2Core.righteousFury,
	// Table 7-3, printed p226: identical bands to RT's Table 9-6, read on the
	// reversed digits of the roll.
	hitLocations: dh2Core.hitLocations,
	// Ten characteristics, Influence last (printed pp21-22).
	characteristics: dh2Core.characteristics,
	id: dh2Core.id,
	// The sibling's own branding. The template path is the sibling module's to
	// choose — bead w9sa.9 owns deriving a root from the active system id.
	messageFlagNamespace: "dark-heresy-2e",
	rollCardTemplate: "systems/dark-heresy-2e/template/chat/roll.hbs",
} satisfies ConfigProfile;

describe("the neutral config port's profile() (bead w9sa.8)", () => {
	test("the neutral default still resolves the shared default profile", async () => {
		const { foundryPorts } = await import("./ports");
		// RT is byte-identical: the same object the RT shim re-exports.
		expect(foundryPorts.config.profile()).toBe(DEFAULT_SYSTEM_PROFILE);
	});

	test("a kernel + branding profile with NO RT constants rides the override seam", async () => {
		const { foundryPorts, setConfigOverrides } = await import("./ports");
		// `configOverrides` is module-level and has no reset, so a leaked
		// override would retune every suite bun runs afterwards (one process).
		// Clear it on the way out.
		setConfigOverrides({ profile: () => dh2KernelProfile });
		try {
			const profile = foundryPorts.config.profile();
			expect(profile).toBe(dh2KernelProfile);
			expect(profile.id).toBe(dh2Core.id);

			// The fixture IS dh2Core-shaped: every rule field equals the
			// sibling's own verified value (its `| undefined` typing is the
			// pinned hole, not a value we invented here).
			expect(dh2KernelProfile.critOnDouble).toBe(dh2Core.critOnDouble);
			expect(dh2KernelProfile.autoFailRoll).toBe(dh2Core.autoFailRoll);
			expect(dh2KernelProfile.autoPassRoll).toBe(dh2Core.autoPassRoll);
			expect(dh2KernelProfile.primitiveArmourDouble).toBe(
				dh2Core.primitiveArmourDouble,
			);

			// --- kernel consumers: every field-only read resolves ------------
			// The kernel rules resolvers take a RuleProfile and read nothing
			// else, so a sibling profile drives them unchanged.
			// Table 7-3, read on the REVERSED digits of the roll (20 reads as 02).
			expect(locationForHit(20, profile)).toBe("head");
			expect(locationForHit(88, profile)).toBe("left-leg");
			expect(resolveTest({ target: 50, roll: 1, profile }).success).toBe(true);
			// DH2's verified auto-pass band (printed p22: a roll of 1 auto-succeeds)
			// is read THROUGH the kernel, not from an RT default.
			expect(resolveTest({ target: 1, roll: 1, profile }).success).toBe(true);
			// The auto-FAIL band is deliberately NOT asserted here: the kernel's
			// comparison is `roll > autoFailRoll`, so with DH2's verified 100 the
			// band never fires on a d100. That off-by-one is open bead vhfh, not
			// this one's business — asserting it here would pin the bug.

			// --- branding consumers ------------------------------------------
			// The two "the system" fields are the only non-kernel data the
			// shared machinery reads, and they resolve from the sibling's own
			// values rather than a hardcoded RT namespace.
			expect(messageFlagNamespace(foundryPorts)).toBe("dark-heresy-2e");
			expect(profile.rollCardTemplate).toBe(
				"systems/dark-heresy-2e/template/chat/roll.hbs",
			);

			// The rule data RT owns is genuinely ABSENT, not defaulted: the
			// sibling profile does not pretend to carry RT's constants.
			expect("fireModeBonus" in profile).toBe(false);
			expect("characteristicBase" in profile).toBe(false);
			expect("pushCap" in profile).toBe(false);
			expect("eliteAdvanceBaseCost" in profile).toBe(false);
		} finally {
			setConfigOverrides({ profile: undefined });
		}
	});

	test("clearing the override restores the neutral default", async () => {
		const { foundryPorts } = await import("./ports");
		expect(foundryPorts.config.profile()).toBe(DEFAULT_SYSTEM_PROFILE);
	});

	test("a profile with NO branding refuses loudly instead of guessing a namespace", async () => {
		const { foundryPorts, setConfigOverrides } = await import("./ports");
		setConfigOverrides({
			profile: () => ({
				id: "unbranded-core",
				critOnDouble: false,
				autoFailRoll: null,
				autoPassRoll: null,
				primitiveArmourDouble: false,
				righteousFury: { enabled: false, trigger: "damaging-hit" },
				hitLocations: {},
			}),
		});
		try {
			// The KERNEL half of the widened contract still works fine: branding
			// is optional precisely so a system that has not branded yet can boot.
			expect(foundryPorts.config.profile().critOnDouble).toBe(false);
			// The BRANDING half refuses rather than writing chat flags under
			// `undefined` — the silent bug this repo refuses.
			expect(() => messageFlagNamespace(foundryPorts)).toThrow(
				/messageFlagNamespace/,
			);
		} finally {
			setConfigOverrides({ profile: undefined });
		}
	});
});

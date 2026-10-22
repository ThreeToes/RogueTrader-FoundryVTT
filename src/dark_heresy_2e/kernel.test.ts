/**
 * The kernel accepts a DH2 profile (bead cmio.3).
 *
 * THE PROOF the bead asks for: `resolveTest`, `locationForHit` and
 * `resolveDamage` — the kernel resolvers in `src/rules-engine/test.ts` and
 * `src/rules-engine/damage.ts` — run UNMODIFIED against the DH2 profile, and
 * every value they read back is the value bead w9sa.6 verified against the DH2
 * Core Rulebook: 100 auto-fails, 1 auto-passes (single digit, NOT DH1's
 * 01-05), a double on a successful test is NOT a Critical Hit, and there is NO
 * primitive-armour doubling. This mirrors `src/rules-engine/kernel.test.ts`
 * case for case where DH2 differs.
 *
 * Why this matters: the DH2 profile was once one `as` away from the config
 * port (bead w9sa.4). The four kernel rule fields now carry the kernel's own
 * types (bead cmio.3 closed the `| undefined` holes), and the kernel resolvers
 * read the rule surface off the DH2 profile directly — no adaptation, no RT
 * fallback, no restated value. Only the creation-time fields
 * (`startingWounds`, `startingFate`) remain DH2-shaped, and the kernel
 * resolvers never read those.
 */
import { describe, expect, test } from "bun:test";

import { resolveDamage } from "../rules-engine/damage";
import { locationForHit, resolveTest } from "../rules-engine/test";
import { dh2Core } from "../ffg/domain/system-profile-dark-heresy";
import { rtCore, type RuleProfile } from "../rules-engine/profile";

/**
 * The kernel-facing view of `dh2Core`, and the WHOLE residual blocker set,
 * named in one type (bead cmio.3).
 *
 * Every field the kernel resolvers read carries the kernel's own type on
 * `DarkHeresyProfile` now, so the ONLY thing keeping the raw profile from
 * `TestRequest`/`DamageRequest`'s `profile: RuleProfile` is the two OPTIONAL
 * creation-time fields DH2 redefines (`startingWounds`, `startingFate`) — a
 * smaller blocker set than the four `| undefined` rule holes cmio.3 closed.
 * The resolvers never read either field (they are creation-time data), so the
 * view drops exactly those two keys from the TARGET type and nothing else:
 * a `dh2Core` value satisfies it verbatim, no cast, no adaptation.
 *
 * If the parent later types the kernels' request `profile` param as this
 * kernel-read surface instead of full `RuleProfile`, DH2 callers drop the
 * view — that decision lives in `src/rules-engine`, outside this bead.
 */
type KernelRuleSurface = Omit<
	RuleProfile,
	"startingWounds" | "startingFate"
>;
const dh2KernelProfile: KernelRuleSurface = dh2Core;

describe("resolveTest (dh2-core drives the kernel)", () => {
	test("degrees resolve exactly as in the kernel's own tests", () => {
		const outcome = resolveTest({
			target: 60,
			roll: 60,
			profile: dh2KernelProfile,
		});
		expect(outcome.success).toBe(true);
		expect(outcome.degrees).toBe(1);
		expect(outcome.margin).toBe(0);
		expect(
			resolveTest({ target: 60, roll: 50, profile: dh2KernelProfile })
				.degrees,
		).toBe(2);
	});

	test("100 auto-fails even when the target exceeds 100 (printed p22)", () => {
		// "if the result is 100, then the test automatically fails, even if the
		// target number is greater than 100." A target above 100 only exists
		// with stacked modifiers — exactly the case the book calls out.
		expect(
			resolveTest({ target: 115, roll: 100, profile: dh2KernelProfile })
				.success,
		).toBe(false);
		// Inclusive band: 99 against a 115 target still succeeds.
		expect(
			resolveTest({ target: 115, roll: 99, profile: dh2KernelProfile })
				.success,
		).toBe(true);
	});

	test("1 auto-passes even when the target is below 1 (printed p22)", () => {
		// "if the result of the percentile roll is 1, the test automatically
		// succeeds, even if the target number is less than 1."
		expect(
			resolveTest({ target: 0, roll: 1, profile: dh2KernelProfile }).success,
		).toBe(true);
	});

	test("the auto-pass band is the SINGLE digit 1, not DH1's 01-05 (printed p22)", () => {
		// A 2 against target 1 fails: DH2e has no 01-05 auto-pass band.
		expect(
			resolveTest({ target: 1, roll: 2, profile: dh2KernelProfile }).success,
		).toBe(false);
	});

	test("a double on a SUCCESSFUL test is NOT a Critical Hit (printed p22, p232)", () => {
		// The same request that criticals in RT (kernel.test.ts asserts true):
		// 55 on 60 is a success, a double, and in DH2e just a success.
		const dh2 = resolveTest({
			target: 60,
			roll: 55,
			profile: dh2KernelProfile,
		});
		expect(dh2.success).toBe(true);
		expect(dh2.isDouble).toBe(true);
		expect(dh2.critical).toBe(false);

		const rt = resolveTest({ target: 60, roll: 55, profile: rtCore });
		expect(rt.critical).toBe(true);

		// And 22 on 60, RT's other critical case: still not a critical in DH2e.
		expect(
			resolveTest({ target: 60, roll: 22, profile: dh2KernelProfile })
				.critical,
		).toBe(false);
	});

	test("echoes the raw roll, degrees/margin shape unchanged", () => {
		expect(resolveTest({ target: 60, roll: 37, profile: dh2KernelProfile }).roll).toBe(
			37,
		);
		expect(
			resolveTest({ target: 60, roll: 61, profile: dh2KernelProfile }).margin,
		).toBe(-1);
	});
});

describe("locationForHit (dh2-core drives the kernel)", () => {
	// Table 7-3 (DH2 printed p226) carries IDENTICAL bands to RT's Table 9-6;
	// the DH2 profile reuses the same reversed-digit keying, so a sample of
	// boundary rolls resolves through dh2Core alone. Full band coverage lives
	// in kernel.test.ts; here the proof is that DH2's OWN table answers.
	test("boundary rolls read Table 7-3 through dh2Core", () => {
		const cases: Array<[number, string]> = [
			[10, "head"], // "10" -> 01
			[11, "right-arm"], // 11
			[12, "left-arm"], // "12" -> 21
			[13, "body"], // "13" -> 31
			[17, "right-leg"], // "17" -> 71
			[68, "left-leg"], // "68" -> 86
			[0, "left-leg"], // 00 -> 100
		];
		for (const [roll, location] of cases) {
			expect(locationForHit(roll, dh2KernelProfile)).toBe(location);
		}
	});
});

describe("resolveDamage (dh2-core drives the kernel)", () => {
	test("no primitive-armour doubling: Primitive (X) is a WEAPON quality (printed p148, p227)", () => {
		// The request that DOUBLES wounds under RT's profile (kernel.test.ts
		// asserts primitiveDouble true, wounds 4): DH2e subtracts Toughness
		// bonus plus armour and nothing more, so the same request resolves flat.
		const request = {
			roll: 4,
			penetration: 0,
			toughnessBonus: 0,
			location: "body",
			armourValue: 2,
			weaponPrimitive: false,
			armourPrimitive: true,
		} as const;
		const dh2 = resolveDamage({ ...request, profile: dh2KernelProfile });
		expect(dh2.primitiveDouble).toBe(false);
		expect(dh2.wounds).toBe(2);

		const rt = resolveDamage({ ...request, profile: rtCore });
		expect(rt.primitiveDouble).toBe(true);
		expect(rt.wounds).toBe(4);
	});

	test("soak resolves normally: armour + TB, pen reduces armour only", () => {
		const outcome = resolveDamage({
			roll: 12,
			penetration: 2,
			toughnessBonus: 3,
			location: "body",
			armourValue: 5,
			profile: dh2KernelProfile,
		});
		expect(outcome.effectiveArmour).toBe(3);
		expect(outcome.soak).toBe(6);
		expect(outcome.wounds).toBe(6);
	});
});
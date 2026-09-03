import type { RuleProfile } from "./profile";

/**
 * FFG test resolution (RT core flavour): roll d100 against a target number
 * where lower is better. Success margin grants degrees: one degree at roll
 * exactly equal to target, plus one per additional full 10 below.
 *
 * Crits: a "double" (matching tens/units digits, e.g. 22, 55, 00) is reported
 * as data. Per the RT core book (VERIFY: wording), doubles on successful
 * weapon tests produce Critical Hits; the system layer decides how to
 * present or consume them.
 */
export interface TestRequest {
	/** Target number the roll must be at or under. */
	target: number;
	/** The d100 result (1-100). */
	roll: number;
	profile: RuleProfile;
}

export interface TestOutcome {
	/** The raw d100 roll (echoed so adapters can use it, e.g. hit location). */
	roll: number;
	/** Did the roll meet the target (also true for exact match)? */
	success: boolean;
	/** Degrees of success (0 on failure). */
	degrees: number;
	/** The raw margin: target - roll (positive = succeeded by that much). */
	margin: number;
	/** Matching tens/units digits. */
	isDouble: boolean;
	/** Profile-flagged critical indication (success + critOnDouble + double). */
	critical: boolean;
}

function isDouble(roll: number): boolean {
	// d100 values 1-100; tens digit of 100 is 10 -> constrain to 0-9 so 00 counts.
	const tens = Math.floor(roll / 10) % 10;
	const units = roll % 10;
	return tens === units;
}

export function resolveTest(request: TestRequest): TestOutcome {
	const { target, roll, profile } = request;

	let success = roll <= target;
	if (profile.autoPassRoll !== null && roll <= profile.autoPassRoll) {
		success = true;
	}
	if (profile.autoFailRoll !== null && roll > profile.autoFailRoll) {
		success = false;
	}

	const degrees = success ? Math.floor(Math.max(0, target - roll) / 10) + 1 : 0;
	const double = isDouble(roll);

	return {
		roll,
		success,
		degrees,
		margin: target - roll,
		isDouble: double,
		critical: profile.critOnDouble && success && double,
	};
}

/**
 * Hit location from the to-hit d100 tens digit, per the profile's table.
 * Pure table lookup; falls back to "body" for unknown digits.
 */
export function locationForHit(hitRoll: number, profile: RuleProfile): string {
	const tens = String(Math.floor(Math.abs(hitRoll) / 10) % 10);
	return profile.hitLocations?.[tens] ?? "body";
}

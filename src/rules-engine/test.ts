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

/**
 * Degrees of success: one degree at roll exactly equal to target, plus one
 * per additional full 10 under. The success-side half of the degrees rule.
 */
export function degreesOfSuccess(target: number, roll: number): number {
	return Math.floor(Math.max(0, target - roll) / 10) + 1;
}

/**
 * Degrees of failure: the mirror-image failure-side half of the degrees
 * rule. Must not drift from `degreesOfSuccess`.
 */
export function degreesOfFailure(target: number, roll: number): number {
	return Math.floor(Math.max(0, roll - target) / 10) + 1;
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

	const degrees = success ? degreesOfSuccess(target, roll) : 0;
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
 * Reverse the digits of a d100 roll (Core Rulebook Table 9-6, printed p244:
 * Hit Locations read the REVERSED roll). 20 -> 02 = 2; 00/100 -> 100.
 */
function reversedD100(hitRoll: number): number {
	const digits = String(((Math.abs(hitRoll) % 100) + 100) % 100).padStart(2, "0");
	const reversed = Number(digits[1] + digits[0]);
	return reversed === 0 ? 100 : reversed;
}

/** Parse one "low-high" band key ("01-10", tolerant of whitespace). */
function parseHitBand(key: string): [number, number] | null {
	const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(key);
	if (!match) return null;
	const to100 = (raw: string) => (Number(raw) === 0 ? 100 : Number(raw));
	return [to100(match[1]), to100(match[2])];
}

/**
 * Hit location from the to-hit d100 roll, per the Core Rulebook (Table 9-6:
 * Hit Locations, printed p244): the roll's digits are reversed, then read
 * against the profile's range bands. Falls back to "body" out of range.
 */
export function locationForHit(hitRoll: number, profile: RuleProfile): string {
	const table = profile.hitLocations;
	if (!table) return "body";
	const reversed = reversedD100(hitRoll);
	for (const [key, location] of Object.entries(table)) {
		const band = parseHitBand(key);
		if (band && reversed >= band[0] && reversed <= band[1]) return location;
	}
	return "body";
}

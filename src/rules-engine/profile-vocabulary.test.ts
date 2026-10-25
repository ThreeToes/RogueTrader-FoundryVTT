/**
 * The shared fire-mode vocabulary (bead w9sa.12).
 *
 * `FireModes` used to be a CLOSED triple — RT's `{standard, semiAutoBurst,
 * fullAutoBurst}` — so a sibling system whose book models a different set
 * (DH2e prints Standard +10 / Full-Auto Burst -10, and no separate single-shot
 * action, printed p223/p226) could not express its own fire modes without
 * pretending to have RT's three. The set is now a name-keyed map: a mode a
 * profile does not model is ABSENT, and consumers ask through `fireModeRule`.
 *
 * These tests pin the WIDENED shape, not any system's values — a system's mode
 * table is its own data (`rtCore.fireModes`, `dh2Core.fireModes`).
 */
import { describe, expect, test } from "bun:test";

import {
	FIRE_MODES,
	type FireMode,
	type FireModeRule,
	type FireModes,
	fireModeRule,
} from "./profile-vocabulary";

/** A rule a system could declare; the modifier values are irrelevant here. */
const rule = (modifier: number): FireModeRule => ({
	modifier,
	characteristic: "ballistic-skill",
});

describe("FireModes is a name-keyed map, not RT's closed triple", () => {
	test("a two-mode set is a COMPLETE FireModes (DH2e's shape)", () => {
		// DH2e models a Standard Attack and a Full-Auto Burst; it has no
		// separate single-shot action, so nothing is missing from this set.
		const twoModeSet: FireModes = {
			standard: rule(10),
			fullAutoBurst: rule(-10),
		};
		// The same shape takes one more declared mode for RT's complete set —
		// the map does not care how many names are present.
		const threeModeSet: FireModes = { ...twoModeSet, semiAutoBurst: rule(0) };

		expect(Object.keys(twoModeSet)).toEqual(["standard", "fullAutoBurst"]);
		expect(Object.keys(threeModeSet)).toHaveLength(3);
	});

	test("RT's triple still reads directly (no consumer churn, same values)", () => {
		// Byte-identical to the pre-widening shape: RT's consumers read the
		// declared modes straight off the map, exactly as before.
		const rtShaped: FireModes = {
			standard: { modifier: 0, characteristic: "either" },
			semiAutoBurst: rule(10),
			fullAutoBurst: rule(20),
		};
		expect(rtShaped.standard.modifier).toBe(0);
		expect(rtShaped.semiAutoBurst.modifier).toBe(10);
		expect(rtShaped.fullAutoBurst.modifier).toBe(20);
	});

	test("the mode NAME is a string alias, not a closed union", () => {
		// A system that names its actions differently is not a compile error:
		// the shared layer pins the names it gives a meaning to (`FIRE_MODES`)
		// but does not forbid a sibling's own name.
		const siblingMode: FireMode = "suppressing-fire";
		const modes: FireModes = { [siblingMode]: rule(0) };
		expect(fireModeRule(modes, siblingMode)?.modifier).toBe(0);
	});
});

describe("fireModeRule reports absence honestly", () => {
	test("a declared mode returns its rule; an undeclared one returns undefined", () => {
		const modes: FireModes = {
			standard: rule(10),
			fullAutoBurst: rule(-10),
		};
		expect(fireModeRule(modes, "standard")).toEqual(rule(10));
		expect(fireModeRule(modes, "fullAutoBurst")).toEqual(rule(-10));
		// The map's index type cannot express "this profile does not model that
		// mode"; the accessor is where the absence becomes real.
		expect(fireModeRule(modes, "semiAutoBurst")).toBeUndefined();
		// A name that only exists on Object.prototype is NOT a declared mode.
		expect(fireModeRule(modes, "toString")).toBeUndefined();
	});
});

describe("FIRE_MODES pins the names the shared layer gives meaning to", () => {
	test("the pinned vocabulary is exactly the three actions both books model", () => {
		expect(FIRE_MODES).toEqual(["standard", "semiAutoBurst", "fullAutoBurst"]);
	});

	test("the pinned names build a complete mode table", () => {
		// The vocabulary is data: it can key a profile's table without any file
		// restating the mode names (drift is then a test, not a silent rename).
		const fromVocabulary: FireModes = Object.fromEntries(
			FIRE_MODES.map((name) => [name, rule(0)]),
		);
		expect(Object.keys(fromVocabulary).sort()).toEqual([...FIRE_MODES].sort());
	});
});

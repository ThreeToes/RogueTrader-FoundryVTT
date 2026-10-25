/**
 * The no-sibling-names guard (bead w9sa.11).
 *
 * Two systems share this core, and each brings its OWN rule-knob registry. What
 * they must never share is a NAME:
 *
 *   - a knob ID may be registered by both systems only when it names the SAME
 *     rule in both books (today: exactly three book-neutral rules);
 *   - an i18n LABEL belongs to the owning system's namespace — RT keeps the
 *     incumbent un-prefixed `RULES.*` family (its releases and stored deltas
 *     cannot be renamed), DH2 owns `RULES.DH.*` — except the one key a
 *     deliberately shared id co-owns;
 *   - no name may be a dotted prefix of another, or foundry.utils.expandObject
 *     drops the whole dictionary at load.
 *
 * The rules are CODE (`knobNameConflicts`, pure and Foundry-free), so this file
 * both pins the shipped registries green and proves each rule FIRES on a
 * synthetic pair. A new sibling system (or a copy-pasted label) therefore fails
 * here by name, not in a world where two systems quietly read each other's
 * rules.
 *
 * `SHARED_KNOB_IDS` is the documented allow-list the guard takes as data: adding
 * a fourth shared rule is a deliberate edit to this table, with an argument for
 * why its wording stays true in both books.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import {
	DARK_HERESY_RULE_KNOBS,
	DARK_HERESY_RULE_KNOB_REGISTRY,
	DH2_KNOB_I18N_PREFIX,
} from "./rule-knobs-dark-heresy";
import {
	hintKeyFor,
	knobLabelNamespace,
	knobNameConflicts,
	labelKeyFor,
	type RuleKnob,
	type RuleKnobRegistry,
	RT_KNOB_I18N_PREFIX,
	RT_RULE_KNOB_REGISTRY,
	RULE_KNOBS as RT_KNOBS,
} from "./rule-knobs";

/**
 * The knob ids the two books genuinely share: the same rule, worded
 * book-neutrally, so the two systems co-own one label key instead of carrying a
 * duplicate translation.
 */
const SHARED_KNOB_IDS: readonly string[] = [
	"test.critOnDouble",
	"damage.primitiveArmourDouble",
	"damage.righteousFury",
];

/** Every registry the repo ships, in order. A new system joins this list. */
const SHIPPED_REGISTRIES: readonly RuleKnobRegistry[] = [
	RT_RULE_KNOB_REGISTRY,
	DARK_HERESY_RULE_KNOB_REGISTRY,
];

/** A minimal knob for the red-path pairs: only the fields the guard reads. */
function fakeKnob(
	key: string,
	i18nPrefix: string,
	over: Partial<RuleKnob> = {},
): RuleKnob {
	return {
		key,
		path: ["critOnDouble"],
		labelKey: labelKeyFor(key, i18nPrefix),
		hintKey: hintKeyFor(key, i18nPrefix),
		group: "test",
		control: "boolean",
		hazard: "auto-recomputed",
		coreValue: false,
		...over,
	};
}

function fakeRegistry(
	systemId: string,
	i18nPrefix: string,
	knobs: readonly RuleKnob[],
): RuleKnobRegistry {
	return { systemId, i18nPrefix, knobs };
}

/** The conflict kinds, sorted, so a test states what it expects exactly. */
function kindsOf(conflicts: readonly { kind: string }[]): string[] {
	return conflicts.map((conflict) => conflict.kind).sort();
}

describe("the shipped systems have no sibling names", () => {
	test("knobNameConflicts is clean for RT + DH2 under the allow-list", () => {
		const conflicts = knobNameConflicts(SHIPPED_REGISTRIES, SHARED_KNOB_IDS);
		expect(conflicts, conflicts.map((c) => c.message).join("; ")).toEqual([]);
	});

	test("RT keeps the incumbent, un-prefixed namespace", () => {
		// Bead w9sa.11: RT's labels ship in four language files and its knob ids
		// are the delta keys stored in released worlds, so the scheme must not
		// rename one byte of them.
		expect(RT_KNOB_I18N_PREFIX).toBe("");
		expect(RT_RULE_KNOB_REGISTRY.i18nPrefix).toBe(RT_KNOB_I18N_PREFIX);
		expect(knobLabelNamespace(RT_KNOB_I18N_PREFIX)).toBe("RULES.");
		for (const knob of RT_KNOBS) {
			expect(knob.labelKey, knob.key).toBe(labelKeyFor(knob.key));
			expect(knob.hintKey, knob.key).toBe(hintKeyFor(knob.key));
		}
		// Spot-pin the released strings a prefix would have broken.
		expect(RT_KNOBS[0].labelKey).toBe("RULES.TEST_CRIT_ON_DOUBLE");
		const burst = RT_KNOBS.find(
			(knob) => knob.key === "combat.fireModeBonus.burst",
		);
		expect(burst?.labelKey).toBe("RULES.COMBAT_FIRE_MODE_BONUS_BURST");
		expect(burst?.hintKey).toBe("RULES.COMBAT_FIRE_MODE_BONUS_BURST_HINT");
	});

	test("DH2 owns its own namespace, disjoint from RT's family", () => {
		expect(DH2_KNOB_I18N_PREFIX).toBe("dh");
		expect(DARK_HERESY_RULE_KNOB_REGISTRY.i18nPrefix).toBe(
			DH2_KNOB_I18N_PREFIX,
		);
		const namespace = knobLabelNamespace(DH2_KNOB_I18N_PREFIX);
		expect(namespace).toBe("RULES.DH.");
		// Every knob whose id is NOT a deliberately shared one names a label
		// under DH2's prefix — none of them can land in RT's namespace.
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			if (SHARED_KNOB_IDS.includes(knob.key)) continue;
			expect(knob.labelKey, knob.key).toBe(
				labelKeyFor(knob.key, DH2_KNOB_I18N_PREFIX),
			);
			expect(knob.labelKey.startsWith(namespace), knob.labelKey).toBe(true);
			expect(knob.hintKey.startsWith(namespace), knob.hintKey).toBe(true);
		}
	});

	test("only the shared ids' labels are held by both registries", () => {
		const rtNames = new Set(
			RT_KNOBS.flatMap((knob) => [knob.labelKey, knob.hintKey]),
		);
		const sharedIds = new Set<string>();
		for (const knob of DARK_HERESY_RULE_KNOBS) {
			for (const name of [knob.labelKey, knob.hintKey]) {
				if (rtNames.has(name)) sharedIds.add(knob.key);
			}
		}
		expect([...sharedIds].sort()).toEqual([...SHARED_KNOB_IDS].sort());
	});

	test("the shared ids are exactly three, each the same rule in both books", () => {
		const shared = RT_KNOBS.filter((knob) =>
			DARK_HERESY_RULE_KNOBS.some((mine) => mine.key === knob.key),
		).map((knob) => knob.key);
		expect(shared.sort()).toEqual([...SHARED_KNOB_IDS].sort());
		// Same group, control, options, nullability and profile path: the VALUE
		// may differ per book (each coreValue is read from that book's profile),
		// the RULE may not. `knobNameConflicts` is what enforces it; here we pin
		// the allow-list entry by entry so a shape drift reads clearly.
		for (const key of SHARED_KNOB_IDS) {
			const mine = DARK_HERESY_RULE_KNOBS.find((knob) => knob.key === key);
			const theirs = RT_KNOBS.find((knob) => knob.key === key);
			expect(mine, `DH2 must register the shared id ${key}`).toBeDefined();
			expect(theirs, `RT must register the shared id ${key}`).toBeDefined();
			expect(mine?.group).toBe(theirs?.group);
			expect(mine?.control).toBe(theirs?.control);
			expect(mine?.options).toEqual(theirs?.options);
			expect(mine?.nullable).toBe(theirs?.nullable);
			expect(mine?.path).toEqual(theirs?.path);
		}
	});

	test("every system's label and hint is translated in all four languages", () => {
		const LANGS = ["en", "es", "fr", "pl"] as const;
		const dictionaries = Object.fromEntries(
			LANGS.map((lang) => [
				lang,
				JSON.parse(readFileSync(`lang/${lang}.json`, "utf8")) as Record<
					string,
					string
				>,
			]),
		) as Record<(typeof LANGS)[number], Record<string, string>>;
		for (const registry of SHIPPED_REGISTRIES) {
			for (const knob of registry.knobs) {
				for (const lang of LANGS) {
					for (const key of [knob.labelKey, knob.hintKey]) {
						expect(
							dictionaries[lang][key],
							`${lang}.json must translate ${key} (${registry.systemId}: ${knob.key})`,
						).toBeTruthy();
					}
				}
			}
		}
	});
});

describe("the guard fails loudly (the red paths)", () => {
	test("an empty allow-list reports every co-owned label, naming the id", () => {
		// Without the documented allow-list the three intentional co-ownerships
		// are findings, not silence: each is a label outside DH2's own namespace
		// AND a name two systems hold.
		const conflicts = knobNameConflicts(SHIPPED_REGISTRIES);
		expect(kindsOf(conflicts)).toEqual([
			"foreign-label",
			"foreign-label",
			"foreign-label",
			"foreign-label",
			"foreign-label",
			"foreign-label",
			"shared-label",
			"shared-label",
			"shared-label",
			"shared-label",
			"shared-label",
			"shared-label",
		]);
		for (const key of SHARED_KNOB_IDS) {
			expect(
				conflicts.some((conflict) => conflict.names.includes(key)),
				`${key} must be named`,
			).toBe(true);
		}
	});

	test("a shared id with a DIFFERENT rule fails, naming both systems", () => {
		const mine = fakeRegistry("a-system", "a", [fakeKnob("test.critOnDouble", "a")]);
		const theirs = fakeRegistry("b-system", "b", [
			fakeKnob("test.critOnDouble", "b", {
				path: ["fireModes", "standard", "modifier"],
				control: "number",
			}),
		]);
		const conflicts = knobNameConflicts([mine, theirs], ["test.critOnDouble"]);
		expect(kindsOf(conflicts)).toEqual(["shared-knob-differs"]);
		expect(conflicts[0].systems).toEqual(["a-system", "b-system"]);
		expect(conflicts[0].message).toContain("different rules");
	});

	test("a label outside the owning prefix fails", () => {
		const stray = fakeRegistry("a-system", "a", [
			fakeKnob("test.critOnDouble", "a", {
				labelKey: "RULES.B.TEST_CRIT_ON_DOUBLE",
			}),
		]);
		const conflicts = knobNameConflicts([stray]);
		expect(kindsOf(conflicts)).toEqual(["foreign-label"]);
		expect(conflicts[0].message).toContain("RULES.A.TEST_CRIT_ON_DOUBLE");
	});

	test("two systems claiming one namespace fail", () => {
		// The empty prefix is RT's; a sibling that forgets its own prefix would
		// otherwise write labels straight into RT's released family.
		const mine = fakeRegistry("a-system", "", [fakeKnob("test.critOnDouble", "")]);
		const theirs = fakeRegistry("b-system", "", [
			fakeKnob("damage.righteousFury", ""),
		]);
		const conflicts = knobNameConflicts([mine, theirs]);
		expect(kindsOf(conflicts)).toEqual(["duplicate-prefix"]);
		expect(conflicts[0].message).toContain("RULES.");
	});

	test("a name that shadows another by dotted prefix fails", () => {
		// RULES.A is a dotted prefix of RULES.A.DEEP: foundry.utils.expandObject
		// rejects the pair and drops the whole dictionary.
		const short = fakeRegistry("a-system", "", [fakeKnob("a", "")]);
		const deep = fakeRegistry("a-system-2", "a", [fakeKnob("deep", "a")]);
		const conflicts = knobNameConflicts([short, deep]);
		expect(kindsOf(conflicts)).toContain("shadowed-name");
		const shadows = conflicts.filter(
			(conflict) => conflict.kind === "shadowed-name",
		);
		// Both of RULES.A.DEEP's leaves hang off RULES.A.
		expect(shadows.map((shadow) => shadow.names)).toEqual([
			["RULES.A", "RULES.A.DEEP"],
			["RULES.A", "RULES.A.DEEP_HINT"],
		]);
		expect(shadows[0].message).toContain("expandObject");
	});

	test("a name repeated inside one registry fails", () => {
		const twice = fakeRegistry("a-system", "a", [
			fakeKnob("test.critOnDouble", "a"),
			fakeKnob("test.critOnDouble", "a"),
		]);
		expect(kindsOf(knobNameConflicts([twice]))).toEqual([
			"duplicate-hint",
			"duplicate-knob-id",
			"duplicate-label",
		]);
	});
});

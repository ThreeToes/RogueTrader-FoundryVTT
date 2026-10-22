/**
 * Effect-liveness + source-label coverage over the registered item types
 * (bead j6ko) — the guard for the two UNGUARDED item-type registration
 * sites. Adding an item type is a four-site edit; two of them are kept
 * honest by existing tests (foundry-types.test.ts, template-coverage.test.ts
 * pin the DataModel file, foundry.d.ts, template.json and SHEET_REGISTRY),
 * but the other two failed SILENTLY before this file existed:
 *
 *   - the liveness tables (innateEffectTypes / equipStatesForEffects on the
 *     taxonomy registry, formerly model/effect.ts's INNATE_EFFECT_TYPES /
 *     EQUIP_STATES_FOR_EFFECTS) — a new physical effect-carrying type would
 *     contribute nothing to the funnel, with no compile error;
 *   - the sourceLabels table (formerly effects/specs.ts's SOURCE_LABELS) —
 *     funnel breakdown rows would render the `?? "SOURCE.FROM_GEAR"`
 *     fallback ("this modifier comes from your gear") for a type that has
 *     its own vocabulary, and the wrong label reads as a rules statement.
 *
 * The invariant here: every SHEET_REGISTRY.Item type is EITHER effect-
 * bearing (on a liveness table, with a type-appropriate source label) OR
 * named in NON_EFFECT_BEARING below with the reason it stays label-less.
 * A new registered type that satisfies neither FAILS this test and forces
 * the author to make both decisions explicitly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
// The shared schema stub suffices for the SHEET_REGISTRY import (the
// foundry-types.test.ts lesson: NOT the Proxy-field stub — it poisons the
// cached models' instanceof/opts assertions for the suites that run later).
import "../test-helpers/foundry-schema-stub";
import { effectKinds } from "../ffg/domain/effects/registry";
import { funnelModifier } from "../ffg/domain/effects/specs";
import { effectsAreLive } from "../ffg/domain/model/effect";
import {
	itemTaxonomyRegistry,
	RT_SOURCE_LABELS,
} from "../ffg/domain/model/taxonomy-registry";
import type { ItemView } from "../ffg/domain/model/actor";

// SHEET_REGISTRY pulls in every DataModel class, and those `extends
// foundry.abstract.TypeDataModel` at module load — stub before importing it.
const { SHEET_REGISTRY } = await import("./bootstrap/sheet-registry");

const REGISTERED = Object.keys(SHEET_REGISTRY.Item);

/**
 * The registered item types that are deliberately NOT effect-bearing, each
 * with the reason. This is the allowlist half of the bead's guard: a type
 * named here must never appear on the liveness tables, and a type that
 * leaves this table is silently dead no longer — it must be added to a
 * liveness table and given a source label to pass.
 */
const NON_EFFECT_BEARING: Record<string, string> = {
	// A rolled document (bead moew): an action's mechanics ride its
	// structured cost/roll fields, not effect rows contributed to a test.
	action: "rolled document; the action's cost/roll fields are its mechanics",
	// The starship hull and its chart-based reference types (beads 5lbn/kwd):
	// ship combat rolls through the ship-action test kind on the starship
	// actor, never through actor-level effect liveness.
	ship: "starship hull document, not an effect carrier",
	"ship-complication": "reference chart row (bead 5lbn)",
	"ship-component": "starship component document",
	"ship-weapon-component": "starship weapon component document",
	"ship-ordnance": "starship ordnance document (consumed via the salvo pick)",
	"ship-action": "rolled through the ship-action test kind, not the funnel",
	// Planet/system generation reference rows; embedded reference documents.
	"game-table": "planet/system generation reference rows",
	// Reference chart entries read by their own rules machinery (epic 1gb7):
	// the origin-path engine consumes the structured row data, not effects.
	origin: "Origin Path chart entry; consumed by rules/origins.ts",
	origintrait:
		"applied through rules/origin-traits.ts from its own structured data",
	"warrant-option": "read-only Ship & Warrant Path reference (bead 3cb1)",
	// Grant template consumed by the character creator's kit step.
	heirloom: "Heirloom grant template (Table 1-2); consumed by the creator",
	gearset: "creator kit template; one item per career (owner rework 2026)",
	// Careers hold ranks/skills by reference; no per-career effect rows.
	career: "rank/skill reference document",
	// Description-only compendium entries (bead r7w): the packs author them
	// with `effects: []` and no liveness gate is given.
	aptitude: "description-only (bead r7w): packs author `effects: []`",
	// A skill's effects are not funnel contributions — the registry's own
	// recorded decision (pinned by taxonomy-registry.test.ts).
	skill: "skills carry no funnel contributions (registry decision, cmio.5)",
	// Navigator powers roll through presentation/rolls/navigator.ts, which
	// labels their rows SOURCE.FROM_POWERS directly; no effect rows are
	// authored for them and no live gate — the system author's decision
	// (pinned by taxonomy-registry.test.ts's "quiet" describe block).
	navigatorpower:
		"rolls via presentation/rolls/navigator.ts (SOURCE.FROM_POWERS); no effect rows",
	// Ammunition is consumed through the weapon's reloading machinery, not
	// effect liveness.
	ammunition: "consumed through the weapon's ammo machinery",
	// Attached modification rows fold into their weapon/armour's profile
	// DIRECTLY (specs.ts's weapon-profile channel, beads huaf/ujtg):
	// deliberately NOT collected at actor level — a carried mod would
	// double-count what its installation applies.
	"weapon-modification": "attached mod rows fold via the attack profile",
	"armour-modification": "like weapon-modification (bead dfb8): direct fold",
	// Plain-Gear subtypes the packs may declare (bead 5p8). No effect rows
	// exist for them today; if one is authored, the liveness decision has to
	// be made explicitly (most likely by mapping the subtype onto gear's
	// "carried" liveness) — the allowlist entry keeps that gap VISIBLE.
	tool: "plain-Gear subtype (bead 5p8); effect liveness undecided",
	drug: "plain-Gear subtype (bead 5p8); effect liveness undecided",
	"special-ability": "plain-Gear subtype (bead 5p8); effect liveness undecided",
	battlesuit:
		"no effect rows authored for a suit today; liveness decision deferred",
	"battlesuit-system": "rides the carrying suit's hard points (bead i0dc)",
	"force-field": "no effect rows authored today; liveness decision deferred",
};

/**
 * Registered types whose effects ARE live but whose funnel breakdown rows
 * deliberately render the SOURCE.FROM_GEAR fallback — the taxonomy
 * registry's own recorded decision ("a psychic power's contributions have
 * always rendered there"); SOURCE.FROM_POWERS serves the psychic *roll*
 * rows instead (presentation/rolls/psychic.ts).
 */
const DELIBERATE_GEAR_FALLBACK_ROLES: Record<string, string> = {
	psychicpower:
		"funnel fallback is deliberate (cmio.5); FROM_POWERS serves the roll rows",
};

const en = JSON.parse(readFileSync("lang/en.json", "utf8")) as Record<
	string,
	string
>;

/** A minimal view for label probes (nothing reads beyond name/type). */
function itemOfType(type: string): ItemView {
	return {
		id: `probe-${type}`,
		name: `Probe ${type}`,
		type,
		equipState: "stowed",
		effects: [],
		special: [],
		attack: null,
		system: {},
	};
}

/** The funnel labels every MODIFIER-producing hit's breakdown row. */
function funneledSourceLabel(type: string): string {
	const modifier = funnelModifier(itemOfType(type), { value: 1 }, "any");
	return modifier.source.label;
}

/** The damage-channel modifier builder for one row (the registered spec's
 * own `toModifier`), so the pin travels with the spec, not a copy of it. */
function damageSourceLabel(type: string): string | undefined {
	const modifier = effectKinds.get("damage-flat")?.toModifier?.(
		itemOfType(type),
		{ kind: "damage-flat", value: 2 },
		{ channel: "damage" },
	);
	return modifier?.source.label;
}

describe("registered item types are either effect-bearing or explicitly exempt (bead j6ko)", () => {
	test("the guard sees a meaningful registry (stays meaningful)", () => {
		expect(REGISTERED.length).toBeGreaterThan(20);
	});

	test("the taxonomy's declared vocabulary is exactly the sheet registry's Item keys", () => {
		// foundry-types.test.ts pins foundry.d.ts <-> SHEET_REGISTRY; this
		// pins the RUNTIME vocabulary <-> the same registry, so a type cannot
		// exist without every registered consumer seeing it.
		const declared = new Set(itemTaxonomyRegistry().declaredItemTypes);
		const missing = REGISTERED.filter((type) => !declared.has(type));
		const extra = [...declared].filter((type) => !REGISTERED.includes(type));
		expect({ missing, extra }).toEqual({ missing: [], extra: [] });
	});

	test("every registered type is on a liveness table or named in the exempt allowlist", () => {
		const innate = itemTaxonomyRegistry().innateEffectTypes;
		const equipped = Object.keys(itemTaxonomyRegistry().equipStatesForEffects);
		const unexplained = REGISTERED.filter((type) => {
			return (
				!innate.includes(type) &&
				!equipped.includes(type) &&
				NON_EFFECT_BEARING[type] === undefined
			);
		});
		expect(
			unexplained,
			`registered types on no liveness table and missing from NON_EFFECT_BEARING (silent dead/label-less today): ${unexplained.join(", ")}`,
		).toEqual([]);
	});

	test("the exempt allowlist carries no stale entries", () => {
		const innate = new Set(itemTaxonomyRegistry().innateEffectTypes);
		const equipped = new Set(
			Object.keys(itemTaxonomyRegistry().equipStatesForEffects),
		);
		for (const [type, reason] of Object.entries(NON_EFFECT_BEARING)) {
			expect(REGISTERED, `exempt type ${type} is registered`).toContain(type);
			expect(
				innate.has(type) || equipped.has(type),
				`exempt type ${type} must not be effect-bearing (reason: ${reason})`,
			).toBe(false);
			// And the recorded decision holds at runtime, not just on paper.
			expect(
				effectsAreLive(type, "carried"),
				`effectsAreLive(${type}) is false in every equip state`,
			).toBe(false);
			expect(effectsAreLive(type, undefined)).toBe(false);
		}
	});
});

describe("every effect-bearing type has a type-appropriate source label (bead j6ko)", () => {
	function livenessTypes(): string[] {
		const innate = itemTaxonomyRegistry().innateEffectTypes;
		const equipped = Object.keys(itemTaxonomyRegistry().equipStatesForEffects);
		return [...new Set([...innate, ...equipped])];
	}

	test("each liveness type has a registered source label, except the documented gear-fallback roles", () => {
		const unlabelled = livenessTypes().filter(
			(type) =>
				RT_SOURCE_LABELS[type] === undefined &&
				DELIBERATE_GEAR_FALLBACK_ROLES[type] === undefined,
		);
		expect(
			unlabelled,
			`live types falling back to SOURCE.FROM_GEAR with no recorded decision: ${unlabelled.join(", ")}`,
		).toEqual([]);
	});

	test("the fallback roles resolve through the real funnel lookup, as recorded", () => {
		for (const type of Object.keys(DELIBERATE_GEAR_FALLBACK_ROLES)) {
			// funnelModifier builds the source through the same labels lookup
			// (sourceFor) the breakdown renders, so this pins the FALLBACK
			// itself, not a copy of the table.
			expect(funneledSourceLabel(type)).toBe("SOURCE.FROM_GEAR");
		}
	});

	test("each labelled type's label resolves through the real funnel lookup", () => {
		for (const [type, labelKey] of Object.entries(RT_SOURCE_LABELS)) {
			expect(REGISTERED, `labelled type ${type} is registered`).toContain(
				type,
			);
			expect(funneledSourceLabel(type)).toBe(labelKey);
		}
	});

	test("every source label key AND the fallback keys exist in lang/en.json", () => {
		// en presence is the pin here (cross-language parity is the i18n
		// parity test's job): a fallback key that vanishes from en renders
		// raw on every funnel breakdown row.
		for (const labelKey of [
			...Object.values(RT_SOURCE_LABELS),
			// The fallback keys the label lookups may resolve to
			// (effects/specs.ts): the funnel's FROM_GEAR fallback and the
			// damage/soak channels' FROM_TALENTS / FROM_WEAPONS / FROM_TRAITS
			// fallbacks.
			"SOURCE.FROM_GEAR",
			"SOURCE.FROM_TALENTS",
			"SOURCE.FROM_WEAPONS",
			"SOURCE.FROM_TRAITS",
		]) {
			expect(
				en[labelKey],
				`lang/en.json is missing the source label ${labelKey}`,
			).toBeTruthy();
		}
	});
});

describe("the damage channel's source labels follow the same table (bead j6ko)", () => {
	// Before this guard, specs.ts's damageModifier hard-coded
	// FROM_TALENTS/FROM_WEAPONS: an INNATE type carrying a damage row still
	// collected (it is live) and rendered "Weapons". No pack data trips it
	// today (no damage-flat/critical-damage rows in packs — checked on the
	// bead), so the fix is a pin rather than a behaviour repair; this test
	// keeps it from drifting back.
	test("a label-registered carrier's damage row uses its own label", () => {
		for (const [type, labelKey] of Object.entries(RT_SOURCE_LABELS)) {
			if (type === "talent") continue; // the hard-coded FROM_TALENTS branch
			expect(damageSourceLabel(type), `damage-flat on ${type}`).toBe(labelKey);
		}
	});

	test("talents keep the FROM_TALENTS branch", () => {
		expect(damageSourceLabel("talent")).toBe("SOURCE.FROM_TALENTS");
	});
});
/**
 * Homebrew seam (bead 9if, reworked by epic wxut bead .2).
 *
 * A world's house rules live as DATA and reach the rules through ONE read:
 * `effectiveProfile()`, which merges the stored house-rule delta over the
 * system's base profile and hands back a complete `SystemProfile`. There are
 * no per-rule resolvers and no parallel override type any more — bead 9if's
 * `HomebrewProfile`, `parseHomebrewProfile` and the three `resolve*` helpers
 * were retired in favour of the knob registry
 * (`src/ffg/domain/rule-knobs.ts`), whose `validateProfile` both validates and
 * selects and whose `mergeProfile` performs the leaf merge. A house rule is
 * therefore a knob-keyed delta, not a bespoke object shape.
 *
 * The merge is strict: an unknown or wrong-typed knob is WARNED and ignored
 * (never silently applied), so a typo'd profile cannot quietly run a rule the
 * GM did not write. Core rules apply when there is no setting.
 *
 * Named rule profiles (bead wxut.3) sit in two world settings — `ruleProfiles`
 * (a JSON array of `{id, name, delta}`) and `activeProfileId` — and the
 * provider in `bootstrap/config.ts` hands `effectiveProfile` the ACTIVE
 * profile's delta; `activeProfileDelta` below does that lookup. The retired
 * `homebrewProfile` key is cleared at init, not imported.
 *
 * MODULE-REGISTERED profiles (bead wxut.6, sharing tier T2) are the other source:
 * a module calls `CONFIG.ROGUE_TRADER.registerRuleProfile` at its own init, the
 * registration is validated here against the same registry, and the effective
 * profile is composed module layer FIRST, active world profile SECOND, in one
 * merge hop over the base. A module ships DELTAS, so its rules track the book
 * instead of freezing a snapshot of it.
 *
 * Pilot rule (bead 9if): fire-mode BS bonuses (Core Rulebook p237 core values
 * Semi-Auto +10, Full Auto +20 — the owner's motivating example for tuning).
 *
 * WHOSE RULES (bead w9sa.2): the registry this seam validates and merges
 * against is the ACTIVE system's (`ruleKnobs()`), which is RT's until a sibling
 * system swaps the one binding at its own boot. RT's `RULE_KNOBS` are exported
 * from src/ffg/domain/rule-knobs.ts for the registry's own tests and drift
 * guards; nothing here imports them, so a sibling's rules run through this same
 * seam with no per-system branch and no RT knob key in a second place.
 */

import { type SystemProfile } from "../../ffg/domain/system-profile";
import {
	mergeProfile,
	type ProfileDelta,
	type RuleKnob,
	type RuleKnobRegistry,
	ruleKnobRegistry,
	ruleKnobs,
	validateProfile,
} from "../../ffg/domain/rule-knobs";

/**
 * The registry the rules validate and merge against (bead w9sa.2).
 *
 * A read of the ONE registry binding, not a `ports.config` value: the merge
 * and the validation below must stay Foundry-free (architecture.test.ts lets a
 * single rules file touch Foundry, and it is not this one), and the knob
 * registry is pure domain data. RT's own `RULE_KNOBS` stay exported for the
 * registry's own tests and drift guards; the SEAM resolves the ACTIVE system's
 * registry, which is RT's until a sibling system swaps the binding at its own
 * boot — one call, one binding, the same shape as `setConfigOverrides`
 * swapping the profile binding.
 */
function registryInForce(): readonly RuleKnob[] {
	return ruleKnobs();
}
import type { Modifier } from "../../rules-engine/modifier";
import type { TestContributor } from "../../ffg/application/funnel";
import { getPorts } from "../infrastructure/foundry/ports";

/**
 * Decode the stored setting value into a delta candidate.
 *
 * The setting is a String (Foundry has no structured setting type), so a
 * stored profile arrives either as JSON text or — when a future caller sets
 * the value as an object — as the object itself. Empty means "no house
 * rules". Successor of bead 9if's `parseHomebrewProfile`: this only decodes
 * STORAGE shape, it makes no judgement about whether the knobs are valid.
 * That judgement belongs to `validateProfile`, which names every rejected
 * key instead of accepting a malformed object (bead 083c ·2).
 */
export function parseStoredDelta(stored: unknown): ProfileDelta | null {
	return decodeStoredJson(stored, "homebrew profile") as ProfileDelta | null;
}

/**
 * Decode a stored String setting that holds JSON (or an object passed
 * straight through), reporting a malformed value by label rather than
 * throwing. Null/undefined/empty all mean "nothing stored".
 */
function decodeStoredJson(stored: unknown, label: string): unknown {
	if (stored === null || stored === undefined) return null;
	if (typeof stored === "string") {
		const text = stored.trim();
		if (text === "") return null;
		try {
			const parsed: unknown = JSON.parse(text);
			return typeof parsed === "object" && parsed !== null ? parsed : null;
		} catch {
			console.warn(`rogue-trader | malformed ${label} — ignored.`);
			return null;
		}
	}
	return typeof stored === "object" ? stored : null;
}

// ---------------------------------------------------------------------------
// Named rule profiles (bead wxut.3)
// ---------------------------------------------------------------------------

/** A stored profile row, as far as the lookup needs to read it. */
interface StoredProfileRow {
	readonly id: string;
	readonly delta: ProfileDelta;
}

// ---------------------------------------------------------------------------
// Module-registered profiles (epic wxut, child B6 — sharing tier T2)
// -------------------------------------------------------------------

/**
 * A profile a MODULE registered at its own init (sharing tier T2).
 *
 * A module ships DELTAS, never snapshots: `delta` is knob-keyed data against
 * the SAME base profile the world's profiles are keyed against, so a "lethal
 * crits" module states "crits on doubles" and keeps working when the numbers
 * around it move (a frozen copy of 2026 arithmetic would not). Nothing about a
 * registration may pin a core value — the validator is what guarantees that.
 *
 * This is the shape `CONFIG.ROGUE_TRADER.registerRuleProfile` accepts, which
 * `bootstrap/config.ts` attaches at init as the extension point beside
 * `testContributors` and `talentEffectHandlers`.
 */
export interface RuleProfileRegistration {
	readonly id: string;
	readonly name: string;
	readonly delta: ProfileDelta;
}

/** The registered module profiles, in registration order (one entry per id). */
let moduleRegistrations: readonly RuleProfileRegistration[] = [];

/**
 * Bumped on every accepted registration, and part of the effective profile's
 * memo key (bead qa9k): a module registers during its own init, which can
 * happen after the first roll of a session has already been memoised, so the
 * cache must see the registry change without a Foundry hook.
 */
let moduleRegistryVersion = 0;

function isRecordCandidate(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The shape check a registration must pass before its knobs are even looked
 * at. A module that hands over something else is told WHAT, not ignored.
 */
function registrationShapeProblem(profile: unknown): string | null {
	if (!isRecordCandidate(profile)) {
		return "a rule profile must be an object of {id, name, delta}";
	}
	const id = typeof profile.id === "string" ? profile.id.trim() : "";
	if (id === "") return "a rule profile needs a non-empty string id";
	if (typeof profile.name !== "string" || profile.name.trim() === "") {
		return `rule profile "${id}" needs a non-empty string name`;
	}
	if (!isRecordCandidate(profile.delta)) {
		return `rule profile "${id}" needs a delta object of knob key -> value`;
	}
	return null;
}

/**
 * Register a module's rule profile (bead wxut.6).
 *
 * IDEMPOTENT BY ID: a re-registration REPLACES the entry with the same id (a
 * module re-registering after a settings change, or a reload, is one profile,
 * not two) and keeps its position in the module layer.
 *
 * LOUD ON REJECTION: a bad shape or a delta that fails `validateProfile` is
 * REFUSED, not applied and not silently dropped — the console names the id and
 * every offending knob. Init must never throw, so this only warns; the
 * previously registered profile for that id (if any) stays in force rather
 * than being replaced by a broken one.
 *
 * Returns whether the profile is now registered, so a module can assert it.
 */
export function registerModuleRuleProfile(profile: unknown): boolean {
	const problem = registrationShapeProblem(profile);
	if (problem !== null) {
		console.warn(`rogue-trader | rule profile rejected: ${problem}`);
		return false;
	}
	const candidate = profile as Record<string, unknown>;
	const id = (candidate.id as string).trim();
	const name = (candidate.name as string).trim();
	const delta = candidate.delta as ProfileDelta;
	const validation = validateProfile(registryInForce(), delta);
	if (!validation.valid) {
		console.warn(
			`rogue-trader | rule profile "${id}" rejected: ${validation.errors.join("; ")}`,
		);
		return false;
	}
	const registration: RuleProfileRegistration = {
		id,
		name,
		delta: validation.value,
	};
	const at = moduleRegistrations.findIndex((entry) => entry.id === id);
	moduleRegistrations =
		at === -1
			? [...moduleRegistrations, registration]
			: moduleRegistrations.map((entry, index) =>
					index === at ? registration : entry,
			  );
	// Part of the effective profile's memo key: a registration that happens
	// after a roll was cached must change the next one.
	moduleRegistryVersion += 1;
	return true;
}

/**
 * The registered module profiles, in registration order.
 *
 * Read-only by contract: the rules app lists these (bead wxut.6) but nothing
 * may rewrite them — a module's profile is data the module shipped, so the
 * app offers ACTIVATION only, never edit, rename, duplicate or delete.
 */
export function registeredModuleRuleProfiles(): readonly RuleProfileRegistration[] {
	return moduleRegistrations;
}

/** Drop the module profiles (test-only: keeps suites from leaking into others). */
export function resetModuleRuleProfilesForTests(): void {
	moduleRegistrations = [];
	moduleRegistryVersion += 1;
}

/**
 * The module layer as one composite delta: registration order, so a LATER
 * registration wins over an earlier one (the same knob twice is the later
 * module's ruling — there is no weighting scheme, only an order).
 */
function moduleLayerDelta(): ProfileDelta | null {
	if (moduleRegistrations.length === 0) return null;
	const composite: Record<string, unknown> = {};
	for (const registration of moduleRegistrations) {
		Object.assign(composite, registration.delta);
	}
	return composite;
}

/**
 * The whole composite delta in ONE merge hop (epic wxut architecture: "Provider
 * order: rtCore (or a sibling base) → module profiles → active world profile.
 * One hop, no further layering.").
 *
 * Both sides are knob-keyed deltas over the SAME base, so a module delta does
 * NOT inherit world-profile values: module first, world wins. A knob both sides
 * set resolves to the world's value; a knob only the module sets keeps the
 * module's; and the world's profile is never the thing the module's delta is
 * layered on top of (that would make a module's rules depend on the GM's).
 *
 * Null when neither side says anything, so the seam keeps returning the base
 * profile OBJECT ITSELF (its identity guarantee, bead wxut.2).
 */
function composedProfileDelta(world: ProfileDelta | null): ProfileDelta | null {
	const modules = moduleLayerDelta();
	if (modules === null) return world;
	if (world === null) return modules;
	return { ...modules, ...world };
}


/**
 * The ACTIVE profile's knob-keyed delta (bead wxut.3).
 *
 * `ruleProfiles` is a JSON array of `{id, name, delta}` and
 * `activeProfileId` names the row in force. Everything that is not exactly
 * that — a missing or unparseable list, an empty or unknown id, a profile
 * whose delta is empty — resolves to null, which the seam reads as CORE RULES.
 * It never throws: the rules must keep running against a hand-edited or
 * half-written setting.
 *
 * This is LOOKUP only. Decoding, validation and merging stay in
 * `effectiveProfile` below, so the seam reports a bad knob ONCE per stored
 * value instead of re-validating on every read.
 */
export function activeProfileDelta(
	ruleProfiles: unknown,
	activeProfileId: unknown,
): ProfileDelta | null {
	// "" (the default) or a non-string id means core rules.
	const id = typeof activeProfileId === "string" ? activeProfileId.trim() : "";
	if (id === "") return null;
	const decoded = decodeStoredJson(ruleProfiles, "rule profiles list");
	if (decoded === null || !Array.isArray(decoded)) return null;
	const row = (decoded as unknown[]).find(
		(entry): entry is StoredProfileRow =>
			typeof entry === "object" &&
			entry !== null &&
			!Array.isArray(entry) &&
			typeof (entry as { id?: unknown }).id === "string" &&
			typeof (entry as { delta?: unknown }).delta === "object" &&
			(entry as { delta: unknown }).delta !== null &&
			(entry as StoredProfileRow).id === id,
	);
	// An empty delta is the same as no profile: nothing to merge, so the seam
	// returns the base profile object itself.
	return row && Object.keys(row.delta).length > 0 ? row.delta : null;
}

/**
 * The profile the rules should run on: the base profile with the module layer
 * and the world's house-rule delta merged over it (bead wxut.2, module layer
 * by bead wxut.6).
 *
 * Returns the base profile OBJECT ITSELF when there is nothing to merge, so
 * identity checks against the profile (sibling-module swaps, tests) keep
 * working. Reads `ports.config.homebrew()` — the seam READ; the provider that
 * fills it is attached at init by `bootstrap/config.ts`. The MODULE layer comes
 * from the registry below (bead wxut.6): a module registers at its own init,
 * which is not a settings read, so it is composed here rather than in the
 * provider — the provider stays the world's own lookup, and the merge stays in
 * one place.
 *
 * MEMOISED (bead qa9k): the profile used to be decoded, validated and merged
 * on EVERY attack roll, so an inert or malformed profile warned once per roll
 * forever. The cache is keyed on the RAW STORED VALUE, the module registry's
 * version and the base profile it was merged over — the only things that can
 * change the answer. Deliberately no Foundry hook: a mistyped hook name would
 * be a silent never-invalidating cache, a worse failure than the one being
 * fixed.
 */
/**
 * The RT fields `effectiveProfile` promises its callers, and nothing else.
 *
 * A widened `ConfigProfile` carries the kernel plus optional branding, so RT's
 * own constants are NOT guaranteed by the type. This list is the contract: a
 * profile missing any of them cannot drive RT's rules, and the guard says
 * which one is missing rather than letting arithmetic produce NaN three layers
 * away.
 */
const RT_SYSTEM_PROFILE_FIELDS: readonly string[] = [
	"fireModes",
	"psychicPush",
	"untrainedSkill",
	"eliteAdvanceCost",
];

export function isRtSystemProfile(profile: unknown): profile is SystemProfile {
	return (
		typeof profile === "object" &&
		profile !== null &&
		RT_SYSTEM_PROFILE_FIELDS.every((field) => field in profile)
	);
}

/** The loud guard behind `effectiveProfile`'s precondition (bead w9sa.8). */
function requireRtSystemProfile(profile: unknown): SystemProfile {
	if (isRtSystemProfile(profile)) return profile;
	const missing = RT_SYSTEM_PROFILE_FIELDS.filter(
		(field) =>
		!(
			typeof profile === "object" &&
			profile !== null &&
			field in profile
		),
	);
	throw new Error(
		`rogue-trader | the effective-profile seam handed a profile without RT's rule fields (missing: ${missing.join(", ")}). This module is the Rogue Trader system's own homebrew layer; a sibling system supplies its own.`,
	);
}

export function effectiveProfile(): SystemProfile {
	const ports = getPorts();
	// Bead w9sa.8: the config port widens to the kernel profile plus OPTIONAL
	// system branding, so it no longer PROMISES RT's creation/advancement
	// constants. This module is RT's OWN homebrew layer and the profile it
	// returns is read for RT's fireModes / psychicPush / untrainedSkill /
	// eliteAdvanceCost constants by RT's rules and presentation layers, so
	// the RT system states its own precondition here instead of letting those
	// reads resolve to undefined. A sibling system supplies its profile through
	// the same seam and owns its own homebrew layer.
	const widened = ports.config.profile();
	// Bead w9sa.8 widens the seam to the kernel profile plus OPTIONAL system
	// branding, so it no longer PROMISES RT's creation/advancement constants.
	// This module is RT's OWN homebrew layer, and the profile it returns is read
	// for RT's fireModes / psychicPush / untrainedSkill / eliteAdvanceCost
	// constants by RT's rules and presentation layers. Casting there (the
	// obvious shortcut) would let those read `undefined` and fail at a
	// distance, so the precondition is checked HERE, loudly, naming exactly
	// what is missing. A sibling system supplying its own profile through the
	// same seam owns its own homebrew layer and never reaches this code.
	const base = requireRtSystemProfile(widened);
	const stored = ports.config.homebrew();
	// Part of the memo key (bead w9sa.2): the registry decides which knobs a
	// delta HAS, so swapping it must invalidate the cached profile.
	const registration: RuleKnobRegistry = ruleKnobRegistry();
	const key = `${moduleRegistryVersion}:${storedKey(stored)}`;
	if (
		memoProfile !== null &&
		memoBase === base &&
		memoRegistry === registration &&
		memoKey === key
	) {
		return memoProfile;
	}
	const profile = mergeEffectiveProfile(base, stored);
	memoBase = base;
	memoRegistry = registration;
	memoKey = key;
	memoProfile = profile;
	return profile;
}

/** Drop the memo so a test sees a fresh read (test-only). */
export function resetEffectiveProfileCacheForTests(): void {
	memoBase = null;
	memoRegistry = null;
	memoKey = null;
	memoProfile = null;
}

let memoBase: SystemProfile | null = null;
let memoRegistry: RuleKnobRegistry | null = null;
let memoKey: string | null = null;
let memoProfile: SystemProfile | null = null;

/**
 * A stable cache key for a raw stored value.
 *
 * A String setting is its own key (a cheap `===`); an object-shaped value (a
 * sibling system providing the delta directly, or a profile row handed back by
 * the provider) is serialised so two equal reads still share the memo.
 */
function storedKey(stored: unknown): string {
	if (stored === null || stored === undefined) return "";
	if (typeof stored === "string") return stored;
	return JSON.stringify(stored) ?? "";
}

/**
 * The world's delta after the KNOWN checks (bead wxut.2), or null when there is
 * nothing to apply: no stored value, an empty delta, or a value the registry
 * refuses — which is reported by name and dropped, never applied. Split out so
 * a broken stored profile costs only ITSELF: the module layer is independent
 * of it.
 */
function validatedWorldDelta(stored: unknown): ProfileDelta | null {
	const delta = parseStoredDelta(stored);
	if (delta === null) return null;
	const validated = validateProfile(registryInForce(), delta);
	if (!validated.valid) {
		console.warn(
			`rogue-trader | ignoring house-rule profile: ${validated.errors.join("; ")}`,
		);
		return null;
	}
	return validated.value;
}

/**
 * Decode -> validate -> merge, over the module layer + the world's delta.
 * Warns once per value, so the caller memoises.
 */
function mergeEffectiveProfile(
	base: SystemProfile,
	stored: unknown,
): SystemProfile {
	const registry = registryInForce();
	const composed = composedProfileDelta(validatedWorldDelta(stored));
	if (composed === null || Object.keys(composed).length === 0) return base;
	return mergeProfile(base, composed, registry);
}

// ---------------------------------------------------------------------------
// Built-in funnel contributor: attack action modifiers (bead hyv), hoisted out
// of the (now system-neutral) funnel into the RT module that owns the data
// (bead 8ycd). Values VERIFIED against the core action table (p237):
//   Semi-Auto Burst: "+10 to BS, additional hit for every two degrees"
//   Full Auto Burst: "+20 to BS, additional hit for every degree"
// Additional hits are out of scope here (to-hit modifier only). The values
// come from the effective profile (core p237/+10/+20 or the world's house
// rules) — data-driven, no core-code edits (bead 9if).
//
// Registration is explicit, not an import side effect (bead i4b0): the
// function is called from rules/funnel-registration.ts, so a caller that
// imports the funnel machinery directly still sees the RT contributors
// without depending on which module happened to load first.
// ---------------------------------------------------------------------------
export const attackContextContributor: TestContributor = (_view, context) => {
	if (context.kind !== "attack") return [];
	// Bead dfdv: Modifier.label is documented as a localized label, so the
	// contributor resolves its keys through the i18n port (same keys the
	// sibling weapon contributor and lang/en.json use).
	const ports = getPorts();
	const profile = effectiveProfile();
	const mods: Modifier[] = [];
	if (context.fireMode === "burst") {
		// Bead cmio.2: RT's unsigned burst bonus is the shared FireModes shape's
		// signed semiAutoBurst modifier — the same number, +10 (Core Rulebook
		// p237).
		mods.push({
			id: "attack:fire-mode:burst",
			source: { type: "item", label: "ROLL.FIRE_MODE_BURST" },
			label: ports.i18n.t("ROLL.FIRE_MODE_BURST"),
			value: profile.fireModes.semiAutoBurst.modifier,
		});
	}
	if (context.fireMode === "full") {
		mods.push({
			id: "attack:fire-mode:full",
			source: { type: "item", label: "ROLL.FIRE_MODE_FULL" },
			label: ports.i18n.t("ROLL.FIRE_MODE_FULL"),
			value: profile.fireModes.fullAutoBurst.modifier,
		});
	}
	return mods;
};

/**
 * Settings keys (bead wxut.3).
 *
 * `HOMEBREW_SETTING` is the RETIRED pre-profile key: it is kept registered
 * (hidden) purely so `bootstrap/config.ts` can read and clear it at init —
 * owner ruling 2026-10-10: the value is CLEARED, never imported, so a live
 * world's prior house rules reset to core and must be re-entered as a profile.
 *
 * The pair below are the rule-profile keys the provider reads: the named
 * profiles as a JSON array, and the id of the one in force.
 */
export const HOMEBREW_SETTING = "homebrewProfile";
export const RULE_PROFILES_SETTING = "ruleProfiles";
export const ACTIVE_PROFILE_ID_SETTING = "activeProfileId";

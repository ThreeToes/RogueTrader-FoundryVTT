/**
 * Rules packs: the import/export format for named house-rule profiles
 * (epic wxut, child B5).
 *
 * A PACK is the unit a GM shares:
 *
 *   {
 *     "kind": "rogue-trader.rule-profiles",
 *     "schemaVersion": 1,
 *     "profiles": [
 *       { "id", "name", "description"?, "base": { "profile", "systemVersion"? },
 *         "delta", "snapshot"? }
 *     ]
 *   }
 *
 * `delta` is the knob-keyed house-rule delta the app stores in the
 * `ruleProfiles` setting; `base` records WHICH rules that delta was authored
 * against, so a world running a newer Core Rulebook (or a sibling system) can
 * SEE the mismatch instead of quietly importing a rule tuned for something
 * else; `snapshot` is display-only metadata a GM may paste in.
 *
 * THE KIND IS SYSTEM-DERIVED (bead w9sa.2): `"rogue-trader.rule-profiles"`
 * above is Rogue Trader's instance of `<systemId>.rule-profiles`
 * (`ruleProfilePackKindFor` in src/ffg/domain/rule-knobs.ts), never a literal
 * this module owns. Every guard and the builder take the registry — the ACTIVE
 * system's by default — so a Dark Heresy 2e pack is refused into a Rogue
 * Trader world (and the reverse) by name, without a per-system branch.
 *
 * IMPORT IS NOT THE TOLERANT PATH. `parseStoredDelta` (rules/homebrew.ts) warns
 * and falls back because a world's OWN stored value must never stop the rules
 * from running; a pack a human hands over is the opposite case — a typo'd knob
 * must be NAMED, so `parseRuleProfilePack` rejects the WHOLE pack and reports
 * every problem, naming the offending key, kind or schema version. Nothing is
 * silently dropped and nothing is silently applied (the same convention as the
 * extraction emit script: unmapped values fail loudly).
 *
 * SNAPSHOT IS NEVER RESOLVED. It is carried through untouched for display and
 * dropped from nothing; the rules come from `delta` and only from `delta`
 * (`packProfileEffective` reads exactly one field). A snapshot that disagrees
 * with its delta therefore changes nothing — pinned by test, because that is
 * the kind of "helpful" metadata that quietly becomes a second source of truth.
 *
 * Pure: no Foundry imports (the architecture boundary test), so this sits in
 * the rules layer beside homebrew.ts and is unit-tested directly.
 */

import {
	mergeProfile,
	type ProfileDelta,
	type RuleKnob,
	type RuleKnobRegistry,
	ruleKnobRegistry,
	ruleKnobs,
	ruleProfilePackKindFor,
	RT_RULE_KNOB_REGISTRY,
	validateProfile,
} from "../../ffg/domain/rule-knobs";
import { rtCore, type SystemProfile } from "../../ffg/domain/system-profile";

/**
 * The pack's `kind`: RT's own, DERIVED from RT's own system id rather than
 * written out as a second literal (bead w9sa.2). It is also the cross-system
 * gate — a Rogue Trader pack carries this kind, and a sibling system's pack
 * does not, so importing it into the wrong system names the kind instead of
 * translating rules that were never written for it (epic non-goal: no
 * cross-system translation). A sibling system gets its own kind for free
 * because it only declares its system id in its registry.
 *
 * Kept as the RT value (byte-identical) for logs, tests and any caller that
 * wants RT's kind without building its registry; the PARSE guards derive
 * theirs from the registry in force through `ruleProfilePackKindFor`.
 */
export const RULE_PROFILE_PACK_KIND = ruleProfilePackKindFor(
	RT_RULE_KNOB_REGISTRY.systemId,
);

/** The schema this system reads and writes. */
export const RULE_PROFILE_PACK_SCHEMA_VERSION = 1;

/** Every pack schema version this system can read, ascending. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [
	RULE_PROFILE_PACK_SCHEMA_VERSION,
];

/** What a pack says its deltas were authored against. */
export interface RuleProfilePackBase {
	/** The system profile id, e.g. "rt-core". */
	readonly profile: string;
	/** The system version that profile id was at, when the pack knows it. */
	readonly systemVersion?: string;
}

/** One accepted pack profile. */
export interface RuleProfilePackProfile {
	readonly id: string;
	/** The pack's name, or the id when the pack carries none. */
	readonly name: string;
	/** Present only when the pack carries one; empty is no description. */
	readonly description?: string;
	/**
	 * The rules the delta was authored against, or null when the pack says
	 * nothing. Display only: it never changes what the delta resolves to.
	 */
	readonly base: RuleProfilePackBase | null;
	readonly delta: ProfileDelta;
	/** Display-only metadata, carried through untouched and NEVER resolved. */
	readonly snapshot?: unknown;
}

/** The pack as this system writes it. */
export interface RuleProfilePack {
	/**
	 * `<systemId>.rule-profiles` — DERIVED from the registry in force, so a
	 * sibling system's pack cannot be mistaken for this system's.
	 */
	readonly kind: string;
	readonly schemaVersion: number;
	readonly profiles: readonly RuleProfilePackProfile[];
}

/**
 * Why a pack (or one profile in it) was refused. Flat records so the app can
 * localise each one generically: every non-`problems` field is an interpolation
 * parameter for the sentence named by `kind`.
 */
export type RuleProfilePackProblem =
	| { readonly kind: "not-json"; readonly message: string }
	| { readonly kind: "not-an-object"; readonly got: string }
	| {
			readonly kind: "wrong-kind";
			readonly got: string;
			readonly expected: string;
	  }
	| {
			readonly kind: "unsupported-schema";
			readonly got: string;
			readonly supported: string;
	  }
	| { readonly kind: "profiles-not-a-list"; readonly got: string }
	| {
			readonly kind: "profile-not-a-row";
			readonly index: number;
			readonly got: string;
	  }
	| { readonly kind: "profile-no-id"; readonly index: number }
	| { readonly kind: "profile-bad-base"; readonly index: number; readonly id: string }
	| {
			readonly kind: "profile-no-delta";
			readonly index: number;
			readonly id: string;
	  }
	| {
			readonly kind: "profile-duplicate-id";
			readonly index: number;
			readonly id: string;
	  }
	| {
			readonly kind: "profile-delta-invalid";
			readonly index: number;
			readonly id: string;
			/** The validator's own sentences, each naming the knob it refused. */
			readonly problems: readonly string[];
	  };

/** Every problem kind, for the app's localisation table. */
export type RuleProfilePackProblemKind = RuleProfilePackProblem["kind"];

/** What a pack means after parsing: all or nothing, with every problem named. */
export interface RuleProfilePackResult {
	/** True only when the WHOLE pack is importable as it stands. */
	readonly valid: boolean;
	readonly problems: readonly RuleProfilePackProblem[];
	/** The accepted profiles. Empty unless `valid` — no partial import. */
	readonly profiles: readonly RuleProfilePackProfile[];
	/** The problems as English sentences (logs, tests, headless fallbacks). */
	readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Description helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value as one clause of a refusal sentence. */
function describeValue(raw: unknown): string {
	if (raw === undefined) return "nothing";
	if (raw === null) return "null";
	if (Array.isArray(raw)) return "an array";
	if (typeof raw === "object") return "an object";
	if (typeof raw === "string") return `the string "${raw}"`;
	return `the ${typeof raw} ${String(raw)}`;
}

/** A JSON syntax failure, as the sentence's detail. */
function describeJsonError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Pack parsing
// ---------------------------------------------------------------------------

type DecodeResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly problem: RuleProfilePackProblem };

/**
 * The pack text (a textarea or a file) as JSON, or the problem that says why
 * it is not. An already-parsed value passes straight through, so a caller
 * holding an object can use the same entry point.
 */
function decodePack(value: unknown): DecodeResult {
	if (typeof value !== "string") return { ok: true, value };
	const text = value.trim();
	if (text === "") return { ok: false, problem: { kind: "not-an-object", got: "nothing" } };
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch (error) {
		return {
			ok: false,
			problem: { kind: "not-json", message: describeJsonError(error) },
		};
	}
}

/** The `kind` guard: an exact match for THIS registry, or a refusal naming both. */
function kindProblemFor(
	kind: unknown,
	registry: RuleKnobRegistry,
): RuleProfilePackProblem | null {
	const expected = ruleProfilePackKindFor(registry.systemId);
	if (kind === expected) return null;
	return {
		kind: "wrong-kind",
		got: typeof kind === "string" ? `"${kind}"` : "nothing",
		expected: `"${expected}"`,
	};
}

/** The `schemaVersion` guard: a supported number, or a refusal naming both. */
function schemaVersionFor(version: unknown): RuleProfilePackProblem | null {
	if (
		typeof version === "number" &&
		Number.isInteger(version) &&
		SUPPORTED_SCHEMA_VERSIONS.includes(version)
	) {
		return null;
	}
	return {
		kind: "unsupported-schema",
		got: typeof version === "number" ? String(version) : describeValue(version),
		supported: SUPPORTED_SCHEMA_VERSIONS.join(", "),
	};
}

/**
 * One `base` value: a record of strings, or null when the pack says nothing.
 * A malformed base is REFUSED rather than ignored: it is the field that would
 * let a GM see the pack was authored against other rules.
 */
function baseFrom(value: unknown): RuleProfilePackBase | null | "bad" {
	if (value === undefined || value === null) return null;
	if (!isRecord(value)) return "bad";
	const profile = value.profile;
	if (profile !== undefined && typeof profile !== "string") return "bad";
	const systemVersion = value.systemVersion;
	if (systemVersion !== undefined && typeof systemVersion !== "string") {
		return "bad";
	}
	const base: { profile: string; systemVersion?: string } = {
		profile: typeof profile === "string" ? profile : "",
	};
	if (typeof systemVersion === "string" && systemVersion !== "") {
		base.systemVersion = systemVersion;
	}
	return base;
}

type EntryResult =
	| { readonly profile: RuleProfilePackProfile }
	| { readonly problems: readonly RuleProfilePackProblem[] };

/** Parse one `profiles` entry, tracking the ids already seen in this pack. */
function parseEntry(
	entry: unknown,
	index: number,
	seen: ReadonlySet<string>,
	registry: RuleKnobRegistry,
): EntryResult {
	if (!isRecord(entry)) {
		return {
			problems: [{ kind: "profile-not-a-row", index, got: describeValue(entry) }],
		};
	}
	const id = typeof entry.id === "string" ? entry.id.trim() : "";
	if (id === "") {
		return { problems: [{ kind: "profile-no-id", index }] };
	}
	if (seen.has(id)) {
		return { problems: [{ kind: "profile-duplicate-id", index, id }] };
	}
	if (!isRecord(entry.delta)) {
		return {
			problems: [{ kind: "profile-no-delta", index, id }],
		};
	}
	const base = baseFrom(entry.base);
	if (base === "bad") {
		return { problems: [{ kind: "profile-bad-base", index, id }] };
	}
	const validation = validateProfile(
		registry.knobs,
		entry.delta as ProfileDelta,
	);
	if (!validation.valid) {
		return {
			problems: [
				{
					kind: "profile-delta-invalid",
					index,
					id,
					problems: validation.errors,
				},
			],
		};
	}
	const name = typeof entry.name === "string" ? entry.name.trim() : "";
	const description =
		typeof entry.description === "string" ? entry.description.trim() : "";
	const profile: {
		id: string;
		name: string;
		description?: string;
		base: RuleProfilePackBase | null;
		delta: ProfileDelta;
		snapshot?: unknown;
	} = {
		id,
		name: name === "" ? id : name,
		// An empty description is no description: omit it, exactly as the
		// builder does, so a parsed pack re-exports byte-identically.
		...(description === "" ? {} : { description }),
		base,
		delta: validation.value,
		// The snapshot rides along untouched. It is metadata; nothing below
		// reads it, and packProfileEffective never will.
		...(entry.snapshot === undefined ? {} : { snapshot: entry.snapshot }),
	};
	return { profile };
}

function result(
	problems: readonly RuleProfilePackProblem[],
	profiles: readonly RuleProfilePackProfile[] = [],
): RuleProfilePackResult {
	return {
		valid: problems.length === 0,
		problems,
		profiles,
		errors: problems.map(packProblemMessage),
	};
}

/**
 * Parse a rules pack.
 *
 * ALL OR NOTHING: one bad profile refuses the whole pack, so a GM cannot
 * import the four good profiles of a five-profile pack and discover the fifth
 * was a typo three sessions later. `profiles` is therefore empty whenever
 * `valid` is false, and `problems` names every reason.
 *
 * The value may be the pack TEXT (a textarea or a picked file's contents) or an
 * already-parsed object; both go through the same guards. The registry
 * defaults to the ACTIVE system's: the `kind` guard and every delta check are
 * theirs, so a pack authored for a sibling system is refused by name instead
 * of being translated.
 */
export function parseRuleProfilePack(
	value: unknown,
	registry: RuleKnobRegistry = ruleKnobRegistry(),
): RuleProfilePackResult {
	const decoded = decodePack(value);
	if (!decoded.ok) return result([decoded.problem]);
	const pack = decoded.value;
	if (!isRecord(pack)) return result([{ kind: "not-an-object", got: describeValue(pack) }]);
	const kindProblem = kindProblemFor(pack.kind, registry);
	if (kindProblem) return result([kindProblem]);
	const schemaProblem = schemaVersionFor(pack.schemaVersion);
	if (schemaProblem) return result([schemaProblem]);
	if (!Array.isArray(pack.profiles)) {
		return result([
			{ kind: "profiles-not-a-list", got: describeValue(pack.profiles) },
		]);
	}
	const problems: RuleProfilePackProblem[] = [];
	const profiles: RuleProfilePackProfile[] = [];
	const seen = new Set<string>();
	for (const [index, entry] of (pack.profiles as unknown[]).entries()) {
		const parsed = parseEntry(entry, index + 1, seen, registry);
		if ("problems" in parsed) problems.push(...parsed.problems);
		else {
			profiles.push(parsed.profile);
			seen.add(parsed.profile.id);
		}
	}
	return result(problems, profiles);
}

// ---------------------------------------------------------------------------
// Pack building (export)
// ---------------------------------------------------------------------------

/** The row shape the app exports: id, name, delta, plus what a re-export keeps. */
export interface RuleProfilePackRow {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	/** The row's own base, preserved when re-exporting a parsed pack. */
	readonly base?: RuleProfilePackBase | null;
	readonly delta: ProfileDelta;
	readonly snapshot?: unknown;
}

/**
 * One entry of the built pack, in the pack's documented key order
 * (id, name, description?, base, delta, snapshot?). The order is fixed here so
 * an export -> import -> export round trip is byte-identical: the parser keeps
 * whatever it read, and the builder always writes the same shape.
 */
function packEntry(
	row: RuleProfilePackRow,
	defaultBase: RuleProfilePackBase,
): RuleProfilePackProfile {
	const base: RuleProfilePackBase | null = row.base ?? {
		profile: defaultBase.profile,
		...(defaultBase.systemVersion
			? { systemVersion: defaultBase.systemVersion }
			: {}),
	};
	const entry: {
		id: string;
		name: string;
		description?: string;
		base: RuleProfilePackBase | null;
		delta: ProfileDelta;
		snapshot?: unknown;
	} = {
		id: row.id,
		name: row.name,
		// An empty description is no description: omitting it keeps the pack
		// small and keeps the round trip byte-identical.
		...(row.description === undefined || row.description === ""
			? {}
			: { description: row.description }),
		base,
		delta: row.delta,
		...(row.snapshot === undefined ? {} : { snapshot: row.snapshot }),
	};
	return entry;
}

/**
 * Serialise rows into a pack.
 *
 * `base` is what the export fills in for every row that does not carry its own:
 * the profile id and system version the deltas were authored against, so a
 * world on a newer Core Rulebook can flag the difference instead of trusting a
 * rule tuned for something else.
 *
 * The `kind` comes from the registry in force (RT's by default), so the pack
 * says which system it belongs to without any caller naming one.
 */
export function buildRuleProfilePack(
	rows: readonly RuleProfilePackRow[],
	base: RuleProfilePackBase,
	registry: RuleKnobRegistry = ruleKnobRegistry(),
): RuleProfilePack {
	return {
		kind: ruleProfilePackKindFor(registry.systemId),
		schemaVersion: RULE_PROFILE_PACK_SCHEMA_VERSION,
		profiles: rows.map((row) => packEntry(row, base)),
	};
}

/** The pack as the JSON text a GM copies, downloads or pastes. */
export function ruleProfilePackJson(
	rows: readonly RuleProfilePackRow[],
	base: RuleProfilePackBase,
	registry: RuleKnobRegistry = ruleKnobRegistry(),
): string {
	return JSON.stringify(
		buildRuleProfilePack(rows, base, registry),
		null,
		2,
	);
}

/**
 * The rules a pack profile produces: the base profile with the delta merged
 * over it.
 *
 * The snapshot is NOT read — this function takes the delta and nothing else,
 * which is what makes "snapshot is display-only" a property of the code rather
 * than a comment nobody enforces. The merge resolves its knobs against the
 * ACTIVE registry (RT's by default) unless the caller names another.
 */
export function packProfileEffective(
	entry: { readonly delta: ProfileDelta },
	base: SystemProfile = rtCore,
	registry: readonly RuleKnob[] = ruleKnobs(),
): SystemProfile {
	return mergeProfile(base, entry.delta, registry);
}

// ---------------------------------------------------------------------------
// Refusal sentences (English — the app localises these through its own table)
// ---------------------------------------------------------------------------

function paramsOf(problem: RuleProfilePackProblem): Record<string, string> {
	const params: Record<string, string> = {};
	for (const [key, value] of Object.entries(problem)) {
		if (key === "kind" || key === "problems") continue;
		params[key] = String(value);
	}
	return params;
}

/** One problem as an English sentence (tests, logs, headless fallbacks). */
export function packProblemMessage(problem: RuleProfilePackProblem): string {
	switch (problem.kind) {
		case "not-json":
			return `the pack is not valid JSON: ${problem.message}`;
		case "not-an-object":
			return `a rules pack must be a JSON object, got ${problem.got}`;
		case "wrong-kind":
			return `this is not a Rogue Trader rules pack: kind is ${problem.got}, expected ${problem.expected}`;
		case "unsupported-schema":
			return `rules pack schema version ${problem.got} is not supported — this system reads version ${problem.supported}`;
		case "profiles-not-a-list":
			return `the pack's "profiles" must be an array, got ${problem.got}`;
		case "profile-not-a-row":
			return `pack profile ${problem.index} is not an object, got ${problem.got}`;
		case "profile-no-id":
			return `pack profile ${problem.index} has no id — every profile needs one`;
		case "profile-bad-base":
			return `pack profile ${problem.index} ("${problem.id}") has a "base" that is not an object of strings`;
		case "profile-no-delta":
			return `pack profile ${problem.index} ("${problem.id}") has no delta — a profile needs the knob keys it changes`;
		case "profile-duplicate-id":
			return `the pack lists the id "${problem.id}" twice (profile ${problem.index}) — each profile needs its own id`;
		case "profile-delta-invalid":
			return `pack profile ${problem.index} ("${problem.id}") was refused: ${problem.problems.join("; ")}`;
	}
}

/**
 * A problem's interpolation parameters, so the app can localise it without
 * knowing the problem's shape. Values are stringified; Foundry interpolates
 * them into the translated sentence.
 */
export function packProblemParams(
	problem: RuleProfilePackProblem,
): Record<string, string> {
	return paramsOf(problem);
}

/**
 * Weapon-quality registry (bead gyei): the RT book's roll-mechanic and
 * attack-modifier weapon qualities live HERE, with the RT data they belong to.
 *
 * Two registries previously carried this behaviour split across layers:
 *
 * - `QUALITY_CONTRIBUTIONS` sat in the system-neutral funnel
 *   (ffg/application/funnel.ts) as the LAST RT book table there (bead 8ycd
 *   already hoisted origin-traits and attack-context into RT modules); and
 * - `parseSpecialMechanics` (talent-effects.ts) hard-coded a if/else-if
 *   switch chain ("tearing" ... "toxic" ... blast regex).
 *
 * One slug-keyed registry now answers BOTH routes (each def declares what it
 * carries, neither is required):
 *
 * - `contribution` — the funnel test-modifier row (accurate/defensive);
 *   the contributor registers as "weapon-qualities" from
 *   rules/funnel-registration.ts, with the other RT contributors.
 * - `mechanics` — roll mechanics for the damage pipeline, consumed by
 *   parseSpecialMechanics / collectRollMechanicEffects (talent-effects.ts),
 *   which previously needed the per-quality switch chain.
 *
 * Adding a quality = one `weaponQualities.register` HERE (+lang keys where
 * the display seams need a label) — no funnel edit, no switch chain.
 *
 * Parameterised forms: the printed entry's base slug is its first segment
 * split over the printable separators ("- ("), rated as
 * `q.split(/[- (]/)[0]`; "blast (3)" / "blast-4" / "blast (3)" → "blast" +
 * rating 3. A def with `rating: "optional"` (bare "Blast" = rating 0) may
 * carry a numerical rating form; a rating that cannot be parsed as a number
 * WARNS and drops the quality loudly (bead dfb8 semantics, e.g. "blast
 * (1d5)" — a variable rating can never resolve to a static value). Flag
 * qualities (`rating: "none"`) ignore any printed rating silently, as they
 * always have.
 *
 * Unregistered qualities are inert (not warned): the `special` array carries
 * free-form book prose fragments ("Overheat", "Unstable") far beyond the
 * engine's coverage.
 */

import type { TestContributor, TestModifierContext } from "../../ffg/application/funnel";
import { qualityLabelKey } from "../../ffg/application/funnel";
import { HandlerRegistry } from "../../ffg/domain/registry";
import type { Modifier } from "../../rules-engine/modifier";
import type { RollMechanics } from "./talent-effects";

export interface WeaponQualityDef {
	/** Registry slug: the printable form's first segment, e.g. "accurate". */
	slug: string;
	/**
	 * Whether the printable form carries a numeric rating ("Blast (3)"):
	 * - "none" (default): flag quality — a printed rating is ignored, as it
	 *   always was ("toxic-5" in the DH2e pack data is NOT RT Toxic).
	 * - "optional": bare form = rating 0 (book "Blast"), rated form parsed.
	 */
	rating?: "none" | "optional";
	/**
	 * Funnel test-modifier row (accurate/defensive); omitted for roll-only
	 * qualities. `rating` is the entry's parsed rating (null when none) — a
	 * parameterised contribution (e.g. "felling-1") reads it here. Null = no
	 * row for this test.
	 */
	contribution?: (context: TestModifierContext, rating: number | null) => number | null;
	/**
	 * Roll mechanics the quality applies to the damage pipeline; omitted for
	 * contribution-only qualities. Called with the parsed rating (null when
	 * none printed or, on the effect-kind route, when the spec's value is
	 * missing) — a null-receiving def decides for itself (Blast: 0).
	 */
	mechanics?: (rating: number | null) => Partial<RollMechanics>;
}

const registry = new HandlerRegistry<string, WeaponQualityDef>();

/**
 * Once-per-slug warn cache (bead gyei review): matchQualityEntry is reached
 * from MULTIPLE routes per attack (the funnel dialog's contributor AND the
 * damage pipeline), so a shipped variable-rating entry like the Bomb Squig's
 * "blast-1d5" warned two-to-three identical times per attack. Keyed by the
 * quality SLUG: a repeat parse of an unparseable rating under the same slug
 * (same broken data, hit through the other route) stays silent after the
 * first warning. The failure stays LOUD — the first warning is verbatim and
 * the quality is still dropped; nothing silently succeeds.
 */
const warnedQualitySlugs = new Set<string>();

/** Test affordance: clear the once-per-slug warn cache so warn-count asserts
 * stay hermetic across suites in one process. */
export function resetQualityWarns(): void {
	warnedQualitySlugs.clear();
}

/** The quality registry. Register at module scope or in a test; defs are read-only data. */
export const weaponQualities = {
	/**
	 * Add a quality def. First def registered under a slug wins: (i)
	 * re-registering an existing slug is silently ignored from the reader's
	 * viewpoint — `def()` reads only the FIRST registration, so a later def
	 * under a live slug never takes effect (a reference-identical repeat is a
	 * no-op by design, bead 00z5). (ii) There is deliberately no off/clear
	 * override here yet: module-authored override of a core quality rides the
	 * 00z5 off/clear affordance story if that seam is ever opened for
	 * HandlerRegistry-backed registries; until then, house rules REGISTER NEW
	 * slugs via this same seam rather than editing core defs.
	 */
	register(def: WeaponQualityDef): void {
		registry.on(def.slug, def);
	},
	/** The def registered under a slug (first registration wins). */
	def(slug: string): WeaponQualityDef | undefined {
		return registry.for(slug)[0];
	},
	/** Slugs with at least one def (covers both routes). */
	keys(): string[] {
		return registry.keys();
	},
};

/** One matched printable quality entry. */
export interface QualityEntryMatch {
	def: WeaponQualityDef;
	/** Numeric rating parsed from the printed form; null when none printed. */
	rating: number | null;
}

/**
 * Match one printable quality entry against the registry ("bead gyei" parse
 *): the base slug is the first segment split over the printable separators
 * ("-", " ", "(" after ")" is dropped, so "blast (3)" reads clean); the
 * remaining tokens are its rating. A def-less entry (free prose like
 * "Overheat") returns null silently; a def with an UNPARSEABLE rating
 * ("blast (1d5)" — a dice rating can never be a static value) warns and
 * drops the quality loudly, never silently.
 */
export function matchQualityEntry(entry: string): QualityEntryMatch | null {
	const parts = entry
		.trim()
		.toLowerCase()
		.replace(/\)/g, "")
		.split(/[- (]/);
	const slug = parts[0] ?? "";
	const def = weaponQualities.def(slug);
	if (!def) return null;
	const tokens = parts.slice(1).filter((token) => token !== "");
	if (tokens.length === 0) return { def, rating: null };
	// A printable rating is exactly ONE numeric token.
	const rating =
		tokens.length === 1 && Number.isFinite(Number(tokens[0]))
			? Number(tokens[0])
			: null;
	if (rating === null) {
		// Warn only the first time this slug's unparseable rating is seen (the
		// cache above): the same broken entry is re-parsed through several
		// routes per attack, and repeating the identical warning buys nothing.
		if (!warnedQualitySlugs.has(def.slug)) {
			warnedQualitySlugs.add(def.slug);
			console.warn(
				`rogue-trader | weapon quality "${entry}" carries a rating the parser cannot read (quality "${def.slug}", rating: ${tokens.join("/")}) — the quality contributes NOTHING. ` +
					`Fix the data (use the numeric form "blast-4"/"blast (4)") or extend the registry.`,
			);
		}
		return null;
	}
	// Flag qualities ("none") never read a rating — silently inert, exactly as
	// the pre-registry parser left any non-matching entry.
	if (def.rating !== "optional") return null;
	return { def, rating };
}

/**
 * The RT quality seeds (bead gyei): every value here is a remembered
 * Core Rulebook quality — accurate/defensive VERIFIED on book pp115-116
 * (PDF p116), funnel.test.ts pins both; Tearing/Toxic/Blast wording lives in
 * the talent-effects roll-mechanic docblock (bead gci0).
 *
 * MODULE-REGISTERED qualities (house rules, sibling systems) call
 * `weaponQualities.register` themselves — same seam the rule profiles use.
 */
weaponQualities.register({
	slug: "accurate",
	// Accurate: Core Rulebook pp115-116 (PDF p116): +10 to BS with an Aim
	// Action, in addition to the aiming bonus.
	contribution: (context) => (context.aimed && context.kind === "attack" ? 10 : null),
});
weaponQualities.register({
	slug: "defensive",
	// Defensive: Core Rulebook p115 (PDF p116): +15 to Parry but -10 when
	// used to make attacks. The attack penalty lives here.
	contribution: (context) => (context.kind === "attack" ? -10 : null),
});
weaponQualities.register({
	slug: "tearing",
	mechanics: () => ({ tearing: true }),
});
weaponQualities.register({
	slug: "toxic",
	// Toxic-3/-5 forms (DH2e pack data) are NOT RT Toxic — rating "none" keeps
	// them inert, as the pre-registry parser did.
	mechanics: () => ({ toxic: true }),
});
weaponQualities.register({
	slug: "blast",
	// Bare "Blast" (no rating) = 0, exactly as the old regex's `?? 0` did.
	rating: "optional",
	mechanics: (rating) => ({ blast: rating ?? 0 }),
});

/**
 * Built-in funnel contributor (bead gyei), hoisted out of the system-neutral
 * funnel into this RT module — one-for-one with the origin-traits precedent
 * (beads 8ycd/i4b0). The funnel's test-modifier walk matches the printable
 * entry's base slug, so parameterised forms ("crippling-1d5") reach their
 * def.
 *
 * Registration is explicit, not an import side effect (bead i4b0): the
 * contributor registers in rules/funnel-registration.ts beside the other RT
 * contributors, so a caller importing the funnel machinery directly still
 * sees it without depending on which module happened to load first.
 */
export const weaponQualitiesContributor: TestContributor = (_view, context) => {
	if (context.kind !== "attack" || !context.weapon) return [];
	const special = context.weapon.special ?? [];
	const mods: Modifier[] = [];
	for (const quality of special) {
		const match = matchQualityEntry(quality);
		if (!match?.def.contribution) continue;
		const value = match.def.contribution(context, match.rating);
		if (value === null || value === 0) continue;
		// Bead dfdv: the label is the QUALITY.<SLUG> KEY (Foundry-free); the
		// display seams localize it via localizeLabel.
		mods.push({
			id: `quality:${match.def.slug}`,
			source: { type: "item", label: "WEAPON.SPECIAL" },
			label: qualityLabelKey(match.def.slug),
			value,
		});
	}
	return mods;
};
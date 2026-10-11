/**
 * The character creator's compendium loaders + dice helper (bead hldm) —
 * the Foundry-coupled fetch edge that feeds the PURE context builders in
 * creator-context.ts. Extracted from the class so the module-level session
 * caches (career docs, Table 1-1 suggestions) and the pack fetches live in
 * one loader module instead of inside the application class.
 *
 * This module is allowed to touch Foundry (docs/ARCHITECTURE.md: sheet
 * layer); the creators' handlers use it for context prep only.
 */
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import {
	WEAPON_CLASSES,
	weaponTrainingCoverage,
	type WeaponTrainingCoverage,
} from "../../rules/acquisition";
import { type SpeciesOption, speciesOptions } from "../../rules/creation";
import { resolveOrigins } from "../../rules/origins";
import { readRtFlag } from "../../rules/chat-flags";
import {
	getTalentLinkDocs,
	setTalentLinkDocs,
	talentLinkDocFromDoc,
} from "../../rules/talent-catalog";
import {
	characterOptionDocsOnce,
	getCharacterOptionDocs,
	getPackDocuments,
	type PackDocLike,
} from "../pack-resolve";
import {
	type AcqDocLike,
	type AcqOption,
	buildAcquisitions,
} from "./creator-context";
import type { CareerDocLike, CreatorState } from "./creator-state";

/** Dice seam: roll one notation through the injected Dice port. */
export async function rollFormula(formula: string): Promise<number> {
	return (await getPorts().dice.roll(formula)).total ?? 0;
}

// --- Careers ------------------------------------------------------------------

let careerDocsCache: CareerDocLike[] | null = null;

/** The careers pack, read once. */
export async function careerDocs(): Promise<CareerDocLike[]> {
	if (!careerDocsCache) {
		careerDocsCache = (await getCharacterOptionDocs(
			"career",
		)) as unknown as CareerDocLike[];
	}
	return careerDocsCache;
}

/**
 * The STARTING careers (blank requiredCareer) — a starting character cannot
 * hold an alternate/elite rank.
 */
export async function startingCareerDocs(): Promise<CareerDocLike[]> {
	const docs = await careerDocs();
	return docs.filter((doc) => (doc.system?.requiredCareer ?? "").trim() === "");
}

let careerSuggestionCache: Map<string, string[]> | null = null;

/**
 * careerKey -> suggested home-world origin keys (Core Rulebook Table 1-1,
 * p24), read from the careers pack's `system.suggestedHomeWorlds` (epic
 * 1gb7 follow-up). Cached across re-renders; empty until the pack loads.
 */
export async function careerSuggestions(): Promise<Map<string, string[]>> {
	if (!careerSuggestionCache) {
		careerSuggestionCache = new Map(
			(await careerDocs())
				.filter((doc) => doc.system?.key)
				.map((doc) => [
					String(doc.system?.key),
					(doc.system?.suggestedHomeWorlds ?? []).map(String),
				]),
		);
	}
	return careerSuggestionCache;
}

/** Species options from the careers pack's species blocks, plus human. */
export async function creatorSpeciesOptions(): Promise<SpeciesOption[]> {
	const docs = await careerDocs();
	return speciesOptions(docs.map((doc) => doc.system?.species));
}

// --- Talent doc-link catalog ----------------------------------------------------

/**
 * Ensure the warmed talent-doc link catalog is loaded (bead hjve): normally
 * warmed at ready (bootstrap/warmers); if the creator opens before the pack
 * resolves, fill it here from the same shared mapper — loudly empty is a
 * bug, not a feature. A successfully EMPTY fetch means the pack is absent
 * and the chips degrade to plain text (the same tolerated re-fetch
 * #ensurePool accepts).
 */
export async function ensureTalentLinkDocs(): Promise<PackDocLike[]> {
	if (getTalentLinkDocs().length > 0) return getTalentLinkDocs();
	setTalentLinkDocs(
		// The CACHED fetch (bead oo5b F5): getCharacterOptionDocs would
		// re-fetch the whole pack on EVERY re-render while the pack is
		// absent — with an empty catalog the guard above always re-runs.
		(
			(await characterOptionDocsOnce("talent")) as unknown as Array<{
				name?: string;
				uuid?: string;
				system?: unknown;
			}>
		).map((doc) => talentLinkDocFromDoc(doc)),
	);
	return getTalentLinkDocs();
}

// --- Starting acquisitions (stage 6, gjvg) --------------------------------------

/**
 * Weapon-training coverage for the starting-acquisition gate, from the
 * chosen career's startingTalents plus origin talents (book p272 bullet 2;
 * pure rule logic in rules/acquisition.ts weaponTrainingCoverage). No
 * career chosen yet (page navigation) — everything selectable, matching
 * the pre-gate behaviour until the talent list exists.
 */
export async function weaponTrainingCoverageFor(
	state: CreatorState,
): Promise<WeaponTrainingCoverage> {
	if (!state.careerKey) {
		return {
			classes: new Set(WEAPON_CLASSES),
			byCategory: {},
			exotic: new Set(),
			sources: new Set(),
		};
	}
	const talentNames = [...(resolveOrigins(state.picks).talents ?? [])];
	const docs = (await getCharacterOptionDocs("career")) as unknown as Array<{
		name?: string;
		system?: { key?: string; startingTalents?: string[] };
	}>;
	const career = docs.find((c) => c.system?.key === state.careerKey);
	if (!career) {
		return {
			classes: new Set(WEAPON_CLASSES),
			byCategory: {},
			exotic: new Set(),
			sources: new Set(),
		};
	}
	talentNames.push(...(career.system?.startingTalents ?? []));
	return weaponTrainingCoverage(talentNames);
}

/**
 * Items from the equipment packs qualifying as the starting free
 * acquisition (availability modifier >= +0, Table 9-35; printed p272 —
 * the file-page-0273 heading "Acquisition and Starting Characters" is
 * printed page 272 under the dump's +1 offset). Book bullets:
 * "They may choose a single item with a total Acquisition Modifier of
 * +0 or more without the need to make an Acquisition Test" and "In the
 * case of weapons, a character may only choose those which he can use.
 * i.e., he must have a corresponding Weapon Training Talent."
 *
 * The chip mapping is the PURE buildAcquisitions; this loader owns the
 * pack fetch, the Foundry flag reader and the caller's payload map (the
 * application keeps the payloads instance-side; full item JSON never goes
 * through the DOM — the old data-payload attribute broke on JSON quotes).
 * The weapon-training gate is enforced here at the loader level — see the
 * pure builder's comment on the family mapping.
 */
export async function startingAcquisitions(
	state: CreatorState,
	payloads: Map<string, object>,
): Promise<AcqOption[]> {
	payloads.clear();
	const coverage = await weaponTrainingCoverageFor(state);
	const docs = (await getPackDocuments(
		"rogue-trader.equipment",
	)) as unknown as AcqDocLike[];
	const { options, payloads: built } = buildAcquisitions(
		docs,
		coverage,
		state.acquisition?.key ?? "",
		(doc) => String(readRtFlag(doc, "source") ?? ""),
		(key: string) => game.i18n!.localize(key),
	);
	for (const [key, payload] of built) {
		payloads.set(key, payload);
	}
	return options;
}

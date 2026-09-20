import type { CharacteristicKey } from "../../data/actor/character";
import {
	getHeirloomEntries,
	heirloomForRoll,
} from "../../rules/heirlooms";
import {
	allowedColumns,
	type CharMod,
	entryColumns,
	fateFromTable,
	ORIGIN_ROW_LABEL_KEYS,
	type OriginPick,
	type OriginRow,
	isOriginRow,
	originByKey,
	originRowsForSpecies,
	originsInRow,
	storedOriginPicks,
	storedOriginsFromPicks,
	type ResolvedOrigin,
	resolveOrigins,
} from "../../rules/origins";
import {
	availabilityModifier,
	isTrainedFor,
	WEAPON_CLASSES,
	type WeaponTrainingCoverage,
	weaponTrainingCoverage,
} from "../../rules/acquisition";
import {
	careersForSpecies,
	type CatalogSkill,
	CREATOR_LAST_STEP,
	creatorCanAdvance,
	DEFAULT_SPECIES_WOUNDS,
	type FateBand,
	fateFromBands,
	finalCharacteristics,
	HUMAN_SPECIES_KEY,
	isUnresolvedChoice,
	matchOriginSkills,
	POINT_BUY_MAX,
	type SpeciesOption,
	type SpeciesSource,
	type SpeciesWoundsSpec,
	speciesOptions,
	validatePointBuy,
	woundsFromOrigin,
	woundsFromSpecies,
} from "../../rules/creation";
import {
	GRANTED_BY_CREATOR,
	type GrantPayload,
	reconcileForCreator,
	skillGrantPayload,
} from "../../rules/grants";
import { sheetContext } from "../context";
import { waitForDefaultGrants } from "../default-grants";
import { getCharacterOptionDocs, getPackDocuments } from "../pack-resolve";
import { CreatorApplication } from "./creator-application";
import { promptParameterisedSubject, talentGrant } from "./grant-helpers";

/** yclz: prompt for a parameterised talent's subject; resolved names pass through. */
async function resolveParameterisedTalent(
	name: string,
): Promise<string | null> {
	return promptParameterisedSubject(name);
}

/** Career-doc suggestion cache (system.suggestedHomeWorlds), per session. */
let careerSuggestionCache: Map<string, string[]> | null = null;

/**
 * A careers-pack document, as far as the creator reads it (bead ghmn). The
 * creator is COMPENDIUM-DRIVEN: the species list, the per-species career list
 * and every base value come from these docs — nothing is authored in code.
 */
interface CareerDocLike {
	name?: string;
	system?: {
		key?: string;
		suggestedHomeWorlds?: string[];
		/** Verbatim alternate/elite gate; blank = a starting career. */
		requiredCareer?: string;
		species?: SpeciesSource;
	};
}

let careerDocsCache: CareerDocLike[] | null = null;

/** The careers pack, read once. */
async function careerDocs(): Promise<CareerDocLike[]> {
	if (!careerDocsCache) {
		careerDocsCache = (await getCharacterOptionDocs(
			"career",
		)) as unknown as CareerDocLike[];
	}
	return careerDocsCache;
}

const CHARACTERISTIC_ORDER: CharacteristicKey[] = [
	"ws",
	"bs",
	"s",
	"t",
	"ag",
	"int",
	"per",
	"wp",
	"fel",
];

interface CreatorState {
	name: string;
	method: "roll" | "points";
	/**
	 * The species' per-characteristic 2d10 BASE (bead ghmn), copied from the
	 * careers compendium when a species is chosen. Human = 25 across, which is
	 * also the initial value, so an unchosen species behaves exactly as before.
	 */
	base: Record<CharacteristicKey, number>;
	/** Chosen species key ("" = human) + its pack label/formulas for display. */
	speciesKey: string;
	speciesLabel: string;
	speciesFate: number;
	speciesFateFormula: string;
	speciesWoundsFormula: string;
	/** Structured species starter-Fate bands (bead g45s); empty = fixed/none. */
	speciesFateBands: FateBand[];
	/** Structured species starter-Wounds spec (bead g45s). */
	speciesWounds: SpeciesWoundsSpec;
	allocated: Partial<Record<CharacteristicKey, number>>;
	rolled: Partial<Record<CharacteristicKey, number>>;
	rerollUsed: boolean;
	picks: Partial<Record<OriginRow, OriginPick>>;
	/** Track choice for corruptionOrInsanityDice, per row key. */
	corrOrInsTrack: Record<string, "corruption" | "insanity">;
	careerKey: string;
	/** Rolled totals for wounds/fate/insanity/corruption dice. */
	rolledDice: {
		wounds: number[];
		fateD10: number | null;
		/** Species-block wound dice (bead g45s); empty for the human path. */
		speciesWounds: number[];
		/** Species-block starting-Fate d10 (bead g45s). */
		speciesFateD10: number | null;
		insanity: number[];
		corruption: number[];
		corrOrInsanity: number[];
	};
	/** Stage 6: the starting free acquisition (item key + pack payload). */
	acquisition: { key: string; name: string; payload: object } | null;
	/** Stage 6 collapsed group state (bead a2rd): group key -> collapsed. */
	acqCollapsed: Record<string, boolean>;
	/** Stage 3.5 (bead rboc): rolled heirloom (1d100 result + entry name). */
	heirloom: { roll: number; name: string } | null;
}

interface AcqOption {
	/** Stable chip key (pack + name); payloads live in #acquisitionPayloads. */
	key: string;
	name: string;
	payload: object;
	tooltip: string;
	group: string;
	/** Weapon-training gate (book p272 bullet 2): false = not selectable. */
	selectable: boolean;
	selected: boolean;
}

function emptyState(): CreatorState {
	return {
		name: "",
		method: "roll",
		base: {
			ws: 25,
			bs: 25,
			s: 25,
			t: 25,
			ag: 25,
			int: 25,
			per: 25,
			wp: 25,
			fel: 25,
		},
		allocated: {},
		rolled: {},
		speciesKey: HUMAN_SPECIES_KEY,
		speciesLabel: "",
		speciesFate: 0,
		speciesFateFormula: "",
		speciesWoundsFormula: "",
		speciesFateBands: [],
		speciesWounds: { ...DEFAULT_SPECIES_WOUNDS },
		rerollUsed: false,
		picks: {},
		corrOrInsTrack: {},
		careerKey: "",
		rolledDice: {
			wounds: [],
			fateD10: null,
			speciesWounds: [],
			speciesFateD10: null,
			insanity: [],
			corruption: [],
			corrOrInsanity: [],
		},
		acquisition: null,
		acqCollapsed: {},
		heirloom: null,
	};
}

async function roll(formula: string): Promise<number> {
	const roll = new foundry.dice.Roll(formula);
	await roll.evaluate();
	return roll.total ?? 0;
}

/**
 * Character creator (bead ay0): a wizard over Core Rulebook Chapter I stages 1-2.
 *
 * Stage 1 — Generate Characteristics (p14): 2d10+25 per characteristic with
 * the book's single re-roll, or the "Allocating Points" alternative (25 base,
 * +100 budget, max +20 to any one).
 * Stage 2 — The Origin Path (p16-35): Home World -> Birthright -> Lure of the
 * Void -> Trials and Travails -> Motivation, with the chart's adjacency rule
 * enforced (each pick allows the option below it or its horizontal
 * neighbours), including sub-result variants and player choices.
 * Careers are a free choice (p24) with Table 1-1 suggested combinations
 * highlighted; Wounds/Fate/Insanity/Corruption are rolled per the chosen
 * Home World's tables; starting XP is 500 (p30).
 *
 * Stages 3-7 of the chapter (XP spending, Giving Characters Life, Profit
 * Factor and Ship Points, Select Equipment) are group-level or advancement-
 * engine dependent and remain out of scope for the creator itself.
 */
export class CharacterCreator extends CreatorApplication {
	static DEFAULT_OPTIONS = CreatorApplication.creatorOptions({
		id: "rogue-trader-character-creator",
		slug: "character-creator",
		titleKey: "CREATOR.TITLE",
		width: 720,
		height: 640,
		actions: {
			setMethod: CharacterCreator.#onSetMethod,
			rollOne: CharacterCreator.#onRollOne,
			reroll: CharacterCreator.#onReroll,
			rollAll: CharacterCreator.#onRollAll,
			alloc: CharacterCreator.#onAlloc,
			chooseOrigin: CharacterCreator.#onChooseOrigin,
			choosePickOption: CharacterCreator.#onChoosePickOption,
			chooseCorrIns: CharacterCreator.#onChooseCorrIns,
			chooseCareer: CharacterCreator.#onChooseCareer,
			chooseSpecies: CharacterCreator.#onChooseSpecies,
			chooseAcquisition: CharacterCreator.#onChooseAcquisition,
			toggleAcqGroup: CharacterCreator.#onToggleAcqGroup,
			rollHeirloom: CharacterCreator.#onRollHeirloom,
			finish: CharacterCreator.#onCreate,
		},
	});

	/** Species, characteristics, Origin Path, review, equipment. */
	protected get lastStep(): number {
		return CREATOR_LAST_STEP;
	}

	/**
	 * Step 2 is the Origin Path: its wounds/Fate/insanity dice are rolled on
	 * entry (the dice belong to the origin rows, not the species).
	 */
	protected override async onEnterStep(step: number): Promise<void> {
		if (step === 2) await this.#rollOriginDice();
	}

	creatorState: CreatorState = emptyState();

	constructor(options: { actor?: foundry.documents.Actor } & object = {}) {
		super(options);
		// Only character-carrying actors can prefill/update-in-place. Right-
		// clicking a vehicle, ship, planet or dynasty entry (the creator menu is
		// offered on every actor entry) must start a fresh explorer, not crash
		// reading a missing `characteristics` block.
		const candidate = options.actor ?? null;
		const hasCharacteristics = Boolean(
			(candidate?.system as { characteristics?: unknown } | undefined)
				?.characteristics,
		);
		this.targetActor = candidate && hasCharacteristics ? candidate : null;
		if (this.targetActor) {
			const system = this.targetActor.system as unknown as {
				characteristics: Record<CharacteristicKey, { value: number }>;
				careerKey?: string;
			};
			this.name = this.targetActor.name ?? "";
			this.creatorState.careerKey = system.careerKey ?? "";
			// Existing characteristics prefill as rolled values; the player can
			// re-roll (book: one re-roll) or switch to point-buy.
			for (const key of CHARACTERISTIC_ORDER) {
				this.creatorState.rolled[key] =
					system.characteristics[key]?.value ?? 25;
			}
		}
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/character-creator.hbs",
		},
	};

	get #resolved(): ResolvedOrigin {
		return resolveOrigins(this.creatorState.picks);
	}

	/**
	 * The species list for the Species step (bead ghmn), derived from the
	 * careers compendium's species blocks — human first, then each distinct
	 * xeno species the pack defines. Empty pack (still loading) yields human
	 * only, so the step is always safe to render.
	 */
	/**
	 * The Origin rows for the chosen species (bead ghmn), DERIVED FROM THE
	 * PACK: human uses the five core rows, and a xeno species uses whatever
	 * rows its own entries declare (Kroot -> a single Kindred row; Into the
	 * Storm p48 is explicit that they do not use the Origin Path). Every Origin
	 * step check below goes through this, so nothing assumes the human five.
	 */
	#originRows(): OriginRow[] {
		return originRowsForSpecies(this.creatorState.speciesKey);
	}

	async #speciesOptions(): Promise<SpeciesOption[]> {
		const docs = await careerDocs();
		return speciesOptions(docs.map((doc) => doc.system?.species));
	}

	/**
	 * careerKey -> suggested home-world origin keys (Core Rulebook Table 1-1,
	 * p24), read from the careers pack's `system.suggestedHomeWorlds` (epic
	 * 1gb7 follow-up). Cached across re-renders; empty until the pack loads.
	 */
	async #suggestedHomeWorlds(): Promise<Map<string, string[]>> {
		const docs = await careerDocs();
		if (!careerSuggestionCache) {
			careerSuggestionCache = new Map(
				docs
					.filter((doc) => doc.system?.key)
					.map((doc) => [
						String(doc.system?.key),
						(doc.system?.suggestedHomeWorlds ?? []).map(String),
					]),
			);
		}
		return careerSuggestionCache;
	}

	/** The name field lives on step 0; keep it in state across re-renders. */
	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		const input = this.element?.querySelector<HTMLInputElement>(
			'input[name="explorer-name"]',
		);
		if (input && !input.dataset.wired) {
			input.dataset.wired = "1";
			input.addEventListener("input", () => {
				this.name = input.value;
			});
		}
	}

	#baseCharacteristics(): Record<CharacteristicKey, number> {
		const base = {} as Record<CharacteristicKey, number>;
		for (const key of CHARACTERISTIC_ORDER) {
			base[key] =
				this.creatorState.method === "roll"
					? (this.creatorState.rolled[key] ?? this.creatorState.base[key])
					: this.creatorState.base[key] +
						(this.creatorState.allocated[key] ?? 0);
		}
		return base;
	}

	/**
	 * Starting Wounds/Fate for the current character (bead g45s). A chosen
	 * species uses its structured block (Wounds spec + Fate bands); the human
	 * path uses the Origin Path tables. Only reads the pre-rolled dice in state,
	 * so the Review card and the created actor always agree.
	 */
	#resolveVitals(
		chars: Record<CharacteristicKey, number>,
		resolved: ResolvedOrigin,
	): {
		wounds: number;
		fate: number;
		woundsBreakdown: string;
		fateBreakdown: string;
	} {
		const state = this.creatorState;
		const tb = Math.floor(chars.t / 10);
		if (state.speciesKey !== HUMAN_SPECIES_KEY) {
			const spec = state.speciesWounds;
			const wounds = woundsFromSpecies(
				spec,
				tb,
				state.rolledDice.speciesWounds,
			);
			const rolled = state.rolledDice.speciesFateD10 ?? 1;
			const fate =
				state.speciesFate > 0
					? state.speciesFate
					: fateFromBands(state.speciesFateBands, rolled);
			const woundParts = [`${spec.toughnessMultiplier}×TB`];
			const dice = state.rolledDice.speciesWounds.join(" + ");
			if (dice) woundParts.push(dice);
			if (spec.flat) woundParts.push(String(spec.flat));
			return {
				wounds,
				fate,
				woundsBreakdown: woundParts.join(" + "),
				fateBreakdown:
					state.speciesFate > 0
						? `fixed ${fate}`
						: `1d10: ${rolled} → ${fate}`,
			};
		}
		const wounds = woundsFromOrigin(
			tb,
			state.rolledDice.wounds,
			resolved.woundBonus,
		);
		const fateBase = resolved.fateTable
			? fateFromTable(resolved.fateTable, state.rolledDice.fateD10 ?? 1)
			: 0;
		const woundParts = ["2×TB", ...state.rolledDice.wounds.map(String)];
		if (resolved.woundBonus) woundParts.push(String(resolved.woundBonus));
		return {
			wounds,
			fate: Math.max(0, fateBase + resolved.fateDelta),
			woundsBreakdown: woundParts.join(" + "),
			fateBreakdown:
				`d10: ${state.rolledDice.fateD10 ?? "—"}` +
				(resolved.fateDelta ? `; ${resolved.fateDelta}` : ""),
		};
	}

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
		const state = this.creatorState;
		context.step = this.step;
		context.name = this.name;
		context.isRoll = state.method === "roll";
		context.isPoints = state.method === "points";
		context.characteristics = CHARACTERISTIC_ORDER.map((key) => {
			const labelKey = `CHARACTERISTIC.${key.toUpperCase()}`;
			const rolled = state.rolled[key];
			const alloc = state.allocated[key] ?? 0;
			return {
				key,
				labelKey,
				rolled: rolled ?? null,
				alloc,
				base:
					state.method === "roll"
						? (rolled ?? null)
						: state.base[key] + alloc,
			};
		});
		const pointBuy = validatePointBuy(state.allocated);
		context.pointBuy = pointBuy;
		context.canReroll = !state.rerollUsed;

		// Origin path rows with adjacency-enforced options.
		let prevCol: number | null = null;
		const originRows = this.#originRows();
		context.originRows = originRows.map((row) => {
			const pick = state.picks[row];
			const pickEntry = pick ? originByKey(pick.key) : undefined;
			const allowed = allowedColumns(row, prevCol);
			const options = originsInRow(row).map((entry) => ({
				...entry,
				// An expanded entry may substitute either of two core slots
				// (bead b03f), so check every column it may occupy.
				enabled: entryColumns(entry).some((col) => allowed.includes(col)),
				selected: pick?.key === entry.key,
			}));
			if (pickEntry) prevCol = pickEntry.col;

			const entry = pickEntry;
			const pickVariant = pick?.variantKey
				? entry?.variants?.find((v) => v.key === pick.variantKey)
				: undefined;
			let detail: Record<string, unknown> | null = null;
			if (entry) {
				const mechanicsForPick = pickVariant
					? pickVariant.mechanics
					: entry.mechanics;
				detail = {
					entry,
					effect: entry.effect ?? null,
					variants: (entry.variants ?? []).map((v) => ({
						...v,
						selected: pick?.variantKey === v.key,
					})),
					pickVariant,
					pickVariantEffect: pickVariant?.effect ?? null,
					pickOption: pick?.optionChoice ?? null,
					pickAlternate: pick?.alternate ?? null,
					// Track choice is stored under the ROW key (the write side in
					// #onChooseCorrIns uses data-row = row.row) — reading it under
					// entry.key silently never matched (bug report 2026-09-05:
					// "Choose a track" chips never highlighted).
					corrIns: state.corrOrInsTrack[row] ?? null,
					hasOptions: (mechanicsForPick?.optionChoice?.length ?? 0) > 0,
					// Selection state precomputed here (not in Handlebars paths):
					// each-scope relative paths were silently unresolvable.
					options: (mechanicsForPick?.optionChoice ?? []).map((option) => ({
						value: option,
						selected: pick?.optionChoice === option,
					})),
					hasCharChoice:
						(mechanicsForPick?.characteristicChoice?.length ?? 0) > 0,
					charChoices: (mechanicsForPick?.characteristicChoice ?? []).map(
						(group: CharMod[]) => ({
							value: JSON.stringify(group),
							label: group
								.map(
									(m) =>
										`${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`,
								)
								.join(", "),
							selected:
								JSON.stringify(pick?.charChoice ?? []) ===
								JSON.stringify(group),
						}),
					),
					hasAlternate: (mechanicsForPick?.alternateChoice?.length ?? 0) > 0,
					alternates: (mechanicsForPick?.alternateChoice ?? []).map(
						(alt, index) => ({
							...alt,
							index,
							selected: pick?.alternate === index,
						}),
					),
					hasCorrIns:
						(mechanicsForPick?.corruptionOrInsanityDice?.length ?? 0) > 0,
					corrOrInsDice: mechanicsForPick?.corruptionOrInsanityDice ?? [],
					skills: mechanicsForPick?.skills ?? [],
					talents: mechanicsForPick?.talents ?? [],
					woundsDice: mechanicsForPick?.woundsDice ?? null,
					fateTable: mechanicsForPick?.fateTable ?? null,
					notes: mechanicsForPick?.notes ?? [],
				};
			}
			return {
				row,
				labelKey: ORIGIN_ROW_LABEL_KEYS[row],
				pickKey: pick?.key ?? "",
				options,
				detail,
			};
		});

		// Review: resolved origin + dice totals.
		const resolved = this.#resolved;
		const base = this.#baseCharacteristics();
		const chars = finalCharacteristics(base, resolved.characteristics);
		const vitals = this.#resolveVitals(chars, resolved);
		const woundsTotal = vitals.wounds;
		const fateTotal = vitals.fate;
		const corrInsTotal = state.rolledDice.corrOrInsanity.reduce(
			(a, b) => a + b,
			0,
		);
		const insanityTotal =
			resolved.insanity +
			state.rolledDice.insanity.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("insanity")
				? corrInsTotal
				: 0);
		const corruptionTotal =
			resolved.corruption +
			state.rolledDice.corruption.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("corruption")
				? corrInsTotal
				: 0);
		context.review = {
			characteristics: CHARACTERISTIC_ORDER.map((key) => ({
				key,
				labelKey: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: chars[key],
				delta: resolved.characteristics[key] ?? 0,
			})),
			woundsTotal,
			fateTotal,
			insanityTotal,
			corruptionTotal,
			woundsBreakdown: vitals.woundsBreakdown,
			fateBreakdown: vitals.fateBreakdown,
			initiativeBonus: resolved.initiativeBonus,
			profitFactor: resolved.profitFactor,
			xpTotal: 5000,
			xpCost: resolved.xpCost,
		};

		// Career chips (free choice, p24) with Table 1-1 suggestions. The
		// suggestion list now lives on each career doc (system.suggestedHomeWorlds).
		// Bead ghmn: the LIST is the careers compendium filtered to the chosen
		// species and to STARTING careers (blank requiredCareer) — a starting
		// character cannot hold an alternate/elite rank, since every one of those
		// gates needs rank 1+ AND 5,000+ XP. No career content lives in code.
		const suggestions = await this.#suggestedHomeWorlds();
		const homeWorld = state.picks["home-world"]?.key;
		const suggested = homeWorld
			? new Set(
					[...suggestions.entries()]
						.filter(([, worlds]) => worlds.includes(homeWorld))
						.map(([career]) => career),
				)
			: new Set(suggestions.keys());
		const docs = await careerDocs();
		const starting = docs.filter(
			(doc) => (doc.system?.requiredCareer ?? "").trim() === "",
		);
		const careerOptions = careersForSpecies(starting, state.speciesKey).map(
			(doc) => {
				const key = String(doc.system?.key ?? "");
				return {
					key,
					label: doc.name ?? key,
					selected: state.careerKey === key,
					suggested: suggested.has(key),
				};
			},
		);
		context.careers = careerOptions;
		context.careerLabel =
			careerOptions.find((career) => career.selected)?.label ?? "";

		// Species step (bead ghmn): every option comes from the careers pack's
		// species blocks, plus the human default. The chosen species supplies the
		// stage-1 characteristic bases and its printed Fate/Wounds rules.
		const speciesChoices = (await this.#speciesOptions()).map((option) => ({
			key: option.key,
			label: option.key
				? option.label || option.key
				: game.i18n!.localize("CREATOR.SPECIES_HUMAN"),
			selected: state.speciesKey === option.key,
		}));
		context.speciesOptions = speciesChoices;
		context.speciesLabel =
			speciesChoices.find((option) => option.selected)?.label ?? "";
		context.speciesFateFormula = state.speciesFateFormula;
		context.speciesWoundsFormula = state.speciesWoundsFormula;
		context.speciesFate = state.speciesFate;

		// Stage 6 (gjvg): the starting free acquisition — items with a total
		// modifier of +0 or better need no test (Core Rulebook printed p272,
		// file page-0273, heading "Acquisition and Starting
		// and Starting Characters"). Availability modifier ≥ 0 (scarce+).
		// The group's PF/SP (stage 5) are a GROUP/GM-level decision and live
		// on the dynasty document, NOT in the creator (owner redesign).
		context.acquisitions = await this.#startingAcquisitions();
		context.acquisitionGroups = this.#acquisitionGroups(
			context.acquisitions as Array<Record<string, unknown>>,
		);
		context.acquisition = state.acquisition?.name ?? "";

		// Stage 3.5 (bead rboc): the heirloom roll only applies when the Pride
		// motivation's "Heirloom Item" alternative was taken.
		const pridePick = state.picks.motivation;
		context.heirloom = {
			enabled: pridePick?.key === "pride" && pridePick.alternate === 0,
			rolled: state.heirloom,
		};

		context.canCreate =
			this.step === CREATOR_LAST_STEP &&
			originRows.every((row) => Boolean(state.picks[row])) &&
			Boolean(state.careerKey) &&
			(state.method === "roll" ? true : pointBuy.valid) &&
			// Every origin whose mechanics offer the corruption-or-insanity
			// track must have the track chosen (book rule); otherwise the
			// rolled dice would be silently dropped.
			originRows.every((row) => {
				const pick = state.picks[row];
				if (!pick) return true;
				const detail = (
					context.originRows as Array<
						{ row: string; detail: { hasCorrIns?: boolean } } | undefined
					>
				)?.find((r) => r?.row === row)?.detail;
				if (!detail?.hasCorrIns) return true;
				return Boolean(state.corrOrInsTrack[row]);
			});
		// The forward button must be enabled on every step before the last;
		// `canCreate` is step-3 only, so it cannot gate Next directly.
		context.canNext = creatorCanAdvance(
			this.step,
			Boolean(context.canCreate),
		);
		return context;
	}

	/** Payloads for the acquisition chips, keyed by AcqOption.key. Full
	 * item JSON never goes through the DOM (the old data-payload attribute
	 * broke on JSON quotes — the "fix that selection up" bug). */
	#acquisitionPayloads = new Map<string, object>();

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
	 * Weapon gate: the weapon schema has no family field (Las/SP/...), so
	 * the gate is enforced at CLASS level — a weapon is selectable when the
	 * PC has any Weapon Training of the matching class (Universal covers
	 * everything). A specific-family talent only truly covers its families;
	 * that finer check needs a name->family mapping that does not exist in
	 * the schema (see comment on #coveredWeaponClasses).
	 */
	async #startingAcquisitions(): Promise<Array<AcqOption>> {
		const out: AcqOption[] = [];
		this.#acquisitionPayloads.clear();
		const coverage = await this.#weaponTrainingCoverage();
		const docs = (await getPackDocuments(
			"rogue-trader.equipment",
		)) as unknown as Array<{
			name?: string;
			type?: string;
			flags?: { "rogue-trader"?: { source?: string } };
			system?: {
				availability?: string;
				class?: string;
				weaponFamily?: string;
				source?: { book?: string };
				description?: string;
			};
			toObject: () => object;
		}>;
		for (const doc of docs) {
			if (!doc.name) continue;
			// Acquisition buckets (bead n7hu): six packs became one `equipment`
			// pack, so bucket by the build-time source flag. The Tau armoury is
			// hand-authored mixed-type, so it buckets by item type; heirlooms and
			// cybernetics are not acquisitions.
			const source = doc.flags?.["rogue-trader"]?.source ?? "";
			const group =
				source === "tau-armoury"
					? doc.type === "armour"
						? "armour"
						: doc.type === "gear"
							? "gear"
							: "weapons"
					: source === "weapons" ||
						  source === "armour" ||
						  source === "gear" ||
						  source === "drugs" ||
						  source === "tools"
						? source
						: null;
			if (!group) continue;
			const modifier = availabilityModifier(doc.system?.availability ?? "");
			if (modifier === null || modifier < 0) continue;
			const key = `${source}::${doc.name}`;
			const payload = doc.toObject() as object;
			this.#acquisitionPayloads.set(key, payload);
			const isWeapon =
				doc.type === "melee-weapon" || doc.type === "ranged-weapon";
			const selectable =
				!isWeapon ||
				isTrainedFor(coverage, {
					class: doc.system?.class,
					weaponFamily: doc.system?.weaponFamily,
					name: doc.name,
					source: doc.system?.source,
				});
			out.push({
				key,
				name: `${doc.name} (${game.i18n!.localize("CREATOR.ACQ_MODIFIER")} ${modifier >= 0 ? "+" : ""}${modifier})`,
				payload,
				tooltip: (doc.system?.description ?? "").slice(0, 300),
				group,
				selectable,
				selected: this.creatorState.acquisition?.key === key,
			});
		}
		return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	}

	/**
	 * Weapon-training coverage for the starting-acquisition gate, from the
	 * chosen career's startingTalents plus origin talents (book p272 bullet
	 * 2; pure rule logic in rules/acquisition.ts weaponTrainingCoverage).
	 */
	async #weaponTrainingCoverage(): Promise<WeaponTrainingCoverage> {
		const state = this.creatorState;
		if (!state.careerKey) {
			// No career chosen yet (page navigation) — everything selectable,
			// matching the pre-gate behaviour until the talent list exists.
			return {
				classes: new Set(WEAPON_CLASSES),
				byCategory: {},
				exotic: new Set(),
				sources: new Set(),
			};
		}
		const talentNames = [...(this.#resolved.talents ?? [])];
		const careerDocs = (await getCharacterOptionDocs(
			"career",
		)) as unknown as Array<{
			name?: string;
			system?: { key?: string; startingTalents?: string[] };
		}>;
		const career = careerDocs.find((c) => c.system?.key === state.careerKey);
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
	 * Stage 6 grouped view (bead a2rd, owner: collapsible groups): the flat
	 * ~100+ chip list bucketed by item type, alphabetical WITHIN each group.
	 * Groups start collapsed; a group containing the current selection
	 * always renders open so the choice stays visible.
	 */
	#acquisitionGroups(items: Array<Record<string, unknown>>): Array<{
		key: string;
		labelKey: string;
		count: number;
		open: boolean;
		items: Array<Record<string, unknown>>;
	}> {
		const state = this.creatorState;
		const GROUPS: Array<{ key: string; labelKey: string }> = [
			{ key: "weapons", labelKey: "CREATOR.ACQ_GROUP_WEAPONS" },
			{ key: "armour", labelKey: "CREATOR.ACQ_GROUP_ARMOUR" },
			{ key: "gear", labelKey: "CREATOR.ACQ_GROUP_GEAR" },
			{ key: "drugs", labelKey: "CREATOR.ACQ_GROUP_DRUGS" },
			{ key: "tools", labelKey: "CREATOR.ACQ_GROUP_TOOLS" },
		];
		return GROUPS.map(({ key, labelKey }) => {
			const list = items
				.filter((item) => (item.group ?? "gear") === key)
				.sort((a, b) => String(a.name).localeCompare(String(b.name)));
			return {
				key,
				labelKey,
				count: list.length,
				open:
					!state.acqCollapsed[key] ||
					list.some((item) => Boolean(item.selected)),
				items: list,
			};
		});
	}

	/**
	 * Roll the origin-path AND species-block vitals dice when entering the
	 * Review step. A xeno's species block carries its own Wounds dice and Fate
	 * bands (bead g45s); the human path uses the chosen Origin rows instead.
	 */
	async #rollOriginDice(): Promise<void> {
		const resolved = this.#resolved;
		const state = this.creatorState;
		state.rolledDice = {
			wounds: [],
			fateD10: null,
			speciesWounds: [],
			speciesFateD10: null,
			insanity: [],
			corruption: [],
			corrOrInsanity: [],
		};
		for (const notation of resolved.woundsDice) {
			state.rolledDice.wounds.push(await roll(notation));
		}
		if (resolved.fateTable) state.rolledDice.fateD10 = await roll("1d10");
		if (state.speciesKey !== HUMAN_SPECIES_KEY) {
			if (state.speciesWounds.dice) {
				state.rolledDice.speciesWounds.push(
					await roll(state.speciesWounds.dice),
				);
			}
			if (state.speciesFate <= 0 && state.speciesFateBands.length > 0) {
				state.rolledDice.speciesFateD10 = await roll("1d10");
			}
		}
		for (const notation of resolved.insanityDice) {
			state.rolledDice.insanity.push(await roll(notation));
		}
		for (const notation of resolved.corruptionDice) {
			state.rolledDice.corruption.push(await roll(notation));
		}
		for (const notation of resolved.corruptionOrInsanityDice) {
			state.rolledDice.corrOrInsanity.push(await roll(notation));
		}
	}

	static async #onSetMethod(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		this.creatorState.method =
			target.dataset.method === "points" ? "points" : "roll";
		this.render({ force: true });
	}

	static async #onRollOne(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		if (!key) return;
		this.creatorState.rolled[key] = await roll(
			`2d10+${this.creatorState.base[key]}`,
		);
		this.render({ force: true });
	}

	/** The book's single re-roll: one characteristic, keep the new result. */
	static async #onReroll(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		if (this.creatorState.rerollUsed) return;
		const key = target.dataset.key as CharacteristicKey;
		if (!key || this.creatorState.rolled[key] === undefined) return;
		this.creatorState.rolled[key] = await roll(
			`2d10+${this.creatorState.base[key]}`,
		);
		this.creatorState.rerollUsed = true;
		this.render({ force: true });
	}

	static async #onRollAll(this: CharacterCreator): Promise<void> {
		for (const key of CHARACTERISTIC_ORDER) {
			this.creatorState.rolled[key] = await roll(
				`2d10+${this.creatorState.base[key]}`,
			);
		}
		this.render({ force: true });
	}

	static async #onAlloc(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		const delta = Number(target.dataset.delta ?? 0);
		if (!key) return;
		const current = this.creatorState.allocated[key] ?? 0;
		const next = Math.min(POINT_BUY_MAX, Math.max(0, current + delta));
		this.creatorState.allocated[key] = next;
		this.render({ force: true });
	}

	static async #onChooseOrigin(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.dataset.row as OriginRow;
		const key = target.dataset.key ?? "";
		if (!row || !isOriginRow(row)) return;
		if (!key) {
			delete this.creatorState.picks[row];
		} else {
			this.creatorState.picks[row] = { key };
			delete this.creatorState.corrOrInsTrack[row];
		}
		this.render({ force: true });
	}

	static async #onChoosePickOption(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.dataset.row as OriginRow;
		const kind = target.dataset.kind;
		const value = target.dataset.value ?? "";
		const pick = this.creatorState.picks[row];
		if (!pick) return;
		if (kind === "variant") pick.variantKey = value || undefined;
		else if (kind === "option") pick.optionChoice = value || undefined;
		else if (kind === "charChoice")
			pick.charChoice = value ? (JSON.parse(value) as CharMod[]) : undefined;
		else if (kind === "alternate")
			pick.alternate = value === "" ? undefined : Number(value);
		this.render({ force: true });
	}

	static async #onChooseCorrIns(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.dataset.row as OriginRow;
		const track = target.dataset.track as "corruption" | "insanity";
		if (!row || (track !== "corruption" && track !== "insanity")) return;
		this.creatorState.corrOrInsTrack[row] = track;
		this.render({ force: true });
	}

	static async #onChooseCareer(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		this.creatorState.careerKey = target.dataset.key ?? "";
		this.render({ force: true });
	}

	/**
	 * Species choice (bead ghmn). Everything the step needs comes from the
	 * chosen pack option: the per-characteristic base used by BOTH stage-1
	 * methods, and the printed Fate/Wounds rules shown on review. Changing
	 * species therefore invalidates rolled values and any career that is no
	 * longer legal, so both are cleared rather than left stale.
	 */
	static async #onChooseSpecies(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = (target.dataset.key ?? "").trim();
		const option = (await this.#speciesOptions()).find((o) => o.key === key);
		if (!option) return;
		const state = this.creatorState;
		if (state.speciesKey === option.key) return;
		state.speciesKey = option.key;
		state.speciesLabel = option.label;
		state.base = { ...option.base };
		state.speciesFate = option.startingFate;
		state.speciesFateFormula = option.fateFormula;
		state.speciesWoundsFormula = option.woundsFormula;
		state.speciesFateBands = [...option.fateBands];
		state.speciesWounds = { ...option.wounds };
		// The bases changed, so any roll taken at the old base is meaningless.
		state.rolled = {};
		state.rerollUsed = false;
		// Species paths differ (bead ghmn): drop picks whose row the new species
		// does not have, or a Kroot would carry human Home World/Birthright picks
		// into a path that has no such rows.
		const rows = new Set(originRowsForSpecies(option.key));
		for (const row of Object.keys(state.picks) as OriginRow[]) {
			if (!rows.has(row)) {
				delete state.picks[row];
				delete state.corrOrInsTrack[row];
			}
		}
		// Drop a career the new species cannot take.
		const docs = await careerDocs();
		const legal = careersForSpecies(
			docs.filter((doc) => (doc.system?.requiredCareer ?? "").trim() === ""),
			option.key,
		).some((doc) => String(doc.system?.key ?? "") === state.careerKey);
		if (!legal) state.careerKey = "";
		this.render({ force: true });
	}

	/** Stage 6 (printed p272): choose the single starting free acquisition. */
	static async #onToggleAcqGroup(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.group;
		if (!key) return;
		const collapsed = this.creatorState.acqCollapsed;
		if (collapsed[key]) delete collapsed[key];
		else collapsed[key] = true;
		this.render({ force: true });
	}

	/**
	 * Stage 3.5 (bead rboc, Core Rulebook Table 1-2 p31): roll 1d100 for the
	 * heirloom when the Pride "Heirloom Item" alternative is taken. The roll
	 * is stored in state and the grant happens at apply alongside the
	 * starting acquisition.
	 */
	static async #onRollHeirloom(this: CharacterCreator): Promise<void> {
		const rollTotal = await roll("1d100");
		const total = Math.floor(rollTotal);
		const entry = heirloomForRoll(total);
		this.creatorState.heirloom = { roll: total, name: entry.name };
		this.render({ force: true });
	}

	static async #onChooseAcquisition(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.acqKey ?? "";
		if (!key) {
			this.creatorState.acquisition = null;
		} else if (this.creatorState.acquisition?.key === key) {
			// Toggle: clicking the selected chip clears the choice.
			this.creatorState.acquisition = null;
		} else {
			if (target.dataset.selectable === "false") {
				ui.notifications!.warn(game.i18n!.localize("CREATOR.ACQ_BLOCKED"));
				return;
			}
			const payload = this.#acquisitionPayloads.get(key);
			if (!payload) {
				// Loud: stale render vs rebuilt index — never grant nothing
				// silently.
				console.warn(`rogue-trader | no acquisition payload for "${key}"`);
				return;
			}
			this.creatorState.acquisition = {
				key,
				name: (payload as { name?: string }).name ?? "",
				payload,
			};
		}
		this.render({ force: true });
	}

	/** Build the new pc actor and apply the whole Stage 1-2 bundle. */
	static async #onCreate(this: CharacterCreator): Promise<void> {
		const state = this.creatorState;
		const resolved = this.#resolved;
		const chars = finalCharacteristics(
			this.#baseCharacteristics(),
			resolved.characteristics,
		);
		const { wounds, fate } = this.#resolveVitals(chars, resolved);
		const corrInsTotal = state.rolledDice.corrOrInsanity.reduce(
			(a, b) => a + b,
			0,
		);
		const insanity =
			resolved.insanity +
			state.rolledDice.insanity.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("insanity")
				? corrInsTotal
				: 0);
		const corruption =
			resolved.corruption +
			state.rolledDice.corruption.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("corruption")
				? corrInsTotal
				: 0);

		const systemPayload = {
			characteristics: Object.fromEntries(
				CHARACTERISTIC_ORDER.map((key) => [
					key,
					{ value: chars[key], unnatural: 1 },
				]),
			),
			wounds: { value: wounds, max: wounds },
			fate: { value: fate, max: fate },
			insanity,
			corruption,
			// Core Rulebook p13: characters begin with 4,500 xp already spent plus
			// 500 to spend on Rank 1 advances; total earned = 5,000. Into the
			// Storm's expanded Origin Path options deduct their xp cost from that
			// starting pool (bead b03f), so they raise the spent baseline.
			xp: { total: 5000, spent: 4500 + resolved.xpCost },
			// Psyker status from the career (bead m4me): Astropaths start
			// with Psy Rating 2 (their starting talents); Navigators are
			// "considered a psyker for all game purposes" (p182) with no
			// standard Psy Rating. Career-derived only — not editable (owner:
			// stick to the book rules).
			psyker:
				state.careerKey === "astropath-transcendent" ||
				state.careerKey === "navigator",
			psyRating: state.careerKey === "astropath-transcendent" ? 2 : 0,
			careerKey: state.careerKey,
			rank: 1,
			// Persist the Origin Path picks (bead ay0; species paths bead 58js):
			// the consolidated Background tab reads these; the summary card is not
			// the record.
			//
			// Built by the SHARED helper rather than by hand: a hand-written list
			// of the five human fields is exactly how a xeno's picks were silently
			// discarded. The helper writes the five named fields (keeping the
			// existing "key|variantKey" convention) and puts every other row in
			// `path`.
			origins: storedOriginsFromPicks(state.picks),
		};

		if (this.targetActor) {
			// Right-clicked actor: update in place. Confirm overwrite when the
			// actor already has content (blank new PCs apply silently).
			const target = this.targetActor as unknown as {
				update: (data: object) => Promise<unknown>;
				createEmbeddedDocuments: (
					t: string,
					data: object[],
				) => Promise<unknown>;
				deleteEmbeddedDocuments: (t: string, ids: string[]) => Promise<unknown>;
				sheet?: { render: (options?: object) => unknown };
			};
			const system = this.targetActor.system as unknown as {
				xp?: { spent?: number; total?: number };
			};
			const hasContent =
				this.targetActor.items.size > 0 ||
				(system.xp?.spent ?? 0) > 0 ||
				(system.xp?.total ?? 0) > 0;
			if (hasContent) {
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					window: {
						title: game.i18n!.localize("CREATOR.APPLY_TITLE"),
					},
					content: game.i18n!.format("CREATOR.APPLY_CONFIRM", {
						name: this.targetActor.name ?? "",
					}),
				});
				if (!confirmed) return;
			}
			await target.update({
				name: this.name || this.targetActor.name,
				system: systemPayload,
			} as never);
			await this.#applyGrantsAndSummary(target, state, resolved);
			await this.#applyAcquisition(target, state);
			this.close();
			target.sheet?.render({});
			return;
		}

		const actor = (await foundry.documents.Actor.create({
			name: this.name || game.i18n!.localize("CREATOR.DEFAULT_NAME"),
			type: "explorer",
			system: systemPayload,
		} as never)) as unknown as {
			uuid: string;
			createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
			deleteEmbeddedDocuments: (t: string, ids: string[]) => Promise<unknown>;
			sheet?: { render: (options?: object) => unknown };
		};
		if (!actor) return;

		await this.#applyGrantsAndSummary(actor, state, resolved);
		await this.#applyAcquisition(actor, state);

		this.close();
		actor.sheet?.render({});
	}

	/**
	 * Stage 6 apply (bead gjvg): grant the character's single starting free
	 * acquisition (printed p272, modifier +0 or better — chosen on step 3). The
	 * group's PF/SP are NOT set here — they live on the dynasty document
	 * (owner redesign: keep group-level decisions out of the creator).
	 */
	async #applyAcquisition(actor: unknown, state: CreatorState): Promise<void> {
		if (state.acquisition && state.acquisition.payload) {
			const target = actor as {
				createEmbeddedDocuments: (
					t: string,
					data: object[],
				) => Promise<unknown>;
			};
			await target.createEmbeddedDocuments("Item", [
				{
					...state.acquisition.payload,
					system: {
						...(state.acquisition.payload as { system?: object }).system,
						grantedBy: GRANTED_BY_CREATOR,
					},
				},
			] as never);
		}
		// Stage 3.5 heirloom (bead rboc): grant the rolled Table 1-2 entry as a
		// live item (pack-item clone with craftsmanship override, or a
		// note-item for the conditional-interaction rows), creator provenance.
		if (state.heirloom) {
			const entry = getHeirloomEntries().find(
				(e) => e.name === state.heirloom?.name,
			);
			if (!entry) {
				console.error(
					`rogue-trader | unknown heirloom "${state.heirloom.name}"`,
				);
				return;
			}
			const target = actor as {
				createEmbeddedDocuments: (
					t: string,
					data: object[],
				) => Promise<unknown>;
			};
			const grants: object[] = [];
			if (entry.grant.kind === "pack-item") {
				const packId = entry.grant.pack;
				if (!packId) {
					console.error(
						`rogue-trader | heirloom "${entry.name}" has a pack-item grant with no pack`,
					);
					return;
				}
				const docs = (await getPackDocuments(packId)) as unknown as Array<{
					name?: string;
					type?: string;
					toObject: () => object;
				}>;
				const doc = docs.find(
					// The pack also holds a same-named heirloom template (bead n7hu);
					// clone the real gear item, never the template.
					(d) => d.name === entry.grant.item && d.type !== "heirloom",
				);
				if (!doc) {
					console.error(
						`rogue-trader | heirloom pack item "${entry.grant.item}" not found in ${packId}`,
					);
					return;
				}
				const data = doc.toObject() as {
					name?: string;
					system?: Record<string, unknown>;
				};
				grants.push({
					...data,
					...(entry.grant.rename ? { name: entry.grant.rename } : {}),
					system: {
						...data.system,
						...(entry.grant.craftsmanship
							? { craftsmanship: entry.grant.craftsmanship }
							: {}),
						grantedBy: GRANTED_BY_CREATOR,
					},
				});
			} else {
				grants.push({
					name: entry.name,
					type: "special-ability",
					system: {
						description: entry.grant.noteText ?? "",
						grantedBy: GRANTED_BY_CREATOR,
					},
				});
			}
			if (grants.length > 0) {
				await target.createEmbeddedDocuments("Item", grants as never);
			}
		}
	}

	/**
	 * Shared apply tail (create or in-place update): grant starting
	 * skills/talents as live items, post the summary chat card.
	 */
	async #applyGrantsAndSummary(
		actor: {
			createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
			deleteEmbeddedDocuments: (t: string, ids: string[]) => Promise<unknown>;
			system?: unknown;
			uuid?: string;
			items?:
				| {
						size?: number;
						map: (cb: (i: { name?: string }) => string) => string[];
				  }
				| undefined;
		},
		state: CreatorState,
		resolved: ResolvedOrigin,
	): Promise<void> {
		// The createActor hook's common-skill grant is async and NOT awaited by
		// Actor.create — wait for it before merging on name, or the dedupe set
		// misses the defaults (bead t093).
		await waitForDefaultGrants(actor.uuid);
		// iufv: creator grants carry provenance; a re-run wipes ALL
		// creator-granted items and re-grants from the new picks (owner
		// decision: full wipe + re-grant). Manual items (no flag) are kept.
		// Pre-flag legacy items are identified by name against the OLD picks
		// and removed by this first re-run (remove-then-regrant).
		const existing = (this.targetActor?.items ?? []) as unknown as Array<{
			id?: string;
			type?: string;
			name?: string;
			system?: { grantedBy?: string };
		}>;
		const legacyNames = new Set<string>();
		const oldOrigins = (
			(this.targetActor?.system ?? {}) as {
				origins?: Record<string, string>;
			}
		).origins;
		if (oldOrigins) {
			// Bead 58js: read BOTH halves of the stored picks through the shared
			// helper. The hand-rolled loop here mapped only the five camelCase
			// human keys, so a xeno character's species-path picks were invisible
			// to its own reconcile as well as to the resolver.
			const oldPicks = storedOriginPicks(oldOrigins);
			if (Object.keys(oldPicks).length > 0) {
				const legacyResolved = resolveOrigins(oldPicks);
				for (const name of [
					...legacyResolved.skills,
					...legacyResolved.options,
					...legacyResolved.talents.filter((t) => !isUnresolvedChoice(t)),
				]) {
					legacyNames.add(name);
				}
			}
		}
		const { deleteIds } = reconcileForCreator(existing, legacyNames);
		if (deleteIds.length > 0) {
			await actor.deleteEmbeddedDocuments("Item", deleteIds);
		}

		// Grants: catalog-matched skills, then talents (cloning the pack
		// document, meh0), then unmatched options (talents, or manual if
		// unresolved).
		const catalog: CatalogSkill[] = [];
		const docs = (await getCharacterOptionDocs("skill")) as unknown as Array<{
			name?: string;
			system: { characteristic: string };
		}>;
		for (const doc of docs) {
			if (doc.name)
				catalog.push({
					name: doc.name,
					characteristic: doc.system.characteristic,
				});
		}
		const { grants, unmatched } = matchOriginSkills(resolved, catalog);
		const provenance = { grantedBy: GRANTED_BY_CREATOR };
		// Merge on name, case-insensitive + trimmed.
		const normName = (name: string) => name.trim().toLowerCase();
		const itemGrants: GrantPayload[] = [];
		const manual: string[] = [...resolved.notes];
		// Dedupe on NAME against the actor's LIVE items (bead: duplicate skills
		// on new explorers). On the create path the createActor hook has
		// already embedded the common-skill defaults by the time this runs —
		// `existing` (targetActor snapshot) is empty there, so origin/career
		// skills overlapping the defaults (Awareness, Common Lore, ...) were
		// granted a second time. Merging against the live actor items makes
		// both flows idempotent.
		const liveItems =
			(actor.items as unknown as { contents?: Array<{ name?: string }> })
				.contents ??
			(actor.items as unknown as Array<{ name?: string }>) ??
			[];
		const seenNames = new Set(
			liveItems.map((item) => normName(item.name ?? "")),
		);
		for (const grant of grants) {
			if (seenNames.has(normName(grant.name))) continue;
			seenNames.add(normName(grant.name));
			itemGrants.push(
				skillGrantPayload(grant.name, grant.system.characteristic, provenance),
			);
		}
		for (const talentName of resolved.talents) {
			if (isUnresolvedChoice(talentName)) {
				manual.push(talentName);
				continue;
			}
			// yclz: resolve parameterised talents ("Peer (choose one)") to a
			// concrete subject before granting; cancelled prompt = skipped.
			const resolvedName = await resolveParameterisedTalent(talentName);
			if (!resolvedName) continue;
			if (seenNames.has(normName(resolvedName))) continue;
			seenNames.add(normName(resolvedName));
			itemGrants.push(await talentGrant(resolvedName, provenance));
		}
		for (const leftover of unmatched) {
			if (isUnresolvedChoice(leftover)) manual.push(leftover);
			else if (!seenNames.has(normName(leftover))) {
				const resolvedName = await resolveParameterisedTalent(leftover);
				if (!resolvedName) continue;
				if (seenNames.has(normName(resolvedName))) continue;
				seenNames.add(normName(resolvedName));
				itemGrants.push(await talentGrant(resolvedName, provenance));
			}
		}
		if (itemGrants.length > 0) {
			await actor.createEmbeddedDocuments("Item", itemGrants);
		}

		// Summary card: choices + everything needing manual application.
		const rows = this.#originRows().map((rowKey) => {
			const pick = state.picks[rowKey];
			const entry = pick ? originByKey(pick.key) : undefined;
			const variant = pick?.variantKey
				? entry?.variants?.find((v) => v.key === pick.variantKey)?.name
				: null;
			const label = game.i18n!.localize(ORIGIN_ROW_LABEL_KEYS[rowKey]);
			return `<li><strong>${label}:</strong> ${entry?.name ?? "—"}${variant ? ` (${variant})` : ""}</li>`;
		}).join("");
		// Bead ay0: origin trait notes live on the Background tab now (tgq9) —
		// the card only points there instead of duplicating them.
		const notes = `<p>${game.i18n!.localize("CREATOR.NOTES_POINTER")}</p>`;
		const pf = resolved.profitFactor
			? `<p>${game.i18n!.localize("CREATOR.PROFIT_FACTOR")}: ${resolved.profitFactor > 0 ? "+" : ""}${resolved.profitFactor}</p>`
			: "";
		const initiative = resolved.initiativeBonus
			? `<p>${game.i18n!.localize("CREATOR.INIT_BONUS")}: +${resolved.initiativeBonus}</p>`
			: "";
		// Psyker note (bead m4me): Astropaths (Psy Rating 2) and Navigators.
		const psykerNote =
			state.careerKey === "astropath-transcendent" ||
			state.careerKey === "navigator"
				? `<p>${game.i18n!.localize("CREATOR.PSYKER")}${
						state.careerKey === "astropath-transcendent"
							? ` — ${game.i18n!.localize("CREATOR.PSY_RATING_2")}`
							: ""
					}</p>`
				: "";
		await foundry.documents.ChatMessage.create({
			content: `<div class="rogue-trader creator-summary"><h3>${this.name}</h3><ul>${rows}</ul>${pf}${initiative}${psykerNote}${notes}</div>`,
		} as never);
	}
}

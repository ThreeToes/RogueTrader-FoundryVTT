import type { CharacteristicKey } from "../../data/actor/character";
import {
	allowedColumns,
	fateFromTable,
	ORIGIN_ROW_LABEL_KEYS,
	ORIGIN_ROWS,
	originByKey,
	originsInRow,
	resolveOrigins,
	SUGGESTED_HOME_WORLDS,
	type CharMod,
	type OriginPick,
	type OriginRow,
	type ResolvedOrigin,
} from "../../origins";
import {
	finalCharacteristics,
	isUnresolvedChoice,
	matchOriginSkills,
	POINT_BUY_MAX,
	validatePointBuy,
	woundsFromOrigin,
	CHARACTERISTIC_BASE,
	type CatalogSkill,
} from "../../rules/creation";
import { careers } from "../../registry";
import { availabilityModifier } from "../../rules/acquisition";
import {
	GRANTED_BY_CREATOR,
	originRowFromStoredKey,
	reconcileForCreator,
	skillGrantPayload,
	type GrantPayload,
} from "../../rules/grants";
import {
	talentGrant,
	promptParameterisedSubject,
} from "./grant-helpers";

/** yclz: prompt for a parameterised talent's subject; resolved names pass through. */
async function resolveParameterisedTalent(name: string): Promise<string | null> {
	return promptParameterisedSubject(name);
}

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

const CHARACTERISTIC_ORDER: CharacteristicKey[] = [
	"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
];

interface CreatorState {
	step: number;
	name: string;
	method: "roll" | "points";
	/** Rolled values (method=roll) or base+allocated (method=points). */
	base: Record<CharacteristicKey, number>;
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
		insanity: number[];
		corruption: number[];
		corrOrInsanity: number[];
	};
	/** Stage 6: the starting free acquisition (item name + pack payload). */
	acquisition: { name: string; payload: object } | null;
}

function emptyState(): CreatorState {
	return {
		step: 0,
		name: "",
		method: "roll",
		base: { ws: 25, bs: 25, s: 25, t: 25, ag: 25, int: 25, per: 25, wp: 25, fel: 25 },
		allocated: {},
		rolled: {},
		rerollUsed: false,
		picks: {},
		corrOrInsTrack: {},
		careerKey: "",
		rolledDice: { wounds: [], fateD10: null, insanity: [], corruption: [], corrOrInsanity: [] },
		acquisition: null,
	};
}

async function roll(formula: string): Promise<number> {
	const roll = new foundry.dice.Roll(formula);
	await roll.evaluate();
	return roll.total ?? 0;
}

/**
 * Character creator (bead ay0): a wizard over rt_core Chapter I stages 1-2.
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
export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-character-creator",
		classes: ["rogue-trader", "sheet", "character-creator"],
		position: { width: 720, height: 640 },
		window: { title: "CREATOR.TITLE", resizable: true },
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
			chooseAcquisition: CharacterCreator.#onChooseAcquisition,
			prev: CharacterCreator.#onPrev,
			next: CharacterCreator.#onNext,
			create: CharacterCreator.#onCreate,
		},
	};

	creatorState: CreatorState = emptyState();

	/**
	 * Optional existing actor (right-clicked entry): the creator prefills
	 * from it and UPDATES it on finish instead of creating a new actor.
	 */
	targetActor: foundry.documents.Actor | null = null;

	constructor(
		options: { actor?: foundry.documents.Actor } & object = {},
	) {
		super(options as never);
		this.targetActor = options.actor ?? null;
		if (this.targetActor) {
			const system = this.targetActor.system as unknown as {
				characteristics: Record<CharacteristicKey, { value: number }>;
				careerKey?: string;
			};
			this.creatorState.name = this.targetActor.name ?? "";
			this.creatorState.careerKey = system.careerKey ?? "";
			// Existing characteristics prefill as rolled values; the player can
			// re-roll (book: one re-roll) or switch to point-buy.
			for (const key of CHARACTERISTIC_ORDER) {
				this.creatorState.rolled[key] = system.characteristics[key]?.value ?? 25;
			}
		}
	}

	static PARTS = {
		form: {
			template: "systems/rogue-trader/template/sheet/actor/character-creator.hbs",
		},
	};

	get #resolved(): ResolvedOrigin {
		return resolveOrigins(this.creatorState.picks);
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
				this.creatorState.name = input.value;
			});
		}
	}

	#baseCharacteristics(): Record<CharacteristicKey, number> {
		const base = {} as Record<CharacteristicKey, number>;
		for (const key of CHARACTERISTIC_ORDER) {
			base[key] =
				this.creatorState.method === "roll"
					? (this.creatorState.rolled[key] ?? CHARACTERISTIC_BASE)
					: CHARACTERISTIC_BASE + (this.creatorState.allocated[key] ?? 0);
		}
		return base;
	}

	async _prepareContext(_options: object = {}) {
		const context = (await super._prepareContext(_options as never)) as Record<
			string,
			unknown
		>;
		const state = this.creatorState;
		context.step = state.step;
		context.name = state.name;
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
						: CHARACTERISTIC_BASE + alloc,
			};
		});
		const pointBuy = validatePointBuy(state.allocated);
		context.pointBuy = pointBuy;
		context.canReroll = !state.rerollUsed;

		// Origin path rows with adjacency-enforced options.
		let prevCol: number | null = null;
		context.originRows = ORIGIN_ROWS.map((row) => {
			const pick = state.picks[row];
			const pickEntry = pick ? originByKey(pick.key) : undefined;
			const allowed = allowedColumns(row, prevCol);
			const options = originsInRow(row).map((entry) => ({
				...entry,
				enabled: allowed.includes(entry.col),
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
					corrIns: state.corrOrInsTrack[entry.key] ?? null,
					hasOptions: (mechanicsForPick?.optionChoice?.length ?? 0) > 0,
					// Selection state precomputed here (not in Handlebars paths):
					// each-scope relative paths were silently unresolvable.
					options: (mechanicsForPick?.optionChoice ?? []).map((option) => ({
						value: option,
						selected: pick?.optionChoice === option,
					})),
					hasCharChoice: (mechanicsForPick?.characteristicChoice?.length ?? 0) > 0,
					charChoices: (mechanicsForPick?.characteristicChoice ?? []).map(
						(group: CharMod[]) => ({
							value: JSON.stringify(group),
							label: group
								.map((m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`)
								.join(", "),
							selected:
								JSON.stringify(pick?.charChoice ?? []) === JSON.stringify(group),
						}),
					),
					hasAlternate: (mechanicsForPick?.alternateChoice?.length ?? 0) > 0,
					alternates: (mechanicsForPick?.alternateChoice ?? []).map(
						(alt, index) => ({ ...alt, index, selected: pick?.alternate === index }),
					),
					hasCorrIns: (mechanicsForPick?.corruptionOrInsanityDice?.length ?? 0) > 0,
					corrOrInsDice: mechanicsForPick?.corruptionOrInsanityDice ?? [],
					skills: mechanicsForPick?.skills ?? [],
					talents: mechanicsForPick?.talents ?? [],
					woundsDice: mechanicsForPick?.woundsDice ?? null,
					fateTable: mechanicsForPick?.fateTable ?? null,
					notes: mechanicsForPick?.notes ?? [],
				};
			}
			return { row, labelKey: ORIGIN_ROW_LABEL_KEYS[row], pickKey: pick?.key ?? "", options, detail };
		});

		// Review: resolved origin + dice totals.
		const resolved = this.#resolved;
		const base = this.#baseCharacteristics();
		const chars = finalCharacteristics(base, resolved.characteristics);
		const tb = Math.floor(chars.t / 10);
		const woundsTotal = woundsFromOrigin(tb, state.rolledDice.wounds, resolved.woundBonus);
		const fateBase = resolved.fateTable
			? fateFromTable(resolved.fateTable, state.rolledDice.fateD10 ?? 1)
			: 0;
		const fateTotal = Math.max(0, fateBase + resolved.fateDelta);
		const corrInsTotal = state.rolledDice.corrOrInsanity.reduce((a, b) => a + b, 0);
		const insanityTotal =
			resolved.insanity +
			state.rolledDice.insanity.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("insanity") ? corrInsTotal : 0);
		const corruptionTotal =
			resolved.corruption +
			state.rolledDice.corruption.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("corruption") ? corrInsTotal : 0);
		context.review = {
			characteristics: CHARACTERISTIC_ORDER.map((key) => ({
				key,
				labelKey: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: chars[key],
				delta: (resolved.characteristics[key] ?? 0),
			})),
			woundsTotal,
			fateTotal,
			insanityTotal,
			corruptionTotal,
			fateDelta: resolved.fateDelta,
			initiativeBonus: resolved.initiativeBonus,
			profitFactor: resolved.profitFactor,
			xpTotal: 5000,
			woundRolls: state.rolledDice.wounds.join(" + "),
			fateRoll: state.rolledDice.fateD10,
		};

		// Career chips (free choice, p24) with Table 1-1 suggestions.
		const homeWorld = state.picks["home-world"]?.key;
		const suggested = homeWorld
			? new Set(
					Object.entries(SUGGESTED_HOME_WORLDS)
						.filter(([, worlds]) => worlds.includes(homeWorld))
						.map(([career]) => career),
				)
			: new Set(Object.keys(SUGGESTED_HOME_WORLDS));
		context.careers = careers.entries().map(([key, labelKey]) => ({
			key,
			label: game.i18n!.localize(labelKey) ?? labelKey,
			selected: state.careerKey === key,
			suggested: suggested.has(key),
		}));
		context.careerLabel = state.careerKey
			? (careers.get(state.careerKey) ?? "")
			: "";

		// Stage 6 (gjvg): the starting free acquisition — items with a total
		// modifier of +0 or better need no test (rt_core p273 "Acquisition
		// and Starting Characters"). Availability modifier ≥ 0 (scarce+).
		// The group's PF/SP (stage 5) are a GROUP/GM-level decision and live
		// on the dynasty document, NOT in the creator (owner redesign).
		context.acquisitions = await this.#startingAcquisitions();
		context.acquisition = state.acquisition?.name ?? "";

		context.canCreate =
			state.step === 3 &&
			ORIGIN_ROWS.every((row) => Boolean(state.picks[row])) &&
			Boolean(state.careerKey) &&
			(state.method === "roll" ? true : pointBuy.valid);
		return context;
	}

	/**
	 * Items from the equipment packs qualifying as the starting free
	 * acquisition (availability modifier >= +0, Table 9-35). Payload carries
	 * the pack document clone (meh0 flavour) for the grant.
	 */
	async #startingAcquisitions(): Promise<Array<Record<string, unknown>>> {
		const out: Array<Record<string, unknown>> = [];
		const packs = ["rogue-trader.weapons", "rogue-trader.armour", "rogue-trader.gear", "rogue-trader.drugs", "rogue-trader.tools"];
		for (const packName of packs) {
			const pack = game.packs?.get(packName);
			if (!pack) continue;
			const docs = (await pack.getDocuments()) as unknown as Array<{
				name?: string;
				type?: string;
				system?: { availability?: string; description?: string };
				toObject: () => object;
			}>;
			for (const doc of docs) {
				if (!doc.name) continue;
				const modifier = availabilityModifier(doc.system?.availability ?? "");
				if (modifier === null || modifier < 0) continue;
				const payload = doc.toObject() as object;
				out.push({
					name: `${doc.name} (${game.i18n!.localize("CREATOR.ACQ_MODIFIER")} ${modifier >= 0 ? "+" : ""}${modifier})`,
					payload: JSON.stringify(payload),
					tooltip: (doc.system?.description ?? "").slice(0, 300),
					selected: this.creatorState.acquisition?.name === doc.name,
				});
			}
		}
		return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
	}

	/** Roll wound/fate/insanity/corruption dice when entering the review. */
	async #rollOriginDice(): Promise<void> {
		const resolved = this.#resolved;
		const state = this.creatorState;
		state.rolledDice = { wounds: [], fateD10: null, insanity: [], corruption: [], corrOrInsanity: [] };
		for (const notation of resolved.woundsDice) {
			state.rolledDice.wounds.push(await roll(notation));
		}
		if (resolved.fateTable) state.rolledDice.fateD10 = await roll("1d10");
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
		this.creatorState.method = target.dataset.method === "points" ? "points" : "roll";
		this.render({ force: true });
	}

	static async #onRollOne(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		if (!key) return;
		this.creatorState.rolled[key] = await roll("2d10+25");
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
		this.creatorState.rolled[key] = await roll("2d10+25");
		this.creatorState.rerollUsed = true;
		this.render({ force: true });
	}

	static async #onRollAll(this: CharacterCreator): Promise<void> {
		for (const key of CHARACTERISTIC_ORDER) {
			this.creatorState.rolled[key] = await roll("2d10+25");
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
		const next = Math.min(
			POINT_BUY_MAX,
			Math.max(0, current + delta),
		);
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
		if (!row || !ORIGIN_ROWS.includes(row)) return;
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

	static async #onPrev(this: CharacterCreator): Promise<void> {
		this.creatorState.step = Math.max(0, this.creatorState.step - 1);
		this.render({ force: true });
	}

	static async #onNext(this: CharacterCreator): Promise<void> {
		const next = Math.min(3, this.creatorState.step + 1);
		if (next === 2) await this.#rollOriginDice();
		this.creatorState.step = next;
		this.render({ force: true });
	}

	/** Stage 6 (p273): choose the single starting free acquisition. */
	static async #onChooseAcquisition(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const raw = target.dataset.payload ?? "";
		if (!raw) {
			this.creatorState.acquisition = null;
		} else {
			try {
				const payload = JSON.parse(raw) as { name?: string };
				this.creatorState.acquisition = {
					name: payload.name ?? "",
					payload: payload as object,
				};
			} catch {
				this.creatorState.acquisition = null;
			}
		}
		this.render({ force: true });
	}

	/** Build the new pc actor and apply the whole Stage 1-2 bundle. */
	static async #onCreate(this: CharacterCreator): Promise<void> {
		const state = this.creatorState;
		const resolved = this.#resolved;
		const chars = finalCharacteristics(this.#baseCharacteristics(), resolved.characteristics);
		const tb = Math.floor(chars.t / 10);
		const wounds = woundsFromOrigin(tb, state.rolledDice.wounds, resolved.woundBonus);
		const fate = Math.max(
			0,
			(resolved.fateTable
				? fateFromTable(resolved.fateTable, state.rolledDice.fateD10 ?? 1)
				: 0) + resolved.fateDelta,
		);
		const corrInsTotal = state.rolledDice.corrOrInsanity.reduce((a, b) => a + b, 0);
		const insanity =
			resolved.insanity +
			state.rolledDice.insanity.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("insanity") ? corrInsTotal : 0);
		const corruption =
			resolved.corruption +
			state.rolledDice.corruption.reduce((a, b) => a + b, 0) +
			(Object.values(state.corrOrInsTrack).includes("corruption") ? corrInsTotal : 0);

		const systemPayload = {
			characteristics: Object.fromEntries(
				CHARACTERISTIC_ORDER.map((key) => [key, { value: chars[key], unnatural: 1 }]),
			),
			wounds: { value: wounds, max: wounds },
			fate: { value: fate, max: fate },
			insanity,
			corruption,
			// rt_core p13: characters begin with 4,500 xp already spent plus
			// 500 to spend on Rank 1 advances; total earned = 5,000.
			xp: { total: 5000, spent: 4500 },
			// Psyker status from the career (bead m4me): Astropaths start
			// with Psy Rating 2 (their starting talents); Navigators are
			// "considered a psyker for all game purposes" (p182) with no
			// standard Psy Rating. Manually editable post-creation.
			psyker:
				state.careerKey === "astropath-transcendent" ||
				state.careerKey === "navigator",
			psyRating: state.careerKey === "astropath-transcendent" ? 2 : 0,
			careerKey: state.careerKey,
			rank: 1,
			// Persist the Origin Path picks (bead ay0): the consolidated
			// Background tab reads these; the summary card is not the record.
			// Chosen variants append as "key|variantKey".
			origins: {
				homeWorld: state.picks["home-world"]?.key ?? "",
				birthright: state.picks.birthright?.key ?? "",
				lure: state.picks.lure
					? state.picks.lure.variantKey
						? `${state.picks.lure.key}|${state.picks.lure.variantKey}`
						: state.picks.lure.key
					: "",
				trials: state.picks.trials?.key ?? "",
				motivation: state.picks.motivation?.key ?? "",
			},
		};

		if (this.targetActor) {
			// Right-clicked actor: update in place. Confirm overwrite when the
			// actor already has content (blank new PCs apply silently).
			const target = this.targetActor as unknown as {
				update: (data: object) => Promise<unknown>;
				createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
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
			await target.update({ name: state.name || this.targetActor.name, system: systemPayload } as never);
			await this.#applyGrantsAndSummary(target, state, resolved);
			await this.#applyAcquisition(target, state);
			this.close();
			target.sheet?.render({});
			return;
		}

		const actor = (await foundry.documents.Actor.create({
			name: state.name || game.i18n!.localize("CREATOR.DEFAULT_NAME"),
			type: "pc",
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
	 * acquisition (p273, modifier +0 or better — chosen on step 3). The
	 * group's PF/SP are NOT set here — they live on the dynasty document
	 * (owner redesign: keep group-level decisions out of the creator).
	 */
	async #applyAcquisition(
		actor: unknown,
		state: CreatorState,
	): Promise<void> {
		if (state.acquisition && state.acquisition.payload) {
			const target = actor as {
				createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
			};
			await target.createEmbeddedDocuments("Item", [
				{ ...state.acquisition.payload, system: { ...(state.acquisition.payload as { system?: object }).system, grantedBy: GRANTED_BY_CREATOR } },
			] as never);
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
		},
		state: CreatorState,
		resolved: ResolvedOrigin,
	): Promise<void> {
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
		const oldOrigins = ((this.targetActor?.system ?? {}) as {
			origins?: Record<string, string>;
		}).origins;
		if (oldOrigins) {
			const oldPicks: Partial<Record<OriginRow, OriginPick>> = {};
			for (const [storedKey, value] of Object.entries(oldOrigins)) {
				// Bead h7wl: stored keys are camelCase (homeWorld); map them to
				// the kebab-case OriginRow keys before validating.
				const row = originRowFromStoredKey(storedKey);
				if (!value || !row || !ORIGIN_ROWS.includes(row as OriginRow)) continue;
				const [base, variant] = value.split("|");
				oldPicks[row as OriginRow] = {
					key: base,
					...(variant ? { variantKey: variant } : {}),
				};
			}
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
		const pack = game.packs!.get("rogue-trader.skills");
		if (pack) {
			const docs = (await pack.getDocuments()) as unknown as Array<{
				name?: string;
				system: { characteristic: string };
			}>;
			for (const doc of docs) {
				if (doc.name) catalog.push({ name: doc.name, characteristic: doc.system.characteristic });
			}
		}
		const { grants, unmatched } = matchOriginSkills(resolved, catalog);
		const provenance = { grantedBy: GRANTED_BY_CREATOR };
		const itemGrants: GrantPayload[] = grants.map((grant) =>
			skillGrantPayload(grant.name, grant.system.characteristic, provenance),
		);
		const manual: string[] = [...resolved.notes];
		// Dedupe against ourselves and the surviving items (manual items the
		// player added by hand should not be duplicated by the re-grant).
		const seenNames = new Set(existing.map((item) => item.name ?? ""));
		for (const talentName of resolved.talents) {
			if (isUnresolvedChoice(talentName)) {
				manual.push(talentName);
				continue;
			}
			// yclz: resolve parameterised talents ("Peer (choose one)") to a
			// concrete subject before granting; cancelled prompt = skipped.
			const resolvedName = await resolveParameterisedTalent(talentName);
			if (!resolvedName) continue;
			if (seenNames.has(resolvedName)) continue;
			seenNames.add(resolvedName);
			itemGrants.push(await talentGrant(resolvedName, provenance));
		}
		for (const leftover of unmatched) {
			if (isUnresolvedChoice(leftover)) manual.push(leftover);
			else if (!seenNames.has(leftover)) {
				const resolvedName = await resolveParameterisedTalent(leftover);
				if (!resolvedName) continue;
				seenNames.add(resolvedName);
				itemGrants.push(await talentGrant(resolvedName, provenance));
			}
		}
		if (itemGrants.length > 0) {
			await actor.createEmbeddedDocuments("Item", itemGrants);
		}

		// Summary card: choices + everything needing manual application.
		const rows = ORIGIN_ROWS.map((rowKey) => {
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
			content: `<div class="rogue-trader creator-summary"><h3>${state.name}</h3><ul>${rows}</ul>${pf}${initiative}${psykerNote}${notes}</div>`,
		} as never);
	}
}
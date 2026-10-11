import type { CharacteristicKey } from "../../data/actor/character";
import { heirloomForRoll } from "../../rules/heirlooms";
import {
	type OriginRow,
	type ResolvedOrigin,
	resolveOrigins,
} from "../../rules/origins";
import { CREATOR_LAST_STEP, finalCharacteristics } from "../../rules/creation";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
// Bead hldm: the creator's PURE state + transitions live in creator-state.ts,
// the pack loaders in creator-packs.ts, the apply service in creator-apply.ts.
// The builders (context assembly, summary card) are creator-context.ts. This
// file is the thin Foundry orchestrator: constructor prefill, context
// orchestration, the 17 #on* dispatch actions and the finalize tail.
import {
	baseCharacteristics,
	buildCharacterSystemPayload,
	buildCreatorContext,
	type ExistingItemLike,
} from "./creator-context";
// The pure roll helpers stay re-exported here: ship-creator and the helpers'
// unit test import them from this module path (beads 71gm/nxok).
export {
	rollCharacteristic,
	rollAllCharacteristics,
	toggleCollapse,
} from "./creator-state";
import {
	allocatePointBuy,
	chooseCorrInsTrack,
	chooseCreatorCareer,
	chooseOriginRow,
	choosePickOption,
	chooseSpecies,
	type CreatorState,
	emptyState,
	prefillFromActor,
	rerollCharacteristic,
	rollAllCharacteristics,
	rollCharacteristicInto,
	rollOriginDice,
	setCreatorMethod,
	toggleCollapse,
	toggleKitSlotPick,
} from "./creator-state";
import {
	applyAcquisition,
	applyGrantsAndSummary,
	applyKit,
	type ApplyableActor,
	createOrUpdateActor,
} from "./creator-apply";
// The Foundry-coupled loaders + dice (bead hldm): the same fetch/caches the
// class used to hold, moved out where they are shared with nothing else.
import {
	careerSuggestions,
	creatorSpeciesOptions,
	ensureTalentLinkDocs,
	rollFormula,
	startingAcquisitions,
	startingCareerDocs,
} from "./creator-packs";
// Bead npnn: the shared imperative input-wiring helpers (dataset.wired guard).
import { wireInput } from "../dom-wire";
import { sheetContext } from "../context";
import {
	getPackDocuments,
	OPEN_PACK_DOC_ACTION,
	openPackDocUuid,
} from "../pack-resolve";
import { CreatorApplication } from "./creator-application";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

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
			// Epic 61pk, bead hjve: the pick chips' doc-link action name is the
			// library constant — the convention cannot drift.
			[OPEN_PACK_DOC_ACTION]: CharacterCreator.#onOpenPackDoc,
			chooseAcquisition: CharacterCreator.#onChooseAcquisition,
			toggleAcqGroup: CharacterCreator.#onToggleAcqGroup,
			rollHeirloom: CharacterCreator.#onRollHeirloom,
			// Starting Kit picks (owner rework 2026, step 5).
			chooseKitSlot: CharacterCreator.#onChooseKitSlot,
			finish: CharacterCreator.#onCreate,
		},
	});

	/** Species, characteristics, Origin Path, review, equipment, kit. */
	protected get lastStep(): number {
		return CREATOR_LAST_STEP;
	}

	/**
	 * Step 2 is the Origin Path: its wounds/Fate/insanity dice are rolled on
	 * entry (the dice belong to the origin rows, not the species).
	 */
	protected override async onEnterStep(step: number): Promise<void> {
		if (step === 2) {
			await rollOriginDice(this.creatorState, this.#resolved, rollFormula);
		}
	}

	creatorState: CreatorState = emptyState();

	/** Payloads for the acquisition chips, keyed by AcqOption.key. Full
	 * item JSON never goes through the DOM (the old data-payload attribute
	 * broke on JSON quotes — the "fix that selection up" bug). */
	#acquisitionPayloads = new Map<string, object>();

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
		this.name = this.targetActor?.name ?? "";
		prefillFromActor(this.creatorState, this.targetActor);
	}

	static PARTS = {
		form: {
			template: `${TEMPLATE_ROOT}sheet/actor/character-creator.hbs`,
		},
	};

	get #resolved(): ResolvedOrigin {
		return resolveOrigins(this.creatorState.picks);
	}

	/**
	 * The name field lives on step 0; keep it in state across re-renders
	 * (shared dataset.wired guard, bead npnn).
	 */
	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		wireInput(
			this.element?.querySelector<HTMLInputElement>(
				'input[name="explorer-name"]',
			),
			(value) => {
				this.name = value;
			},
		);
	}

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
		// The orchestration tail is the PURE buildCreatorContext (bead hldm):
		// every reviewed value — origin rows, review card, career/species chips,
		// acquisitions, heirloom, kit, the Create gate — is computed there over
		// the loaders' plain inputs, so the context shape tests headlessly.
		return buildCreatorContext(context, this.creatorState, {
			step: this.step,
			name: this.name,
			talentDocs: await ensureTalentLinkDocs(),
			suggestions: await careerSuggestions(),
			starting: await startingCareerDocs(),
			species: await creatorSpeciesOptions(),
			acquisitions: await startingAcquisitions(
				this.creatorState,
				this.#acquisitionPayloads,
			),
			localize: (key: string) => game.i18n!.localize(key),
		});
	}

	// --- Static #on* action handlers (the Foundry dispatch edge) ----------

	static async #onSetMethod(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		setCreatorMethod(this.creatorState, target.dataset.method);
		this.render({ force: true });
	}

	static async #onRollOne(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		if (!key) return;
		await rollCharacteristicInto(this.creatorState, getPorts().dice, key);
		this.render({ force: true });
	}

	/** The book's single re-roll: one characteristic, keep the new result. */
	static async #onReroll(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		const changed = await rerollCharacteristic(
			this.creatorState,
			getPorts().dice,
			key,
		);
		if (changed) this.render({ force: true });
	}

	static async #onRollAll(this: CharacterCreator): Promise<void> {
		Object.assign(
			this.creatorState.rolled,
			await rollAllCharacteristics(getPorts().dice, this.creatorState),
		);
		this.render({ force: true });
	}

	static async #onAlloc(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as CharacteristicKey;
		if (!key) return;
		allocatePointBuy(this.creatorState, key, Number(target.dataset.delta ?? 0));
		this.render({ force: true });
	}

	static async #onChooseOrigin(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const changed = chooseOriginRow(
			this.creatorState,
			target.dataset.row as OriginRow,
			target.dataset.key ?? "",
		);
		if (changed) this.render({ force: true });
	}

	static async #onChoosePickOption(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const changed = choosePickOption(
			this.creatorState,
			target.dataset.row as OriginRow,
			target.dataset.kind,
			target.dataset.value ?? "",
		);
		if (changed) this.render({ force: true });
	}

	static async #onChooseCorrIns(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const changed = chooseCorrInsTrack(
			this.creatorState,
			target.dataset.row as OriginRow,
			target.dataset.track,
		);
		if (changed) this.render({ force: true });
	}

	static async #onChooseCareer(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		chooseCreatorCareer(this.creatorState, target.dataset.key ?? "");
		this.render({ force: true });
	}

	/**
	 * The chip doc-link action (epic 61pk, bead hjve): open the chip's pack
	 * doc read-only. Delegates to the SHARED open path (bead oo5b F4) — the
	 * creator contributes its failure key + console label; the { uuid } toast
	 * vars and the loud missing-doc notify are the helper's convention.
	 */
	static async #onOpenPackDoc(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		await openPackDocUuid(target.dataset.uuid ?? "", {
			notifyKey: "CREATOR.OPEN_DOC_FAIL",
			label: "creator doc link",
		});
	}

	/**
	 * Species choice (bead ghmn): every state change (bases, Fate/Wounds,
	 * invalidation of rolls and illegal picks/careers) is the PURE
	 * chooseSpecies transition in creator-state.ts; the loaders fetch.
	 */
	static async #onChooseSpecies(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = (target.dataset.key ?? "").trim();
		const option = (await creatorSpeciesOptions()).find((o) => o.key === key);
		if (!option) return;
		const changed = chooseSpecies(
			this.creatorState,
			option,
			await startingCareerDocs(),
		);
		if (changed) this.render({ force: true });
	}

	/** Stage 6 group collapse (bead a2rd, owner: collapsible groups). */
	static async #onToggleAcqGroup(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.group;
		if (!key) return;
		toggleCollapse(this.creatorState, "acqCollapsed", key);
		this.render({ force: true });
	}

	/**
	 * Stage 3.5 (bead rboc, Core Rulebook Table 1-2 p31): roll 1d100 for the
	 * heirloom when the Pride "Heirloom Item" alternative is taken. The roll
	 * is stored in state and the grant happens at apply alongside the
	 * starting acquisition.
	 */
	static async #onRollHeirloom(this: CharacterCreator): Promise<void> {
		const total = Math.floor(await rollFormula("1d100"));
		const entry = heirloomForRoll(total);
		this.creatorState.heirloom = { roll: total, name: entry.name };
		this.render({ force: true });
	}

	/** Stage 6 (printed p272): choose the single starting free acquisition. */
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
				getPorts().notify.warn("CREATOR.ACQ_BLOCKED");
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

	/**
	 * Starting Kit (owner rework 2026, step 5): record the pick-one slot's
	 * chosen option; clicking the chosen option again clears it back to the
	 * unset state (Create re-gates, no silent default).
	 */
	static async #onChooseKitSlot(
		this: CharacterCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const changed = toggleKitSlotPick(
			this.creatorState,
			Number(target.dataset.slot),
			Number(target.dataset.option),
		);
		if (changed) this.render({ force: true });
	}

	/**
	 * Build the new pc actor and apply the whole Stage 1-2 bundle. The
	 * create-vs-update branching and its confirm dialog live in the SHARED
	 * helper (creator-apply.ts, bead w7zm) — the confirm-overwrite stays
	 * character-creator-only (the ship creator applies silently, and that
	 * asymmetry is deliberate); the apply service runs from a single
	 * equipment-pack fetch (bead hldm).
	 */
	static async #onCreate(this: CharacterCreator): Promise<void> {
		const state = this.creatorState;
		const resolved = this.#resolved;
		const chars = finalCharacteristics(
			baseCharacteristics(state),
			resolved.characteristics,
		);
		// The system payload is the PURE buildCharacterSystemPayload (bead
		// a87x) — the same vitals/totals math the Review card uses, so the
		// two can no longer drift.
		const systemPayload = buildCharacterSystemPayload(state, resolved, chars);
		// The reconcile input is the update path's PRE-EXISTING snapshot.
		let existingItems: ExistingItemLike[] = [];
		let oldOrigins: Record<string, string> | undefined;
		if (this.targetActor) {
			existingItems = (this.targetActor.items ??
				[]) as unknown as ExistingItemLike[];
			oldOrigins = (
				(this.targetActor.system ?? {}) as {
					origins?: Record<string, string>;
				}
			).origins;
		}
		await createOrUpdateActor(
			this.targetActor as unknown as ApplyableActor | null,
			{ name: this.name, type: "explorer", system: systemPayload },
			async (actor) => {
				await applyGrantsAndSummary(actor, state, resolved, {
					actorName: this.name,
					existingItems,
					oldOrigins,
				});
				const deps = {
					docs: await getPackDocuments("rogue-trader.equipment"),
					notify: getPorts().notify,
				};
				await applyAcquisition(actor, state, deps);
				await applyKit(actor, state, deps);
			},
			{
				confirmOverwrite: true,
				fallbackNameKey: "CREATOR.DEFAULT_NAME",
				confirmKeys: {
					title: "CREATOR.APPLY_TITLE",
					content: "CREATOR.APPLY_CONFIRM",
				},
				close: () => this.close(),
			},
		);
	}
}

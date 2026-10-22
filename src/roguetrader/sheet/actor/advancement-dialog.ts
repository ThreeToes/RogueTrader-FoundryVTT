import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import { systemOf } from "../../data/accessors";
import { CHARACTERISTIC_KEYS } from "../../data/actor/character";
import {
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	type CharacteristicSchemeLike,
	characteristicNextAdvance,
	derivedRank,
	evaluateAlternateRankGate,
	ledgerEntryFor,
	type RankThresholdLike,
	totalSpent,
} from "../../rules/advancement";
// Bead iktx: the ONE characteristic-label composition seam (labels.ts).
import { characteristicLabelKey } from "../../rules/labels";
// Bead 656m: the shared pack-doc catalog builders — the inline mapping
// loops that duplicated the character creator's grant catalog lived here.
import {
	buildSkillCatalog,
	buildTalentCatalog,
	type OptionDocLike,
	type SkillCatalogEntry,
	type TalentCatalogEntry,
} from "../catalog";
import { sheetContext } from "../context";
// Bead npnn: the shared imperative input-wiring helpers (dataset.wired guard).
import { wireInput } from "../dom-wire";
// Shared doc-link library (epic 61pk, bead n2b2): the resolvers live there,
// re-exported through pack-resolve (see below); no local copies.
import { resolveSkillDoc } from "../pack-doc-links";
import { characterOptionDocsOnce, openPackDocUuid } from "../pack-resolve";
import {
	characteristicValues,
	findOwnedSkillForRow,
	LADDER_MAX,
} from "../skills-domain";
// Bead avah: the PURE purchase helpers (validation, ledger update, talent
// grant) — #buyRow orchestrates over them.
import {
	advanceConfirmReasons,
	applyTalentGrant,
	type TalentGrantDeps,
	updateLedger,
	validateAdvancePurchase,
} from "./advancement-buy";
import {
	buildAdvancementViewModel,
	filterAdvancementRows,
} from "./advancement-view-model";
import { promptParameterisedSubject, talentGrant } from "./grant-helpers";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Session cache for the compendium pack fetches (bead j4io, owner-approved
 * 2026-09-29): MEMOIZE lived here; bead qg4z moved it into pack-resolve.ts
 * (shared with the chat-card doc-link catalogs) — the behaviour is pinned by
 * pack-doc-links.test.ts and this file's usages below are unchanged.
 */
/**
 * Player-facing Spend-XP dialog (bead clng). The single Foundry-coupled
 * layer of the advancement engine: the math is pure (rules/advancement).
 *
 * Lists the career's Characteristic Advance Scheme and every rank advance
 * row the character holds or previously held (Core Rulebook p38), with computed
 * cost, multiplier state, remaining xp pool and progress to the next rank.
 * Purchase = ledger append + live application (skill ladder bump or item
 * grant, characteristic +5). Ineligible rows soft-confirm (GM overridable).
 */
export class AdvancementDialog extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-advancement-dialog",
		classes: [
			"rogue-trader",
			"dialog",
			"advancement-dialog",
			"rt-component",
			"rtk-window",
		],
		position: { width: 640, height: 560 },
		window: { title: "ADVANCE.TITLE", resizable: true },
		actions: {
			buy: AdvancementDialog.#onBuy,
			buyCharacteristic: AdvancementDialog.#onBuyCharacteristic,
			openPackDoc: AdvancementDialog.#onOpenPackDoc,
			refund: AdvancementDialog.#onRefund,
			selectRank: AdvancementDialog.#onSelectRank,
			toggleFilter: AdvancementDialog.#onToggleFilter,
		},
	};

	actor: foundry.documents.Actor;

	/** Career item from the compendium pack, loaded in _prepareContext. */
	#career: {
		key: string;
		/** Career display name (alternate-rank gates print names, not slugs). */
		name: string;
		/** Species block (bead ghmn); blank key = human. */
		species: { key: string; label: string };
		ranks: Array<{
			rank: number;
			xpLevel: number;
			advances: AdvanceRowLike[];
		}>;
		characteristicAdvances: Record<string, CharacteristicSchemeLike>;
	} | null = null;

	/**
	 * Advance rows from ELIGIBLE alternate/elite ranks (bead g45s): once the
	 * actor's career/species/rank/xp clear a rank's structured gate, its table
	 * rows are offered alongside the primary career's, tagged with their
	 * source career. Requirements/Other Requirements stay soft (GM-confirm).
	 */
	#alternateRows: Array<
		AdvanceRowLike & { source: string; sourceName: string }
	> = [];

	/** Eligible alternate ranks for the header hint. */
	#alternateOffers: Array<{ name: string; notesText: string }> = [];

	/** Skill catalog docs from the compendium (for grants by key/name). */
	#skillDocs: SkillCatalogEntry[] = [];

	/** Talent catalog docs: name resolution + benefit tooltips (lzeb child 1). */
	#talentDocs: TalentCatalogEntry[] = [];

	constructor(
		options: {
			actor: foundry.documents.Actor;
		} & object,
	) {
		super(options as never);
		this.actor = options.actor;
	}

	// -----------------------------------------------------------------
	// Dialog-held UI state (epic lzeb child 2, creatorState pattern): rank
	// chip selection + search/filter toolbar. Purely presentational — never
	// touches the ledger; re-rendered on interaction.
	/** Selected rank chip; null = follow the view model's defaultRank. */
	#selectedRank: number | null = null;
	/** Search text (lowercase compare happens in filterAdvancementRows). */
	#search = "";
	/** Toolbar toggles. */
	#onlyAffordable = false;
	#onlyUnowned = false;
	/** One-shot: restore focus/caret to the search input after the re-render. */
	#refocusSearch = false;

	static PARTS = {
		form: {
			template: `${TEMPLATE_ROOT}sheet/actor/parts/advancement-dialog.hbs`,
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
		const system = systemOf(this.actor);
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const spent = totalSpent(ledger);

		// Load the career from the compendium by key.
		this.#career = null;
		this.#skillDocs = [];
		this.#talentDocs = [];
		this.#alternateRows = [];
		this.#alternateOffers = [];
		const careerKey = system.careerKey;
		const toRows = (
			rank: number,
			advances: Array<Record<string, unknown>> | undefined,
		): AdvanceRowLike[] =>
			(advances ?? []).map((adv) => ({
				key: String(adv.key ?? ""),
				name: String(adv.name ?? ""),
				type: adv.type === "talent" ? ("talent" as const) : ("skill" as const),
				cost: Number(adv.cost ?? 0),
				multiplier: Number(adv.multiplier ?? 1),
				prerequisites: (adv.prerequisites ?? []) as string[],
				rank,
			}));
		let allCareers: Array<{
			id?: string;
			name?: string;
			system: {
				key: string;
				ranks?: Array<{
					rank: number;
					xpLevel: number;
					advances?: Array<Record<string, unknown>>;
				}>;
				characteristicAdvances?: Record<string, Record<string, number>>;
				species?: { key?: string; label?: string };
				requiredCareer?: string;
				requiredRace?: string;
				alternateRank?: string;
				requirements?: string;
				otherRequirements?: string;
			};
		}> = [];
		if (careerKey) {
			allCareers = (await characterOptionDocsOnce(
				"career",
			)) as unknown as typeof allCareers;
			const doc = allCareers.find((d) => d.system.key === careerKey);
			if (doc) {
				this.#career = {
					key: doc.system.key,
					name: doc.name ?? doc.system.key,
					species: {
						key: doc.system.species?.key ?? "",
						label: doc.system.species?.label ?? "",
					},
					ranks: (doc.system.ranks ?? []).map((rank) => ({
						rank: rank.rank,
						xpLevel: rank.xpLevel,
						advances: toRows(rank.rank, rank.advances),
					})),
					characteristicAdvances: (doc.system.characteristicAdvances ??
						{}) as unknown as Record<string, CharacteristicSchemeLike>,
				};
			}
		}
		// Bead 656m: mapped by the SHARED builder (the shape that carries
		// uuid/key, so rank-row doc links keep working).
		this.#skillDocs = buildSkillCatalog(
			(await characterOptionDocsOnce("skill")) as unknown as OptionDocLike[],
		);
		// Talents pack for name resolution of key-only rows ("psy-rating",
		// "psychic-technique", ...) and the benefit tooltips (lzeb child 1:
		// name + description resolution moved into the pure view model).
		// Bead 656m: mapped by the SHARED talent builder.
		this.#talentDocs = buildTalentCatalog(
			(await characterOptionDocsOnce("talent")) as unknown as OptionDocLike[],
		);

		const thresholds: RankThresholdLike[] = (this.#career?.ranks ?? []).map(
			(r) => ({ rank: r.rank, xpLevel: r.xpLevel }),
		);
		const derived = derivedRank(thresholds, spent);
		const isGM = (game as unknown as { user?: { isGM?: boolean } }).user?.isGM;

		// Alternate/elite ranks (bead g45s): offer the advance tables of every
		// rank whose STRUCTURED gate this character clears (career/race/rank/xp).
		// Requirements and Other Requirements stay soft notes, shown in the
		// header hint and re-confirmed at purchase (GM-overridable, bead tfk).
		const ownedTalents = this.actor.items
			.filter((item) => (item.type as string) === "talent")
			.map((item) => item.name ?? "");
		const ownedSkillItems = this.actor.items
			.filter((item) => (item.type as string) === "skill")
			.map((item) => ({
				key: (item.system as unknown as { key?: string }).key ?? "",
				name: item.name ?? "",
				ladder: (item.system as unknown as { ladder?: number }).ladder ?? 1,
			}));
		const ownedSkills = ownedSkillItems.map((skill) => skill.name);
		const characteristics: Partial<Record<string, number>> =
			characteristicValues(system);
		if (this.#career) {
			for (const doc of allCareers) {
				const alt = doc.system;
				if (alt.key === this.#career.key) continue;
				if (!alt.requiredCareer && !alt.requiredRace && !alt.alternateRank)
					continue;
				const evaluation = evaluateAlternateRankGate(
					{
						requiredCareer: alt.requiredCareer ?? "",
						requiredRace: alt.requiredRace ?? "",
						alternateRank: alt.alternateRank ?? "",
						requirements: alt.requirements ?? "",
						otherRequirements: alt.otherRequirements ?? "",
					},
					{
						careerKey: this.#career.key,
						careerName: this.#career.name,
						speciesKey: this.#career.species.key,
						speciesLabel: this.#career.species.label,
						rank: derived,
						spent,
						characteristics,
						ownedTalents,
						ownedSkills,
						psyRating: system.psyRating ?? 0,
						psyker: system.psyker === true,
					},
				);
				if (!evaluation.eligible) continue;
				for (const rank of alt.ranks ?? []) {
					for (const row of toRows(rank.rank, rank.advances)) {
						this.#alternateRows.push({
							...row,
							source: alt.key,
							sourceName: doc.name ?? alt.key,
						});
					}
				}
				this.#alternateOffers.push({
					name: doc.name ?? alt.key,
					notesText: evaluation.notes.join("; "),
				});
			}
		}

		// Row enrichment moved into the pure view model (epic lzeb child 1,
		// bead anv0): resolved names, owned/multiplier, ladder previews,
		// characteristic tiers, affordability, prereq unmet lists, benefit
		// tooltips, rank groups and the default rank chip — all unit-tested.
		// The dialog only orchestrates: feed the plain inputs, hang the result
		// on the context (existing keys unchanged; new fields additive).
		const viewModel = buildAdvancementViewModel({
			xpTotal: system.xp?.total ?? 0,
			career: this.#career,
			alternateRows: this.#alternateRows,
			ledger,
			characteristics,
			ownedTalentNames: ownedTalents,
			psyRating: system.psyRating ?? 0,
			ownedSkills: ownedSkillItems,
			skillDocs: this.#skillDocs,
			talentDocs: this.#talentDocs,
		});

		context.pool = viewModel.pool;
		context.spent = viewModel.spent;
		context.rank = viewModel.rank;
		context.systemRank = system.rank ?? 1;
		context.rankUp = viewModel.rank > (system.rank ?? 1);
		context.progress = viewModel.progress;
		context.rankGroups = viewModel.rankGroups;
		context.characteristics = viewModel.characteristics;
		context.defaultRank = viewModel.defaultRank;

		// Rank chip selection (lzeb child 2): null selection follows the
		// view model's defaultRank (lowest rank with unpurchased rows).
		const selectedRank = this.#selectedRank ?? viewModel.defaultRank ?? null;
		context.selectedRank = selectedRank;
		context.search = this.#search;
		context.onlyAffordable = this.#onlyAffordable;
		context.onlyUnowned = this.#onlyUnowned;
		const filter = {
			search: this.#search,
			affordableOnly: this.#onlyAffordable,
			unownedOnly: this.#onlyUnowned,
		};
		const shown =
			viewModel.rankGroups.find((group) => group.rank === selectedRank) ?? null;
		context.shownGroup = shown
			? { ...shown, rows: filterAdvancementRows(shown.rows, filter) }
			: null;
		context.shownEmpty =
			Boolean(shown) &&
			(context.shownGroup as { rows: unknown[] }).rows.length === 0;

		// Meter: % toward the next rank inside THIS rank's window (spent from
		// the current rank threshold to the next one).
		const currentThreshold =
			viewModel.rank > 1
				? (thresholds.find((t) => t.rank === viewModel.rank)?.xpLevel ?? 0)
				: 0;
		const nextThreshold = viewModel.progress.nextXpLevel;
		context.progressPct =
			nextThreshold && nextThreshold > currentThreshold
				? Math.max(
						0,
						Math.min(
							100,
							Math.round(
								((viewModel.spent - currentThreshold) /
									(nextThreshold - currentThreshold)) *
									100,
							),
						),
					)
				: 0;

		// Locked next-rank preview (lzeb child 2): re-run the pure builder with
		// the ledger topped up to the next threshold — that flips derivedRank to
		// the next rank (pool 0 → all rows unaffordable) and enriches its rows
		// with resolved names + prereq state. Presentational only.
		context.nextRankPreview = null;
		if (viewModel.progress.nextRank && this.#career) {
			const previewLedger: AdvanceLedgerEntry[] =
				viewModel.progress.remaining > 0
					? [
							...ledger,
							{
								type: "talent",
								key: "",
								name: "next-rank-preview",
								cost: viewModel.progress.remaining,
								rank: 0,
							},
						]
					: ledger;
			const previewVM = buildAdvancementViewModel({
				xpTotal: system.xp?.total ?? 0,
				career: this.#career,
				alternateRows: this.#alternateRows,
				ledger: previewLedger,
				characteristics,
				ownedTalentNames: ownedTalents,
				psyRating: system.psyRating ?? 0,
				ownedSkills: ownedSkillItems,
				skillDocs: this.#skillDocs,
				talentDocs: this.#talentDocs,
			});
			context.nextRankPreview =
				previewVM.rankGroups.find(
					(group) => group.rank === viewModel.progress.nextRank,
				) ?? null;
		}

		context.alternateOffers = this.#alternateOffers;
		context.canBuy = viewModel.canBuy;
		context.isGM = isGM === true;
		context.hasCareer = Boolean(this.#career);
		return context;
	}

	/** The search input's value must survive re-renders (creator pattern). */
	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		const input = this.element?.querySelector<HTMLInputElement>(
			'input[name="advancement-search"]',
		);
		if (!input) return;
		if (this.#refocusSearch) {
			this.#refocusSearch = false;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		}
		// Shared imperative guard (bead npnn); the dialog re-renders on change
		// and asks for the caret back via the #refocusSearch flag.
		wireInput(input, (value) => {
			this.#search = value;
			this.#refocusSearch = true;
			this.render({ force: true } as never);
		});
	}

	/** Rank chip click: show that rank's table (presentational state only). */
	static async #onSelectRank(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		this.#selectedRank = Number(target.dataset.rank ?? 1);
		this.#refocusSearch = false;
		this.render({ force: true } as never);
	}

	/** Toolbar toggle: flip one filter chip and re-render. */
	static async #onToggleFilter(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		switch (target.dataset.filter) {
			case "affordable":
				this.#onlyAffordable = !this.#onlyAffordable;
				break;
			case "unowned":
				this.#onlyUnowned = !this.#onlyUnowned;
				break;
			default:
				return;
		}
		this.#refocusSearch = false;
		this.render({ force: true } as never);
	}

	/** Confirm dialog listing the soft-enforcement reasons (GM overridable). */
	async #confirmReasons(reasons: string[]): Promise<boolean> {
		if (reasons.length === 0) return true;
		const list = `<ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>`;
		return (
			(await foundry.applications.api.DialogV2.confirm({
				window: { title: game.i18n!.localize("ADVANCE.CONFIRM_TITLE") },
				content: `<p>${game.i18n!.localize("ADVANCE.CONFIRM_HINT")}</p>${list}`,
			})) === true
		);
	}

	static async #onBuyCharacteristic(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key as (typeof CHARACTERISTIC_KEYS)[number];
		if (!key) return;
		await this.#buyCharacteristic(key);
	}

	async #buyCharacteristic(
		key: (typeof CHARACTERISTIC_KEYS)[number],
	): Promise<void> {
		if (!this.#career) return;
		const system = systemOf(this.actor);
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const scheme = this.#career.characteristicAdvances[key];
		if (!scheme) return;
		const purchased = ledger.filter(
			(entry) =>
				entry.type === "characteristic" && entry.characteristic === key,
		).length;
		const next = characteristicNextAdvance(scheme, purchased);
		if (!next) return;
		const spent = totalSpent(ledger);
		const pool = Math.max(0, (system.xp?.total ?? 0) - spent);
		if (next.cost > pool) {
			const reasons = [
				`Cost ${next.cost} xp exceeds the remaining pool of ${pool} xp.`,
			];
			if (!(await this.#confirmReasons(reasons))) return;
		}
		const current = system.characteristics[key]?.value ?? 0;
		const value = Math.min(100, current + 5);
		const entry: AdvanceLedgerEntry = {
			type: "characteristic",
			key: "",
			name: `${key.toUpperCase()} ${next.tier}`,
			characteristic: key,
			cost: next.cost,
			rank: 0,
			tier: next.tier,
			source: this.#career.key,
		};
		await this.actor.update({
			system: {
				characteristics: { [key]: { value } },
				advances: [...ledger, entry],
				xp: { spent: totalSpent([...ledger, entry]) },
			},
		} as never);
		getPorts().notify.info("ADVANCE.BOUGHT", {
			name: `${getPorts().i18n.t(characteristicLabelKey(key))} +5 (${next.tier})`,
			cost: String(next.cost),
		});
		this.render({ force: true } as never);
	}

	static async #onBuy(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row: AdvanceRowLike = {
			key: target.dataset.key ?? "",
			name: target.dataset.name ?? "",
			type: (target.dataset.type as "skill" | "talent") ?? "skill",
			cost: Number(target.dataset.cost ?? 0),
			multiplier: Number(target.dataset.multiplier ?? 1),
			prerequisites: (target.dataset.prerequisites ?? "")
				.split("|")
				.filter(Boolean),
			rank: Number(target.dataset.rank ?? 1),
		};
		if (!row.name) return;
		await this.#buyRow(row, target.dataset.source || undefined);
	}

	async #buyRow(row: AdvanceRowLike, source?: string): Promise<void> {
		if (!this.#career) return;
		const system = systemOf(this.actor);
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const spent = totalSpent(ledger);
		const pool = Math.max(0, (system.xp?.total ?? 0) - spent);
		const thresholds: RankThresholdLike[] = this.#career.ranks.map((r) => ({
			rank: r.rank,
			xpLevel: r.xpLevel,
		}));
		// Bead avah: the validation is the PURE validateAdvancePurchase —
		// shared rule validator + structured prereq eval (bead tfk, only UNMET
		// prereqs) + the skill-at-cap soft-confirm (bead i1f4). The dialog
		// localizes the pieces and confirms.
		const validation = validateAdvancePurchase(row, {
			spent,
			pool,
			ledger,
			derivedRank: derivedRank(thresholds, spent),
			characteristics: characteristicValues(system),
			ownedTalents: this.actor.items
				.filter((item) => (item.type as string) === "talent")
				.map((item) => item.name ?? ""),
			psyRating: system.psyRating ?? 0,
			ownedSkills: this.actor.items
				.filter((item) => (item.type as string) === "skill")
				.map((item) => ({
					key: (item.system as unknown as { key?: string }).key ?? "",
					name: item.name ?? "",
					ladder: (item.system as unknown as { ladder?: number }).ladder ?? 1,
				})),
			// data-name is already the resolved display name
			rowName: row.name,
		});
		if (
			!(await this.#confirmReasons(
				advanceConfirmReasons(
					validation,
					(key: string) => game.i18n!.localize(key),
					(key: string, vars?: Record<string, string>) =>
						game.i18n!.format(key, vars),
				),
			))
		) {
			return;
		}

		const entry = ledgerEntryFor(row, source ?? this.#career.key);

		if (row.type === "skill") {
			const applied = await this.#applySkillAdvance(row);
			if (!applied) return;
		} else if (row.key === "psy-rating" || /^psy rating/i.test(row.name)) {
			// Psy Rating advance (bead m4me): raises the actor's Psy Rating by
			// 1 instead of granting a talent item (the rating lives on the
			// actor, Core Rulebook p182 psykers).
			const live = systemOf(this.actor);
			await this.actor.update({
				system: { psyRating: (live.psyRating ?? 0) + 1 },
			} as never);
		} else {
			// Talent: idempotent grant by name (matching the talent picker);
			// a CANCELLED parameterised-subject prompt grants nothing and
			// records no ledger entry (yclz).
			const granted = await applyTalentGrant(row, this.#talentGrantDeps());
			if (!granted) return;
		}

		// The ledger + rank updates are the PURE updateLedger (p38: the Rank
		// rises automatically once the threshold is crossed).
		const { updates, rankUp } = updateLedger(
			ledger,
			entry,
			thresholds,
			system.rank ?? 1,
		);
		await this.actor.update({ system: updates } as never);
		if (rankUp) {
			getPorts().notify.info("ADVANCE.RANK_UP", { rank: String(rankUp) });
		}
		getPorts().notify.info("ADVANCE.BOUGHT", {
			name: row.name,
			cost: String(row.cost),
		});
		this.render({ force: true } as never);
	}

	/**
	 * The Foundry edges of the talent-grant branch, injected into the pure
	 * applyTalentGrant: the parameterised-subject prompt (yclz), the pack
	 * clone (meh0), the exact-name owned check and the embedded create.
	 */
	#talentGrantDeps(): TalentGrantDeps {
		return {
			promptSubject: (name: string) => promptParameterisedSubject(name),
			grantPayload: (name: string) => talentGrant(name),
			ownedTalentNames: () =>
				this.actor.items
					.filter((item) => (item.type as string) === "talent")
					.map((item) => item.name ?? ""),
			createItems: (payload: object) =>
				this.actor.createEmbeddedDocuments("Item", [payload] as never),
		};
	}

	/** Skill advance: bump the ladder of an owned skill, or grant it. */
	async #applySkillAdvance(row: AdvanceRowLike): Promise<boolean> {
		// Owned match through the SHARED matcher (bead wxkw): the exact helper
		// the view model's ladder preview uses, so a promised bump can never
		// turn into a duplicate ladder-1 grant (key first, then the trimmed,
		// case-insensitive name against the resolved and raw row names).
		const owned = findOwnedSkillForRow(
			this.actor.items
				.filter((item) => (item.type as string) === "skill")
				.map((item) => ({
					item,
					key: (item.system as unknown as { key?: string }).key ?? "",
					name: item.name ?? "",
				})),
			row,
			row.name, // data-name is already the resolved display name
		)?.item;
		if (owned) {
			const system = owned.system as unknown as { ladder: number };
			// Shared cap (bead i1f4): the three-step ladder, Core Rulebook p74.
			const ladder = Math.min(LADDER_MAX, (system.ladder ?? 1) + 1);
			if (ladder === (system.ladder ?? 1)) return true; // already maxed
			await owned.update({ system: { ladder } });
			return true;
		}
		// New skill: clone the pack doc's characteristic — through THE shared
		// skill matcher (bead e72x B1), matching the preview and the uuid link.
		const doc = resolveSkillDoc(row, this.#skillDocs);
		await this.actor.createEmbeddedDocuments("Item", [
			{
				name: row.name,
				type: "skill",
				system: { characteristic: doc?.characteristic ?? "int", ladder: 1 },
			},
		] as never);
		return true;
	}

	/**
	 * Rank-row link (bead ha1y): open the resolved pack document's sheet
	 * read-only — the group argues rules from item sheets (AGENTS.md). The
	 * uuid is what the view model stamped on the row (matched by key, then
	 * the existing name matchers); rows without a doc render plain text, so
	 * a missing data-uuid is a normal no-op.
	 *
	 * FOUNDRY v14 API VERIFICATION (foundry.mjs): fromUuidSync (line 39467)
	 * is WRONG here — for a CompendiumCollection it falls back to
	 * `collection.index.get(baseId)` (line 39490), returning the pack's
	 * INDEX ENTRY, which has no `.sheet` to render. async `fromUuid` (line
	 * 39440) awaits `collection.getDocument(id)` and returns the real
	 * Document — and the repo's resolvePackDocument (bead wwuc) additionally
	 * fixes the LevelDB packs where fromUuid no-opped in-world, so resolution
	 * goes through that shared primitive + openDocumentSheet's loud failure.
	 *
	 * bead oo5b F4: the BODY is the shared openPackDocUuid helper — this
	 * action only contributes its failure key + console label.
	 */
	static async #onOpenPackDoc(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		await openPackDocUuid(target.dataset.uuid ?? "", {
			notifyKey: "ADVANCE.OPEN_DOC_FAIL",
			label: "advancement doc link",
		});
	}

	/** GM refund: remove the newest matching ledger entry. */
	static async #onRefund(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index ?? -1);
		if (index < 0) return;
		const system = systemOf(this.actor);
		const ledger = [...((system.advances ?? []) as AdvanceLedgerEntry[])];
		const [removed] = ledger.splice(index, 1);
		if (!removed) return;
		await this.actor.update({
			system: {
				advances: ledger,
				xp: { spent: totalSpent(ledger) },
			},
		} as never);
		getPorts().notify.info("ADVANCE.REFUNDED", {
			name: removed.name,
			cost: String(removed.cost),
		});
		this.render({ force: true } as never);
	}
}

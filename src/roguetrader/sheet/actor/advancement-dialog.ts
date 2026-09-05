import type { Character } from "../../data/actor/character";
import {
	availableRows,
	characteristicNextAdvance,
	derivedRank,
	ledgerEntryFor,
	multiplierRemaining,
	rankProgress,
	spentOnRank,
	totalSpent,
	validatePurchase,
	type AdvanceLedgerEntry,
	type AdvanceRowLike,
	type CharacteristicSchemeLike,
	type RankThresholdLike,
} from "../../rules/advancement";
import { CHARACTERISTIC_KEYS } from "../../data/actor/character";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/**
 * Player-facing Spend-XP dialog (bead clng). The single Foundry-coupled
 * layer of the advancement engine: the math is pure (rules/advancement).
 *
 * Lists the career's Characteristic Advance Scheme and every rank advance
 * row the character holds or previously held (rt_core p38), with computed
 * cost, multiplier state, remaining xp pool and progress to the next rank.
 * Purchase = ledger append + live application (skill ladder bump or item
 * grant, characteristic +5). Ineligible rows soft-confirm (GM overridable).
 */
export class AdvancementDialog extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-advancement-dialog",
		classes: ["rogue-trader", "dialog", "advancement-dialog"],
		position: { width: 640, height: 560 },
		window: { title: "ADVANCE.TITLE", resizable: true },
		actions: {
			buy: AdvancementDialog.#onBuy,
			buyCharacteristic: AdvancementDialog.#onBuyCharacteristic,
			refund: AdvancementDialog.#onRefund,
		},
	};

	actor: foundry.documents.Actor;

	/** Career item from the compendium pack, loaded in _prepareContext. */
	#career: {
		key: string;
		ranks: Array<{
			rank: number;
			xpLevel: number;
			advances: AdvanceRowLike[];
		}>;
		characteristicAdvances: Record<string, CharacteristicSchemeLike>;
	} | null = null;

	/** Skill catalog docs from the compendium (for grants by key/name). */
	#skillDocs: Array<{
		id: string;
		name: string;
		key: string;
		characteristic: string;
	}> = [];

	/** Key > name resolution for key-only rank-table rows (careers carry empty names). */
	#nameByKey: Record<string, string> = {};

	constructor(options: { actor: foundry.documents.Actor } & object) {
		super(options as never);
		this.actor = options.actor;
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/advancement-dialog.hbs",
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = (await super._prepareContext(_options as never)) as Record<
			string,
			unknown
		>;
		const system = this.actor.system as unknown as Character;
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const spent = totalSpent(ledger);
		const pool = Math.max(0, (system.xp?.total ?? 0) - spent);

		// Load the career from the compendium by key.
		this.#career = null;
		this.#skillDocs = [];
		const careerKey = system.careerKey;
		const careerPack = game.packs?.get("rogue-trader.careers");
		if (careerPack && careerKey) {
			const docs = (await careerPack.getDocuments()) as unknown as Array<{
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
				};
			}>;
			const doc = docs.find((d) => d.system.key === careerKey);
			if (doc) {
				this.#career = {
					key: doc.system.key,
					ranks: (doc.system.ranks ?? []).map((rank) => ({
						rank: rank.rank,
						xpLevel: rank.xpLevel,
						advances: (rank.advances ?? []).map((adv) => ({
							key: String(adv.key ?? ""),
							name: String(adv.name ?? ""),
							type: adv.type === "talent" ? ("talent" as const) : ("skill" as const),
							cost: Number(adv.cost ?? 0),
							multiplier: Number(adv.multiplier ?? 1),
							prerequisites: (adv.prerequisites ?? []) as string[],
							rank: rank.rank,
						})),
					})),
					characteristicAdvances: (doc.system.characteristicAdvances ??
						{}) as unknown as Record<string, CharacteristicSchemeLike>,
				};
			}
		}
		const skillPack = game.packs?.get("rogue-trader.skills");
		if (skillPack) {
			const docs = (await skillPack.getDocuments()) as unknown as Array<{
				id?: string;
				name?: string;
				system: { key?: string; characteristic?: string };
			}>;
			for (const doc of docs) {
				if (doc.name) {
					this.#skillDocs.push({
						id: doc.id ?? "",
						name: doc.name,
						key: doc.system.key ?? "",
						characteristic: doc.system.characteristic ?? "int",
					});
				}
			}
		}
		// Talents pack for name resolution of key-only rows ("psy-rating",
		// "psychic-technique", ...).
		this.#nameByKey = {};
		const talentPack = game.packs?.get("rogue-trader.talents");
		if (talentPack) {
			const docs = (await talentPack.getDocuments()) as unknown as Array<{
				name?: string;
				system: { key?: string };
			}>;
			for (const doc of docs) {
				if (doc.name && doc.system.key) {
					this.#nameByKey[doc.system.key] = doc.name;
				}
			}
		}
		for (const doc of this.#skillDocs) {
			if (doc.key) this.#nameByKey[doc.key] = doc.name;
		}

		const thresholds: RankThresholdLike[] = (this.#career?.ranks ?? []).map(
			(r) => ({ rank: r.rank, xpLevel: r.xpLevel }),
		);
		const derived = derivedRank(thresholds, spent);
		const progress = rankProgress(thresholds, spent);
		const isGM = (game as unknown as { user?: { isGM?: boolean } }).user?.isGM;

		// Characteristic advance rows: next tier per characteristic from the
		// career scheme; ledger counts prior +5 purchases.
		context.characteristics = CHARACTERISTIC_KEYS.map((key) => {
			const scheme = this.#career?.characteristicAdvances?.[key];
			const purchased = ledger.filter(
				(entry) => entry.type === "characteristic" && entry.characteristic === key,
			).length;
			const next = scheme ? characteristicNextAdvance(scheme, purchased) : null;
			return {
				key,
				labelKey: `CHARACTERISTIC.${key.toUpperCase()}`,
				value: system.characteristics[key]?.value ?? 0,
				purchased,
				next,
				affordable: next ? next.cost <= pool : false,
			};
		});

		// Rank advance rows (held or previously held: rank <= derived).
		const rows = availableRows(this.#career?.ranks.flatMap((r) => r.advances) ?? [], derived);
		const rankGroups: Array<Record<string, unknown>> = [];
		for (let rank = 1; rank <= derived; rank += 1) {
			const rankRows = rows
				.filter((row) => row.rank === rank)
				.map((row) => ({
					...row,
					name: row.name || this.#nameByKey[row.key] || row.key,
					purchased: ledger.filter(
						(entry) =>
							entry.type === row.type &&
							entry.key === row.key &&
							entry.rank === row.rank,
					).length,
					remaining: multiplierRemaining(row, ledger),
					affordable: row.cost <= pool,
					prereqText: row.prerequisites.filter(Boolean).join(", "),
					prereqList: row.prerequisites.join("|"),
					ledgerIndex: ledger.findIndex(
						(entry) =>
							entry.type === row.type &&
							entry.key === row.key &&
							entry.rank === row.rank,
					),
				}));
			if (rankRows.length > 0) {
				rankGroups.push({
					rank,
					xpLevel: thresholds.find((t) => t.rank === rank)?.xpLevel ?? 0,
					spentOnRank: spentOnRank(ledger, rank),
					rows: rankRows,
				});
			}
		}

		context.pool = pool;
		context.spent = spent;
		context.rank = derived;
		context.systemRank = system.rank ?? 1;
		context.rankUp = derived > (system.rank ?? 1);
		context.progress = progress;
		context.rankGroups = rankGroups;
		context.canBuy = pool > 0 && Boolean(this.#career);
		context.isGM = isGM === true;
		context.hasCareer = Boolean(this.#career);
		return context;
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
		const system = this.actor.system as unknown as Character;
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const scheme = this.#career.characteristicAdvances[key];
		if (!scheme) return;
		const purchased = ledger.filter(
			(entry) => entry.type === "characteristic" && entry.characteristic === key,
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
		ui.notifications?.info(
			game.i18n!.format("ADVANCE.BOUGHT", {
				name: `${game.i18n!.localize(`CHARACTERISTIC.${key.toUpperCase()}`)} +5 (${next.tier})`,
				cost: String(next.cost),
			}),
		);
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
		await this.#buyRow(row);
	}

	async #buyRow(row: AdvanceRowLike): Promise<void> {
		if (!this.#career) return;
		const system = this.actor.system as unknown as Character;
		const ledger = (system.advances ?? []) as AdvanceLedgerEntry[];
		const spent = totalSpent(ledger);
		const pool = Math.max(0, (system.xp?.total ?? 0) - spent);
		const thresholds: RankThresholdLike[] = this.#career.ranks.map((r) => ({
			rank: r.rank,
			xpLevel: r.xpLevel,
		}));
		const validation = validatePurchase(row, {
			spent,
			pool,
			ledger,
			derivedRank: derivedRank(thresholds, spent),
		});
		if (!(await this.#confirmReasons(validation.reasons))) return;

		const entry = ledgerEntryFor(row, this.#career.key);
		const updates: Record<string, unknown> = {
			advances: [...ledger, entry],
		};

		if (row.type === "skill") {
			const applied = await this.#applySkillAdvance(row);
			if (!applied) return;
		} else if (
			row.key === "psy-rating" ||
			/^psy rating/i.test(row.name)
		) {
			// Psy Rating advance (bead m4me): raises the actor's Psy Rating by
			// 1 instead of granting a talent item (the rating lives on the
			// actor, rt_core p182 psykers).
			const system = this.actor.system as unknown as Character;
			await this.actor.update({
				system: { psyRating: (system.psyRating ?? 0) + 1 },
			} as never);
		} else {
			// Talent: idempotent grant by name (matching the talent picker).
			const owned = this.actor.items.find(
				(item) => (item.type as string) === "talent" && item.name === row.name,
			);
			if (!owned) {
				await this.actor.createEmbeddedDocuments("Item", [
					{ name: row.name, type: "talent", system: {} },
				] as never);
			}
		}

		const nextLedger = [...ledger, entry];
		updates.xp = { spent: totalSpent(nextLedger) };
		// p38: the Rank rises automatically once the threshold is crossed.
		const derived = derivedRank(thresholds, totalSpent(nextLedger));
		if (derived > (system.rank ?? 1)) {
			updates.rank = derived;
			ui.notifications?.info(
				game.i18n!.format("ADVANCE.RANK_UP", { rank: String(derived) }),
			);
		}
		await this.actor.update({ system: updates } as never);
		ui.notifications?.info(
			game.i18n!.format("ADVANCE.BOUGHT", {
				name: row.name,
				cost: String(row.cost),
			}),
		);
		this.render({ force: true } as never);
	}

	/** Skill advance: bump the ladder of an owned skill, or grant it. */
	async #applySkillAdvance(row: AdvanceRowLike): Promise<boolean> {
		// Owned match by pack key first, then by exact name.
		const owned =
			this.actor.items.find(
				(item) =>
					(item.type as string) === "skill" &&
					(item.system as unknown as { key?: string }).key === row.key,
			) ??
			this.actor.items.find(
				(item) => (item.type as string) === "skill" && item.name === row.name,
			);
		if (owned) {
			const system = owned.system as unknown as { ladder: number };
			const ladder = Math.min(4, (system.ladder ?? 1) + 1);
			if (ladder === (system.ladder ?? 1)) return true; // already maxed
			await owned.update({ system: { ladder } });
			return true;
		}
		// New skill: clone the pack doc's characteristic.
		const doc = this.#skillDocs.find((d) => d.key === row.key) ??
			this.#skillDocs.find((d) => d.name === row.name);
		await this.actor.createEmbeddedDocuments("Item", [
			{
				name: row.name,
				type: "skill",
				system: { characteristic: doc?.characteristic ?? "int", ladder: 1 },
			},
		] as never);
		return true;
	}

	/** GM refund: remove the newest matching ledger entry. */
	static async #onRefund(
		this: AdvancementDialog,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index ?? -1);
		if (index < 0) return;
		const system = this.actor.system as unknown as Character;
		const ledger = [...((system.advances ?? []) as AdvanceLedgerEntry[])];
		const [removed] = ledger.splice(index, 1);
		if (!removed) return;
		await this.actor.update({
			system: {
				advances: ledger,
				xp: { spent: totalSpent(ledger) },
			},
		} as never);
		ui.notifications?.info(
			game.i18n!.format("ADVANCE.REFUNDED", { name: removed.name, cost: String(removed.cost) }),
		);
		this.render({ force: true } as never);
	}
}
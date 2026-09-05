import { Character } from "../../data/actor/character";
import type { AdvanceLedgerEntry } from "../../rules/advancement";
import { derivedRank, totalSpent } from "../../rules/advancement";
import { careers, equipStates } from "../../registry";
import { effectiveMechanics, originByKey } from "../../origins";
import {
	resolveOriginTraits,
	traitDefKey,
} from "../../rules/origin-traits";
import {
	corruptionTrack,
	dueDisorders,
	insanityTrack,
	malignancyTestsDue,
} from "../../rules/madness";
import type { Modifier } from "../../rules-engine/src/modifier";
import {
	rollNavigatorPower,
	rollPsychicPower,
	rollSkill,
	rollSkillUntrained,
	rollTest,
	rollWeaponAttack,
	rollWeaponDamage,
	toggleSustainedPower,
} from "../../rules/adapter";
import { defaultSkillItems } from "../../rules/default-skills";
import { fatigueThreshold, woundsMax } from "../../rules/derived";
import { deriveCapacity, resolveEncumbrance, carriedWeight } from "../../rules/encumbrance";
import { getSkillCatalog } from "./skill-catalog";
import { openDocumentSheet, resolvePackDocument } from "../pack-resolve";
import { AdvancementDialog } from "./advancement-dialog";
import { PsychicPicker } from "./psychic-picker";
import { SkillPicker } from "./skill-picker";
import { TalentPicker } from "./talent-picker";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

interface CharacteristicView {
	key: string;
	label: string;
	value: number;
	bonus: number;
	effectiveBonus: number;
	unnatural: number;
	bonusTooltip: string;
	unnaturalTooltip: string;
	pips: Array<{ value: number; lit: boolean }>;
}

/** Max unnatural multiplier shown as pips. */
const MAX_UNNATURAL_STEPS = 5;

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "character"],
		position: { width: 600, height: 500 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollTest: CharacterSheet.#onRollTest,
			rollSkill: CharacterSheet.#onRollSkill,
			rollUntrained: CharacterSheet.#onRollUntrained,
			ownSkill: CharacterSheet.#onOwnSkill,
			addSkill: CharacterSheet.#onAddSkill,
			setUnnatural: CharacterSheet.#onSetUnnatural,
			setLadder: CharacterSheet.#onSetLadder,
			openItem: CharacterSheet.#onOpenItem,
			openPackItem: CharacterSheet.#onOpenPackItem,
			deleteItem: CharacterSheet.#onDeleteItem,
			rollWeapon: CharacterSheet.#onRollWeapon,
			rollDamage: CharacterSheet.#onRollDamage,
			openTalentPicker: CharacterSheet.#onOpenTalentPicker,
			toggleEquip: CharacterSheet.#onToggleEquip,
			openAdvancement: CharacterSheet.#onOpenAdvancement,
			openPsychicPicker: CharacterSheet.#onOpenPsychicPicker,
			rollPower: CharacterSheet.#onRollPower,
			toggleSustain: CharacterSheet.#onToggleSustain,
			rollNavigatorPower: CharacterSheet.#onRollNavigatorPower,
			openCareerSheet: CharacterSheet.#onOpenCareerSheet,
			claimGrant: CharacterSheet.#onClaimGrant,
			rollTraumaTest: CharacterSheet.#onRollTraumaTest,
			rollMalignancyTest: CharacterSheet.#onRollMalignancyTest,
		},
	};

	static async #onOpenItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (item) item.sheet?.render(true);
	}

	/**
	 * Open the COMPENDIUM version of an item (bead oaaz): reads data-uuid
	 * (pack uuid resolved in _prepareContext), robust pack resolution per
	 * the wwuc root cause. Used by the Background tab's talent book icons.
	 */
	static async #onOpenPackItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		try {
			const item = await resolvePackDocument(uuid);
			if (!item) {
				console.warn(`rogue-trader | pack item link: "${uuid}" did not resolve`);
				return;
			}
			await openDocumentSheet(item, "pack item link");
		} catch (error) {
			console.error("rogue-trader | pack item link failed:", error);
		}
	}

	/** Delete an owned inventory item. */
	static async #onDeleteItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
	}

	/** Roll the to-hit test for a weapon on the combat tab (v1). */
	static async #onRollWeapon(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponAttack(this.actor, itemId);
	}

	/** Quick damage roll from a weapon row (no to-hit test). */
	static async #onRollDamage(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollWeaponDamage(this.actor, itemId);
	}

	static async #onOpenTalentPicker(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new TalentPicker({ actor: this.actor }).render({ force: true });
	}

	/** Open the Spend-XP advancement dialog (bead ayw/clng). */
	static async #onOpenAdvancement(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new AdvancementDialog({ actor: this.actor }).render({ force: true });
	}

	/** Open the psychic powers compendium picker (bead m4me). */
	static async #onOpenPsychicPicker(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new PsychicPicker({ actor: this.actor }).render({ force: true });
	}

	/** Activate a psychic power (bead sa6): strength prompt -> Focus Power Test. */
	static async #onRollPower(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollPsychicPower(this.actor, itemId);
	}

	/** Toggle a power's sustained state (bead sa6, book p157). */
	static async #onToggleSustain(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const row = target.closest<HTMLElement>("[data-item-uuid]");
		const uuid = row?.dataset.itemUuid;
		const name = row?.dataset.itemName;
		if (!uuid || !name) return;
		await toggleSustainedPower(this.actor, uuid, name);
	}

	/** Activate a navigator power (bead sa6, book p178): characteristic test + mastery. */
	static async #onRollNavigatorPower(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		await rollNavigatorPower(this.actor, itemId);
	}

	/** Open the compendium career item sheet (Background tab, bead ay0). */
	static async #onOpenCareerSheet(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		// Bead wwuc: trace entry so an in-world attempt distinguishes
		// "action never dispatched" from "handler ran and failed".
		console.log("[career-link] clicked, uuid =", uuid);
		if (!uuid) {
			console.warn("rogue-trader | career link: no data-uuid on the clicked element");
			return;
		}
		try {
			// ROOT CAUSE (wwuc, diagnosed in-world 2026-09-05): fromUuid on a
			// Compendium uuid resolved to undefined even though the pack held
			// the document (pack getDocuments matched by system.key) — so the
			// old `item.sheet?.render({})` silently no-oped. Direct pack
			// resolution (sheet/pack-resolve.ts), fromUuid as fallback.
			const item = await resolvePackDocument(uuid);
			if (!item) {
				ui.notifications?.error(
					game.i18n!.format("BACKGROUND.OPEN_CAREER_FAIL", { uuid }),
				);
				console.warn(`rogue-trader | career link: "${uuid}" did not resolve`);
				return;
			}
			await openDocumentSheet(item, "career link");
		} catch (error) {
			// Surface render failures visibly instead of dying silently —
			// CareerSheet._prepareContext errors land here.
			console.error("rogue-trader | career link failed:", error);
			ui.notifications?.error(
				game.i18n!.format("BACKGROUND.OPEN_CAREER_FAIL", { uuid }),
			);
		}
	}

	/**
	 * Claim a pending origin grant (bead tgq9): free-skill grants open the
	 * skill picker; claiming persists in system.origins.claims. Non-resolvable
	 * grants (bionic/heirloom) only mark acknowledged so the chip stops
	 * prompting — the underlying system still has to be built.
	 */
	static async #onClaimGrant(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key) return;
		const system = this.actor.system as unknown as {
			origins?: { claims?: Record<string, boolean> };
		};
		const claims = { ...(system.origins?.claims ?? {}), [key]: true };
		await this.actor.update({
			system: { origins: { claims } },
		} as never);
		if (target.dataset.resolvable === "true") {
			await new SkillPicker({ actor: this.actor }).render({ force: true });
		}
		this.render({ force: true } as never);
	}

	/**
	 * Trauma Test (epic 1g2t, p296): Willpower test modified by the Insanity
	 * Track; on failure the GM rolls d100 + 10/degree of failure on Table 10-6
	 * (the chat card shows the full modifier breakdown).
	 */
	static async #onRollTraumaTest(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		const system = this.actor.system as unknown as {
			insanity?: number;
		};
		const rows = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { madness?: { getRows?: () => unknown[] } };
			}
		).ROGUE_TRADER?.madness?.getRows?.() ?? [];
		const track = insanityTrack(rows as never, system.insanity ?? 0);
		const modifiers: Modifier[] = track.modifier
			? [{
					id: "trauma:track",
					source: { type: "item", label: "MADNESS.TRAUMA_MODIFIER" },
					label: `${track.degree}`,
					value: track.modifier,
				}]
			: [];
		await rollTest(this.actor, "wp", { modifiers });
	}

	/**
	 * Malignancy Test (epic 1g2t, p299): Willpower test modified by the
	 * Corruption Track; on failure roll on the Malignancies table (manual/GM).
	 */
	static async #onRollMalignancyTest(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		const system = this.actor.system as unknown as {
			corruption?: number;
		};
		const rows = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { madness?: { getRows?: () => unknown[] } };
			}
		).ROGUE_TRADER?.madness?.getRows?.() ?? [];
		const track = corruptionTrack(rows as never, system.corruption ?? 0);
		const modifiers: Modifier[] = track.modifier
			? [{
					id: "malignancy:track",
					source: { type: "item", label: "MADNESS.MALIGNANCY_MODIFIER" },
					label: `${track.degree}`,
					value: track.modifier,
				}]
			: [];
		await rollTest(this.actor, "wp", { modifiers });
	}

	/**
	 * Toggle the equip state of an inventory item: stowed -> carried (or worn
	 * for armour); any ready state -> stowed.
	 */
	static async #onToggleEquip(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId =
			target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const type = item.type as string;
		if (
			!["weapon", "melee-weapon", "ranged-weapon", "armour", "gear"].includes(
				type,
			)
		)
			return;
		const current =
			(item.system as unknown as { equipState?: string }).equipState ??
			"stowed";
		const readyState = type === "armour" ? "worn" : "carried";
		const next = current === readyState ? "stowed" : readyState;
		await item.update({ system: { equipState: next } });
	}

	/**
	 * Click a characteristic to roll it.
	 */
	static async #onRollTest(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		if (!key) return;
		await rollTest(this.actor, key, { skipDialog: false });
	}

	static async #onRollSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await rollSkill(this.actor, itemId, { skipDialog: false });
	}

	static async #onRollUntrained(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const key = target.dataset.characteristic;
		if (!name || !key) return;
		await rollSkillUntrained(this.actor, name, key);
	}

	/** Lazy-own: create the catalog skill item at the requested ladder. */
	static async #onOwnSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const characteristic = target.dataset.characteristic;
		// Template attribute is data-value on ladder buttons (see skills.hbs).
		const ladder = Number(target.dataset.value);
		if (!name || !characteristic || Number.isNaN(ladder)) return;
		await this.actor.createEmbeddedDocuments("Item", [
			{ name, type: "skill", system: { characteristic, ladder } },
		]);
	}

	static async #onAddSkill(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await new SkillPicker({ actor: this.actor }).render({ force: true });
	}

	static async #onSetLadder(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		const value = Number(target.dataset.value);
		if (!itemId || Number.isNaN(value)) return;
		const item = this.actor.items.get(itemId);
		if (!item) return;
		const current = (item as { system?: { ladder?: number } }).system?.ladder;
		// Click-to-own toggle (bead tnw): clicking the skill's active ladder
		// again removes it (no separate trash icon on the row).
		if (current === value) {
			await item.delete();
			return;
		}
		await item.update({ system: { ladder: value } });
	}

	/** Set the unnatural multiplier from a clicked pip; clicking the last lit pip resets to natural. */
	static async #onSetUnnatural(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.key;
		const value = Number(target.dataset.value);
		if (!key || Number.isNaN(value)) return;
		const current =
			(this.actor.system as unknown as Character).characteristics[key]
				?.unnatural ?? 1;
		const next = current === value ? 1 : value;
		await this.actor.update({
			system: { characteristics: { [key]: { unnatural: next } } },
		});
	}

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/actor/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		stats: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/stats.hbs",
		},
		combat: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/combat.hbs",
		},
		inventory: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/inventory.hbs",
		},
		background: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/background.hbs",
		},
		skills: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/skills.hbs",
		},
		psychic: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/psychic.hbs",
		},
		notes: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/notes.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.STATS" },
				{ id: "combat", group: "primary", label: "TAB.COMBAT" },
				{ id: "skills", group: "primary", label: "TAB.SKILLS" },
				{ id: "background", group: "primary", label: "TAB.BACKGROUND" },
				{ id: "psychic", group: "primary", label: "TAB.PSYCHIC" },
				{ id: "inventory", group: "primary", label: "TAB.INVENTORY" },
				{ id: "notes", group: "primary", label: "TAB.NOTES" },
			],
			initial: "data",
		},
	};

	/**
	 * The psychic tab renders only for psykers (bead m4me): Navigators count
	 * (rt_core p182) and anyone with a Psy Rating. Mundane characters never
	 * see the tab in the nav nor the section.
	 */
	protected override _prepareTabs(
		group: string,
	): Record<string, foundry.applications.api.ApplicationV2.Tab> {
		const tabs = super._prepareTabs(group);
		const system = this.actor.system as unknown as Character;
		if (!(system.psyker === true || (system.psyRating ?? 0) >= 1)) {
			delete tabs.psychic;
		}
		return tabs;
	}

	/**
	 * Inventory rows carry their item uuid; drag transfers core {type, uuid}
	 * data so rows can be dropped onto other sheets/hotbars.
	 */
	protected _onDragStart(event: DragEvent): void {
		const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			"[data-item-uuid]",
		);
		if (!row?.dataset.itemUuid) return;
		event.dataTransfer?.setData(
			"text/plain",
			JSON.stringify({ type: "Item", uuid: row.dataset.itemUuid }),
		);
	}

	/**
	 * Drop an external Item onto the inventory to copy it into the actor.
	 * Drops of uuids already owned are no-ops (reordering comes later).
	 */
	protected async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(event) as {
			type?: string;
			uuid?: string;
		};
		if (data.type !== "Item" || !data.uuid) return;
		const source = await foundry.utils.fromUuid(data.uuid);
		if (!(source instanceof foundry.documents.Item)) return;
		if (this.actor.items.find((item) => item.uuid === source.uuid)) return;
		return this.actor.createEmbeddedDocuments("Item", [source.toObject()]);
	}

	/**
	 * Lazy default-skill backfill: a pc/npc opened with zero skills receives
	 * the catalog's common skills. Belt-and-braces with the createActor hook:
	 * both paths use the same pure grant and are guarded to no-op once any
	 * item exists. Covers actors created before the feature existed.
	 */
	async #ensureDefaultSkills(): Promise<void> {
		if (this.actor.items.size > 0) return;
		if (this.actor.type !== "pc" && this.actor.type !== "npc") return;
		const pack = game.packs.get("rogue-trader.skills");
		if (!pack) return;
		const documents = (await pack.getDocuments()) as foundry.documents.Item[];
		const grants = defaultSkillItems(
			documents.map(
				(doc) =>
					doc.toObject() as {
						type: string;
						name: string;
						system: {
							common?: boolean;
							characteristic: string;
							ladder: number;
						};
					},
			),
		);
		if (grants.length === 0 || this.actor.items.size > 0) return;
		await this.actor.createEmbeddedDocuments("Item", grants);
	}

	async _prepareContext(options: { isFirstRender: boolean }) {
		await this.#ensureDefaultSkills();
		const context = (await super._prepareContext(options)) as Record<
			string,
			unknown
		>;
		const system = this.actor.system as Character;

		// Career picker (bead 0ib): choices from the careers registry; the
		// read-only label resolves via the registry so homebrew careers work.
		context.careerLabel = system.careerKey
			? (careers.get(system.careerKey) ?? system.careerKey)
			: "";

		// Advancement (bead ayw): derived rank from the career's xpLevel
		// thresholds + the ledger, shown as a tooltip hint next to the
		// stored rank; the Advancement dialog is the purchase path.
		// Advancement button tooltip: derived-rank hint when available, else
		// the generic open label (header.hbs must stay parseable — no inline
		// || expressions with nested quotes, see character-sheet render error).
		context.advancementTooltip = game.i18n!.localize("ADVANCE.OPEN");
		if (system.careerKey) {
			const pack = game.packs?.get("rogue-trader.careers");
			if (pack) {
				const docs = (await pack.getDocuments()) as unknown as Array<{
					system: {
						key: string;
						ranks?: Array<{ rank: number; xpLevel: number }>;
					};
				}>;
				const careerDoc = docs.find((d) => d.system.key === system.careerKey);
				const thresholds = (careerDoc?.system.ranks ?? []).map((r) => ({
					rank: r.rank,
					xpLevel: r.xpLevel,
					}));
				if (thresholds.length > 0) {
					const derived = derivedRank(
						thresholds,
						totalSpent((system.advances ?? []) as AdvanceLedgerEntry[]),
					);
					if (derived) {
						context.rankTooltip = game.i18n!.format("ADVANCE.RANK_HINT", {
							rank: String(derived),
						});
						context.advancementTooltip = context.rankTooltip;
					}
				}
			}
		}

		// XP (owner cull): spent is DISPLAY-ONLY, derived from the
		// advancement ledger (totalSpent) — manual editing desynced the pool
		// from the ledger; the Advancement dialog is the purchase path. The
		// lifetime total stays editable.
		context.xpSpent = totalSpent((system.advances ?? []) as AdvanceLedgerEntry[]);
		context.xpTotal = system.xp?.total ?? 0;

		context.characteristics = Object.entries(system.characteristics).map(
			([key, data]): CharacteristicView => {
				const bonus = system.characteristicBonus(key);
				const effectiveBonus = system.effectiveCharacteristicBonus(key);
				return {
					key,
					label: `CHARACTERISTIC.${key.toUpperCase()}`,
					value: data.value,
					unnatural: data.unnatural,
					bonus,
					effectiveBonus,
					bonusTooltip: game.i18n.format("CHARACTER.BONUS_TOOLTIP", {
						bonus: data.unnatural > 1 ? effectiveBonus : bonus,
					}),
					unnaturalTooltip: game.i18n.format("CHARACTER.UNNATURAL_TOOLTIP", {
						mult: data.unnatural,
					}),
					pips: Array.from({ length: MAX_UNNATURAL_STEPS }, (_, i) => {
						const mult = i + 2; // pip 1 = x2
						return { value: mult, lit: data.unnatural >= mult };
					}),
				};
			},
		);

		const ownedSkills = this.actor.items.filter(
			(item) => item.type === "skill",
		);
		const ladderOptions = [
			{ value: 1, label: "SKILL.LADDER_KNOWN" },
			{ value: 2, label: "SKILL.LADDER_PLUS_10" },
			{ value: 3, label: "SKILL.LADDER_PLUS_20" },
		];
		const catalog = await getSkillCatalog();
		const ownedNames = new Set(ownedSkills.map((item) => item.name));
		const catalogByChar = new Map<
			string,
			Awaited<ReturnType<typeof getSkillCatalog>>
		>();
		for (const entry of catalog) {
			const list = catalogByChar.get(entry.characteristic) ?? [];
			list.push(entry);
			catalogByChar.set(entry.characteristic, list);
		}

		context.skillGroups = Object.keys(
			(system.characteristics ?? {}) as Record<string, unknown>,
		).map((key) => {
			const label = `CHARACTERISTIC.${key.toUpperCase()}`;
			const rows = ownedSkills
				.filter(
					(item) =>
						(item.system as unknown as { characteristic: string })
							.characteristic === key,
				)
				.map((item) => ({
					owned: true,
					id: item.id,
					name: item.name,
					advanced:
						(item.system as unknown as { advanced?: boolean }).advanced ===
						true,
					ladder: (item.system as unknown as { ladder: number }).ladder,
					ladderOptions,
				}));
			for (const entry of catalogByChar.get(key) ?? []) {
				if (ownedNames.has(entry.name)) continue;
				rows.push({
					owned: false,
					id: entry.id,
					name: entry.name,
					advanced: entry.advanced,
					ladder: 0,
					ladderOptions,
				});
			}
			rows.sort((a, b) => a.name.localeCompare(b.name));
			return { key, label, skills: rows };
		});

		context.isPC = this.actor.type === "pc";

		// Psychic tab (bead m4me): owned powers + psyker status; the tab nav
		// itself is gated in _prepareTabs.
		context.isPsyker =
			system.psyker === true || (system.psyRating ?? 0) >= 1;
		context.psyRating = system.psyRating ?? 0;
		const sustained = new Set(
			(system.sustainedPowers ?? []).map((p) => p.itemUuid),
		);
		context.psychicPowers = this.actor.items
			.filter((item) => (item.type as string) === "psychicpower")
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
			.map((item) => {
				const sys = item.system as unknown as {
					powerClass?: string;
					subtype?: string;
					rating?: number;
				};
				return {
					id: item.id,
					uuid: item.uuid,
					name: item.name,
					powerClass: sys.powerClass ?? "bound",
					classLabel: `PSYCHIC_POWER.${(sys.powerClass ?? "bound").toUpperCase()}`,
					subtype: sys.subtype ?? "focus",
					subtypeLabel: `PSYCHIC_POWER.${(sys.subtype ?? "focus").toUpperCase()}`,
					rating: sys.rating ?? 0,
					// Bead sa6: sustained-powers affordance (book p157 — the
					// sustain modifiers flow through rules/psychic.ts).
					sustained: sustained.has(item.uuid),
				};
			});
		// Navigator powers (bead sa6, Ch. VII): plain characteristic test with
		// mastery bonus — same tab, distinct section (owner fold-in decision).
		context.navigatorPowers = this.actor.items
			.filter((item) => (item.type as string) === "navigatorpower")
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
			.map((item) => {
				const sys = item.system as unknown as {
					mastery?: string;
				};
				return {
					id: item.id,
					name: item.name,
					mastery: sys.mastery ?? "novice",
					masteryLabel: `NAVIGATOR_POWER.${(sys.mastery ?? "novice").toUpperCase()}`,
				};
			});

		// Inventory: all non-skill owned items grouped by family. Weight display
		// only - aggregation/encumbrance is deliberately NOT calculated here yet.
		const byType = (types: string[]) =>
			this.actor.items
				.filter((item) => types.includes(item.type as string))
				.map((item) => {
					const equipState = (item.system as unknown as { equipState?: string })
						.equipState;
					const type = item.type as string;
					// Localized label computed here (not via a template concat):
					// module-registered states resolve through the registry when
					// present, core states via the lang keys.
					const stateKey = equipState ?? "stowed";
					const registryLabel = equipStates.get(stateKey);
					const label = registryLabel
						? game.i18n!.localize(registryLabel)
						: stateKey;
					return {
						id: item.id,
						name: item.name,
						uuid: item.uuid,
						weight: (item.system as unknown as { weight?: number }).weight ?? 0,
						equipState: stateKey,
						equipStateLabel: label,
						equipped: equipState === "carried" || equipState === "worn",
						// Weapons get the inline attack/damage roll button.
						isWeapon: type === "melee-weapon" || type === "ranged-weapon",
					};
				});
		const inventory: Array<{
			label: string;
			items: Array<{
				id: string | null;
				name: string | null;
				uuid: string;
				weight: number;
				equipState: string;
				equipStateLabel: string;
				equipped: boolean;
			}>;
			addLabel?: string;
			addAction?: string;
		}> = [
			{
				label: "WEAPON.HEADER",
				items: byType(["melee-weapon", "ranged-weapon"]),
			},
			{ label: "ARMOUR.HEADER", items: byType(["armour"]) },
			{ label: "GEAR.HEADER", items: byType(["gear"]) },
		];

		// Armour: highest AP per body location across WORN armour items (bead
		// yb6 equip-state model: stowed armour contributes nothing, matching
		// the adapter's wornArmour filter in the damage pipeline).
		const armourItems = this.actor.items.filter(
			(item) =>
				(item.type as string) === "armour" &&
				(item.system as unknown as { equipState?: string }).equipState ===
					"worn",
		);
		const LOCATIONS = [
			"head",
			"left-arm",
			"body",
			"right-arm",
			"left-leg",
			"right-leg",
		] as const;
		context.armourLocations = Object.fromEntries(
			LOCATIONS.map((loc) => {
				const ap = Math.max(
					0,
					...armourItems.map((item) =>
						(
							item.system as unknown as { armourAt(loc: string): number }
						).armourAt(loc),
					),
				);
				return [loc, { ap }];
			}),
		);

		// Combat tab: weapons from inventory with visible stats (display only;
		// roll buttons land with the roll-damage adapter work).
		context.weapons = this.actor.items
			.filter(
				(item) => item.type === "melee-weapon" || item.type === "ranged-weapon",
			)
			.map((item) => {
				const sys = item.system as unknown as {
					class: string;
					damage?: string;
					penetration?: number;
					clip?: number;
					rateOfFire?: {
						singleShot: boolean;
						burst: number;
						fullAuto: number;
					};
				};
				const isRanged = item.type === "ranged-weapon";
				return {
					id: item.id,
					name: item.name,
					classLabel: `CLASS.${(sys.class ?? "melee").toUpperCase()}`,
					damage: sys.damage || "\u2013",
					penetration: sys.penetration ?? 0,
					isRanged,
					rof: {
						singleShot: sys.rateOfFire?.singleShot ? "S" : "\u2013",
						burst: sys.rateOfFire?.burst || "\u2013",
						fullAuto: sys.rateOfFire?.fullAuto || "\u2013",
					},
					clip: sys.clip ?? 0,
				};
			})
			.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

		context.inventory = inventory;

		// Consolidated Background tab (bead ay0): origins + career + talents.
		context.talentRows = byType(["talent"]);
		// Compendium link per talent row (bead oaaz): pack uuid by name
		// (case-insensitive), same careers-pack pattern as careerItemId above.
		const talentsPack = game.packs?.get("rogue-trader.talents");
		if (talentsPack && context.talentRows.length > 0) {
			const packDocs = (await talentsPack.getDocuments()) as unknown as Array<{
				uuid?: string;
				name?: string;
			}>;
			const byName = new Map(
				packDocs
					.filter((d) => d.name)
					.map((d) => [d.name!.toLowerCase(), d.uuid ?? ""]),
			);
			for (const row of context.talentRows as Array<
				Record<string, unknown> & { name?: string; packUuid?: string }
			>) {
				row.packUuid = row.name
					? (byName.get(row.name.toLowerCase()) ?? "")
					: "";
			}
		}

		// Origins: persisted picks (creator) resolved against the origin chart;
		// tooltip carries the verbatim book effect text.
		const originPicks = system.origins ?? {} as {
			homeWorld?: string;
			birthright?: string;
			lure?: string;
			trials?: string;
			motivation?: string;
		};
		const splitPick = (stored?: string) => {
			if (!stored) return null;
			const [key, variantKey] = stored.split("|");
			const entry = originByKey(key);
			if (!entry) return null;
			const variant = variantKey
				? entry.variants?.find((v) => v.key === variantKey)
				: undefined;
			const mods = effectiveMechanics(entry, variantKey).characteristics ?? [];
			return {
				name: variant ? `${entry.name}: ${variant.name}` : entry.name,
				tooltip: variant?.effect ?? entry.effect ?? "",
				mods: mods.map((m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`),
			};
		};
		const originRows: Array<{
			labelKey: string;
			pick: { name: string; tooltip: string; mods: string[] } | null;
		}> = (
			[
				["homeWorld", "ORIGIN.ROW_HOME_WORLD"],
				["birthright", "ORIGIN.ROW_BIRTHRIGHT"],
				["lure", "ORIGIN.ROW_LURE"],
				["trials", "ORIGIN.ROW_TRIALS"],
				["motivation", "ORIGIN.ROW_MOTIVATION"],
			] as Array<[string, string]>
		)
			.map(([field, labelKey]) => ({
				field,
				labelKey,
				pick: splitPick(
					(originPicks as Record<string, string | undefined>)[field],
				),
			}))
			.filter((row) => row.pick !== null);
		context.originRows = originRows;
		context.hasOrigins = originRows.length > 0;

		// Dynasty link (owner redesign): characters attach to the group's
		// dynasty actor; PF/SP live there. Picker lists all dynasty actors.
		context.dynastyUuid = system.dynastyUuid ?? "";
		context.dynastyOptions = ((game.actors ?? []) as unknown as {
			contents: Array<{
				type?: string;
				uuid: string;
				name?: string;
				system?: { profitFactor?: number };
			}>;
		}).contents
			.filter((a) => a.type === "dynasty")
			.map((a) => ({
				uuid: a.uuid,
				name: a.name ?? "",
				label: a.system?.profitFactor !== undefined ? `${a.name} (PF ${a.system.profitFactor})` : (a.name ?? ""),
				selected: system.dynastyUuid === a.uuid,
			}));

		// Origin traits (bead tgq9): modifier/grant/note resolution from the
		// cached pack defs; grants carry claim state, free-skill grants resolve
		// via the skill picker.
		const traitDefs = (
			CONFIG as unknown as {
				ROGUE_TRADER?: {
					originTraits?: { getDefs?: () => unknown[] };
				};
			}
		).ROGUE_TRADER?.originTraits?.getDefs?.() ?? [];
		const traitResolution = resolveOriginTraits(
			originPicks as never,
			traitDefs as never,
		);
		context.traitModifiers = traitResolution.modifiers.map((t) => ({
			name: t.def.name,
			value: t.def.value,
			testKeyLabel: t.def.testKey ? t.def.testKey.toUpperCase() : "",
			tooltip: t.def.text,
		}));
		context.traitGrants = traitResolution.grants.map((t) => ({
			key: `${t.def.originKey}.${t.def.traitKey}`,
			name: t.def.name,
			claimed: t.claimed,
			resolvable: t.def.grantKind === "free-skill" || t.def.grantKind === "extra-common-lore",
			tooltip: t.def.text,
		}));
		context.traitNotes = traitResolution.notes.map((t) => ({
			name: t.def.name,
			tooltip: t.def.text,
		}));
		context.hasTraits =
			traitResolution.modifiers.length +
				traitResolution.grants.length +
				traitResolution.notes.length >
			0;

		// Career link: the compendium career item behind the actor's careerKey,
		// opened via openCareerSheet for the full crunch tables. Diagnostic log
		// when the lookup fails (bead qwp6) — pack missing, or key mismatch.
		const careerPack = game.packs?.get("rogue-trader.careers");
		if (careerPack && system.careerKey) {
			const docs = (await careerPack.getDocuments()) as unknown as Array<{
				uuid?: string;
				system: { key: string };
			}>;
			const careerDoc = docs.find((d) => d.system.key === system.careerKey);
			if (!careerDoc) {
				console.warn(
					`rogue-trader | no career doc with system.key "${system.careerKey}" in rogue-trader.careers`,
				);
			}
			context.careerItemId = careerDoc?.uuid ?? "";
		} else {
			if (!careerPack) {
				console.warn("rogue-trader | careers pack not registered (game.packs)");
			}
			context.careerItemId = "";
		}

		// Encumbrance: carried weight vs capacity derived from Strength Bonus
		// (rules/encumbrance.ts deriveCapacity, VERIFY book rule). Only READY
		// items count (bead yar): carried weapons/gear, worn armour.
		const carried = carriedWeight([
			...byType(["melee-weapon", "ranged-weapon"]),
			...byType(["armour"]),
			...byType(["gear"]),
		]);
		const capacity = deriveCapacity(system.characteristicBonus("s"));
		context.encumbrance = resolveEncumbrance(carried, capacity);
		// Derived values (read-only): definitional + rules-layer, no writeback.
		context.derived = {
			...system.movement(),
			initiative: system.initiativeBonus(),
			woundsMax: woundsMax(
				system,
				this.actor.items.map((item) => ({
					type: item.type,
					system: item.system as never,
				})),
			),
			fatigueMax: fatigueThreshold(system),
		};

		// Madness tracks (epic 1g2t): degrees + test modifiers from the cached
		// madness pack; affliction ledger for display.
		const madnessRows = (
			CONFIG as unknown as {
				ROGUE_TRADER?: {
					madness?: { getRows?: () => unknown[] };
				};
			}
		).ROGUE_TRADER?.madness?.getRows?.() ?? [];
		const insanity = insanityTrack(madnessRows as never, system.insanity ?? 0);
		const corr = corruptionTrack(madnessRows as never, system.corruption ?? 0);
		context.madness = {
			insanityDegree: insanity.degree,
			insanityModifier: insanity.modifier,
			corruptionDegree: corr.degree,
			corruptionModifier: corr.modifier,
			dueDisorders: dueDisorders(system.insanity ?? 0, (system.afflictions ?? []) as never),
			afflictions: (system.afflictions ?? []) as unknown as Array<{
				kind: string;
				name: string;
				severity?: string;
				text?: string;
			}>,
		};

		const enrich = (text: string) =>
			foundry.applications.ux.TextEditor.enrichHTML(text, {
				secrets: this.actor.isOwner,
				relativeTo: this.actor,
			});
		context.descriptionHTML = await enrich(system.description);
		// Notes tab: motivation is rich text (owner request; appearance was
		// culled — the description field covers it).
		context.motivationHTML = await enrich(system.life?.motivation ?? "");

		return context;
	}
}

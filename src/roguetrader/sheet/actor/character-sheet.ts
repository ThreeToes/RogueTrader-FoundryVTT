import { Character } from "../../data/actor/character";
import {
	equipStateOf,
	isWeaponType,
	systemOf,
} from "../../data/accessors";
import { sheetContext } from "../context";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { getCharacterOptionDocs, getPackDocuments } from "../pack-resolve";
import { waitForDefaultGrants } from "../default-grants";
import type { AdvanceLedgerEntry } from "../../rules/advancement";
import { derivedRank, totalSpent } from "../../rules/advancement";
import { careers, equipStates, sorceryRanks } from "../../registry";
import { collectSorceryRank } from "../../rules/talent-effects";
import { actorView } from "../../infrastructure/foundry/actor-view";
import { criticalSheetContext } from "../../rules/criticals";
import { rollBattlesuitRepair } from "../../rules/battlesuit-repair";
import { effectiveSorceryRank } from "../../rules/casting";
import {
	effectiveMechanics,
	originByKey,
	ORIGIN_ROW_LABEL_KEYS,
	ORIGIN_ROW_ORDER,
	storedOriginPicks,
} from "../../rules/origins";
import {
	resolveOriginTraits,
} from "../../rules/origin-traits";
import {
	corruptionTrack,
	dueDisorders,
	insanityTrack,
	madnessSheetContext,
	type MadnessPoints,
	type OwnedAfflictionLike,
} from "../../rules/madness";
import type { Modifier } from "../../../rules-engine/src/modifier";
import {
	performRoll,
	rollSnapOut,
	rollWeaponDamage,
	toggleSustainedPower,
} from "../../rules/adapter";
import { missingSkillGrants } from "../../rules/default-skills";
import {
	applyAfflictionProcedure,
	type ProcedureGrant,
	resolveAfflictionGrants,
	resolveEffectValues,
} from "../../rules/afflictions";
import { postCard } from "../../rules/chat-flags";
import type { MutationRow } from "../../data/item/mutation-roll";
import type { EffectData } from "../../data/item/effects";
import { fatigueThreshold, woundsMax } from "../../rules/derived";
import { actorEncumbrance } from "../../rules/encumbrance";
import { getSkillCatalog } from "./skill-catalog";
import {
	buildCharacteristicViews,
	mergeOwnedAndCatalogRows,
	type OwnedSkillLike,
} from "../skills-domain";
import {
	openDocumentSheet,
	openPackItemAction,
	resolvePackDocument,
} from "../pack-resolve";
import { AdvancementDialog } from "./advancement-dialog";
import { PsychicPicker } from "./psychic-picker";
import { SkillPicker } from "./skill-picker";
import { TalentPicker } from "./talent-picker";

// (CharacteristicView, MAX_UNNATURAL_STEPS moved to sheet/skills-domain — bead 6l90)

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
			grantTrait: CharacterSheet.#onGrantTrait,
			rollTraumaTest: CharacterSheet.#onRollTraumaTest,
			rollMalignancyTest: CharacterSheet.#onRollMalignancyTest,
			snapOut: CharacterSheet.#onSnapOut,
			repairBattlesuit: CharacterSheet.#onRepairBattlesuit,
		},
	};

	/**
	 * Battlesuit repair (Tau Character Guide p31): rolls the Hard (-20) Tech-Use
	 * or Trade (Armourer) Test through the normal skill path and applies its
	 * Degrees of Success — one effect plus one per Degree, nothing on a failure.
	 */
	static async #onRepairBattlesuit(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await rollBattlesuitRepair(this.actor);
	}

	/** "Snap out of it" (p296, bead q1ql): success ends the condition. */
	static async #onSnapOut(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await rollSnapOut(this.actor);
	}

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
	 * Thin wrapper over the shared action (bead kwm9 — NpcSheet uses it too).
	 */
	static #onOpenPackItem(
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		return openPackItemAction(_event, target);
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
		await performRoll({
			kind: "weapon",
			actor: this.actor,
			itemId,
		});
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
		await performRoll({
			kind: "psychic",
			actor: this.actor,
			itemId,
		});
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
		await performRoll({
			kind: "navigator",
			actor: this.actor,
			itemId,
		});
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
	 * Add a trait/talent granted by an owned affliction (epic nt8k): the
	 * "grants-item" effect names a pack-qualified item ("traits:Fear",
	 * "talents:Iron Jaw"); the click copies that pack entry onto the actor and
	 * writes the verbatim benefit/rating into the trait's `benefit` field. The
	 * pack lookup is the only reason this is async. No-op when that exact
	 * trait+benefit is already owned.
	 */
	static async #onGrantTrait(
		this: {
			actor: foundry.documents.Actor;
			render?: (options?: unknown) => void;
		},
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const pack = target.dataset.pack;
		const name = target.dataset.name;
		if (!pack || !name) return;
		const benefit = target.dataset.benefit ?? "";
		const benefitOf = (item: foundry.documents.Item) =>
			(item.system as unknown as { benefit?: string }).benefit ?? "";
		if (
			this.actor.items.some(
				(item) =>
					item.type === "trait" &&
					item.name === name &&
					benefitOf(item) === benefit,
			)
		) {
			return;
		}
		const docs = (await getPackDocuments(
			`rogue-trader.${pack}`,
		)) as foundry.documents.Item[];
		const doc = docs.find((item) => item.name === name);
		if (!doc) {
			ui.notifications?.warn(
				game.i18n!.format("AFFLICTION.GRANT_MISSING", { name }),
			);
			return;
		}
		const object = doc.toObject() as unknown as {
			system?: { benefit?: string };
		};
		if (benefit && object.system) object.system.benefit = benefit;
		await this.actor.createEmbeddedDocuments("Item", [object as never]);
		this.render?.({ force: true });
	}

	/** Cached madness-pack rows (CONFIG registry, epic 1g2t). */
	static #madnessRows(): unknown[] {
		return (
			(CONFIG as unknown as {
				ROGUE_TRADER?: {
					madness?: { getRows?: () => unknown[] };
				};
			}).ROGUE_TRADER?.madness?.getRows?.() ?? []
		);
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
		const track = insanityTrack(
			CharacterSheet.#madnessRows() as never,
			system.insanity ?? 0,
		);
		const modifiers: Modifier[] = track.modifier
			? [{
					id: "trauma:track",
					source: { type: "item", label: "MADNESS.TRAUMA_MODIFIER" },
					label: `${track.degree}`,
					value: track.modifier,
					}]
			: [];
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key: "wp",
			modifiers,
		});
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
		const track = corruptionTrack(
			CharacterSheet.#madnessRows() as never,
			system.corruption ?? 0,
		);
		const modifiers: Modifier[] = track.modifier
			? [{
					id: "malignancy:track",
					source: { type: "item", label: "MADNESS.MALIGNANCY_MODIFIER" },
					label: `${track.degree}`,
					value: track.modifier,
					}]
			: [];
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key: "wp",
			modifiers,
		});
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
		const current = equipStateOf(item);
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
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key,
			skipDialog: false,
		});
	}

	static async #onRollSkill(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = target.dataset.item;
		if (!itemId) return;
		await performRoll({
			kind: "skill",
			actor: this.actor,
			itemId,
			skipDialog: false,
		});
	}

	static async #onRollUntrained(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const name = target.dataset.name;
		const key = target.dataset.characteristic;
		if (!name || !key) return;
		await performRoll({
			kind: "skill",
			actor: this.actor,
			characteristicKey: key,
			label: name,
		});
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
			systemOf(this.actor).characteristics[key]?.unnatural ?? 1;
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
				{ id: "data", group: "primary", label: "TAB.STATS", cssClass: "" },
				{ id: "combat", group: "primary", label: "TAB.COMBAT", cssClass: "" },
				{ id: "skills", group: "primary", label: "TAB.SKILLS", cssClass: "" },
				{
					id: "background",
					group: "primary",
					label: "TAB.BACKGROUND",
					cssClass: "",
				},
				{ id: "psychic", group: "primary", label: "TAB.PSYCHIC", cssClass: "" },
				{
					id: "inventory",
					group: "primary",
					label: "TAB.INVENTORY",
					cssClass: "",
				},
				{ id: "notes", group: "primary", label: "TAB.NOTES", cssClass: "" },
			],
			initial: "data",
		},
	};

	/**
	 * The psychic tab renders only for psykers (bead m4me): Navigators count
	 * (Core Rulebook p182), anyone with a Psy Rating, and anyone who owns
	 * psychic/navigator powers (bead hli6 follow-up: the header psyker
	 * checkbox moved onto this tab, so owned powers must be able to reveal
	 * it for homebrew/GM-granted psykers). Mundane characters never see the
	 * tab in the nav nor the section.
	 */
	protected override _prepareTabs(
		group: string,
	): Record<string, foundry.applications.api.ApplicationV2.Tab> {
		const tabs = super._prepareTabs(group);
		const system = systemOf(this.actor);
		const hasPowers = this.actor.items.some(
			(i) =>
				(i.type as string) === "psychicpower" ||
				(i.type as string) === "navigatorpower",
		);
		if (
			!(
				system.psyker === true ||
				(system.psyRating ?? 0) >= 1 ||
				(system.sorceryRank ?? "") !== "" ||
				collectSorceryRank(actorView(this.actor)) > 0 ||
				hasPowers
			)
		) {
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
	 * Afflictions (disorders/malignancies/mutations) are ordinary owned Items
	 * (epic nt8k): acquisition-time dice are settled on the copy itself, not on
	 * a separate ledger.
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
		return this.actor.createEmbeddedDocuments(
			"Item",
			(await prepareDroppedItems(this.actor, source)) as never,
		);
	}

	/**
	 * Lazy default-skill backfill: a pc/npc opened with zero skills receives
	 * the catalog's common skills. Belt-and-braces with the createActor hook:
	 * both paths use the same pure grant and are guarded to no-op once any
	 * item exists. Covers actors created before the feature existed.
	 */
	async #ensureDefaultSkills(): Promise<void> {
		// The createActor hook's grant is async and unawaited by Foundry: wait
		// for it before the items.size guard, or a sheet opened mid-grant
		// backfills the same defaults (bead t093).
		await waitForDefaultGrants(this.actor.uuid);
		if (this.actor.items.size > 0) return;
		if (this.actor.type !== "explorer" && this.actor.type !== "npc") return;
		const documents = (await getCharacterOptionDocs(
			"skill",
		)) as foundry.documents.Item[];
		const grants = missingSkillGrants(
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
			this.actor.items.map((i) => i.name ?? ""),
		);
		if (grants.length === 0) return;
		await this.actor.createEmbeddedDocuments("Item", grants);
	}

	async _prepareContext(options: { isFirstRender: boolean }) {
		await this.#ensureDefaultSkills();
		const context = sheetContext(await super._prepareContext(options as never));
		const system = this.actor.system as Character;

		// Critical Damage panel (bead ks3k): per-location totals, the effects
		// still being suffered, and whether a worn battlesuit can repair them.
		context.criticals = criticalSheetContext(this.actor);

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
			const docs = (await getCharacterOptionDocs("career")) as unknown as Array<{
				system: {
					key: string;
					ranks?: Array<{ rank: number; xpLevel: number }>;
				};
			}>;
			if (docs.length > 0) {
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

		context.characteristics = buildCharacteristicViews(
			system,
			// fvtt-types narrow format's vars to Record<string, string>; the
			// views pass numbers (bonus/mult) like the pre-6l90 inline code.
			(key, vars) => game.i18n!.format(key, vars as Record<string, string>),
		);

		const ownedSkills = this.actor.items.filter(
			(item) => item.type === "skill",
		);
		const catalog = await getSkillCatalog();
		const catalogByChar = new Map<string, Awaited<ReturnType<typeof getSkillCatalog>>>();
		for (const entry of catalog) {
			const list = catalogByChar.get(entry.characteristic) ?? [];
			list.push(entry);
			catalogByChar.set(entry.characteristic, list);
		}

		context.skillGroups = Object.keys(
			(system.characteristics ?? {}) as Record<string, unknown>,
		).map((key) => {
			const label = `CHARACTERISTIC.${key.toUpperCase()}`;
			// 6l90: shared merge drops catalog entries owned under differing
			// casing (t093 semantics) so owned skills never render twice.
			const skills = mergeOwnedAndCatalogRows(
				ownedSkills.filter(
					(item) =>
						(item.system as unknown as { characteristic: string })
							.characteristic === key,
				) as unknown as OwnedSkillLike[],
				catalogByChar.get(key) ?? [],
			);
			return { key, label, skills };
		});

		context.isPC = this.actor.type === "explorer";

		// Psychic tab (bead m4me): owned powers + psyker status; the tab nav
		// itself is gated in _prepareTabs.
		context.isPsyker =
			system.psyker === true || (system.psyRating ?? 0) >= 1;
		context.psyRating = system.psyRating ?? 0;
		// Sorcery (epic 0hap): the rank select + the Table 6-1 sanctioned
		// toggle. Owned Sorcery talents win; the field is the manual fallback.
		const sorceryRank = effectiveSorceryRank(
			collectSorceryRank(actorView(this.actor)),
			system.sorceryRank,
		);
		context.sorceryRank = sorceryRank;
		context.hasSorcery = sorceryRank !== "";
		context.sanctioned = system.sanctioned !== false;
		context.sorceryRankChoices = { "": "", ...sorceryRanks.choices };
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
					castAs?: string;
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
					// Epic 0hap: sorcerous copies (Intelligence test, Int-Bonus PR)
					// carry a chip so hybrid casters can see the mode at a glance.
					sorcerous: sys.castAs === "sorcery",
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
					const equipState = equipStateOf(item);
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
						isWeapon: isWeaponType(type),
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
				(item.type as string) === "armour" && equipStateOf(item) === "worn",
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
			.filter((item) => isWeaponType(item.type as string))
			.map((item) => {
				const sys = item.system as unknown as {
					class: string;
					damage?: string;
					penetration?: number;
					clip?: number;
					rateOfFire?: RateOfFire;
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
		const packDocs = (await getCharacterOptionDocs("talent")) as unknown as Array<{
			uuid?: string;
			name?: string;
		}>;
		if (packDocs.length > 0 && context.talentRows.length > 0) {
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
		//
		// Driven by storedOriginPicks + ORIGIN_ROW_LABEL_KEYS rather than a
		// hand-written list of the five human fields (bead 58js): a xeno's
		// species-path picks live in `origins.path`, so a fixed list would omit
		// them from the sheet as silently as it omitted them from the save.
		const splitPick = (key: string, variantKey?: string) => {
			const entry = originByKey(key);
			if (!entry) return null;
			const variant = variantKey
				? entry.variants?.find((v) => v.key === variantKey)
				: undefined;
			const mods = effectiveMechanics(entry, variantKey).characteristics ?? [];
			return {
				name: variant ? `${entry.name}: ${variant.name}` : entry.name,
				tooltip: variant?.effect ?? entry.effect ?? "",
				mods: mods.map(
					(m) => `${m.value > 0 ? "+" : ""}${m.value} ${m.key.toUpperCase()}`,
				),
			};
		};
		const storedPicks = storedOriginPicks(system.origins as never);
		const originRows: Array<{
			labelKey: string;
			pick: { name: string; tooltip: string; mods: string[] } | null;
		}> = ORIGIN_ROW_ORDER.filter((row) => Boolean(storedPicks[row]?.key))
			.map((row) => ({
				labelKey: ORIGIN_ROW_LABEL_KEYS[row],
				pick: splitPick(
					storedPicks[row]?.key ?? "",
					storedPicks[row]?.variantKey,
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
			// The STORED shape, both halves: resolveOriginTraits reads it through
			// storedOriginPicks, so a xeno's path picks contribute their traits.
			system.origins as never,
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
		// Affliction grants (epic nt8k): traits/talents named by owned
		// disorders/malignancies/mutations ("traits:Fear", "talents:Iron Jaw").
		// The chip copies the pack item on click; nothing is auto-granted.
		context.afflictionGrants = resolveAfflictionGrants(
			actorView(this.actor),
		).map((grant) => ({
			...grant,
			label: grant.benefit ? `${grant.name} ${grant.benefit}` : grant.name,
		}));

		// Career link: the compendium career item behind the actor's careerKey,
		// opened via openCareerSheet for the full crunch tables. Diagnostic log
		// when the lookup fails (bead qwp6) — pack missing, or key mismatch.
		const docs = (await getCharacterOptionDocs("career")) as unknown as Array<{
			uuid?: string;
			system: { key: string };
		}>;
		if (docs.length > 0 && system.careerKey) {
			const careerDoc = docs.find((d) => d.system.key === system.careerKey);
			if (!careerDoc) {
				console.warn(
					`rogue-trader | no career doc with system.key "${system.careerKey}" in the character-options pack`,
				);
			}
			context.careerItemId = careerDoc?.uuid ?? "";
		} else {
			if (docs.length === 0) {
				console.warn("rogue-trader | careers pack not registered (game.packs)");
			}
			context.careerItemId = "";
		}

		// Encumbrance: carried weight vs capacity derived from Strength Bonus
		// (rules/encumbrance.ts deriveCapacity, VERIFY book rule). Only READY
		// items count (bead yar): carried weapons/gear, worn armour.
		// Carried load (rules/encumbrance.ts): one shared definition of which
		// items count — STOWED counts too (owner decision 2026-09-08, bead xhcc,
		// which superseded yar's READY-only rule).
		context.encumbrance = actorEncumbrance(
			this.actor.items,
			system.characteristicBonus("s"),
		);
		// Derived values (read-only): definitional + rules-layer, no writeback.
		context.derived = {
			...system.movement(),
			initiative: system.initiativeBonus(),
			woundsMax: woundsMax(actorView(this.actor)),
			fatigueMax: fatigueThreshold(system),
		};

		// Madness tracks + conditions (epic 1g2t, q1ql): pure helper.
		Object.assign(
			context,
			madnessSheetContext(
				CharacterSheet.#madnessRows() as never,
				system as unknown as MadnessPoints,
				this.actor.items.map((item) => ({
					name: item.name ?? "",
					type: item.type,
					system: item.system as unknown as OwnedAfflictionLike["system"],
				})),
				this.actor as unknown as never,
			),
		);

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

/**
 * The mutation pack (bead kam1): Ravaged Body rolls further mutations off it,
 * and the granted Items are cloned from it.
 */
const MUTATION_PACK = "rogue-trader.afflictions";

/** Structural view of a mutation pack document (band + name). */
interface MutationPackDoc {
	name?: string;
	type?: string;
	system?: { tableKey?: string; rollMin?: number; rollMax?: number };
	toObject?: () => unknown;
}

/**
 * Read the mutation table rows out of the pack. A row missing its band THROWS:
 * a silently-defaulted band would make one row cover every number and quietly
 * corrupt every Ravaged Body roll.
 */
function mutationRowsFrom(docs: MutationPackDoc[]): MutationRow[] {
	return docs.map((doc) => {
		const system = doc.system;
		if (
			!doc.name ||
			typeof system?.rollMin !== "number" ||
			typeof system?.rollMax !== "number"
		) {
			throw new Error(
				`mutation pack row "${doc.name ?? "?"}" has no table band (rollMin/rollMax)`,
			);
		}
		return {
			name: doc.name,
			tableKey: system.tableKey ?? "mutations",
			rollMin: system.rollMin,
			rollMax: system.rollMax,
		};
	});
}

/**
 * Clone a dropped Item for embedding, settling acquisition-time state on the
 * copy (epic nt8k). Four affliction-specific steps:
 * - a printed acquisition procedure (bead xu83) runs once and appends its
 *   settled effect rows (Degenerate Mind's trait pick, Mental Regressive's
 *   per-characteristic table), then clears the marker so it cannot re-run;
 * - a procedure that rolls up FURTHER mutations (bead kam1: Ravaged Body's
 *   "Roll 1d5 times on this table") returns them as grants. They are resolved
 *   against the mutation pack, settled the same way, and returned alongside
 *   the dropped item so one drop can produce several Items;
 * - characteristic changes are rolled ONCE here and written onto the effect
 *   row, so later tests see a stable number (dice are signed: "-1d10" reduces);
 * - an acquired Disorder records the severity it was gained at, which is what
 *   `dueDisorders` reads to stop re-prompting that threshold.
 *
 * Returns the dropped item's payload FIRST, then any granted mutations, so the
 * caller's single createEmbeddedDocuments call preserves drop order.
 * Module-level to keep it off the class body.
 */
async function prepareDroppedItems(
	actor: foundry.documents.Actor,
	source: foundry.documents.Item,
	gainedByTableRoll = false,
): Promise<Record<string, unknown>[]> {
	const object = source.toObject() as unknown as {
		system?: {
			kind?: string;
			effects?: EffectData[];
			acquiredSeverity?: string;
			procedure?: string;
		};
	};
	const system = object.system;
	if (!system) return [object as unknown as Record<string, unknown>];
	const grants: ProcedureGrant[] = [];
	if (system.procedure) {
		// A mutation gained BY a table roll must not re-run its own table
		// procedure. The book does not resolve re-rolling Ravaged Body into
		// Ravaged Body, and recursing would loop without bound; the bounded
		// reading is to grant the mutation and stop (bead kam1 records this
		// for owner confirmation). Every other procedure still settles.
		if (gainedByTableRoll && system.procedure === "ravaged-body") {
			system.procedure = "";
		} else {
			const character = systemOf(actor);
			// The pack is read at most once per drop, and only when a
			// procedure actually needs the table.
			let packDocs: MutationPackDoc[] | null = null;
			const loadMutations = async (): Promise<MutationPackDoc[]> => {
				packDocs ??= (
					(await getPackDocuments(MUTATION_PACK)) as MutationPackDoc[]
				).filter((doc) => doc.type === "mutation");
				return packDocs;
			};
			const outcome = await applyAfflictionProcedure(system.procedure, {
				roll: async (notation) => {
					const die = new foundry.dice.Roll(notation);
					await die.evaluate();
					return die.total ?? 0;
				},
				characteristic: (key) => character.effectiveCharacteristicValue(key),
				mutationRows: async () => mutationRowsFrom(await loadMutations()),
			});
			system.effects = [...(system.effects ?? []), ...outcome.effects];
			grants.push(...outcome.grants);
			// Settled: the sub-roll must never run again on this item.
			system.procedure = "";
		}
	}
	if (
		system.effects?.some(
			(effect) =>
				effect.kind === "characteristic-modifier" && effect.dice && !effect.value,
		)
	) {
		system.effects = await resolveEffectValues(
			system.effects,
			async (notation) => {
				const die = new foundry.dice.Roll(notation);
				await die.evaluate();
				return die.total ?? 0;
			},
		);
	}
	if (source.type === "madnessentry" && system.kind === "disorder") {
		const character = actor.system as unknown as { insanity?: number };
		const held = actor.items
			.filter(
				(item) =>
					item.type === "madnessentry" &&
					(item.system as unknown as { kind?: string }).kind === "disorder",
			)
			.map((item) => ({
				severity:
					(item.system as unknown as { acquiredSeverity?: string })
						.acquiredSeverity ?? "",
			}));
		system.acquiredSeverity =
			dueDisorders(character.insanity ?? 0, held)[0]?.severity ?? "";
	}

	const payloads = [object as unknown as Record<string, unknown>];
	if (grants.length > 0) {
		await postMutationRollCard(actor, source.name ?? "", grants);
		for (const grant of grants) {
			const granted = await resolveMutationByName(grant.name);
			if (!granted) {
				console.warn(
					`rogue-trader | Ravaged Body rolled "${grant.name}", which is not in ${MUTATION_PACK}`,
				);
				continue;
			}
			const grantedPayloads = await prepareDroppedItems(actor, granted, true);
			for (const payload of grantedPayloads) {
				// A granted mutation is a NEW owned Item, so the pack document's
				// _id must go: rolling the same mutation twice is legal (the book
				// says roll 1d5 times, not re-roll repeats), and two embedded
				// Items cannot share an _id.
				const clone = { ...(payload as Record<string, unknown>) };
				delete clone._id;
				payloads.push(clone);
			}
		}
	}
	return payloads;
}

/** Resolve a mutation pack Item by name (fresh document, safe to clone). */
async function resolveMutationByName(
	name: string,
): Promise<foundry.documents.Item | null> {
	const docs = (
		(await getPackDocuments(MUTATION_PACK)) as Array<{
			name?: string;
			type?: string;
			toObject?: () => unknown;
		}>
	).filter((doc) => doc.type === "mutation");
	const found = docs.find((doc) => doc.name === name) ?? null;
	return found as unknown as foundry.documents.Item | null;
}

/**
 * Post the Ravaged Body card (bead kam1): the mutation that triggered the
 * table, and each d100 with the row it landed on, so the roll is auditable at
 * the table rather than appearing as N unexplained new items.
 */
async function postMutationRollCard(
	actor: foundry.documents.Actor,
	sourceName: string,
	grants: ProcedureGrant[],
): Promise<void> {
	try {
		await postCard(actor, "systems/rogue-trader/template/chat/mutation-roll.hbs", {
			title: game.i18n.format("CHAT.MUTATION_ROLL_TITLE", { mutation: sourceName }),
			countLabel: game.i18n.format("CHAT.MUTATION_ROLL_COUNT", {
				count: grants.length,
			}),
			results: grants.map((grant) => ({
				roll: grant.roll ?? 0,
				name: grant.name,
			})),
		});
	} catch (error) {
		// The items are already being created; a failed card must not abort the
		// drop. Loud, because a silent failure here loses the audit trail.
		console.error("rogue-trader | mutation roll card failed", error);
	}
}

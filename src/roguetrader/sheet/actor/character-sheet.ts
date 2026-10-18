import { Character } from "../../data/actor/character";
import { prepareDroppedItems } from "./affliction-drop";
import type { ActionOwnedItem } from "../../rules/actions";
import { itemIdFromTarget } from "../dom";
import { equipStateOf, isWeaponType, systemOf } from "../../data/accessors";
import { sheetContext } from "../context";
import {
	INVENTORY_EXCLUDED_TYPES,
	pcInventoryGroups,
	type PcInventoryItemLike,
} from "../pc-inventory";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { imageActions } from "../image-actions";
import { getCharacterOptionDocs } from "../pack-resolve";
import { clonePackDocPayload } from "../clone-doc";
import {
	findPackDoc,
	packSlugToType,
	warnPackDocMissing,
} from "./grant-helpers";
import { waitForDefaultGrants } from "../default-grants";
import type { AdvanceLedgerEntry } from "../../rules/advancement";
import { derivedRank, totalSpent } from "../../rules/advancement";
import { careers, equipStates, sorceryRanks } from "../../registry";
import { collectSorceryRank } from "../../rules/talent-effects";
import { actorView } from "../../../ffg/infrastructure/foundry/actor-view";
import { getPorts } from "../../../ffg/infrastructure/foundry/ports";
import { isPsykerLike } from "../../rules/psyker";
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
import { resolveOriginTraits } from "../../rules/origin-traits";
import {
	corruptionTrack,
	insanityTrack,
	madnessSheetContext,
	type MadnessPoints,
	type OwnedAfflictionLike,
} from "../../rules/madness";
import type { Modifier } from "../../../rules-engine/modifier";
import {
	performRoll,
	rollInitiativeAction,
	rollSnapOut,
	toggleSustainedPower,
} from "../../rules/adapter";
import { missingSkillGrants } from "../../rules/default-skills";
import { resolveAfflictionGrants } from "../../rules/afflictions";
import { fatigueThreshold, woundsMax } from "../../rules/derived";
import { actorEncumbrance } from "../../rules/encumbrance";
import { getSkillCatalog } from "./skill-catalog";
import {
	gatePsykerTab,
	openItemAction,
	rollDamageAction,
	rollWeaponAction,
	startItemRowDrag,
} from "./shared-actions";
import { equipToggleState } from "../equip";
import { armourLocations, weaponRows } from "./view-models";
import {
	buildCharacteristicViews,
	findOwnedSkillForRow,
	mergeOwnedAndCatalogRows,
	skillNameKey,
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
import { combatActionChipAction, actionsChipContext } from "./actions-view";
import { enrichText } from "../rich-text";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

// (CharacteristicView, MAX_UNNATURAL_STEPS moved to sheet/skills-domain — bead 6l90)

/** Structural row of a career pack document, shared by the career builders. */
interface CareerDocRow {
	uuid?: string;
	system: {
		key: string;
		ranks?: Array<{ rank: number; xpLevel: number }>;
	};
}

/**
 * In-flight own-skill creations, keyed by actor + skill name (bead bwwg):
 * guards against duplicate Item creation when the button is clicked more
 * than once before the first createEmbeddedDocuments resolves (the sheet
 * does not re-render synchronously).
 */
const owningSkillKeys = new Set<string>();

export class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "character"],
		position: { width: 600, height: 500 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			editImage: imageActions.editImage,
			rollTest: CharacterSheet.#onRollTest,
			rollSkill: CharacterSheet.#onRollSkill,
			rollUntrained: CharacterSheet.#onRollUntrained,
			ownSkill: CharacterSheet.#onOwnSkill,
			addSkill: CharacterSheet.#onAddSkill,
			setUnnatural: CharacterSheet.#onSetUnnatural,
			setLadder: CharacterSheet.#onSetLadder,
			openItem: openItemAction,
			openPackItem: openPackItemAction,
			deleteItem: CharacterSheet.#onDeleteItem,
			rollWeapon: rollWeaponAction,
			rollDamage: rollDamageAction,
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
			rollInitiative: CharacterSheet.#onRollInitiative,
			repairBattlesuit: CharacterSheet.#onRepairBattlesuit,
			combatAction: combatActionChipAction,
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

	/**
	 * Roll initiative (bead dt8t → bead yxm5 funnel): 1d10 + the derived
	 * initiative bonus, funnel-visible (talent/item rows in the dialog) and
	 * assigned to every combatant of the actor via rules/adapter.ts
	 * rollInitiativeAction.
	 */
	static async #onRollInitiative(this: {
		actor: foundry.documents.Actor;
	}): Promise<void> {
		await rollInitiativeAction(this.actor);
	}

	/** Delete an owned inventory item. */
	static async #onDeleteItem(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
		if (!itemId) return;
		await this.actor.items.get(itemId)?.delete();
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
		const itemId = itemIdFromTarget(target);
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
		const itemId = itemIdFromTarget(target);
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
		if (!uuid) {
			console.warn(
				"rogue-trader | career link: no data-uuid on the clicked element",
			);
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
				getPorts().notify.error("BACKGROUND.OPEN_CAREER_FAIL", { uuid });
				console.warn(`rogue-trader | career link: "${uuid}" did not resolve`);
				return;
			}
			await openDocumentSheet(item, "career link", undefined, { uuid });
		} catch (error) {
			// Surface render failures visibly instead of dying silently —
			// CareerSheet._prepareContext errors land here.
			console.error("rogue-trader | career link failed:", error);
			getPorts().notify.error("BACKGROUND.OPEN_CAREER_FAIL", { uuid });
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
		const type = packSlugToType(pack);
		if (!type) {
			// Unmapped slugs (pack-authored/GM labels like "mutations:…") used
			// to resolve against their own per-pack compendium: keep that route
			// name-only instead of warning-and-return (epic zlwc round 4).
			const doc = (await findPackDoc(null, name, {
				pack: `rogue-trader.${pack}`,
			})) as foundry.documents.Item | null;
			if (!doc) {
				warnPackDocMissing(pack, name, "grant skipped");
				getPorts().notify.warn("AFFLICTION.GRANT_MISSING", { name });
				return;
			}
			// Same grant write as the mapped route below: one clone (the pack doc's
			// _id stripped, bead 27eu), an optional benefit stamp, and a
			// re-rendered sheet.
			const unmapped = clonePackDocPayload(
				doc.toObject() as unknown as { _id?: string; system?: { benefit?: string } },
			) as unknown as { system?: { benefit?: string } };
			if (benefit && unmapped.system) unmapped.system.benefit = benefit;
			await this.actor.createEmbeddedDocuments("Item", [unmapped as never]);
			this.render?.({ force: true });
			return;
		}
		// bead 38io: the shared case-insensitive pack-by-name resolve — the
		// grants-item targets live in the character-options concept pack (bead
		// 4tj1), so the per-pack getPackDocuments idiom goes away here.
		const doc = (await findPackDoc(
			type,
			name,
		)) as foundry.documents.Item | null;
		if (!doc) {
			warnPackDocMissing(type, name, "grant skipped");
			getPorts().notify.warn("AFFLICTION.GRANT_MISSING", { name });
			return;
		}
		const object = clonePackDocPayload(
			doc.toObject() as unknown as { _id?: string; system?: { benefit?: string } },
		) as unknown as { system?: { benefit?: string } };
		if (benefit && object.system) object.system.benefit = benefit;
		await this.actor.createEmbeddedDocuments("Item", [object as never]);
		this.render?.({ force: true });
	}

	/** Cached madness-pack rows (CONFIG registry, epic 1g2t). */
	static #madnessRows(): unknown[] {
		return (
			(
				CONFIG as unknown as {
					ROGUE_TRADER?: {
						madness?: { getRows?: () => unknown[] };
					};
				}
			).ROGUE_TRADER?.madness?.getRows?.() ?? []
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
			? [
					{
						id: "trauma:track",
						source: { type: "item", label: "MADNESS.TRAUMA_MODIFIER" },
						label: `${track.degree}`,
						value: track.modifier,
					},
				]
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
			? [
					{
						id: "malignancy:track",
						source: { type: "item", label: "MADNESS.MALIGNANCY_MODIFIER" },
						label: `${track.degree}`,
						value: track.modifier,
					},
				]
			: [];
		await performRoll({
			kind: "characteristic",
			actor: this.actor,
			key: "wp",
			modifiers,
		});
	}

	/**
	 * Toggle the equip state of an inventory item. The type allowlist stays
	 * here (bead 73di: the character keeps a narrower type set); the state
	 * computation is the ONE shared machine (sheet/equip.ts, bead 2dvj).
	 */
	static async #onToggleEquip(
		this: { actor: foundry.documents.Actor },
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const itemId = itemIdFromTarget(target);
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
		const next = equipToggleState(type, equipStateOf(item));
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

		// Idempotency guard (bead bwwg): a double click (or a stale row)
		// must not create a second skill Item. Disable the button up front so
		// the browser won't fire a second action before the first resolves,
		// and look up any already-owned skill with the same name before
		// creating.
		const btn = target as HTMLButtonElement;
		if (btn.disabled) return;
		btn.disabled = true;
		// Also lock every ladder button on this row so a click on a sibling
		// ladder step cannot race the in-flight creation.
		const row = target.closest?.("li");
		const siblings = row?.querySelectorAll?.(
			'button[data-action="ownSkill"]',
		) as NodeListOf<HTMLButtonElement> | undefined;
		siblings?.forEach((btn) => {
			btn.disabled = true;
		});

		const lockKey = `${this.actor.id ?? this.actor.uuid ?? "actor"}::${skillNameKey(name)}`;
		let locked = false;
		try {
			if (owningSkillKeys.has(lockKey)) return;

			const ownedSkills = (this.actor.items ?? []).filter(
				(item: { type?: string }) => item.type === "skill",
			) as unknown as Array<{ key?: string | null; name?: string | null }>;
			const existing = findOwnedSkillForRow(ownedSkills, { name }, name);
			if (existing) return;

			owningSkillKeys.add(lockKey);
			locked = true;
			await this.actor.createEmbeddedDocuments("Item", [
				{ name, type: "skill", system: { characteristic, ladder } },
			]);
		} finally {
			if (locked) owningSkillKeys.delete(lockKey);
			btn.disabled = false;
			siblings?.forEach((btn) => {
				btn.disabled = false;
			});
		}
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
		const current = systemOf(this.actor).characteristics[key]?.unnatural ?? 1;
		const next = current === value ? 1 : value;
		await this.actor.update({
			system: { characteristics: { [key]: { unnatural: next } } },
		});
	}

	static PARTS = {
		header: {
			template: `${TEMPLATE_ROOT}sheet/actor/parts/header.hbs`,
		},
		tabs: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/tabs.hbs`,
		},
		// Each tab part's root <section class="tab"> is the scroll container
		// (.rogue-trader .tab { overflow-y: auto }): the scrollable descriptor
		// makes ApplicationV2 preserve scrollTop across part replacement
		// (bead ss1d) so a delete/re-render no longer jumps the sheet to the
		// top. "" = the part's own root element (core _syncPartState).
		stats: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/stats.hbs`,
			scrollable: [""],
		},
		combat: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/combat.hbs`,
			scrollable: [""],
		},
		// Actions tab (epic moew, bead 9r82): the combat actions chip grid; the
		// root <section class="tab"> is the scroll container like every tab part.
		actions: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/actions.hbs`,
			scrollable: [""],
		},
		inventory: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/inventory.hbs`,
			scrollable: [""],
		},
		background: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/background.hbs`,
			scrollable: [""],
		},
		skills: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/skills.hbs`,
			scrollable: [""],
		},
		psychic: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/psychic.hbs`,
			scrollable: [""],
		},
		notes: {
			template: `${TEMPLATE_ROOT}sheet/actor/tabs/notes.hbs`,
			scrollable: [""],
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "data", group: "primary", label: "TAB.STATS", cssClass: "" },
				{ id: "combat", group: "primary", label: "TAB.COMBAT", cssClass: "" },
				{
					id: "actions",
					group: "primary",
					label: "TAB.ACTIONS",
					cssClass: "",
				},
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
	 * The psychic tab renders only for psykers (bead m4me): shared psyker
	 * predicate (bead 73di, gatePsykerTab); this sheet gates the "psychic" id.
	 * Navigators count (Core Rulebook p182), anyone with a Psy Rating, and
	 * anyone who owns psychic/navigator powers (bead hli6 follow-up: the
	 * header psyker checkbox moved onto this tab, so owned powers must be able
	 * to reveal it for homebrew/GM-granted psykers). Mundane characters never
	 * see the tab in the nav nor the section.
	 */
	protected override _prepareTabs(
		group: string,
	): Record<string, foundry.applications.api.ApplicationV2.Tab> {
		return gatePsykerTab(this.actor, super._prepareTabs(group), "psychic");
	}

	/**
	 * Inventory rows carry their item uuid; drag transfers core {type, uuid}
	 * data so rows can be dropped onto other sheets/hotbars.
	 */
	protected _onDragStart(event: DragEvent): void {
		startItemRowDrag(event);
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

	/**
	 * Builds the sheet context tab by tab. Orchestration only: ensure default
	 * skills -> base context -> the shared per-render career fetch -> one
	 * builder per tab/section, each documented below. The await order (skill
	 * catalog, talent pack, rich-text enrichment) is preserved.
	 */
	async _prepareContext(options: { isFirstRender: boolean }) {
		await this.#ensureDefaultSkills();
		const context = sheetContext(await super._prepareContext(options as never));
		const system = this.actor.system as Character;

		// Critical Damage panel (bead ks3k): per-location totals, the effects
		// still being suffered, and whether a worn battlesuit can repair them.
		context.criticals = criticalSheetContext(this.actor);

		// Career docs fetched ONCE per render (bead yi5t) and shared by both
		// consumers below — the advancement-thresholds lookup and the career-link
		// lookup. getCharacterOptionDocs re-fetches the pack on every call.
		const careerDocs = (await getCharacterOptionDocs(
			"career",
		)) as unknown as CareerDocRow[];

		this.#careerContext(context, system, careerDocs);
		await this.#skillsContext(context, system);
		this.#psychicContext(context, system);
		this.#inventoryContext(context);
		await this.#backgroundContext(context, system);
		this.#derivedContext(context, system);
		this.#madnessContext(context, system);
		await this.#notesContext(context, system);
		// Career link resolves against the shared careerDocs; kept after the
		// section builders to preserve the original assignment order.
		this.#careerLinkContext(context, system, careerDocs);

		return context;
	}

	/**
	 * Stats tab: the career picker (bead 0ib), advancement-rank tooltips (bead
	 * ayw) and the display-only XP pool.
	 */
	#careerContext(
		context: Record<string, unknown>,
		system: Character,
		careerDocs: CareerDocRow[],
	): void {
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
			if (careerDocs.length > 0) {
				const careerDoc = careerDocs.find(
					(d) => d.system.key === system.careerKey,
				);
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
		context.xpSpent = totalSpent(
			(system.advances ?? []) as AdvanceLedgerEntry[],
		);
		context.xpTotal = system.xp?.total ?? 0;
	}

	/** Skills tab: characteristic views + the owned/catalog skill ladder rows. */
	async #skillsContext(
		context: Record<string, unknown>,
		system: Character,
	): Promise<void> {
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
		// Actions tab (epic moew, bead 9r82): the Table 9-4 book order — the
		// chip rows come straight from the warmed actions catalog.
		await this.#actionsContext(context, system);
	}

	/** Actions tab (epic moew, bead 9r82): the catalog + prerequisite chips. */
	async #actionsContext(
		context: Record<string, unknown>,
		_system: Character,
	): Promise<void> {
		context.actions = await actionsChipContext(
			this.actor.items as unknown as ActionOwnedItem[],
			(key) => game.i18n!.localize(key),
		);
	}

	/** Psychic tab (bead m4me): powers, psyker status, sorcery, navigation. */
	#psychicContext(context: Record<string, unknown>, system: Character): void {
		// Psychic tab (bead m4me): owned powers + psyker status; the tab nav
		// itself is gated in _prepareTabs.
		context.isPsyker = isPsykerLike(actorView(this.actor));
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
	}

	/**
	 * Inventory + combat tabs: grouped gear, armour AP per location and weapon
	 * rows, plus the talent rows the background tab builds on.
	 */
	#inventoryContext(context: Record<string, unknown>): void {
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
						// Gear-base quantity (bead 1sxq) - only the ammunition
						// group renders it (xN usage count, bead 8uc7).
						quantity:
							(item.system as unknown as { quantity?: number }).quantity ?? 0,
						equipState: stateKey,
						equipStateLabel: label,
						equipped: equipState === "carried" || equipState === "worn",
						// Weapons get the inline attack/damage roll button.
						isWeapon: isWeaponType(type),
					};
				});
		// Inventory groups (bead packs-pu9): one row pass, then the pure grouping
		// (the npc-inventory contract — a loud CATCH-ALL, so a dropped item of any
		// type is rendered; the heirloom special-abilities (Table 1-2) landed
		// invisibly before this). Weight display only — aggregation/encumbrance
		// is deliberately NOT calculated here.
		const inventory = pcInventoryGroups(
			this.actor.items
				.filter(
					(item) => !INVENTORY_EXCLUDED_TYPES.has(item.type as string),
				)
				.map(
					(item): PcInventoryItemLike => ({
						id: item.id,
						name: item.name,
						uuid: item.uuid,
						type: item.type as string,
						weight:
							(item.system as unknown as { weight?: number }).weight ?? 0,
						// Gear-base quantity (bead 1sxq) - only the ammunition
						// group renders it (xN usage count, bead 8uc7).
						quantity:
							(item.system as unknown as { quantity?: number }).quantity ?? 0,
						equipState: equipStateOf(item),
						// Localized label computed here (not via a template
						// concat): module-registered states resolve through the
						// registry when present, core states via the lang keys.
						equipStateLabel: equipStateLabel(equipStateOf(item)),
						equipped:
							equipStateOf(item) === "carried" ||
							equipStateOf(item) === "worn",
						// Weapons get the inline attack/damage roll button.
						isWeapon: isWeaponType(item.type as string),
					}),
			),
		);

		// Ammunition group note (bead 8uc7): rows stay draggable (core {type,
		// uuid}); they show xN quantity in the weight slot and carry NO equip
		// toggle (the pc-inventory module sets equippable/isAmmunition per row).

		// Armour: highest AP per body location across WORN armour items (bead
		// yb6 equip-state model: stowed armour contributes nothing, matching
		// the adapter's wornArmour filter in the damage pipeline).
		// Shared canonical rows (bead v2ll), adapted to the PC record shape
		// keyed by loc.
		context.armourLocations = Object.fromEntries(
			armourLocations(
				this.actor.items as unknown as Parameters<typeof armourLocations>[0],
			).map(({ loc, ap }) => [loc, { ap }]),
		);

		// Combat tab: weapons from inventory with visible stats (display only;
		// roll buttons land with the roll-damage adapter work).
		// Combat tab: shared weapon rows (bead v2ll), PC sorts by name.
		context.weapons = weaponRows(
			this.actor.items as unknown as Parameters<typeof weaponRows>[0],
		).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

		context.inventory = inventory;

		// Consolidated Background tab (bead ay0): origins + career + talents.
		context.talentRows = byType(["talent"]);
	}

	/** Background tab: talents, origins, dynasty, origin traits, grants. */
	async #backgroundContext(
		context: Record<string, unknown>,
		system: Character,
	): Promise<void> {
		// Compendium link per talent row (bead oaaz): pack uuid by name
		// (case-insensitive), same careers-pack pattern as careerItemId above.
		const packDocs = (await getCharacterOptionDocs(
			"talent",
		)) as unknown as Array<{
			uuid?: string;
			name?: string;
		}>;
		const talentRows = context.talentRows as Array<
			Record<string, unknown> & { name?: string; packUuid?: string }
		>;
		if (packDocs.length > 0 && talentRows.length > 0) {
			const byName = new Map(
				packDocs
					.filter((d) => d.name)
					.map((d) => [d.name!.toLowerCase(), d.uuid ?? ""]),
			);
			for (const row of talentRows) {
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
		context.dynastyOptions = (
			(game.actors ?? []) as unknown as {
				contents: Array<{
					type?: string;
					uuid: string;
					name?: string;
					system?: { profitFactor?: number };
				}>;
			}
		).contents
			.filter((a) => a.type === "dynasty")
			.map((a) => ({
				uuid: a.uuid,
				name: a.name ?? "",
				label:
					a.system?.profitFactor !== undefined
						? `${a.name} (PF ${a.system.profitFactor})`
						: (a.name ?? ""),
				selected: system.dynastyUuid === a.uuid,
			}));

		// Origin traits (bead tgq9): modifier/grant/note resolution from the
		// cached pack defs; grants carry claim state, free-skill grants resolve
		// via the skill picker.
		const traitDefs =
			(
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
			resolvable:
				t.def.grantKind === "free-skill" ||
				t.def.grantKind === "extra-common-lore",
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
	}

	/**
	 * Career link: the compendium career item behind the actor's careerKey,
	 * opened via openCareerSheet for the full crunch tables. Diagnostic log
	 * when the lookup fails (bead qwp6) — pack missing, or key mismatch.
	 */
	#careerLinkContext(
		context: Record<string, unknown>,
		system: Character,
		careerDocs: CareerDocRow[],
	): void {
		if (careerDocs.length > 0 && system.careerKey) {
			const careerDoc = careerDocs.find(
				(d) => d.system.key === system.careerKey,
			);
			if (!careerDoc) {
				console.warn(
					`rogue-trader | no career doc with system.key "${system.careerKey}" in the character-options pack`,
				);
			}
			context.careerItemId = careerDoc?.uuid ?? "";
		} else {
			if (careerDocs.length === 0) {
				console.warn("rogue-trader | careers pack not registered (game.packs)");
			}
			context.careerItemId = "";
		}
	}

	/** Combat tab read-outs: encumbrance + the derived (read-only) values. */
	#derivedContext(context: Record<string, unknown>, system: Character): void {
		// Core Rulebook p267: capacity keys on the SUM of Strength Bonus and
		// Toughness Bonus through Table 9-33 — SB+TB here; quantity stacks count
		// (bead qhkv; bead 1sxq).
		context.encumbrance = actorEncumbrance(
			this.actor.items,
			system.characteristicBonus("s") + system.characteristicBonus("t"),
		);
		// Derived values (read-only): definitional + rules-layer, no writeback.
		context.derived = {
			...system.movement(),
			initiative: system.initiativeBonus,
			woundsMax: woundsMax(actorView(this.actor)),
			fatigueMax: fatigueThreshold(system),
		};
	}

	/** Madness tracks + conditions (epic 1g2t, q1ql): pure helper. */
	#madnessContext(context: Record<string, unknown>, system: Character): void {
		// Madness tracks + conditions (epic 1g2t, q1ql): pure helper.
		Object.assign(
			context,
			madnessSheetContext(
				CharacterSheet.#madnessRows() as never,
				system as unknown as MadnessPoints,
				this.actor.items.map((item) => ({
					id: item.id ?? "",
					name: item.name ?? "",
					type: item.type,
					system: item.system as unknown as OwnedAfflictionLike["system"],
				})),
				this.actor as unknown as never,
			),
		);
	}

	/** Notes tab: rich-text description + motivation (owner request). */
	async #notesContext(
		context: Record<string, unknown>,
		system: Character,
	): Promise<void> {
		const enrich = (text: string) =>
			enrichText(text, this.document, { secrets: this.document.isOwner });
		context.descriptionHTML = await enrich(system.description);
		// Notes tab: motivation is rich text (owner request; appearance was
		// culled — the description field covers it).
		context.motivationHTML = await enrich(system.life?.motivation ?? "");
	}
}

/** Localized equip-state label: module-registered states resolve through the
 * registry when present, core states via the lang keys (shared by the
 * inventory rows; the byType talents path keeps its own inline copy). */
function equipStateLabel(stateKey: string): string {
	const registryLabel = equipStates.get(stateKey);
	return registryLabel ? game.i18n!.localize(registryLabel) : (stateKey ?? "stowed");
}

// Affliction drop machinery — the mutation pack resolution, the procedure
// settling (Ravaged Body's further mutations, Degenerate Mind, Mental
// Regressive), the roll-once characteristic dice and the mutation-roll chat
// card — lives in ./affliction-drop (bead yxpk).

import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import type { CareerRank } from "../../data/item/career";
import { careers } from "../../registry";
// Bead iktx: the ONE characteristic-label composition seam (labels.ts).
import { characteristicLabelKey } from "../../rules/labels";
import { itemDataContext, sheetContext } from "../context";
import {
	CHARACTER_OPTIONS_PACK,
	getPackDocuments,
	OPEN_PACK_DOC_ACTION,
	openPackDocUuid,
	packDocsOnce,
} from "../pack-resolve";
import { itemSheetOptions } from "../sheet-options";
import { ITEM_DESCRIPTION_TABS } from "../tabs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Display row for one rank's advance list. */
interface AdvanceRow {
	/** Display label: resolved pack name or verbatim book name. */
	label: string;
	typeLabel: string;
	cost: number;
	multiplier: number;
	prerequisites: string;
	/** Compendium UUID when the key resolved against the packs. */
	uuid: string;
}

/** slug() matching the emit script's key convention. */
function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Key -> {uuid, name} for the skills/talents pack, so advance rows link to
 * their source items.
 *
 * Bead mg87: this used to read `game.packs` + `pack.index.values()` directly,
 * in violation of the ContentPort rule (the game.packs lookup lives in ONE
 * place, the foundry content adapter) and hard-coding the RT pack id against
 * a swapped NO_CONTENT_PORT/fake. It now fetches through the sheet-side pack
 * path — pack-resolve's getPackDocuments wraps
 * getPorts().content.documentsOrNull and warns ONCE loudly when the pack is
 * missing; a missing pack degrades to rows without doc links, never an
 * error — memoized via the shared session cache. Exported for the headless
 * port-stub test (career-sheet.test.ts).
 */
export async function keyIndexMap(): Promise<
	Map<string, { uuid: string; name: string }>
> {
	const map = new Map<string, { uuid: string; name: string }>();
	// One merged pack holds both types (bead 4tj1); keep only talent/skill
	// docs so advance rows link to the right source items.
	const docs = (await packDocsOnce("character-options:advance-links", () =>
		getPackDocuments(CHARACTER_OPTIONS_PACK),
	)) as Array<{ name?: string; uuid?: string; type?: string }>;
	for (const doc of docs) {
		if (!doc.name) continue;
		if (doc.type !== "talent" && doc.type !== "skill") continue;
		map.set(slugify(doc.name), {
			uuid: doc.uuid ?? "",
			name: doc.name,
		});
	}
	return map;
}

/**
 * Open the linked talent/skill document from the compendium. Bead xhyu:
 * delegate to the SHARED open path — resolvePackDocument fixes the LevelDB
 * packs where fromUuid silently no-opped in-world (bead wwuc), and failures
 * are loud (console + toast) instead of dropping the click on the floor.
 */
async function openAdvance(
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	await openPackDocUuid(target.dataset.uuid ?? "", {
		notifyKey: "ADVANCE.OPEN_DOC_FAIL",
		label: "career advance link",
	});
}

/**
 * Career sheet: DESCRIPTION tab first (career prose, default), with the
 * mechanical crunch (starting kit, characteristic advance scheme, rank
 * tables) on the DATA tab. Rank/advance tables are pack data and
 * display-only; advance rows link to their talents/skills compendium
 * entries when the key resolves. All fields degrade to read-only HTML when
 * the sheet is not editable (bead 2n5).
 */
export class CareerSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	static DEFAULT_OPTIONS = itemSheetOptions({
		slug: "career",
		width: 560,
		height: 480,
		actions: {
			// Bead xhyu: share the pack-doc action convention with the other
			// doc-link surfaces (advancement dialog, creator, chat card).
			[OPEN_PACK_DOC_ACTION]: openAdvance,
		},
	});

	static PARTS = {
		header: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/header.hbs`,
		},
		tabs: {
			template: `${TEMPLATE_ROOT}sheet/item/parts/tabs.hbs`,
		},
		description: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/career-description.hbs`,
		},
		data: {
			template: `${TEMPLATE_ROOT}sheet/item/tabs/career-data.hbs`,
		},
	};

	/** Foundry 14's type-label derivation shows "undefined" for career; use our own. */
	override get title(): string {
		return `${game.i18n.localize("CAREER.HEADER")}: ${this.document.name}`;
	}

	static TABS = ITEM_DESCRIPTION_TABS;

	async _prepareContext(options: object = {}) {
		const context = sheetContext(await super._prepareContext(options as never));
		context.tabs = this._prepareTabs("primary");
		const system = this.document.system as CareerLike;
		context.careerChoices = Object.fromEntries(careers.entries());
		const indexByKey = await keyIndexMap();
		context.charAdvanceRows = Object.entries(
			system.characteristicAdvances ?? {},
		).map(([char, costs]) => ({
			char: game.i18n.localize(characteristicLabelKey(char)),
			costs,
		}));
		context.rankRows = [...(system.ranks ?? [])]
			.sort((a, b) => a.rank - b.rank)
			.map((rank) => ({
				rank: rank.rank,
				xpLevel: rank.xpLevel,
				advances: rank.advances.map(
					(adv): AdvanceRow => ({
						label:
							(adv.key ? indexByKey.get(adv.key)?.name : undefined) ??
							adv.name ??
							(adv.key || "—"),
						typeLabel: game.i18n.localize(
							adv.type === "talent"
								? "CAREER.TYPE_TALENT"
								: "CAREER.TYPE_SKILL",
						),
						cost: adv.cost,
						multiplier: adv.multiplier,
						prerequisites: adv.prerequisites?.join(", ") ?? "",
						uuid: adv.key ? (indexByKey.get(adv.key)?.uuid ?? "") : "",
					}),
				),
			}));
		context.startingSkills = system.startingSkills ?? [];
		context.startingTalents = system.startingTalents ?? [];
		context.startingGear = system.startingGear ?? [];
		Object.assign(context, await itemDataContext(this.document));
		return context;
	}
}

interface CareerLike {
	description?: string;
	characteristicAdvances?: Record<
		string,
		{ simple: number; intermediate: number; trained: number; expert: number }
	>;
	startingSkills?: string[];
	startingTalents?: string[];
	startingGear?: string[];
	ranks?: CareerRank[];
}

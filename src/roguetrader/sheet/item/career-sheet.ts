import { careers } from "../../registry";
import type { CareerRank } from "../../data/item/career";

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

interface PackIndexEntry {
	name?: string;
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
 * Key -> {uuid, name} for the skills/talents packs, so advance rows link to
 * their source items. Built from the pack indexes (no doc loads).
 */
function keyIndexMap(): Map<string, { uuid: string; name: string }> {
	const map = new Map<string, { uuid: string; name: string }>();
	const packs = game.packs as unknown as Map<
		string,
		{ index: Map<string, PackIndexEntry> }
	>;
	for (const packName of ["rogue-trader.talents", "rogue-trader.skills"]) {
		const pack = packs.get(packName);
		if (!pack) continue;
		for (const entry of pack.index.values()) {
			if (!entry.name) continue;
			map.set(slugify(entry.name), {
				uuid: entry.uuid,
				name: entry.name,
			});
		}
	}
	return map;
}

/**
 * Open the linked talent/skill document from the compendium.
 */
async function openAdvance(
	_event: unknown,
	target: HTMLElement,
): Promise<void> {
	const uuid = target.dataset.uuid;
	if (!uuid) return;
	const doc = (await foundry.utils.fromUuid(uuid)) as {
		sheet?: { render: (force?: boolean) => Promise<unknown> };
	} | null;
	await doc?.sheet?.render(true);
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
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "career"],
		position: { width: 560, height: 480 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			openAdvance,
		},
	};

	static PARTS = {
		header: {
			template: "systems/rogue-trader/template/sheet/item/parts/header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		description: {
			template:
				"systems/rogue-trader/template/sheet/item/tabs/career-description.hbs",
		},
		data: {
			template: "systems/rogue-trader/template/sheet/item/tabs/career-data.hbs",
		},
	};

	/** Foundry 14's type-label derivation shows "undefined" for career; use our own. */
	override get title(): string {
		return `${game.i18n.localize("CAREER.HEADER")}: ${this.document.name}`;
	}

	static TABS = {
		primary: {
			tabs: [
				{ id: "description", group: "primary", label: "TAB.DESCRIPTION" },
				{ id: "data", group: "primary", label: "TAB.DATA" },
			],
			initial: "description",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		context.tabs = this._prepareTabs("primary");
		const system = this.document.system as CareerLike;
		context.careerChoices = Object.fromEntries(careers.entries());
		const indexByKey = keyIndexMap();
		context.charAdvanceRows = Object.entries(
			system.characteristicAdvances ?? {},
		).map(([char, costs]) => ({
			char: game.i18n.localize(`CHARACTERISTIC.${char.toUpperCase()}`),
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
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(
				system.description ?? "",
				{
					secrets: this.document.isOwner,
					relativeTo: this.document,
				},
			);
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
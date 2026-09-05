import { crewQualityEffects, CREW_QUALITIES, type StarshipActor } from "../../data/actor/starship-actor";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

/** Row for the hull picker: ships pack `ship` docs. */
interface HullOption {
	uuid: string;
	name: string;
	hullClass: string;
	sp: number;
}

/**
 * Starship sheet (bead kwd): hull snapshot fields, crew quality (with its
 * SP delta), the two Complications (rolled from the ships pack with
 * 1d10), Ship Points and Space trackers, and notes. Fully resizable.
 */
export class ShipSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "starship"],
		position: { width: 640, height: 560 },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			rollOddity: ShipSheet.#onRollOddity,
			pickHull: ShipSheet.#onPickHull,
			rollHistory: ShipSheet.#onRollHistory,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/ship-header.hbs",
		},
		form: {
			template: "systems/rogue-trader/template/sheet/actor/tabs/starship.hbs",
		},
	};

	override get title(): string {
		return `${game.i18n.localize("STARSHIP.HEADER")}: ${this.document.name}`;
	}

	async #hullOptions(): Promise<HullOption[]> {
		const pack = game.packs?.get("rogue-trader.ships");
		if (!pack) return [];
		const docs = (await pack.getDocuments()) as unknown as Array<{
			uuid?: string;
			name?: string;
			type?: string;
			system?: { hullClass?: string; sp?: number };
		}>;
		return docs
			.filter((d) => d.type === "ship")
			.map((d) => ({
				uuid: d.uuid ?? "",
				name: d.name ?? "",
				hullClass: d.system?.hullClass ?? "",
				sp: d.system?.sp ?? 0,
			}));
	}

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as unknown as {
			hullName: string;
			hullClass: string;
			dimensions: string;
			mass: string;
			crew: string;
			accel: string;
			speed: number;
			manoeuvrability: number;
			detection: number;
			hullIntegrity: { value: number; max: number };
			armour: number;
			turretRating: number;
			space: { total: number; used: number };
			sp: { total: number; spent: number };
			weaponCapacity: string;
			crewQuality: string;
			machineSpiritOddity: string;
			pastHistory: string;
			spRemaining: number;
		};
		context.system = system;
		context.crewQualities = Object.fromEntries(
			Object.keys(CREW_QUALITIES).map((key) => [
				key,
				game.i18n.localize(`STARSHIP.CREW_${key.toUpperCase()}`),
			]),
		);
		const crew = crewQualityEffects(system.crewQuality);
		context.crewSkill = crew.skill;
		context.crewSpDelta = crew.spDelta;
		context.spRemaining = system.spRemaining;
		context.hullOptions = await this.#hullOptions();
		return context;
	}

	/** Roll 1d10 on a complications table and record the result name. */
	static async #onRollOddity(this: ShipSheet): Promise<void> {
		await this.#rollComplication("machine-spirit-oddity", "machineSpiritOddity");
	}

	/** Pick a hull from the ships pack: copy its statline into the actor. */
	static async #onPickHull(
		this: ShipSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		const hull = (await foundry.utils.fromUuid(uuid)) as unknown as {
			name?: string;
			system?: {
				hullClass?: string;
				dimensions?: string;
				mass?: string;
				crew?: string;
				accel?: string;
				speed?: number;
				manoeuvrability?: number;
				detection?: number;
				hullIntegrity?: number;
				armour?: number;
				turretRating?: number;
				space?: number;
				sp?: number;
				weaponCapacity?: string;
			};
		} | null;
		if (!hull?.system) return;
		const s = hull.system;
		await this.document.update({
			system: {
				hullName: hull.name ?? "",
				hullClass: s.hullClass ?? "",
				dimensions: s.dimensions ?? "",
				mass: s.mass ?? "",
				crew: s.crew ?? "",
				accel: s.accel ?? "",
				speed: s.speed ?? 0,
				manoeuvrability: s.manoeuvrability ?? 0,
				detection: s.detection ?? 0,
				hullIntegrity: { value: s.hullIntegrity ?? 0, max: s.hullIntegrity ?? 0 },
				armour: s.armour ?? 0,
				turretRating: s.turretRating ?? 0,
				space: { total: s.space ?? 0, used: 0 },
				sp: { total: s.sp ?? 0, spent: 0 },
				weaponCapacity: s.weaponCapacity ?? "",
			},
		} as never);
	}

	static async #onRollHistory(this: ShipSheet): Promise<void> {
		await this.#rollComplication("past-history", "pastHistory");
	}

	async #rollComplication(kind: string, field: string): Promise<void> {
		const roll = new foundry.dice.Roll("1d10");
		await roll.evaluate();
		const result = roll.total ?? 1;
		const pack = game.packs?.get("rogue-trader.ships");
		if (!pack) return;
		const docs = (await pack.getDocuments()) as unknown as Array<{
			type?: string;
			name?: string;
			system?: { kind?: string; roll?: number };
		}>;
		const hit = docs.find(
			(d) => d.type === "ship-complication" && d.system?.kind === kind && d.system?.roll === result,
		);
		await this.document.update({
			system: { [field]: hit?.name ?? `? (roll ${result})` },
		} as never);
	}
}
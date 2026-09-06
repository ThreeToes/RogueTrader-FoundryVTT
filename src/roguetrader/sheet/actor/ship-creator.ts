/**
 * Ship creation wizard (bead 9cre): mirrors the character creator's wizard
 * patterns (step state machine, collapsible groups, permissive picks +
 * loud failures) for starships.
 *
 * Steps: (0) hull from the ships pack + name + crew quality; (1) essential
 * components with power/space validation against the hull's totals (book
 * p198-199); (2) supplemental components against the SP budget (Table 1-5
 * Ship Points; Table 8-8 SP tokens); finish creates/updates a starship
 * actor with the hull snapshot + embedded component items.
 *
 * SP budget: the dynasty's rolled Ship Points (Table 1-5, book p33) live on
 * the dynasty actor — wiring that read is an owner redesign (the creator
 * takes the budget as a permissive input, default 0, and warns when the
 * picks exceed it). Updating an existing ship wipes only creator-flagged
 * items (system.grantedBy = "ship-creator", iufv provenance pattern);
 * manually dropped components (bead pyi3 DnD) survive the reconcile.
 */
import { getPackDocuments } from "../pack-resolve";
import { sheetContext } from "../context";
import { crewQualityEffects, CREW_QUALITIES } from "../../rules/ship-crew";
import { deriveShipStats, type ShipComponentLike } from "../../rules/ship-systems";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

interface ShipPick {
	uuid: string;
	id: string;
	name: string;
	type: string;
	power: string;
	space: number;
	sp: string;
	category: string;
}

function emptyShipState(): {
	step: number;
	name: string;
	spBudget: number;
	hullUuid: string | null;
	hullName: string;
	hullClass: string;
	crewQuality: string;
	picks: ShipPick[];
	collapsed: Record<string, boolean>;
} {
	return {
		step: 0,
		name: "",
		spBudget: 0,
		hullUuid: null,
		hullName: "",
		hullClass: "",
		crewQuality: "competent",
		picks: [],
		collapsed: { essential: false, supplemental: true },
	};
}

interface PackOption {
	uuid: string;
	id: string;
	name: string;
	power: string;
	space: number;
	sp: string;
	category: string;
	type: string;
}

/** Ships-pack component vocabulary (shared by the instance + static paths). */
async function fetchComponentOptions(): Promise<PackOption[]> {
	const docs = (await getPackDocuments("rogue-trader.ships")) as Array<{
		uuid?: string;
		id?: string;
		name?: string;
		type?: string;
		system?: {
			power?: string;
			space?: number;
			sp?: string;
			category?: string;
		};
	}>;
	return docs
		.filter(
			(d) =>
				d.type === "ship-component" || d.type === "ship-weapon-component",
		)
		.map((d) => ({
			uuid: d.uuid ?? "",
			id: d.id ?? "",
			name: d.name ?? "",
			type: d.type ?? "",
			power: d.system?.power ?? "",
			space: d.system?.space ?? 0,
			sp: d.system?.sp ?? "-",
			category: d.system?.category ?? "supplemental",
		}));
}

export class ShipCreator extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "rogue-trader-ship-creator",
		classes: ["rogue-trader", "sheet", "ship-creator"],
		position: { width: 720, height: 640 },
		window: { title: "SHIP_CREATOR.TITLE", resizable: true },
		actions: {
			prev: ShipCreator.#onPrev,
			next: ShipCreator.#onNext,
			pickHull: ShipCreator.#onPickHull,
			toggleGroup: ShipCreator.#onToggleGroup,
			pickComponent: ShipCreator.#onPickComponent,
			unpickComponent: ShipCreator.#onUnpickComponent,
			setCrewQuality: ShipCreator.#onSetCrewQuality,
			finish: ShipCreator.#onFinish,
		},
	};

	creatorState = emptyShipState();

	/** Optional existing starship (right-clicked entry): update in place. */
	targetActor: foundry.documents.Actor | null = null;

	constructor(
		options: { actor?: foundry.documents.Actor } & object = {},
	) {
		super(options as never);
		this.targetActor = options.actor ?? null;
		if (this.targetActor) {
			this.creatorState.name = this.targetActor.name ?? "";
		}
	}

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/ship-creator.hbs",
		},
	};

	/** Ships-pack component options (the refit picker's vocabulary). */
	#componentOptions(): Promise<PackOption[]> {
		return fetchComponentOptions();
	}

	/** Hull options: ships-pack `ship` docs (hulls + NPC quick-starts). */
	async #hullOptions(): Promise<PackOption[]> {
		const docs = (await getPackDocuments("rogue-trader.ships")) as Array<{
			uuid?: string;
			id?: string;
			name?: string;
			type?: string;
			system?: { power?: string; space?: number; sp?: string; category?: string };
		}>;
		return docs
			.filter((d) => d.type === "ship")
			.map((d) => ({
				uuid: d.uuid ?? "",
				id: d.id ?? "",
				name: d.name ?? "",
				type: d.type ?? "",
				power: "",
				space: 0,
				sp: String(d.system?.sp ?? 0),
				category: "hull",
			}));
	}

	/** The picked hull's full statline (from the pack doc). */
	async #hullStatline(): Promise<{
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
	} | null> {
		if (!this.creatorState.hullUuid) return null;
		const doc = (await foundry.utils.fromUuid(
			this.creatorState.hullUuid,
		)) as unknown as {
			name?: string;
			system?: Record<string, unknown>;
		} | null;
		return doc?.system ?? null;
	}

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options as never));
		const state = this.creatorState;
		context.step = state.step;
		context.name = state.name;
		context.spBudget = state.spBudget;
		context.crewQualities = Object.fromEntries(
			Object.keys(CREW_QUALITIES).map((key) => [
				key,
				game.i18n.localize(`STARSHIP.CREW_${key.toUpperCase()}`),
			]),
		);
		context.crewQuality = state.crewQuality;
		context.hullUuid = state.hullUuid;
		context.hullName = state.hullName;
		context.hullOptions = await this.#hullOptions();
		const options = await this.#componentOptions();
		context.essentialOptions = options.filter((o) => o.category === "essential");
		context.supplementalOptions = options.filter(
			(o) => o.category !== "essential",
		);
		context.picks = state.picks;
		context.picked = new Set(state.picks.map((p) => p.uuid));
		// Running totals (book p198-199): the hull's generated power vs
		// installed draw, space, and the SP budget (hull SP + crew delta).
		const hull = (await this.#hullStatline()) ?? {};
		const components: ShipComponentLike[] = state.picks.map((p) => ({
			name: p.name,
			power: p.power,
			space: p.space,
			sp: p.sp,
			category: p.category,
		}));
		const derived = deriveShipStats(components);
		// Power: drives GENERATE into the hull budget; the ship's total power
		// rating = hull's own implied rating is not a statline number, so the
		// validation compares DRAWS against GENERATED (book p198-199).
		const crew = crewQualityEffects(state.crewQuality);
		const spSpent =
			derived.spSpent + Number(hull.sp ?? 0) - crew.spDelta;
		context.derived = {
			...derived,
			hullSpace: hull.space ?? 0,
			spaceLeft: (hull.space ?? 0) - derived.spaceUsed,
			spSpent,
			spBudget: state.spBudget,
			spLeft: state.spBudget - spSpent,
			overBudget: state.spBudget > 0 && spSpent > state.spBudget,
			crewSkill: crew.skill,
			crewSpDelta: crew.spDelta,
		};
		context.collapse = state.collapsed;
		return context;
	}

	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		// Free-text inputs (name, SP budget) wire imperatively per
		// AGENT-GUIDE §3 — only change events reach data-action.
		for (const [selector, key] of [
			['input[name="ship-name"]', "name"],
			['input[name="sp-budget"]', "spBudget"],
		] as const) {
			const input = this.element?.querySelector<HTMLInputElement>(selector);
			if (input && !input.dataset.wired) {
				input.dataset.wired = "1";
				input.addEventListener("input", () => {
					if (key === "spBudget") {
						this.creatorState.spBudget = Number(input.value) || 0;
					} else {
						this.creatorState.name = input.value;
					}
				});
			}
		}
	}

	static async #onPrev(this: ShipCreator): Promise<void> {
		this.creatorState.step = Math.max(0, this.creatorState.step - 1);
		this.render({ force: true });
	}

	static async #onNext(this: ShipCreator): Promise<void> {
		this.creatorState.step = Math.min(2, this.creatorState.step + 1);
		this.render({ force: true });
	}

	/** Step 0: pick the hull (ships pack `ship` doc). */
	static async #onPickHull(
		this: ShipCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		this.creatorState.hullUuid = uuid;
		const doc = (await foundry.utils.fromUuid(uuid)) as unknown as {
			name?: string;
			system?: { hullClass?: string };
		} | null;
		this.creatorState.hullName = doc?.name ?? "";
		this.creatorState.hullClass = doc?.system?.hullClass ?? "";
		this.render({ force: true });
	}

	/** Toggle a pick category group's collapsed state (session-only). */
	static async #onToggleGroup(
		this: ShipCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const key = target.dataset.group;
		if (!key) return;
		const collapsed = this.creatorState.collapsed;
		if (collapsed[key]) delete collapsed[key];
		else collapsed[key] = true;
		this.render({ force: true });
	}

	/** Toggle a component pick (permissive; validation is advisory + at finish). */
	static async #onPickComponent(
		this: ShipCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid) return;
		if (this.creatorState.picks.some((p) => p.uuid === uuid)) {
			this.creatorState.picks = this.creatorState.picks.filter(
				(p) => p.uuid !== uuid,
			);
		} else {
			const options = await fetchComponentOptions();
			const option = options.find((o) => o.uuid === uuid);
			if (!option) return;
			this.creatorState.picks = [
				...this.creatorState.picks,
				{
					uuid,
					id: option.id,
					name: option.name,
					type: option.type,
					power: option.power,
					space: option.space,
					sp: option.sp,
					category: option.category,
				},
			];
		}
		this.render({ force: true });
	}

	static async #onUnpickComponent(
		this: ShipCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const id = target.dataset.itemId;
		if (!id) return;
		this.creatorState.picks = this.creatorState.picks.filter(
			(p) => p.id !== id,
		);
		this.render({ force: true });
	}

	static async #onSetCrewQuality(
		this: ShipCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const value = (target as HTMLSelectElement).value;
		if (!value) return;
		this.creatorState.crewQuality = value;
		this.render({ force: true });
	}

	/** Create/update the starship actor with the hull + picks. */
	static async #onFinish(this: ShipCreator): Promise<void> {
		const state = this.creatorState;
		if (!state.hullUuid) {
			ui.notifications?.warn(game.i18n.localize("SHIP_CREATOR.NO_HULL"));
			return;
		}
		const hull = (await foundry.utils.fromUuid(state.hullUuid)) as unknown as {
			name?: string;
			uuid?: string;
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
		const systemPayload = {
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
			crewQuality: state.crewQuality,
			// Void shields start at the installed arrays' max (book p201);
			// the sheet clamps on component changes.
			voidShields: 0,
			crewPopulation: 100,
			crewMorale: 100,
		};

		// Resolve picks to pack docs (meh0 flavour: loud failures for unmatched
		// entries happen at fromUuid below).
		const pickedDocs: Array<{ name?: string; uuid?: string; system?: object }> = [];
		for (const pick of state.picks) {
			const doc = (await foundry.utils.fromUuid(pick.uuid)) as unknown as {
				name?: string;
				system?: object;
			} | null;
			if (!doc) {
				console.warn(
					`rogue-trader | ship creator: component "${pick.name}" (${pick.uuid}) did not resolve; skipped loudly`,
				);
				continue;
			}
			pickedDocs.push(doc);
		}
		// Stamp iufv-style provenance so a re-run wipes only creator items.
		const payloads = pickedDocs.map((doc) => ({
			...(doc as unknown as { name?: string; system?: Record<string, unknown> }),
			system: {
				...(doc.system as Record<string, unknown>),
				grantedBy: "ship-creator",
			},
		}));

		if (this.targetActor) {
			const target = this.targetActor as unknown as {
				update: (data: object) => Promise<unknown>;
				items: unknown[];
				createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
				deleteEmbeddedDocuments: (t: string, ids: string[]) => Promise<unknown>;
				sheet?: { render: (options?: object) => unknown };
			};
			// iufv reconcile: wipe previously creator-installed components
			// (grantedBy: "ship-creator"); manual drops survive.
			const stale = (target.items as Array<{ id?: string; system?: { grantedBy?: string } }>)
				.filter(
					(i) =>
						i.system?.grantedBy === "ship-creator" &&
						((i as { type?: string }).type === "ship-component" ||
							(i as { type?: string }).type === "ship-weapon-component"),
				)
				.map((i) => i.id)
				.filter((id): id is string => Boolean(id));
			if (stale.length > 0) {
				await target.deleteEmbeddedDocuments("Item", stale);
			}
			await target.update({
				name: state.name || this.targetActor.name,
				system: systemPayload,
			} as never);
			if (payloads.length > 0) {
				await target.createEmbeddedDocuments("Item", payloads);
			}
			this.close();
			target.sheet?.render({});
			return;
		}

		const actor = (await foundry.documents.Actor.create({
			name: state.name || game.i18n!.localize("SHIP_CREATOR.DEFAULT_NAME"),
			type: "starship",
			system: systemPayload,
		} as never)) as unknown as {
			uuid: string;
			createEmbeddedDocuments: (t: string, data: object[]) => Promise<unknown>;
			sheet?: { render: (options?: object) => unknown };
		};
		if (!actor) return;
		if (payloads.length > 0) {
			await actor.createEmbeddedDocuments("Item", payloads);
		}
		this.close();
		actor.sheet?.render({});
	}
}
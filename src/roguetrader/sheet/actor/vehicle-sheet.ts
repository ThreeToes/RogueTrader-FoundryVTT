import { Vehicle } from "../../data/actor/vehicle";
import {
	vehicleClasses,
	vehicleFacings,
	vehicleSystems,
	vehicleTraits,
} from "../../registry";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
	static DEFAULT_OPTIONS = {
		classes: ["rogue-trader", "sheet", "vehicle"],
		position: { width: 560, height: "auto" },
		window: { resizable: true },
		form: { submitOnChange: true, closeOnSubmit: false },
		actions: {
			removeCrew: VehicleSheet.#onRemoveCrew,
			removeMounted: VehicleSheet.#onRemoveMounted,
		},
	};

	static PARTS = {
		header: {
			template:
				"systems/rogue-trader/template/sheet/actor/parts/vehicle-header.hbs",
		},
		tabs: {
			template: "systems/rogue-trader/template/sheet/item/parts/tabs.hbs",
		},
		status: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/vehicle-status.hbs",
		},
		weapons: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/vehicle-weapons.hbs",
		},
		details: {
			template:
				"systems/rogue-trader/template/sheet/actor/tabs/vehicle-details.hbs",
		},
	};

	static TABS = {
		primary: {
			tabs: [
				{ id: "status", group: "primary", label: "TAB.STATUS" },
				{ id: "weapons", group: "primary", label: "TAB.WEAPONS" },
				{ id: "details", group: "primary", label: "TAB.DETAILS" },
			],
			initial: "status",
		},
	};

	async _prepareContext(options: object = {}) {
		const context = await super._prepareContext(options);
		const system = this.document.system as Vehicle;

		// Per-facing armour rows from the registry (same anatomy as the armour
		// tab body layout on character sheets).
		context.facings = vehicleFacingsEntries().map(([key, labelKey]) => ({
			key,
			label: labelKey,
			ap: system.armourAt(key),
		}));

		// System slots: rating + damaged toggle per registry entry.
		context.systemRows = vehicleSystemsEntries().map(([key, labelKey]) => {
			const slot = system.systems?.[key] ?? { rating: 0, damaged: false };
			return {
				key,
				label: labelKey,
				rating: slot.rating,
				damaged: slot.damaged,
			};
		});

		context.classChoices = Object.fromEntries(vehicleClasses.entries());
		context.traitChoices = Object.fromEntries(vehicleTraits.entries());
		context.traitFlags = Object.fromEntries(
			(system.traits ?? []).map((t) => [t, true]),
		);
		context.facingChoices = Object.fromEntries(vehicleFacings.entries());
		context.descriptionHTML =
			await foundry.applications.ux.TextEditor.enrichHTML(system.description, {
				secrets: this.actor.isOwner,
				relativeTo: this.actor,
			});

		// Crew rows (resolved names from Actor UUIDs - references, not embedded).
		context.crewRows = (system.crew ?? []).map((uuid) => ({
			uuid,
			name: foundry.utils.fromUuidSync(uuid as never)?.name ?? uuid,
		}));

		// Mounted weapon rows + facing choices.
		context.mountedRows = await Promise.all(
			(system.mountedWeapons ?? []).map(async (m, index) => {
				const doc = await foundry.utils.fromUuid(m.uuid);
				return {
					uuid: m.uuid,
					facing: m.facing,
					name: doc?.name ?? m.uuid,
				};
			}),
		);

		return context;
	}

	/**
	 * Drop wiring (bead 292): Actor drops join the crew; weapon Item drops are
	 * mounted into the front-facing slot by default (editable via the select).
	 */
	async _onDrop(event: DragEvent): Promise<unknown> {
		const data = foundry.applications.ux.TextEditor.getDragEventData(
			event,
		) as DragVehicleData;
		if (!data.uuid) return;
		const system = this.document.system as Vehicle;

		if (data.type === "Actor") {
			if ((system.crew ?? []).includes(data.uuid)) return;
			return this.actor.update({
				system: { crew: [...(system.crew ?? []), data.uuid] },
			});
		}
		if (data.type === "Item") {
			const doc = await foundry.utils.fromUuid(data.uuid);
			if (!(doc instanceof foundry.documents.Item)) return;
			if (
				!(
					(doc.type as string) === "melee-weapon" ||
					(doc.type as string) === "ranged-weapon"
				)
			) {
				return;
			}
			return this.actor.update({
				system: {
					mountedWeapons: [
						...(system.mountedWeapons ?? []),
						{ uuid: data.uuid, facing: "front" },
					],
				},
			});
		}
		return;
	}

	static async #onRemoveCrew(
		this: VehicleSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.closest<HTMLElement>("[data-uuid]")?.dataset.uuid;
		if (!uuid) return;
		const system = this.document.system as Vehicle;
		await this.actor.update({
			system: { crew: (system.crew ?? []).filter((u) => u !== uuid) },
		});
	}

	static async #onRemoveMounted(
		this: VehicleSheet,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const index = Number(target.dataset.index);
		if (Number.isNaN(index)) return;
		const system = this.document.system as Vehicle;
		const mounted = [...(system.mountedWeapons ?? [])];
		mounted.splice(index, 1);
		await this.actor.update({ system: { mountedWeapons: mounted } });
	}
}

/** Registry entry helpers (typed wrappers for template iteration). */
function vehicleFacingsEntries(): Array<[string, string]> {
	return Object.entries(vehicleFacings.choices);
}
function vehicleSystemsEntries(): Array<[string, string]> {
	return Object.entries(vehicleSystems.choices);
}

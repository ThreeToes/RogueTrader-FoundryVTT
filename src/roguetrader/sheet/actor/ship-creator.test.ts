/**
 * Pre-equipped hull components (BFK printed p30, the Universe-class Mass
 * Conveyor): the hull's `preEquipped` names install as LOCKED picks in the
 * ship creator — counted in the derived totals ("+10 Generated" →
 * powerGenerated), not removable via the supplemental chips, not replaceable
 * through an essential slot, and installed at finish like any other pick
 * (same grantedBy "ship-creator" reconcile stamp, so a re-finish does not
 * duplicate).
 *
 * Harness: the same Foundry globals shim + fake Actor surface pattern as
 * planet-creator.test.ts / creators.test.ts, plus a fake ContentPort so
 * getPackDocuments serves the fake ships pack (the pack-resolve seam) and a
 * fromUuid record so hull/component picks resolve. No mock.module (bun test
 * shares one process).
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { deriveShipStats } from "../../rules/ship-systems";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../../infrastructure/foundry/ports";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;

const uuidDocs: Record<string, Record<string, unknown>> = {};

/** Ships-pack documents served to the fake ContentPort (by pack id). */
const packDocs: Record<string, Array<Record<string, unknown>>> = {};

const ESSENTIAL_TYPES = [
	"plasma-drive",
	"warp-engine",
	"geller-field",
	"void-shield",
	"bridge",
	"life-sustainer",
	"crew-quarters",
	"augur-array",
] as const;

globals.game = {
	i18n: { localize: (key: string) => `L10N[${key}]`, format: (key: string) => key },
	system: { id: "rogue-trader" },
};
globals.ui = { notifications: { warn: () => undefined, info: () => undefined } };
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {
				async _prepareContext(): Promise<Record<string, unknown>> {
					return {};
				}
			},
			DialogV2: { wait: async () => null, input: async () => null },
		},
		handlebars: {
			renderTemplate: async () => "",
			getTemplate: async () => () => "",
		},
	},
	handlebars: { renderTemplate: async () => "", getTemplate: async () => () => "" },
	documents: {
		Item: class {},
		Actor: class {
			static async create(): Promise<unknown> {
				return null;
			}
		},
		ChatMessage: { get: () => undefined },
	},
	utils: {
		mergeObject: () => undefined,
		fromUuid: async (uuid: string) =>
			(uuidDocs as Record<string, unknown>)[uuid] ?? null,
	},
};

const { ShipCreator } = await import("./ship-creator");

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

/** The test-visible slice of the creator (state + the edge we stub). */
interface CreatorLike {
	creatorState: {
		hullUuid: string | null;
		picks: Array<{
			uuid: string;
			id: string;
			name: string;
			type: string;
			power: string;
			space: number;
			sp: string;
			category: string;
			componentType: string;
			locked: boolean;
		}>;
	};
	targetActor: unknown;
	name: string;
	render: (options?: object) => unknown;
	close: () => void;
	_prepareContext: (options?: object) => Promise<Record<string, unknown>>;
}

/** An accumulating fake starship actor (delete/create/inspect by our tests). */
interface FakeActor {
	items: Array<{
		id?: string;
		type: string;
		name?: string;
		system: Record<string, unknown>;
	}>;
	update: (data: object) => Promise<unknown>;
	createEmbeddedDocuments: (type: string, data: object[]) => Promise<unknown[]>;
	deleteEmbeddedDocuments: (type: string, ids: string[]) => Promise<string[]>;
	sheet: { render: () => undefined };
}

function fakeActor(): { actor: FakeActor; items: FakeActor["items"] } {
	const items: FakeActor["items"] = [];
	const actor: FakeActor = {
		items,
		update: async () => undefined,
		createEmbeddedDocuments: async (_t: string, data: object[]) => {
			const rows = data as Record<string, unknown>[];
			for (const row of rows) {
				items.push(row as FakeActor["items"][number]);
			}
			return rows;
		},
		deleteEmbeddedDocuments: async (_t: string, ids: string[]) => {
			for (let i = items.length - 1; i >= 0; i--) {
				if (ids.includes(items[i]?.id ?? "")) items.splice(i, 1);
			}
			return ids;
		},
		sheet: { render: () => undefined },
	};
	return { actor, items };
}

function makeCreator(actor: FakeActor | null): CreatorLike {
	const instance = new ShipCreator(
		actor ? { actor: actor as never } : ({} as never),
	) as unknown as CreatorLike;
	instance.render = () => undefined;
	instance.close = () => undefined;
	return instance;
}

/** The public action routes into the private pick/finish handlers. */
type ActionFn = (
	this: CreatorLike,
	_event: unknown,
	target: { dataset: { uuid: string } },
) => Promise<void>;

function actions(): Record<string, ActionFn | (() => Promise<void>)> {
	return (
		ShipCreator.DEFAULT_OPTIONS as unknown as { actions: Record<string, unknown> }
	).actions as Record<string, ActionFn | (() => Promise<void>)>;
}

function pickHull(instance: CreatorLike, uuid: string): Promise<void> {
	return (actions().pickHull as ActionFn).call(instance, null, {
		dataset: { uuid },
	});
}

function pickComponent(instance: CreatorLike, uuid: string): Promise<void> {
	return (actions().pickComponent as ActionFn).call(instance, null, {
		dataset: { uuid },
	});
}

function finishOf(instance: CreatorLike): Promise<void> {
	return (actions().finish as () => Promise<void>).call(instance);
}

/** Seed the fake pack + fromUuid docs for the Universe-hull scenarios. */
function seedUniverseDocs(): void {
	const genetorium = {
		_id: "pack-gen",
		name: "Secondary Power Genetorium",
		uuid: "Comp.genetorium",
		type: "ship-component",
		system: {
			category: "supplemental",
			componentType: "supplemental",
			hullTypes: "Universe-class",
			power: "+10 Generated",
			space: 0,
			sp: "-",
		},
	};
	const macro = {
		_id: "pack-macro",
		name: "Mars Pattern Macrocannon Battery",
		uuid: "Comp.macro",
		type: "ship-weapon-component",
		system: {
			category: "supplemental",
			componentType: "macrobattery",
			hullTypes: "All Ships",
			power: "3",
			space: 2,
			sp: "1",
		},
	};
	const hull = {
		_id: "pack-hull",
		name: "Universe-class Mass Conveyor",
		uuid: "Hull.universe",
		type: "ship",
		system: {
			hullClass: "transport",
			space: 94,
			sp: 45,
			preEquipped: "Secondary Power Genetorium",
		},
	};
	packDocs["rogue-trader.ships"] = [hull, genetorium, macro];
	uuidDocs["Hull.universe"] = hull;
	uuidDocs["Comp.genetorium"] = genetorium;
	uuidDocs["Comp.macro"] = macro;
}

beforeEach(() => {
	seedUniverseDocs();
	setPorts({
		...foundryPorts,
		content: {
			...foundryPorts.content,
			documentsOrNull: async (packId: string) => packDocs[packId] ?? null,
		},
	});
});

afterEach(() => {
	resetPorts();
});

/** Hand-built essential picks so finish passes the completeness gate. */
function addEssentialPicks(instance: CreatorLike): void {
	for (let i = 0; i < ESSENTIAL_TYPES.length; i++) {
		const uuid = `Essential.${i}`;
		uuidDocs[uuid] = {
			name: `Essential ${i}`,
			uuid,
			type: "ship-component",
			system: { power: "1", space: 1, sp: "-", category: "essential" },
		};
		instance.creatorState.picks.push({
			uuid,
			id: "",
			name: `Essential ${i}`,
			type: "ship-component",
			power: "1",
			space: 1,
			sp: "-",
			category: "essential",
			componentType: ESSENTIAL_TYPES[i] as string,
			locked: false,
		});
	}
}

describe("pre-equipped hull components (BFK p30, Universe genetorium)", () => {
	test("picking the hull installs the pre-equipped component as a locked pick", async () => {
		const instance = makeCreator(null);
		await pickHull(instance, "Hull.universe");
		const picks = instance.creatorState.picks;
		expect(picks).toHaveLength(1);
		expect(picks[0]?.name).toBe("Secondary Power Genetorium");
		expect(picks[0]?.locked).toBe(true);
		expect(picks[0]?.power).toBe("+10 Generated");
	});

	test("the locked pick's +10 Generated counts as generated power (the exact _prepareContext mapping)", async () => {
		// NOTE: we don't call _prepareContext — the first test file to load
		// ship-creator fixes its base class stub (creators.test.ts harness
		// note), so the super._prepareContext hop is not reproducible across
		// the suite. The context maps picks -> components verbatim (locked
		// picks live IN state.picks, so they flow through unchanged) and
		// totals via deriveShipStats; run that exact mapping + derivation.
		const instance = makeCreator(null);
		await pickHull(instance, "Hull.universe");
		const components = instance.creatorState.picks.map((p) => ({
			name: p.name,
			power: p.power,
			space: p.space,
			sp: p.sp,
			category: p.category,
		}));
		const derived = deriveShipStats(components);
		expect(derived.powerGenerated).toBe(10);
		expect(derived.powerUsed).toBe(0);
		expect(derived.spaceUsed).toBe(0);
	});

	test("a locked pick cannot be removed via its chip; unlocked picks still toggle off", async () => {
		const instance = makeCreator(null);
		await pickHull(instance, "Hull.universe");
		// Toggle the locked component's chip: no removal.
		await pickComponent(instance, "Comp.genetorium");
		expect(instance.creatorState.picks).toHaveLength(1);
		expect(instance.creatorState.picks[0]?.locked).toBe(true);
		// A normal supplement pick toggles on and then off as before.
		await pickComponent(instance, "Comp.macro");
		expect(instance.creatorState.picks.map((p) => p.name)).toContain(
			"Mars Pattern Macrocannon Battery",
		);
		await pickComponent(instance, "Comp.macro");
		expect(instance.creatorState.picks).toHaveLength(1);
	});

	test("an essential slot holding a locked pick of that type is not replaceable", async () => {
		const instance = makeCreator(null);
		// Seed a LOCKED pick of a component type, then try to replace it
		// through the chip route (the chip pick replaces its type's pick).
		instance.creatorState.picks.push({
			uuid: "Comp.locked-drive",
			id: "",
			name: "Locked Drive",
			type: "ship-component",
			power: "1",
			space: 1,
			sp: "-",
			category: "essential",
			componentType: "plasma-drive",
			locked: true,
		});
		uuidDocs["Comp.other-drive"] = {
			name: "Other Drive",
			uuid: "Comp.other-drive",
			type: "ship-component",
			system: { power: "30 Generated", space: 8, sp: "-", category: "essential", componentType: "plasma-drive" },
		};
		packDocs["rogue-trader.ships"].push({
			_id: "pack-other",
			name: "Other Drive",
			uuid: "Comp.other-drive",
			type: "ship-component",
			system: { power: "30 Generated", space: 8, sp: "-", category: "essential", componentType: "plasma-drive" },
		});
		await pickComponent(instance, "Comp.other-drive");
		expect(
			instance.creatorState.picks.filter((p) => p.componentType === "plasma-drive").map((p) => p.name),
		).toEqual(["Locked Drive"]);
	});

	test("finish installs the pre-equipped component with the creator grant stamp", async () => {
		const { actor, items } = fakeActor();
		const instance = makeCreator(actor);
		await pickHull(instance, "Hull.universe");
		addEssentialPicks(instance);
		instance.name = "Rogue Trader";
		await finishOf(instance);
		const installed = items.filter(
			(item) => item.name === "Secondary Power Genetorium",
		);
		expect(installed).toHaveLength(1);
		expect(installed[0]?.system.grantedBy).toBe("ship-creator");
	});

	test("a re-finish does not duplicate the pre-equipped item (locked pick skipped; reconcile wipes creator items first)", async () => {
		const { actor, items } = fakeActor();
		items.push({
			id: "old-gen",
			type: "ship-component",
			name: "Secondary Power Genetorium",
			system: { grantedBy: "ship-creator" },
		});
		const instance = makeCreator(actor);
		await pickHull(instance, "Hull.universe");
		addEssentialPicks(instance);
		instance.name = "Rogue Trader";
		await finishOf(instance);
		expect(
			items.filter((item) => item.name === "Secondary Power Genetorium"),
		).toHaveLength(1);
	});

	test("an unresolvable preEquipped name warns loudly naming the hull + component and installs nothing", async () => {
		const warns: unknown[] = [];
		const originalWarn = console.warn;
		console.warn = (message: unknown) => {
			warns.push(message);
		};
		const hull = {
			name: "Bad Hull",
			uuid: "Hull.bad",
			type: "ship",
			system: { hullClass: "transport", preEquipped: "Made-up Component" },
		};
		packDocs["rogue-trader.ships"].push(hull);
		uuidDocs["Hull.bad"] = hull;
		const instance = makeCreator(null);
		await pickHull(instance, "Hull.bad");
		console.warn = originalWarn;
		expect(instance.creatorState.picks).toEqual([]);
		expect(
			warns.some(
				(w) =>
					String(w).includes("Bad Hull") &&
					String(w).includes("Made-up Component"),
			),
		).toBe(true);
	});
});
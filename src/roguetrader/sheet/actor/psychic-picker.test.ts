/**
 * The PsychicPicker's add-power grant, pinned at the clone seam (bead
 * foundryvtt-rogue-trader-xynx): a granted power clone must NOT carry the
 * pack doc's _id — two Items cannot share an _id (repo convention; the kit
 * clones and the grant sites establish it). Same Foundry-globals shim +
 * dynamic-import pattern as creator-apply-kit.test.ts.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { NO_CONTENT_PORT } from "../../../ffg/application/ports";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../../../ffg/infrastructure/foundry/ports";

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Hooks", "CONFIG"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;

globals.game = {
	i18n: { localize: (key: string) => `L10N[${key}]` },
	system: { id: "rogue-trader" },
};
globals.ui = { notifications: { warn: () => undefined } };
globals.CONFIG = {};
globals.Hooks = { once: () => undefined, on: () => undefined };
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	documents: { Item: class {}, Actor: class {} },
	utils: { mergeObject: () => undefined },
};

const UUID = "Compendium.rogue-trader.character-options.Item.smiteId";
const POWER_DOC = {
	uuid: UUID,
	name: "Smite",
	type: "psychicpower",
	toObject: () => ({
		_id: "smiteId",
		name: "Smite",
		type: "psychicpower",
		system: { powerClass: "bound" },
	}),
};

afterEach(() => resetPorts());
afterAll(() => {
	resetPorts();
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const { PsychicPicker } = await import("./psychic-picker");

/** A fake `this` (the handler only reads actor + render off the picker). */
function fakePicker() {
	const created: Record<string, unknown>[] = [];
	const actor = {
		createEmbeddedDocuments: async (_type: string, data: object[]) => {
			created.push(...(data as Record<string, unknown>[]));
			return data.map(() => ({ id: "new-1" }));
		},
	};
	const picker = { actor, render: () => undefined };
	return { picker, created };
}

type AddPowerHandler = (
	this: InstanceType<typeof PsychicPicker>,
	_event: unknown,
	target: { dataset: { uuid?: string } },
) => Promise<void>;

describe("PsychicPicker addPower clone (bead foundryvtt-rogue-trader-xynx)", () => {
	test("the granted power clone carries no _id", async () => {
		const asked: string[] = [];
		// Full Ports via the production base: only the content port's document
		// lookup is exercised, so only it is overridden — no cast needed.
		setPorts({
			...foundryPorts,
			content: {
				...NO_CONTENT_PORT,
				document: async (uuid: string) => {
					asked.push(uuid);
					return POWER_DOC;
				},
			},
		});
		const { picker, created } = fakePicker();
		const addPower = PsychicPicker.DEFAULT_OPTIONS.actions
			.addPower as unknown as AddPowerHandler;
		await addPower.call(picker as never, {}, { dataset: { uuid: UUID } });
		expect(asked).toEqual([UUID]);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ name: "Smite" });
		expect(created[0]._id).toBeUndefined();
	});
});

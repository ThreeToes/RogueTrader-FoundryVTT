/**
 * The SkillPicker's catalog-grant action, pinned at the clone seam
 * (bead foundryvtt-rogue-trader-xynx): a granted skill clone must NOT carry
 * the pack doc's _id — two Items cannot share an _id (repo convention; the
 * kit clones and the grant sites establish it). Same Foundry-globals
 * shim + dynamic-import pattern as creator-apply-kit.test.ts.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { NO_CONTENT_PORT, type Ports } from "../../../ffg/application/ports";
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
	abstract: { TypeDataModel: class {} },
	data: { fields: {} },
	documents: { Item: class {}, Actor: class {} },
	utils: { mergeObject: () => undefined },
};

afterEach(() => resetPorts());
afterAll(() => {
	resetPorts();
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

const { SkillPicker } = await import("./skill-picker");

const SKILL_DOC = {
	id: "pack-awareness",
	name: "Awareness",
	type: "skill",
	toObject: () => ({
		_id: "pack-awareness",
		name: "Awareness",
		type: "skill",
		system: { characteristic: "per" },
	}),
};

const fakePorts: Ports = {
	...foundryPorts,
	content: {
		...NO_CONTENT_PORT,
		documentsOrNull: async () => [SKILL_DOC],
		document: async () => null,
	},
};

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

type AddCatalogHandler = (
	this: InstanceType<typeof SkillPicker>,
	_event: unknown,
	target: { dataset: { name?: string } },
) => Promise<void>;

describe("SkillPicker addCatalog clone (bead foundryvtt-rogue-trader-xynx)", () => {
	test("the granted skill clone carries no _id", async () => {
		setPorts(fakePorts);
		const { picker, created } = fakePicker();
		const addCatalog = SkillPicker.DEFAULT_OPTIONS.actions
			.addCatalog as unknown as AddCatalogHandler;
		await addCatalog.call(
			picker as never,
			{},
			{ dataset: { name: "Awareness" } },
		);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ name: "Awareness" });
		expect(created[0]._id).toBeUndefined();
	});
});

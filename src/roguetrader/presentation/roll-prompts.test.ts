/**
 * Roll-prompt HTML escaping (bead 3z02): DialogV2 prompts build their content
 * by hand, so any document-data interpolation must go through
 * `Handlebars.escapeExpression` before it lands in the HTML — a component
 * name containing a quote or markup used to break/inject into the dialog.
 *
 * The Foundry globals are stubbed BEFORE the dynamic import (roll-prompts
 * touches foundry.applications); the real `handlebars` escape function is
 * installed as the global so the production escape path is exercised.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import HandlebarsLib from "handlebars";

interface DialogInput {
	content: string;
}

const dialogRequests: DialogInput[] = [];
let nextInputResult: unknown = null;

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry", "Handlebars"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, vars?: Record<string, unknown>) =>
			vars ? `${key}:${JSON.stringify(vars)}` : key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: { warn: () => undefined, error: () => undefined, info: () => undefined },
};
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
			DialogV2: {
				wait: async (options: DialogInput) => {
					dialogRequests.push(options);
					return null;
				},
				input: async (options: DialogInput) => {
					dialogRequests.push(options);
					return nextInputResult;
				},
			},
		},
		handlebars: { renderTemplate: async () => "<div>card</div>" },
	},
	utils: { fromUuidSync: () => null },
};
(globalThis as Record<string, unknown>).Handlebars = HandlebarsLib;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { promptTargetComponent, promptShieldAbsorption, escapeDocumentData } =
	await import("./roll-prompts");
const { foundryPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
	resetPorts();
	dialogRequests.length = 0;
	nextInputResult = null;
	globals.Handlebars = HandlebarsLib;
});

afterAll(() => {
	for (const key of ["game", "ui", "foundry", "Handlebars"]) {
		if (originalGlobals[key] === undefined)
			delete globals[key];
		else globals[key] = originalGlobals[key];
	}
});

// --- helpers ----------------------------------------------------------------

function targetWithItems(items: Array<Record<string, unknown>>): unknown {
	return {
		items: {
			filter: (fn: (item: { type: string }) => boolean) =>
				items.filter((item) => fn(item as { type: string })),
			get: (id: string) =>
				items.find((item) => item.id === id) ?? null,
		},
	};
}

function setPortsWithI18n() {
	setPorts({ ...foundryPorts });
}

/** The same transformation handlebars applies to `<`, `>`, `"`, `'`, `&`. */
function expectedEscape(name: string): string {
	return HandlebarsLib.escapeExpression(name);
}

// --- escapeDocumentData (fallback branch, bead nrfr) -------------------------

describe("escapeDocumentData fallback (bead nrfr)", () => {
	test("entity parity with the Handlebars path when the global is deleted", () => {
		const name = 'Bob "the" <Vat> & Sons';
		const savedHb = globals.Handlebars;
		delete globals.Handlebars;
		try {
			// Not tautological: the global is gone, so this runs the hand-rolled
			// branch — it must still pin against the same escape output the
			// Handlebars path produces.
			expect(escapeDocumentData(name)).toBe(
				'Bob &quot;the&quot; &lt;Vat&gt; &amp; Sons',
			);
			expect(escapeDocumentData(name)).toBe(expectedEscape(name));
		} finally {
			globals.Handlebars = savedHb;
		}
	});

	test("a Handlebars-like stub without escapeExpression falls back instead of throwing", () => {
		const savedHb = globals.Handlebars;
		globals.Handlebars = {};
		try {
			expect(escapeDocumentData("Evil & Co <Ltd>")).toBe(
				"Evil &amp; Co &lt;Ltd&gt;",
			);
		} finally {
			globals.Handlebars = savedHb;
		}
	});
});

// --- promptTargetComponent --------------------------------------------------

describe("promptTargetComponent escaping (bead 3z02)", () => {
	test("component names with quotes and markup render escaped, radio keeps the id", async () => {
		setPortsWithI18n();
		const nasty = 'Mach"><script>alert(1)</script>';
		const target = targetWithItems([
			{ id: "comp-1", name: nasty, type: "ship-component", system: { state: "damaged" } },
		]);
		nextInputResult = { component: "comp-1" };

		const chosen = await promptTargetComponent(target);

		expect(chosen).toEqual({ id: "comp-1", name: nasty, type: "ship-component", system: { state: "damaged" } });
		expect(dialogRequests.length).toBe(1);
		const content = dialogRequests[0].content;
		// No raw quotes/markup from the name reach the HTML...
		expect(content).not.toContain(nasty);
		// ...but the escaped entities do...
		expect(content).toContain(expectedEscape(nasty));
		// ...and the radio still carries the id.
		expect(content).toContain('value="comp-1"');
	});

	test("the chosen radio value still resolves to the right item", async () => {
		setPortsWithI18n();
		const target = targetWithItems([
			{ id: "a1", name: 'Evil"Name<&>', type: "ship-component", system: {} },
			{ id: "a2", name: "Plain Name", type: "ship-component", system: {} },
		]);
		nextInputResult = { component: "a2" };

		const chosen = await promptTargetComponent(target);

		expect(chosen).not.toBeNull();
		expect((chosen as { id?: string }).id).toBe("a2");
	});

	test("destroyed components are excluded without rendering their name at all", async () => {
		setPortsWithI18n();
		const target = targetWithItems([
			{ id: "dead", name: '<img src=x onerror=alert(1)>', type: "ship-component", system: { state: "destroyed" } },
		]);
		nextInputResult = null;

		const chosen = await promptTargetComponent(target);

		expect(chosen).toBeNull();
		expect(dialogRequests.length).toBe(0);
	});
});

// --- promptShieldAbsorption --------------------------------------------------

describe("promptShieldAbsorption escaping (bead 3z02)", () => {
	test("target name markup is escaped before it reaches the dialog HTML", async () => {
		setPortsWithI18n();
		const nasty = 'Lord" <b>Voidship</b>';

		await promptShieldAbsorption(3, 2, { name: nasty });

		expect(dialogRequests.length).toBe(1);
		const content = dialogRequests[0].content;
		expect(content).not.toContain(nasty);
		expect(content).toContain(expectedEscape(nasty));
	});
});
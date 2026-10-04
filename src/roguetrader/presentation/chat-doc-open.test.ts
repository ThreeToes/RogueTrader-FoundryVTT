/**
 * Chat-card doc-link OPEN path (epic 61pk, bead qg4z): the roll/damage
 * templates render <a data-action="openPackDoc" data-uuid="..."> anchors in
 * the title; bootstrap/hooks.ts delegates the click to
 * presentation/chat-actions.ts openPackDocFromCard, which resolves the uuid
 * through the pack resolution path and opens the item's sheet READ-ONLY.
 *
 * Fake ports + fake packs prove:
 * - the resolved doc's sheet renders (the happy path);
 * - the loud-fail paths: an unresolvable uuid, a doc without a sheet and a
 *   throwing resolution all notify CHAT.OPEN_DOC_FAIL ({ uuid }) — the
 *   advancement dialog's #onOpenPackDoc posture, never a silent no-op;
 * - a missing data-uuid is a plain no-op (an anchor without a stamp renders
 *   no click behaviour).
 */
import { afterEach, afterAll, describe, expect, test } from "bun:test";

// Foundry globals stubbed BEFORE the dynamic import (adapter-ammo-consume /
// initiative pattern): the import chain reaches ApplicationV2-derived sheet
// classes that destructure foundry.applications.api at module load.
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "foundry", "warn", "error"]) {
	originalGlobals[key] =
		key === "warn" || key === "error"
			? console[key]
			: (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		handlebars: { renderTemplate: async () => "" },
	},
	utils: { fromUuidSync: () => null },
};

const { getPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { openPackDocFromCard } = await import("./chat-actions");

const globals = globalThis as Record<string, unknown>;

interface FakeDoc {
	name?: string;
	sheet?: { render: (options?: object) => Promise<unknown> };
}

function fakeAnchor(uuid: string): HTMLAnchorElement {
	return { dataset: { uuid } } as unknown as HTMLAnchorElement;
}

/** Stub chat-notification calls (the loud-fail observability seam). */
function captureNotifications(): Array<Record<string, unknown>> {
	const captured: Array<Record<string, unknown>> = [];
	setPorts({
		...getPorts(),
		notify: {
			...getPorts().notify,
			error: (key: string, vars?: unknown) => {
				captured.push({ level: "error", key, vars });
			},
		},
	});
	return captured;
}

afterEach(() => {
	resetPorts();
	globals.game = originalGlobals.game;
	console.warn = originalGlobals.warn as typeof console.warn;
	console.error = originalGlobals.error as typeof console.error;
});

afterAll(() => {
	// The foundry stub is a GLOBAL: restore it, or the next test file inherits
	// a barebones API surface (full-suite isolation) — full restore pattern of
	// initiative.test.ts / combat-end.test.ts.
	for (const key of ["game", "foundry"]) {
		if (originalGlobals[key] === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = originalGlobals[key];
	}
	console.warn = originalGlobals.warn as typeof console.warn;
	console.error = originalGlobals.error as typeof console.error;
});

describe("openPackDocFromCard (bead qg4z dispatch)", () => {
	test("a resolved uuid opens the pack item's sheet", async () => {
		const rendered: Array<{ target: FakeDoc; options?: object }> = [];
		const sheetDoc: FakeDoc = {
			name: "Smite",
			sheet: {
				render: async (options?: object) => {
					rendered.push({ target: sheetDoc, options });
				},
			},
		};
		globals.game = {
			packs: {
				get: (id: string) =>
					id === "rogue-trader.character-options"
						? {
								getDocument: async (docId: string) =>
									docId === "smiteId" ? sheetDoc : undefined,
							}
						: undefined,
			},
		};
		const notifications = captureNotifications();
		await openPackDocFromCard(
			fakeAnchor("Compendium.rogue-trader.character-options.Item.smiteId"),
		);
		expect(rendered).toHaveLength(1);
		expect(rendered[0]!.target.name).toBe("Smite");
		expect(notifications).toEqual([]);
	});

	test("an unresolvable uuid loud-fails (notify + console), never a silent no-op", async () => {
		globals.game = { packs: { get: () => undefined } };
		const warnings: string[] = [];
		console.warn = (message: unknown) => {
			warnings.push(String(message));
		};
		const notifications = captureNotifications();
		await openPackDocFromCard(
			fakeAnchor("Compendium.rogue-trader.equipment.Item.goneId"),
		);
		// resolvePackDocument's missing-pack warn + our own failure warn.
		expect(warnings.length).toBeGreaterThanOrEqual(1);
		expect(notifications).toEqual([
			{
				level: "error",
				key: "CHAT.OPEN_DOC_FAIL",
				vars: { uuid: "Compendium.rogue-trader.equipment.Item.goneId" },
			},
		]);
	});

	test("a resolved doc with NO sheet is the openDocumentSheet loud-fail path", async () => {
		globals.game = {
			packs: {
				get: () => ({
					getDocument: async () => ({ name: "Bare doc" }),
				}),
			},
		};
		const errors: string[] = [];
		console.error = (message: unknown) => {
			errors.push(String(message));
		};
		const notifications = captureNotifications();
		await openPackDocFromCard(
			fakeAnchor("Compendium.rogue-trader.character-options.Item.bareId"),
		);
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(notifications).toEqual([
			{
				level: "error",
				key: "CHAT.OPEN_DOC_FAIL",
				vars: { uuid: "Compendium.rogue-trader.character-options.Item.bareId" },
			},
		]);
	});

	test("a throwing resolution is caught and loud-fails (never an error popup loop)", async () => {
		globals.game = {
			packs: {
				get: () => ({
					getDocument: async () => {
						throw new Error("pack backend died");
					},
				}),
			},
		};
		const errors: string[] = [];
		console.error = (message: unknown) => {
			errors.push(String(message));
		};
		const notifications = captureNotifications();
		await openPackDocFromCard(
			fakeAnchor("Compendium.rogue-trader.equipment.Item.anyId"),
		);
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(notifications).toHaveLength(1);
		expect(notifications[0]!.key).toBe("CHAT.OPEN_DOC_FAIL");
	});

	test("an anchor without a data-uuid is a no-op", async () => {
		const captured: Array<Record<string, unknown>> = [];
		let packQueried = false;
		globals.game = {
			packs: {
				get: () => {
					packQueried = true;
					return undefined;
				},
			},
		};
		setPorts({
			...getPorts(),
			notify: {
				...getPorts().notify,
				error: (key: string, vars?: unknown) => {
					captured.push({ key, vars });
				},
			},
		});
		await openPackDocFromCard({ dataset: {} } as unknown as HTMLAnchorElement);
		expect(captured).toEqual([]);
		expect(packQueried).toBe(false);
	});
});
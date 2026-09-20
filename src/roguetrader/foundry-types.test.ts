/**
 * Foundry type declarations stay in sync (epic kof0, bead rt9z).
 *
 * src/roguetrader/foundry.d.ts declares this system's document types to
 * fvtt-types via `DataModelConfig`. bootstrap/sheet-registry.ts is the RUNTIME
 * source of truth for the same mapping. A document type added to one and not
 * the other produces no error anywhere — the type map simply stays narrower
 * than reality, and `item.type === "newtype"` silently reverts to the TS2367
 * "no overlap" error the declaration exists to prevent.
 *
 * A runtime test cannot introspect a type map, so this reads the declaration
 * file and compares its keys with the registry.
 */

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, test } from "bun:test";

// SHEET_REGISTRY pulls in every DataModel class, and those `extends
// foundry.abstract.TypeDataModel` at module load. Stub before importing it.
const originalFoundry = (globalThis as Record<string, unknown>).foundry;
(globalThis as Record<string, unknown>).foundry = {
	abstract: {
		TypeDataModel: class {},
	},
	data: {
		fields: new Proxy(
			{},
			{
				get: () =>
					class {
						static readonly initial = undefined;
					},
			},
		),
	},
	applications: {
		api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b: unknown) => b },
		sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
	},
};

const { SHEET_REGISTRY } = await import("./bootstrap/sheet-registry");

afterAll(() => {
	if (originalFoundry === undefined) {
		delete (globalThis as Record<string, unknown>).foundry;
	} else {
		(globalThis as Record<string, unknown>).foundry = originalFoundry;
	}
});

const DECLARATION = "src/roguetrader/foundry.d.ts";

/**
 * The keys declared in one `Item:` / `Actor:` block of the DataModelConfig
 * merge. Quoted keys ("ranged-weapon") and bare ones (gear) are both valid.
 */
function declaredTypes(documentName: "Item" | "Actor"): Set<string> {
	const source = readFileSync(DECLARATION, "utf8");
	const block = source.match(
		new RegExp(`${documentName}:\\s*\\{([\\s\\S]*?)\\n\\t\\t\\};`),
	);
	expect(block, `${documentName} block found in ${DECLARATION}`).not.toBeNull();
	const keys = new Set<string>();
	for (const match of (block?.[1] ?? "").matchAll(
		/^\s*"?([\w-]+)"?:\s*typeof/gm,
	)) {
		keys.add(match[1]);
	}
	return keys;
}

describe("Foundry type declarations (bead rt9z)", () => {
	test("the AssumeHookRan relaxation is present", () => {
		// Without it, `game` is UninitializedGame and every property is
		// optional — the ~89 `game.i18n` errors come straight back.
		const source = readFileSync(DECLARATION, "utf8");
		expect(source).toContain("interface AssumeHookRan");
		expect(source).toContain('ready: never;');
	});

	for (const documentName of ["Item", "Actor"] as const) {
		test(`every ${documentName} type in SHEET_REGISTRY is declared to fvtt-types`, () => {
			const declared = declaredTypes(documentName);
			const registered = Object.keys(SHEET_REGISTRY[documentName]);
			// Guard the guard: an unparsed block must not pass vacuously.
			expect(declared.size).toBeGreaterThan(5);
			const missing = registered.filter((type) => !declared.has(type));
			expect(missing).toEqual([]);
		});

		test(`no ${documentName} type is declared that the registry does not register`, () => {
			const declared = declaredTypes(documentName);
			const registered = new Set(Object.keys(SHEET_REGISTRY[documentName]));
			const extra = [...declared].filter((type) => !registered.has(type));
			expect(extra).toEqual([]);
		});
	}
});

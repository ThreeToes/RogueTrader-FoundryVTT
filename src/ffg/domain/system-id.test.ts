/**
 * The pre-init system-id fallback (bead 6f99): one constant, three call sites.
 *
 * `SYSTEM_ID_FALLBACK` was written three times — bootstrap/config.ts,
 * presentation/rules-app.ts and presentation/rolls/test-dialog.ts each held a
 * private copy whose comment cited an architecture constraint the contract
 * does not impose. The sites now all consume the domain leaf. This test pins
 * both halves of that: the sites' sources still IMPORT the constant (no
 * private copy grows back) and the one observable site (config's systemId)
 * actually falls back to it when Foundry has not resolved `game.system` yet.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_SYSTEM_ID } from "./template-root";
import { SYSTEM_ID_FALLBACK } from "./system-id";

/** The three former private copies, as source paths relative to the repo root. */
const FALLBACK_SITES: readonly string[] = [
	"src/roguetrader/bootstrap/config.ts",
	"src/roguetrader/presentation/rules-app.ts",
	"src/roguetrader/presentation/rolls/test-dialog.ts",
];

const SAVED_GAME = (globalThis as Record<string, unknown>).game;
const SAVED_FOUNDRY = (globalThis as Record<string, unknown>).foundry;

/**
 * The load stub: importing bootstrap/config transitively imports the rules
 * app, whose module load destructures `foundry.applications.api` — the same
 * stub shape test-dialog.test.ts uses over its import.
 */
const stubFoundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
};

afterAll(() => {
	// Bun shares one process across test files; put the globals back exactly
	// as we found them so the other suites' stubs survive us.
	(globalThis as Record<string, unknown>).game = SAVED_GAME;
	(globalThis as Record<string, unknown>).foundry = SAVED_FOUNDRY;
});

describe("SYSTEM_ID_FALLBACK (bead 6f99)", () => {
	it("is the RT system id, and template-root composes its own root from it", () => {
		expect(SYSTEM_ID_FALLBACK).toBe("rogue-trader");
		expect(DEFAULT_SYSTEM_ID).toBe(SYSTEM_ID_FALLBACK);
	});

	for (const site of FALLBACK_SITES) {
		it(
			`${site} imports the shared constant instead of a private copy`,
			() => {
				const source = readFileSync(site, "utf8");
				// No private copy: a local `const SYSTEM_ID_FALLBACK =` or a
				// re-inlined `"rogue-trader"` literal beside the read would be
				// the duplication the bead deleted, growing back quietly.
				expect(source).not.toMatch(/const\s+SYSTEM_ID_FALLBACK\s*=/);
				expect(source).not.toMatch(/id\s*\?\?\s*"rogue-trader"/);
				// The site consumes the shared constant: the import from this
				// leaf, and the read through it.
				expect(source).toMatch(
					/from\s+"[^"]*ffg\/domain\/system-id[^"]*"/,
				);
				expect(source).toMatch(/\?\?\s*SYSTEM_ID_FALLBACK/);
				// The false-constraint comment must not come back with the copy.
				expect(source).not.toContain("may not import bootstrap");
			},
		);
	}

	it(
		"bootstrap/config's systemId() falls back to the shared constant in the " +
			"pre-init window (game.system unresolved)",
		async () => {
			// The stub the config import graph needs to survive LOAD; `game`
			// itself may exist, only `game.system` may not.
			(globalThis as Record<string, unknown>).foundry = stubFoundry;
			(globalThis as Record<string, unknown>).game = {};
			const { systemId } = await import(
				"../../roguetrader/bootstrap/config"
			);
			try {
				expect(systemId()).toBe(SYSTEM_ID_FALLBACK);
			} finally {
				(globalThis as Record<string, unknown>).game = SAVED_GAME;
				(globalThis as Record<string, unknown>).foundry = SAVED_FOUNDRY;
			}
		},
	);
});
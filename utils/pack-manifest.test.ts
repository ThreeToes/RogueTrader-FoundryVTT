/**
 * `packManifest`'s loud-failure contract (bead mwlr).
 *
 * `packManifest` splices the privately-held packs array into the shipped
 * system.json as a string (not a JSON round-trip, so the committed manifest's
 * formatting survives). Its failure modes are deliberate and load-bearing:
 *
 * - a missing manifest-packs.yaml on the PRIVATE release manifest must throw
 *   (a stale checkout would otherwise silently publish a packless "private
 *   release");
 * - a manifest edit that loses the `"packs": []` stamp must throw rather than
 *   produce malformed system.json from a splice that no longer matches;
 * - every other manifest (dev builds, the packless public release manifest)
 *   ships without packs, just logged.
 *
 * Previously untested because its only caller (`copyStaticFiles` in
 * `build()`) also bundles JS/CSS and packs — un-unit-testable as-is. The
 * function is now exported for direct testing with no behavioural change.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { packManifest } from "./build";

const STAMPED = `{
    "name": "rogue-trader",
    "packs": []
}`;

const STAMPED_WITH_MORE = `{
    "version": "1.0.0",
    "packs": [],
    "manifest": "x"
}`;

describe("packManifest", () => {
	let log: ReturnType<typeof spyOn>;
	afterEach(() => {
		log?.mockRestore();
	});

	test("null packs + requiresPacks=false: returns source untouched and logs", () => {
		const logs: string[] = [];
		log = spyOn(console, "log").mockImplementation((msg?: unknown) => {
			logs.push(String(msg));
		});
		const out = packManifest(STAMPED, null, false);
		expect(out).toBe(STAMPED);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain("no manifest-packs.yaml");
	});

	test("null packs + requiresPacks=true: throws (private release demands packs)", () => {
		expect(() => packManifest(STAMPED, null, true)).toThrow(
			/manifest-packs\.yaml is missing/,
		);
	});

	test("packs splice: injects the array formatted, rest of document verbatim", () => {
		// Packs are stringified with 4-space indent then every newline is
		// prefixed with 4 more spaces, matching the manifest's own indent level.
		const packs = [
			{ name: "rogue-trader-gear", label: "Gear", path: "packs/gear", type: "Item" },
			{ name: "rogue-trader-npcs", label: "NPCs", path: "packs/npcs", type: "Actor" },
		];
		const out = packManifest(STAMPED, packs, false);
		const expected = `{
    "name": "rogue-trader",
    "packs": [
        {
            "name": "rogue-trader-gear",
            "label": "Gear",
            "path": "packs/gear",
            "type": "Item"
        },
        {
            "name": "rogue-trader-npcs",
            "label": "NPCs",
            "path": "packs/npcs",
            "type": "Actor"
        }
    ]
}`;
		expect(out).toBe(expected);
	});

	test("packs splice on a manifest with fields around the stamp", () => {
		const packs = [{ name: "pack" }];
		const out = packManifest(STAMPED_WITH_MORE, packs, false);
		expect(out).toContain('"version": "1.0.0"');
		expect(out).toContain('"manifest": "x"');
		expect(out).toContain(
			`"packs": ${JSON.stringify(packs, null, 4).replace(/\n/g, "\n    ")}`,
		);
	});

	test("manifest that lost the 'packs': [] stamp throws when packs provided", () => {
		const unstamped = `{
    "name": "rogue-trader",
    "packs": []
}`;
		const broken = unstamped.replace('"packs": []', '"packs":[]');
		expect(() => packManifest(broken, [{ name: "pack" }], false)).toThrow(
			/no longer carries the empty `packs` stamp/,
		);
	});
});
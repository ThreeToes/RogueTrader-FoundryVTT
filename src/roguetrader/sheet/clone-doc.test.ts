/**
 * Shared pack-document clone-payload tests (bead lnya): the payload shape
 * every creator/picker grant rides — the pack doc's _id stripped (repo
 * convention: two Items cannot share an _id) plus the grantedBy provenance
 * stamp stamped INTO the cloned system data (iufv reconcile contract).
 */
import { describe, expect, test } from "bun:test";
import {
	clonePackDocPayload,
	grantedClonePayload,
} from "./clone-doc";

describe("clonePackDocPayload", () => {
	test("strips _id and preserves the rest", () => {
		const payload = clonePackDocPayload({
			_id: "abc123",
			name: "Lasgun",
			type: "ranged-weapon",
			system: { class: "basic" },
		});
		expect("_id" in payload).toBe(false);
		expect(payload.name).toBe("Lasgun");
	});
});

describe("grantedClonePayload (bead lnya)", () => {
	test("stamps grantedBy inside the cloned system data", () => {
		const payload = grantedClonePayload(
			{
				_id: "abc123",
				name: "Grand Cruiser",
				system: { hull: 45 },
			},
			"ship-creator",
		);
		expect("_id" in payload).toBe(false);
		expect(payload.system).toEqual({ hull: 45, grantedBy: "ship-creator" });
		expect(payload.name).toBe("Grand Cruiser");
	});

	test("works when the doc carries no system (system becomes just the stamp)", () => {
		const payload = grantedClonePayload(
			{ _id: "x", name: "Bare Row" } as {
				_id?: unknown;
				name?: string;
				system?: Record<string, unknown>;
			},
			"planet-creator",
		);
		expect(payload.system).toEqual({ grantedBy: "planet-creator" });
	});

	test("does not mutate the source doc", () => {
		const doc = {
			_id: "x",
			name: "Mod",
			system: { upgrades: "Telescopic" } as Record<string, unknown>,
		};
		grantedClonePayload(doc, "mod-picker");
		expect(doc.system).toEqual({ upgrades: "Telescopic" });
		expect("_id" in doc).toBe(true);
	});

	test("each creator stamps its OWN provenance string (the three former copies)", () => {
		for (const grantedBy of ["ship-creator", "planet-creator", "mod-picker"]) {
			const payload = grantedClonePayload(
				{ _id: "y", system: {} } as {
					_id?: unknown;
					system?: Record<string, unknown>;
				},
				grantedBy,
			);
			expect(payload.system?.grantedBy).toBe(grantedBy);
		}
	});
});
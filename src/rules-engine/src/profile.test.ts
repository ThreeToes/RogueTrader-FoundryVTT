/**
 * RuleProfile extension points (bead yojf): the kernel profile carries the
 * sibling-system extension data (characteristic vocabulary, advancement
 * model, starter wounds/fate, psychic/critical-table sources) alongside the
 * crit/hit-location data it already had.
 */
import { describe, expect, test } from "bun:test";

import { type RuleProfile, rtCore } from "./profile";

describe("RuleProfile extension points", () => {
	test("rtCore carries the characteristic vocabulary in book order", () => {
		expect(rtCore.characteristics?.keys).toEqual([
			"ws", "bs", "s", "t", "ag", "int", "per", "wp", "fel",
		]);
		expect(rtCore.characteristics?.labelPrefix).toBe("CHARACTERISTIC");
	});

	test("rtCore records the RT advancement/wound/fate model", () => {
		expect(rtCore.advancement?.xpModel).toBe("spent-ledger");
		expect(rtCore.startingWounds).toEqual({
			toughnessMultiplier: 2,
			dice: "",
			flat: 0,
		});
		expect(rtCore.startingFate).toEqual({ model: "bands" });
	});

	test("content-resolved sources stay null (no fabricated data)", () => {
		expect(rtCore.skillCatalogPack).toBeNull();
		expect(rtCore.psychic?.phenomenaTablePack).toBeNull();
		expect(rtCore.criticalTables).toEqual({ core: null, vehicle: null });
	});

	test("a sibling profile can express the same shape minimally", () => {
		// Optional fields mean a sibling only carries what differs.
		const sibling: RuleProfile = {
			id: "dh2-core",
			critOnDouble: true,
			autoFailRoll: null,
			autoPassRoll: null,
			primitiveArmourDouble: true,
			righteousFury: { enabled: true, trigger: "damaging-hit" },
			hitLocations: rtCore.hitLocations,
			advancement: { xpModel: "aptitudes" },
		};
		expect(sibling.advancement).toEqual({ xpModel: "aptitudes" });
		expect(sibling.startingWounds).toBeUndefined();
	});
});
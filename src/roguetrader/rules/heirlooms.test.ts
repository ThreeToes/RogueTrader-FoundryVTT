import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import {
	getHeirloomEntries,
	heirloomForRoll,
	setHeirloomEntries,
	type HeirloomEntry,
} from "./heirlooms";

// Epic 1gb7 follow-up: the heirloom content (key, 1d100 range, in item FLAGS)
// lives in the equipment concept pack. CI does not ship compendia (src/packs
// is machine-local), so this suite is SKIPPED when the pack is absent and runs
// against the real data locally. Table 1-2 in the creationtables RollTable
// remains the prose/range source and is cross-checked by the pack test
// (src/packs/rogue_trader/equipment/heirlooms.test.ts). The entries ARE real
// typed compendium items (owner rework) — granting is a plain pack-doc clone,
// so no grant payload is mapped here.
const HEIRLOOM_PACK = "src/packs/rogue_trader/equipment/heirlooms.yaml";
const HAS_HEIRLOOM_PACK = existsSync(HEIRLOOM_PACK);
const docs = (
	HAS_HEIRLOOM_PACK
		? (parse(readFileSync(HEIRLOOM_PACK, "utf8")) as Array<{
				name?: string;
				flags?: Record<string, { item?: string; table?: string; range?: { low?: number; high?: number } }>;
			}>)
		: []
);
setHeirloomEntries(
	docs.map((doc) => {
		const flag = doc.flags?.["rogue-trader"] ?? {};
		return {
			key: String(flag.item ?? ""),
			name: doc.name ?? "",
			range: [Number(flag.range?.low ?? 0), Number(flag.range?.high ?? 0)],
			table: flag.table,
		} satisfies HeirloomEntry;
	}),
);
const heirloomItems = getHeirloomEntries();

/** Skipped in CI (no compendia); runs locally against the real pack. */
const heirloomDescribe = describe.skipIf(!HAS_HEIRLOOM_PACK);

// Bead rboc: Table 1-2: Heirloom Items (Core Rulebook p31).
// Five 1d100 ranges rolled by the creator's stage 3.5.

heirloomDescribe("heirloom table (Core Rulebook Table 1-2)", () => {
	test("five entries cover 1-100 exactly, in order", () => {
		expect(heirloomItems).toHaveLength(5);
		let next = 1;
		for (const entry of heirloomItems) {
			expect(entry.range[0]).toBe(next);
			expect(entry.range[1]).toBeGreaterThanOrEqual(entry.range[0]);
			next = entry.range[1] + 1;
		}
		expect(next).toBe(101);
	});

	test("book range boundaries resolve to the right entry", () => {
		expect(heirloomForRoll(1).name).toBe("Archeotech Laspistol");
		expect(heirloomForRoll(20).name).toBe("Archeotech Laspistol");
		expect(heirloomForRoll(21).name).toBe("Angevin Era Chainsword");
		expect(heirloomForRoll(40).name).toBe("Angevin Era Chainsword");
		expect(heirloomForRoll(41).name).toBe("Ancestral Seal");
		expect(heirloomForRoll(60).name).toBe("Ancestral Seal");
		expect(heirloomForRoll(61).name).toBe("Saint-blessed Carapace Armour");
		expect(heirloomForRoll(80).name).toBe("Saint-blessed Carapace Armour");
		expect(heirloomForRoll(81).name).toBe("Reliquary of Saint Drusus");
		expect(heirloomForRoll(100).name).toBe("Reliquary of Saint Drusus");
	});

	test("rolls outside 1-100 fail loudly", () => {
		expect(() => heirloomForRoll(0)).toThrow();
		expect(() => heirloomForRoll(101)).toThrow();
	});

	test("each entry's name matches its Table 1-2 roll range and link", () => {
		for (const entry of heirloomItems) {
			expect(entry.key.length).toBeGreaterThan(0);
			expect(entry.table).toBe("rolltables/Table 1-2: Heirloom Items");
		}
	});
});
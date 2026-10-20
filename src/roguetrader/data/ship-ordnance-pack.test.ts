/**
 * Battlefleet Koronus ordnance pack guard (epic necp child S9, bead a413).
 * Mirrors shiptables.test.ts; the pack lives in the private src/packs clone,
 * which may be ABSENT from a worktree clone, so the suite skips then (the
 * ship-salvo-damage.test.ts precedent) — the parent checkout's validation
 * covers the real data. Guards:
 * - every entry resolves to its declared type (ship-ordnance / ship-action);
 * - every machine `ordKey` exists in the kernel's printed tables;
 * - the printed stat columns agree with the kernel tables (spot-check);
 * - every machinery ship-action name maps to the ordnanceRowHandlers keys;
 * - the SHIP_ORDNANCE i18n keys exist in all four langs.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { MINIMAL_FOUNDRY } from "../../test-helpers/foundry-schema-stub";
import { resolveEntryType } from "../../../utils/compendia";
import {
	CRAFT_RATINGS,
	TORPEDO_GUIDANCES,
	TORPEDO_PROFILES,
} from "../../rules-engine/index";

await import("../../test-helpers/foundry-schema-stub");const { ShipOrdnance } = await import(
	"./item/ship-ordnance"
);
const { ShipAction } = await import("./item/ship-action");

const globalThisRecord = globalThis as Record<string, unknown>;
for (const [key, value] of Object.entries({
	game: {
		i18n: { localize: (key: string) => key, format: (key: string) => key },
		system: { id: "rogue-trader" },
	},
	ui: {
		notifications: {
			warn: () => undefined,
			error: () => undefined,
			info: () => undefined,
		},
	},
})) {
	globalThisRecord[key] = value;
}
// Merge the presentation stubs ONTO the schema stub's foundry global
// (the ship-boarding.test.ts stub keys, without clobbering data.fields).
// Guarantee the floor FIRST: this file's helper import may already be cached
// (its side effect does not re-run) and an earlier suite's afterAll may have
// restored the global to nothing (the packless-CI crash class).
const foundryStub = (globalThisRecord.foundry =
	(globalThisRecord.foundry as Record<string, unknown> | undefined) ??
	MINIMAL_FOUNDRY) as Record<string, unknown>;
foundryStub.applications ??= {
	api: { DialogV2: { wait: async () => null, input: async () => null } },
};
foundryStub.utils ??= { fromUuidSync: () => null };
const { ordnanceRowHandlers } = await import(
	"../presentation/rolls/ship-ordnance"
);
const { boardingRowKey } = await import(
	"../presentation/rolls/ship-boarding"
);

/**
 * The packs clone root: the plain relative path in the parent checkout (and
 * any clone that vendors it); the worktree's sibling clone for worker
 * sessions. The suite skips when the pack is absent in BOTH.
 */
const PACK_ROOT = [
	"src/packs/rogue_trader",
	// A worktree checkout: the shared packs clone lives in the PARENT repo.
	"../../src/packs/rogue_trader",
].find(
	(candidate) => existsSync(candidate),
) ?? "src/packs/rogue_trader";
const HAS_PACKS = existsSync(`${PACK_ROOT}/ships/shiptorpedoes.yaml`);

const LOAD = (stem: string): Array<Record<string, unknown>> =>
	parse(readFileSync(`${PACK_ROOT}/ships/${stem}.yaml`, "utf8")) as never;

/** Schema keys the models actually declare (the no-silent-drop guard set). */
const ORDNANCE_KEYS = new Set([
	...Object.keys(ShipOrdnance.defineSchema()),
	// Builder-injected authoring sugar (see utils/compendia.ts toDocument).
	"description",
]);
const ACTION_KEYS = new Set([
	...Object.keys(ShipAction.defineSchema()),
	"description",
]);

type SystemShape = {
	kind?: string;
	ordKey?: string;
	speed?: number;
	damage?: string;
	critRating?: number;
	range?: number;
	terminalPenetration?: number;
	torpedoRating?: number;
	craftRating?: number;
	altCraftRating?: number;
	squadronSize?: number;
	sortieTurns?: number;
	availability?: string;
	roll?: { test?: string; difficulty?: string };
	actionCost?: string;
	source?: { book?: string; page?: number };
};

describe.skipIf(!HAS_PACKS)("battlefleet koronus ordnance pack (bead a413)", () => {
	// bun still evaluates the describe body when skipIf fires (collection),
	// so the LOADs must not throw when the packs clone is absent (packless
	// CI / fresh clones). The empty arrays make the skipped tests inert and
	// the count-guards inside them non-vacuous when the pack IS present.
	const orntorpedoes = HAS_PACKS ? LOAD("shiptorpedoes") : [];
	const attackCraft = HAS_PACKS ? LOAD("shipattackcraft") : [];
	const actions = HAS_PACKS ? LOAD("shipordnance-actions") : [];
	const allEntries = [...orntorpedoes, ...attackCraft, ...actions];
	const systemOf = (entry: Record<string, unknown>): SystemShape =>
		(entry.system ?? {}) as SystemShape;

	it("authors the five Table 1-1 warheads + the p9 guidance entries", () => {
		const torpedoes = orntorpedoes.filter(
			(entry) => systemOf(entry).kind === "torpedo",
		);
		expect(torpedoes).toHaveLength(5);
		const keys = new Set(torpedoes.map((entry) => systemOf(entry).ordKey));
		for (const key of ["plasma", "boarding", "melta", "virus", "vortex"]) {
			expect(keys.has(key), `warhead ${key}`).toBe(true);
		}
		const guidances = orntorpedoes.filter(
			(entry) => systemOf(entry).kind === "torpedo-guidance",
		);
		expect(guidances.map((entry) => systemOf(entry).ordKey)).toEqual([
			"guided",
			"seeking",
			"short-burn",
		]);
	});

	it("authors the eleven Table 1-3 craft rows (+ the generic Assault Boat)", () => {
		const craft = attackCraft.filter(
			(entry) => systemOf(entry).kind === "attack-craft",
		);
		// Ten named rows + the generic "Assault Boats" row (see the yaml's
		// header note).
		expect(craft).toHaveLength(11);
	});

	it("builds every entry as its declared model type", () => {
		for (const [stem, collection] of [
			["shiptorpedoes", orntorpedoes],
			["shipattackcraft", attackCraft],
			["shipordnance-actions", actions],
		] as const) {
			for (const entry of collection) {
				expect(resolveEntryType(entry, stem), String(entry.name)).toBe(
					String(entry.type),
				);
			}
		}
	});

	it("authors no field the model would silently drop", () => {
		for (const entry of orntorpedoes.concat(attackCraft)) {
			expect(String(entry.type)).toBe("ship-ordnance");
			for (const key of Object.keys(entry.system ?? {})) {
				expect(ORDNANCE_KEYS.has(key), `${entry.name} system.${key}`).toBe(
					true,
				);
			}
		}
		for (const entry of actions) {
			for (const key of Object.keys(entry.system ?? {})) {
				expect(ACTION_KEYS.has(key), `${entry.name} system.${key}`).toBe(
					true,
				);
			}
		}
	});

	it("the warhead stat columns agree with the kernel Table 1-1", () => {
		for (const entry of orntorpedoes) {
			const system = systemOf(entry);
			if (system.kind !== "torpedo") continue;
			const profile = TORPEDO_PROFILES[system.ordKey ?? ""];
			expect(profile, `warhead ${system.ordKey}`).toBeTruthy();
			expect(system.speed, entry.name as string).toBe(profile!.speed);
			expect(system.damage, entry.name as string).toBe(profile!.damage);
			expect(system.critRating, entry.name as string).toBe(profile!.critRating);
			expect(system.range, entry.name as string).toBe(profile!.range);
			expect(system.terminalPenetration, entry.name as string).toBe(
				profile!.terminalPenetration,
			);
			// A standard guidance system ships with every torpedo (printed p9).
			expect(system.torpedoRating, entry.name as string).toBe(20);
		}
	});

	it("the guidance Torpedo Ratings agree with the printed prose (p9)", () => {
		for (const entry of orntorpedoes) {
			const system = systemOf(entry);
			if (system.kind !== "torpedo-guidance") continue;
			const guidance = TORPEDO_GUIDANCES[system.ordKey ?? ""];
			expect(guidance, `guidance ${system.ordKey}`).toBeTruthy();
			expect(system.torpedoRating, entry.name as string).toBe(
				guidance!.torRating,
			);
		}
	});

	it("spot-check anchors: the printed Table 1-3 rows read back", () => {
		const byKey = (key: string) =>
			attackCraft.find((entry) => systemOf(entry).ordKey === key);
		const fury = byKey("fury-interceptor");
		expect(systemOf(fury!)).toMatchObject({
			craftRating: 10,
			speed: 10,
			squadronSize: 20,
			sortieTurns: 4,
		});
		const starhawk = byKey("starhawk-bomber");
		expect(systemOf(starhawk!)).toMatchObject({
			craftRating: 0,
			speed: 6,
			squadronSize: 10,
			sortieTurns: 6,
		});
		// Multi-purpose second readings (printed p14): Bloodflayer +8 (+4),
		// Fighta-bomma +8 (+5).
		expect(systemOf(byKey("bloodflayer")!)).toMatchObject({
			craftRating: 8,
			altCraftRating: 4,
			speed: 9,
		});
		expect(systemOf(byKey("fighta-bommers")!)).toMatchObject({
			craftRating: 8,
			altCraftRating: 5,
			speed: 8,
		});
		// The generic row: Craft Rating +8, Speed 10, 15 craft (printed p14).
		expect(systemOf(byKey("assault-boat")!)).toMatchObject({
			craftRating: 8,
			speed: 10,
			squadronSize: 15,
		});
	});

	it("every machinery ship-action name maps to the ordnance row dispatch", () => {
		const expected = new Set(
			actions.map((entry) => boardingRowKey(String(entry.name ?? ""))),
		);
		for (const key of [
			"launch-torpedoes",
			"torpedo-run",
			"reload-torpedo-tubes",
			"bombing-run",
			"assault-boat-run",
			"attack-with-fighters",
		]) {
			expect(expected.has(key), `machinery row ${key}`).toBe(true);
			expect(ordnanceRowHandlers[key], `handler ${key}`).toBeTruthy();
		}
		for (const entry of actions) {
			expect(String(entry.type)).toBe("ship-action");
		}
	});

	it("every entry carries a printed-page cite in the battlefleet koronus book", () => {
		for (const entry of allEntries) {
			const system = systemOf(entry);
			expect(system.source?.book, `${entry.name} book`).toBe(
				"battlefleet_koronus",
			);
			expect(system.source?.page, `${entry.name} page`).toBeGreaterThan(0);
		}
	});

	it("availability values are the printed Table 1-2 machine tokens", () => {
		const availabilityOf = (key: string): string =>
			systemOf(
				orntorpedoes.find((entry) => systemOf(entry).ordKey === key) ?? {},
			).availability!;
		// Table 1-2 (printed p9): Rare / Very Rare / Extremely Rare /
		// Near Unique / Unique.
		expect(availabilityOf("plasma")).toBe("rare");
		expect(availabilityOf("boarding")).toBe("very-rare");
		expect(availabilityOf("melta")).toBe("extremely-rare");
		expect(availabilityOf("virus")).toBe("near-unique");
		expect(availabilityOf("vortex")).toBe("unique");
		// The guidance systems (Table 1-2's own rows).
		expect(availabilityOf("guided")).toBe("rare");
		expect(availabilityOf("seeking")).toBe("extremely-rare");
		expect(availabilityOf("short-burn")).toBe("rare");
	});

	it("has SHIP_ORDNANCE i18n keys in all languages", async () => {
		for (const lang of ["en", "es", "fr", "pl"]) {
			const strings = (await import(
				`../../../lang/${lang}.json`
			)) as unknown as Record<string, string>;
			expect(strings["SHIP_ORDNANCE.TORPEDO_RATING"], lang).toBeTruthy();
			expect(strings["SHIP_ORDNANCE.TURRET_DOWN"], lang).toBeTruthy();
		}
	});
});
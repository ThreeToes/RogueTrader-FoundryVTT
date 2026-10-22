/**
 * startingAcquisitions session caching (beads pwbr + opur).
 *
 * The creator re-renders on EVERY allocation/pick/roll (render({force:true})),
 * and the old path re-fetched the equipment pack and deep-copied every
 * qualifying doc via doc.toObject() per render. The loader now:
 * - fetches the equipment pack once per session (packDocsOnce);
 * - caches the built {options, payloads} keyed by the weapon-training
 *   coverage fingerprint + the selected chip key — the two inputs the build
 *   reads — so a re-render with unchanged inputs rebuilds nothing.
 *
 * These tests pin that the cached results are IDENTICAL for a given key and
 * that the expensive steps (pack fetch, toObject deep copies) run once.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ContentPort } from "../../../ffg/application/ports";
import { NO_CONTENT_PORT } from "../../../ffg/application/ports";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../../infrastructure/foundry/ports";
// Same session-cached loader the creator context calls per render.
import { startingAcquisitions } from "./creator-packs";
import type { CreatorState } from "./creator-state";

const originalGlobals: Record<string, unknown> = {};
const globals = globalThis as Record<string, unknown>;
originalGlobals.game = globals.game;
globals.game = {
	i18n: { localize: (key: string) => key },
};

afterAll(() => {
	if (originalGlobals.game === undefined) delete globals.game;
	else globals.game = originalGlobals.game;
});

afterEach(() => {
	resetPorts();
});

// --- fakes ----------------------------------------------------------------

/** One qualifying pack doc; `copies` counts the toObject deep copies. */
let copies = 0;
function acqDoc(over: {
	name: string;
	type: string;
	flags?: Record<string, Record<string, unknown>>;
	system?: Record<string, unknown>;
}): unknown {
	const doc = {
		name: over.name,
		type: over.type,
		flags: over.flags ?? { "rogue-trader": { source: "gear" } },
		system: {
			availability: "common",
			description: "A thing.",
			...(over.system ?? {}),
		},
	};
	return {
		...doc,
		toObject: () => {
			copies += 1;
			return JSON.parse(JSON.stringify({ name: doc.name, type: doc.type }));
		},
	};
}

const EQUIPMENT_DOCS = [
	// Weapons carry a source flag; the gear item needs only availability.
	acqDoc({
		name: "Lasgun",
		type: "ranged-weapon",
		flags: { "rogue-trader": { source: "weapons" } },
		system: { availability: "common", class: "basic" }, // no family -> class gate
	}),
	// A too-rare item never qualifies (modifier -10 < 0, Core Rulebook p272).
	acqDoc({
		name: "Rare Relic",
		type: "gear",
		flags: { "rogue-trader": { source: "gear" } },
		system: { availability: "rare" },
	}),
	acqDoc({
		name: "Chrono",
		type: "gear",
		flags: { "rogue-trader": { source: "gear" } },
		system: { availability: "scarce" },
	}),
];

const CAREER_DOCS = [
	{
		name: "Test Career",
		type: "career",
		system: {
			key: "pwbr-career",
			requiredCareer: "",
			startingTalents: ["Pistol Weapon Training (SP)"],
			suggestedHomeWorlds: [],
		},
	},
];

let equipmentFetches = 0;
function installPorts(): void {
	setPorts({
		...foundryPorts,
		content: {
			...NO_CONTENT_PORT,
			documentsOrNull: async (packId: string) => {
				if (packId === "rogue-trader.equipment") {
					equipmentFetches += 1;
					return EQUIPMENT_DOCS;
				}
				if (packId === "rogue-trader.character-options") {
					return CAREER_DOCS;
				}
				return null;
			},
		} satisfies ContentPort,
	});
}

function state(careerKey: string, selectedKey: string): CreatorState {
	return {
		careerKey,
		picks: {},
		acquisition: { key: selectedKey, name: selectedKey, payload: {} },
	} as unknown as CreatorState;
}

// --- the pins ---------------------------------------------------------------

describe("startingAcquisitions acquisition cache (bead opur)", () => {
	test("same inputs hit the cache: options + payloads identical, one fetch, no re-copies", async () => {
		installPorts();
		equipmentFetches = 0;
		copies = 0;
		const s = state("", "weapons::Lasgun");
		const payloadsA = new Map<string, object>();
		const optionsA = await startingAcquisitions(s, payloadsA);
		const fetchesAfterFirst = equipmentFetches;
		const copiesAfterFirst = copies;

		const payloadsB = new Map<string, object>();
		const optionsB = await startingAcquisitions(s, payloadsB);

		// The contents for a given selectedKey are stable.
		expect(optionsB).toEqual(optionsA);
		expect(payloadsB).toEqual(payloadsA);
		// ...and nothing expensive re-ran: no second pack fetch, no second
		// round of doc.toObject() deep copies.
		expect(equipmentFetches).toBe(fetchesAfterFirst);
		expect(copies).toBe(copiesAfterFirst);
		// The chips shape: Lasgun selected, the rare relic filtered out.
		expect(optionsA.map((o) => o.name)).toContain(
			"Lasgun (CREATOR.ACQ_MODIFIER +20)",
		);
		expect(optionsA.map((o) => o.name)).not.toContain("Rare Relic");
		expect(optionsA.find((o) => o.key === "weapons::Lasgun")?.selected).toBe(
			true,
		);
		expect(payloadsA.has("weapons::Lasgun")).toBe(true);
		expect(equipmentFetches).toBe(1);
	});

	test("a new selectedKey rebuilds the chips without re-fetching the pack", async () => {
		installPorts();
		const payloads = new Map<string, object>();
		await startingAcquisitions(state("", "weapons::Lasgun"), payloads);
		const fetchesBefore = equipmentFetches;
		const copiesBefore = copies;

		const options = await startingAcquisitions(
			state("", "gear::Chrono"),
			payloads,
		);

		// The selected flag follows the new key...
		expect(options.find((o) => o.key === "gear::Chrono")?.selected).toBe(true);
		expect(options.find((o) => o.key === "weapons::Lasgun")?.selected).toBe(
			false,
		);
		// ...the docs fetch stays memoized (packDocsOnce), but the build
		// re-ran (new key -> new build).
		expect(equipmentFetches).toBe(fetchesBefore);
		expect(copies).toBeGreaterThan(copiesBefore);
	});

	test("a coverage change busts the build cache (the gate depends on it)", async () => {
		installPorts();
		const payloads = new Map<string, object>();
		const noCareer = await startingAcquisitions(
			state("", "weapons::Lasgun"),
			payloads,
		);
		// No career picked -> every weapon class covered -> the basic weapon
		// is selectable.
		expect(noCareer.find((o) => o.key === "weapons::Lasgun")?.selectable).toBe(
			true,
		);

		// A career whose starting talents cover only pistol weapons flips the
		// gate for the basic-class Lasgun — and busts the cache via the covSig.
		const withCareer = await startingAcquisitions(
			state("pwbr-career", "weapons::Lasgun"),
			payloads,
		);
		expect(
			withCareer.find((o) => o.key === "weapons::Lasgun")?.selectable,
		).toBe(false);
		// Switching back re-reads the (unchanged) coverage and the chips.
		const backNoCareer = await startingAcquisitions(
			state("", "weapons::Lasgun"),
			payloads,
		);
		expect(
			backNoCareer.find((o) => o.key === "weapons::Lasgun")?.selectable,
		).toBe(true);
	});
});

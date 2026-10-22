/**
 * Career-sheet advance-row links, headless (bead mg87).
 *
 * keyIndexMap() used to read `game.packs` + `pack.index.values()` directly —
 * in violation of the ContentPort rule (the game.packs lookup lives in ONE
 * place, the foundry content adapter) and unreachable headless. It now
 * routes through pack-resolve's getPackDocuments (the
 * getPorts().content.documentsOrNull path with the one-loud-missing-pack
 * warning), so this suite drives it entirely through the PORT STUB: no
 * game.packs, no foundry compendium, and a swapped NO_CONTENT_PORT would be
 * honoured.
 *
 * One stub regime per suite by design: pack-resolve's session cache keys this
 * fetch under "character-options:advance-links" and never evicts a resolved
 * promise, so every test here shares one documentsOrNull stub. The missing-
 * pack warning and degrade behaviour are covered where they live —
 * pack-resolve.test.ts's getPackDocuments port tests.
 */
import { afterAll, describe, expect, test } from "bun:test";
// Install the minimal Foundry floor BEFORE the sheet module imports (the
// sheet destructures foundry.applications at module scope).
import "../../../test-helpers/foundry-schema-stub";

/** The pack catalogue the sheet slug-maps: mixed types exercise the filter. */
const OPTION_DOCS = [
	{
		name: "Quick Draw",
		uuid: "Compendium.rogue-trader.character-options.Item.quick-draw",
		type: "talent",
	},
	{
		name: "Awareness (Basic)",
		uuid: "Compendium.rogue-trader.character-options.Item.awareness-basic",
		type: "skill",
	},
	{
		// Not a talent/skill: advance rows must never link to it.
		name: "Void Born",
		uuid: "Compendium.rogue-trader.character-options.Item.void-born",
		type: "career",
	},
	{
		// Name-less docs are skipped exactly like the old index scan.
		uuid: "Compendium.rogue-trader.character-options.Item.nameless",
		type: "talent",
	},
];

let contentCalls = 0;
const { setPorts, resetPorts, foundryPorts } = await import(
	"../../../ffg/infrastructure/foundry/ports"
);
const { CHARACTER_OPTIONS_PACK } = await import("../pack-resolve");

const { keyIndexMap } = await import("./career-sheet");

afterAll(() => {
	resetPorts();
});

describe("career advance-row links via the ContentPort (bead mg87)", () => {
	test("talent/skill docs slug-map to uuid + name", async () => {
		setPorts({
			...foundryPorts,
			content: {
				...foundryPorts.content,
				documentsOrNull: async (packId: string) => {
					contentCalls += 1;
					expect(packId).toBe(CHARACTER_OPTIONS_PACK);
					return OPTION_DOCS;
				},
			},
		});
		const map = await keyIndexMap();
		expect(map.get("quick-draw")).toEqual({
			uuid: "Compendium.rogue-trader.character-options.Item.quick-draw",
			name: "Quick Draw",
		});
		// The emit script's key convention: non-alphanumerics collapse to '-'.
		expect(map.get("awareness-basic")).toEqual({
			uuid: "Compendium.rogue-trader.character-options.Item.awareness-basic",
			name: "Awareness (Basic)",
		});
	});

	test("non talent/skill docs and name-less docs are skipped", async () => {
		const map = await keyIndexMap();
		expect(map.has("void-born")).toBe(false);
		expect(map.has("nameless")).toBe(false);
		// Only the two linkable rows are mapped.
		expect(map.size).toBe(2);
	});

	test("one fetch serves the sheet (the session cache dedupes)", async () => {
		await keyIndexMap();
		const afterFirst = contentCalls;
		await keyIndexMap();
		expect(contentCalls).toBe(afterFirst);
	});
});

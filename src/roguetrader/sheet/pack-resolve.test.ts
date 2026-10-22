/**
 * The sheet-side pack resolution through the ContentPort (bead p7o5).
 *
 * resolvePackDocument + getPackDocuments used to read `game.packs` and
 * `foundry.utils.fromUuid` directly (the wwuc root-cause workaround), so a
 * swapped-in NO_CONTENT_PORT had no effect here and the content-optional
 * fallback was untestable. They now read ports.content.document /
 * ports.content.documentsOrNull; these tests pin BOTH the fallback (the
 * no-content path must keep degrading gracefully, never throwing) and the
 * fact that the port is actually consulted (mirror of
 * psychic-support.test.ts's precedent).
 *
 * The direct-from-pack semantics of `document()` live in the foundry adapter
 * (bead wwuc: fromUuid returns undefined in-world for our LevelDB comps) and
 * are exercised there through a fake game.packs; here the port is faked
 * wholesale, which is the point of the routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { ContentPort } from "../../ffg/application/ports";
import { NO_CONTENT_PORT } from "../../ffg/application/ports";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../infrastructure/foundry/ports";
import {
	// Bead pwbr: the memoized fetch layer the per-render call sites route
	// through, now serving the per-render sheet sites too.
	characterOptionDocsOnce,
	getPackDocuments,
	packDocsOnce,
	resolvePackDocument,
} from "./pack-resolve";

const originalWarn = console.warn;
let warned = 0;

afterEach(() => {
	resetPorts();
});

describe("resolvePackDocument reads the ContentPort (bead p7o5)", () => {
	test("NO_CONTENT_PORT: any uuid degrades to null, never throws", async () => {
		setPorts({ ...foundryPorts, content: NO_CONTENT_PORT });
		expect(
			await resolvePackDocument(
				"Compendium.rogue-trader.character-options.Item.smiteId",
			),
		).toBeNull();
		// Non-compendium shapes too (the adapter's fromUuid fallback shape).
		expect(await resolvePackDocument("Actor.abc")).toBeNull();
	});

	test("the injected port is actually consulted and its answer returned", async () => {
		const asked: string[] = [];
		const fake = {
			...NO_CONTENT_PORT,
			document: async (uuid: string) => {
				asked.push(uuid);
				return { name: "Smite", type: "psychicpower" };
			},
		} satisfies ContentPort;
		setPorts({ ...foundryPorts, content: fake });
		const uuid = "Compendium.rogue-trader.character-options.Item.smiteId";
		const doc = (await resolvePackDocument(uuid)) as { name?: string };
		// Exactly one lookup, through the port (the old code called
		// game.packs/fromUuid directly and this array would have stayed empty).
		expect(asked).toEqual([uuid]);
		expect(doc.name).toBe("Smite");
	});
});

describe("getPackDocuments reads the ContentPort (bead p7o5)", () => {
	test("NO_CONTENT_PORT: the missing-pack warning fires once, list stays empty", async () => {
		const warns: string[] = [];
		console.warn = (message: unknown) => {
			warns.push(String(message));
		};
		setPorts({ ...foundryPorts, content: NO_CONTENT_PORT });
		expect(await getPackDocuments("rogue-trader.character-options")).toEqual(
			[],
		);
		console.warn = originalWarn;
		expect(warns.some((w) => w.includes("not installed"))).toBe(true);
	});

	test("the injected port's documentsOrNull list is returned as-is", async () => {
		const rows = [{ name: "Smite", type: "psychicpower" }];
		setPorts({
			...foundryPorts,
			content: {
				...NO_CONTENT_PORT,
				documentsOrNull: async (packId: string) =>
					packId === "rogue-trader.character-options" ? rows : null,
			},
		});
		expect(await getPackDocuments("rogue-trader.character-options")).toEqual(
			rows,
		);
		// A null fetch keeps the missing-pack degradation (empty, warned).
		warned = 0;
		console.warn = () => {
			warned += 1;
		};
		expect(await getPackDocuments("rogue-trader.missing")).toEqual([]);
		console.warn = originalWarn;
		expect(warned).toBe(1);
	});
});

describe("packDocsOnce / characterOptionDocsOnce (bead pwbr)", () => {
	test("characterOptionDocsOnce filters one type and fetches the pack ONCE across awaited calls", async () => {
		const fetched: string[] = [];
		setPorts({
			...foundryPorts,
			content: {
				...NO_CONTENT_PORT,
				documentsOrNull: async (packId: string) => {
					fetched.push(packId);
					return [
						{ type: "pwbr-talent", name: "Smite" },
						{ type: "skill", name: "Awareness" },
						{ type: "pwbr-talent", name: "Warp Speed" },
					];
				},
			},
		});
		const talents = (await characterOptionDocsOnce("pwbr-talent")) as Array<{
			name?: string;
		}>;
		// Same type twice -> the memoized fetch serves BOTH callers.
		const again = await characterOptionDocsOnce("pwbr-talent");
		expect(talents.map((d) => d.name)).toEqual(["Smite", "Warp Speed"]);
		expect(again).toEqual(talents);
		expect(fetched).toEqual(["rogue-trader.character-options"]);
	});

	test("a REJECTED memoized fetch is evicted, so the next caller retries", async () => {
		let attempt = 0;
		setPorts({
			...foundryPorts,
			content: {
				...NO_CONTENT_PORT,
				documentsOrNull: async () => {
					attempt += 1;
					if (attempt === 1) throw new Error("pack boom");
					return [{ type: "pwbr-retry", name: "Dodge" }];
				},
			},
		});
		await expect(characterOptionDocsOnce("pwbr-retry")).rejects.toThrow(
			"pack boom",
		);
		expect(await characterOptionDocsOnce("pwbr-retry")).toEqual([
			{ type: "pwbr-retry", name: "Dodge" },
		]);
		expect(attempt).toBe(2);
	});

	test("packDocsOnce dedupes concurrent and sequential loads under one key", async () => {
		let loads = 0;
		const load = async () => {
			loads += 1;
			return [{ n: loads }];
		};
		const [a, b] = await Promise.all([
			packDocsOnce("pwbr-key", load),
			packDocsOnce("pwbr-key", load),
		]);
		const c = await packDocsOnce("pwbr-key", load);
		expect(loads).toBe(1);
		expect(a).toEqual(b);
		expect(c).toEqual(a);
	});
});

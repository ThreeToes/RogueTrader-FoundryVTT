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
import { getPackDocuments, resolvePackDocument } from "./pack-resolve";

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

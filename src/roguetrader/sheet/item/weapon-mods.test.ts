import { describe, expect, test } from "bun:test";
import {
	attachedModIds,
	installMod,
	removeMod,
} from "./weapon-mods";

describe("weapon-mod install/remove (bead huaf)", () => {
	const owned = new Set(["a", "b"]);
	const owns = (id: string) => owned.has(id);

	test("attachedModIds dedupes and drops dangling ids", () => {
		expect(
			attachedModIds({ system: { modifications: ["a", "ghost", "a", ""] } }, owns),
		).toEqual(["a"]);
	});

	test("install appends once and compacts dangling ids", async () => {
		const writes: Record<string, unknown>[] = [];
		await installMod(
			{
				system: { modifications: ["b", "gone"] },
				update: (d) => {
					writes.push(d as Record<string, unknown>);
					return Promise.resolve();
				},
			},
			"a",
			owns,
		);
		expect(writes).toEqual([{ system: { modifications: ["b", "a"] } }]);
	});

	test("installing twice is a no-op", async () => {
		const writes: Record<string, unknown>[] = [];
		await installMod(
			{
				system: { modifications: ["a"] },
				update: (d) => {
					writes.push(d as Record<string, unknown>);
					return Promise.resolve();
				},
			},
			"a",
			owns,
		);
		expect(writes).toEqual([]);
	});

	test("remove drops the id and keeps the rest compacted", async () => {
		const writes: Record<string, unknown>[] = [];
		await removeMod(
			{
				system: { modifications: ["a", "gone", "b"] },
				update: (d) => {
					writes.push(d as Record<string, unknown>);
					return Promise.resolve();
				},
			},
			"a",
			owns,
		);
		expect(writes).toEqual([{ system: { modifications: ["b"] } }]);
	});
});

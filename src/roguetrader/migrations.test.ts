import { describe, expect, test } from "bun:test";
import {
	LEGACY_CHARACTER_TYPES,
	TARGET_CHARACTER_TYPE,
	explorerClonePayload,
	needsTypeMigration,
} from "./migrations";

// Bead ow8w: legacy pc/acolyte character types migrate onto "explorer"
// (owner decision 2026-09-06). Clone-recreate (create new, then delete old).

describe("legacy character type migration (bead ow8w)", () => {
	test("pc and acolyte need migration; explorer/npc/starship do not", () => {
		for (const type of ["pc", "acolyte"]) {
			expect(needsTypeMigration(type)).toBe(true);
		}
		for (const type of ["explorer", "npc", "dynasty", "starship"]) {
			expect(needsTypeMigration(type)).toBe(false);
		}
	});

	test("legacy list has no overlap with the target type", () => {
		expect(
			(LEGACY_CHARACTER_TYPES as readonly string[]).includes(
				TARGET_CHARACTER_TYPE,
			),
		).toBe(false);
	});

	test("clone payload switches the type and embeds items", () => {
		const payload = explorerClonePayload({
			id: "abc",
			type: "pc",
			name: "Old Explorer",
			img: "img.png",
			prototypeToken: { bar1: { attribute: "wounds" } },
			system: { insanity: 5 },
			items: [
				{ toObject: () => ({ name: "Pistol", type: "ranged-weapon" }) },
			],
		}) as Record<string, unknown>;
		expect(payload.type).toBe("explorer");
		expect(payload.name).toBe("Old Explorer");
		expect(payload.img).toBe("img.png");
		expect(payload.system).toEqual({ insanity: 5 });
		expect(payload.items).toEqual([
			{ name: "Pistol", type: "ranged-weapon" },
		]);
	});

	test("clone payload omits absent optional fields", () => {
		const payload = explorerClonePayload({ type: "acolyte" }) as Record<
			string,
			unknown
		>;
		expect(payload).toEqual({ type: "explorer", items: [] });
	});
});
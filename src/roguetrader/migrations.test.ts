import { describe, expect, test } from "bun:test";
import {
	LEGACY_CHARACTER_TYPES,
	TARGET_CHARACTER_TYPE,
	explorerClonePayload,
	needsTypeMigration,
	withoutLegacyCharacterTypes,
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

// Bead vnz3: the retired "pc" type must stop being OFFERED in the Create Actor
// dialog. The cleanup has to work on both shapes Foundry exposes, because
// confusing them failed silently once already.
describe("legacy types are stripped from the type registry (bead vnz3)", () => {
	test("the ARRAY shape is game.documentTypes — the one the dialog reads", () => {
		expect(
			withoutLegacyCharacterTypes(["explorer", "npc", "pc", "acolyte", "planet"]),
		).toEqual(["explorer", "npc", "planet"]);
	});

	test("the OBJECT-map shape is game.system.documentTypes (an ObjectField)", () => {
		// Array.isArray is always false for this shape — the old guard therefore
		// never filtered anything, which is why "pc" kept showing up.
		const manifest = {
			pc: { htmlFields: ["description"] },
			npc: { htmlFields: ["description"] },
			planet: { htmlFields: ["notes"] },
		};
		expect(withoutLegacyCharacterTypes(manifest)).toEqual({
			npc: { htmlFields: ["description"] },
			planet: { htmlFields: ["notes"] },
		});
	});

	test("the object shape is copied, not mutated in place", () => {
		const manifest: Record<string, unknown> = { pc: {} };
		withoutLegacyCharacterTypes(manifest);
		expect(manifest.pc).toBeDefined();
	});

	test("a registry already free of legacy types is unchanged", () => {
		const types = ["explorer", "npc", "vehicle"];
		expect(withoutLegacyCharacterTypes(types)).toEqual(types);
	});

	test("anything that is neither shape passes through untouched", () => {
		// Total function: a missing/odd registry must not throw during ready.
		for (const value of [undefined, null, 42, "explorer"]) {
			expect(withoutLegacyCharacterTypes(value)).toBe(value as never);
		}
	});

	test("every legacy type is stripped, not just pc", () => {
		for (const legacy of LEGACY_CHARACTER_TYPES) {
			expect(withoutLegacyCharacterTypes([legacy, "explorer"])).toEqual([
				"explorer",
			]);
		}
	});
});
import { describe, expect, test } from "bun:test";
import {
	LEGACY_CHARACTER_TYPES,
	TARGET_CHARACTER_TYPE,
	explorerClonePayload,
	needsTypeMigration,
	removeLegacyCharacterTypes,
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

// Bead aicd: Foundry v14 freezes the game.documentTypes OBJECT (its VALUES —
// the type-name arrays — stay mutable), so the call site must mutate in place
// instead of assigning. This is the regression guard for
// "Cannot assign to read only property 'Actor'" — the fixture reproduces the
// frozen outer object exactly as core builds it (Game.setupPackages).
describe("legacy types are mutated in place (bead aicd)", () => {
	test("frozen registry: array value is filtered IN PLACE and never assigned", () => {
		// The exact v14 shape: frozen outer object, mutable Object.keys arrays.
		const registry = Object.freeze({
			Actor: ["pc", "acolyte", "explorer", "npc", "planet"],
			Item: ["skill", "gear"],
		} as Record<string, unknown>);
		expect(() =>
			removeLegacyCharacterTypes(registry.Actor),
		).not.toThrow();
		const actor = registry.Actor as unknown as string[];
		expect(actor).toEqual(["explorer", "npc", "planet"]);
		// Same array identity: the frozen registry now exposes the cleaned list.
		expect(registry.Actor as unknown as string[]).toBe(actor);
	});

	test("frozen registry: object-map value loses its legacy keys IN PLACE", () => {
		// Same shape core builds for game.system.documentTypes: the OUTER
		// container freeze must never make the call site assign — the map
		// value is an ordinary mutable object and is edited in place.
		const systemDocumentTypes = Object.freeze({
			Actor: {
				pc: { htmlFields: ["description"] },
				npc: { htmlFields: ["description"] },
			},
			Item: {
				gear: { htmlFields: ["description"] },
			},
		} as Record<string, unknown>);
		const map = systemDocumentTypes.Actor as Record<string, unknown>;
		expect(() => removeLegacyCharacterTypes(map)).not.toThrow();
		expect(map.pc).toBeUndefined();
		expect(map.npc).toEqual({ htmlFields: ["description"] });
		expect(systemDocumentTypes.Actor as Record<string, unknown>).toBe(map);
	});

	test("an already-clean registry is left alone", () => {
		const types = ["explorer", "npc"];
		removeLegacyCharacterTypes(types);
		expect(types).toEqual(["explorer", "npc"]);
		const map: Record<string, unknown> = { npc: {} };
		removeLegacyCharacterTypes(map);
		expect(map).toEqual({ npc: {} });
	});

	test("anything that is neither shape is ignored, not thrown", () => {
		for (const value of [undefined, null, 42, "explorer"]) {
			expect(() => removeLegacyCharacterTypes(value)).not.toThrow();
		}
	});

	test("every legacy type is removed from a live array", () => {
		const types = [...LEGACY_CHARACTER_TYPES, "explorer"];
		removeLegacyCharacterTypes(types);
		expect(types).toEqual(["explorer"]);
	});
});
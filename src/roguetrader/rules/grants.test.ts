import { describe, expect, it } from "bun:test";
import {
	creatorGrantIds,
	GRANTED_BY_CREATOR,
	legacyCreatorIds,
	originRowFromStoredKey,
	parameterisedBase,
	parameterisedPackBase,
	resolveParameterised,
	reconcileForCreator,
	skillGrantPayload,
	suggestedSubjects,
	talentGrantPayload,
} from "./grants";

describe("parameterised talents (yclz)", () => {
	it("detects unresolved bases", () => {
		expect(parameterisedBase("Peer")).toBe("Peer");
		expect(parameterisedBase("Peer (choose one)")).toBe("Peer");
		expect(parameterisedBase("Enemy (X)")).toBe("Enemy");
		expect(parameterisedBase("Weapon Training (any)")).toBe("Weapon Training");
	});

	it("treats resolved subjects as resolved", () => {
		expect(parameterisedBase("Peer (Underworld)")).toBeNull();
		expect(parameterisedBase("Enemy (Adeptus Arbites)")).toBeNull();
		expect(parameterisedBase("Survival")).toBeNull();
	});

	it("suggests groups for known bases", () => {
		expect(suggestedSubjects("Peer")).toContain("Underworld");
		expect(suggestedSubjects("Talented")).toEqual([]);
	});

	it("resolves base + subject", () => {
		expect(resolveParameterised("Peer", "Underworld")).toBe("Peer (Underworld)");
	});
});

describe("parameterised pack base (bead h1o5)", () => {
	it("maps concrete subject-qualified names to the pack base", () => {
		expect(parameterisedPackBase("Rival (Rogue Trader family)")).toBe("Rival");
		expect(parameterisedPackBase("Resistance (Fear)")).toBe("Resistance");
		expect(parameterisedPackBase("Peer (Underworld)")).toBe("Peer");
		expect(parameterisedPackBase("Melee Weapon Training (Universal)")).toBe(
			"Melee Weapon Training",
		);
		expect(parameterisedPackBase("Pistol Weapon Training (Universal)")).toBe(
			"Pistol Weapon Training",
		);
	});

	it("also maps unresolved forms", () => {
		expect(parameterisedPackBase("Peer")).toBe("Peer");
		expect(parameterisedPackBase("Peer (choose one)")).toBe("Peer");
	});

	it("returns null for non-parameterised and bare names", () => {
		expect(parameterisedPackBase("Survival")).toBeNull();
		expect(parameterisedPackBase("Air of Authority")).toBeNull();
		expect(parameterisedPackBase("Totally Unrelated (Subject)")).toBeNull();
	});
});

describe("talent grant payload (meh0)", () => {
	it("clones pack doc fields", () => {
		const payload = talentGrantPayload("Air of Authority", {
			name: "Air of Authority",
			system: {
				category: "offence",
				tier: 2,
				prereqTalent: "air-of-authority",
				shortDescription: "Short",
				description: "Prerequisites: Fel 30.",
				effects: [{ kind: "test-modifier", testKey: "", value: 10, label: "x" }],
			},
		});
		expect(payload).toEqual({
			name: "Air of Authority",
			type: "talent",
			system: {
				category: "offence",
				tier: 2,
				prereqTalent: "air-of-authority",
				shortDescription: "Short",
				description: "Prerequisites: Fel 30.",
				effects: [{ kind: "test-modifier", testKey: "", value: 10, label: "x" }],
			},
		});
	});

	it("falls back to a bare payload without a doc", () => {
		expect(talentGrantPayload("Mystery Talent")).toEqual({
			name: "Mystery Talent",
			type: "talent",
			system: {},
		});
	});

	it("records creator provenance", () => {
		const payload = talentGrantPayload("Peer (Underworld)", null, {
			grantedBy: GRANTED_BY_CREATOR,
		});
		expect(payload.system.grantedBy).toBe(GRANTED_BY_CREATOR);
		const skill = skillGrantPayload("Survival", "int", {
			grantedBy: GRANTED_BY_CREATOR,
		});
		expect(skill.system).toEqual({ characteristic: "int", ladder: 1, grantedBy: GRANTED_BY_CREATOR });
	});
});

describe("stored origin key mapping (bead h7wl)", () => {
	it("maps every stored system.origins key to an OriginRow key", () => {
		// The creator stores camelCase keys; the legacy-item lookup must map
		// them to the kebab-case ORIGIN_ROWS or pre-flag items are never wiped.
		expect(originRowFromStoredKey("homeWorld")).toBe("home-world");
		expect(originRowFromStoredKey("birthright")).toBe("birthright");
		expect(originRowFromStoredKey("lure")).toBe("lure");
		expect(originRowFromStoredKey("trials")).toBe("trials");
		expect(originRowFromStoredKey("motivation")).toBe("motivation");
	});

	it("returns null for unknown keys", () => {
		expect(originRowFromStoredKey("claims")).toBeNull();
		expect(originRowFromStoredKey("dynastyUuid")).toBeNull();
	});
});

describe("creator reconcile (iufv)", () => {
	const items = [
		{ id: "a", type: "talent", name: "Peer (Underworld)", system: { grantedBy: GRANTED_BY_CREATOR } },
		{ id: "b", type: "skill", name: "Survival", system: { grantedBy: GRANTED_BY_CREATOR } },
		{ id: "c", type: "talent", name: "Frenzy" }, // manual
		{ id: "d", type: "talent", name: "Light Sleeper" }, // legacy creator grant
	];

	it("collects all creator-flagged ids for the wipe", () => {
		expect(creatorGrantIds(items)).toEqual(["a", "b"]);
	});

	it("collects legacy (pre-flag) items by name", () => {
		expect(legacyCreatorIds(items, new Set(["Light Sleeper"]))).toEqual(["d"]);
	});

	it("legacy detection ignores manual items of the same shape", () => {
		expect(legacyCreatorIds(items, new Set(["Frenzy"]))).toEqual(["c"]);
	});

	it("reconcile combines both", () => {
		expect(reconcileForCreator(items, new Set(["Light Sleeper"]))).toEqual({
			deleteIds: ["a", "b", "d"],
		});
		expect(reconcileForCreator(items, new Set<string>())).toEqual({ deleteIds: ["a", "b"] });
	});
});
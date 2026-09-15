import { describe, expect, test } from "bun:test";

await import("../../../test-helpers/foundry-schema-stub");
const { Character } = await import("./character");

/** Minimal character with set characteristic values (test helper). */
function _makeCharacter(characteristics: Record<string, number>): Character {
	return Object.create(Character.prototype) as Character & {
		characteristics: Record<string, { value: number; unnatural: number }>;
	};
}

function charWith(values: Record<string, number>): Character {
	const c = Object.create(Character.prototype) as Character;
	const characteristics: Record<string, { value: number; unnatural: number }> =
		{};
	for (const [key, value] of Object.entries(values)) {
		characteristics[key] = { value, unnatural: 1 };
	}
	(
		c as unknown as { characteristics: typeof characteristics }
	).characteristics = characteristics;
	return c;
}

describe("Character derived values (definitional)", () => {
	test("movement scales with Agility bonus", () => {
		const c = charWith({ ag: 40 }); // AB 4
		const m = c.movement();
		expect(m).toEqual({ half: 3, full: 4, charge: 8, run: 12 });
	});

	test("low AB clamps half-move to 1", () => {
		const c = charWith({ ag: 10 }); // AB 1
		expect(c.movement().half).toBe(1);
		expect(c.movement().full).toBe(1);
	});

	test("initiative bonus equals Agility bonus", () => {
		expect(charWith({ ag: 40 }).initiativeBonus()).toBe(4);
		expect(charWith({ ag: 0 }).initiativeBonus()).toBe(0);
	});

	test("missing characteristics read as zero", () => {
		const c = charWith({});
		expect(c.initiativeBonus()).toBe(0);
	});
});

// Effective characteristic values (bead xu83): permanent owned-item deltas
// (mutations/malignancies as owned Items) change the value derived badges and
// sheet display read. Tests still start from the base value and add the same
// deltas through the funnel, so both stay consistent and nothing doubles.
describe("effective characteristic values (bead xu83)", () => {
	const delta = (key: string, value: number) => ({
		kind: "characteristic-modifier",
		testKey: key,
		value,
	});

	function withItems(
		c: Character,
		items: Array<Record<string, unknown>>,
	): Character {
		(c as unknown as { parent: { items: unknown[] } }).parent = { items };
		return c;
	}

	test("owned-item deltas add to the effective value and its derived bonuses", () => {
		const c = withItems(charWith({ ag: 40 }), [
			{ type: "mutation", system: { effects: [delta("ag", -15)] } },
		]);
		expect(c.effectiveCharacteristicValue("ag")).toBe(25);
		expect(c.characteristicBonus("ag")).toBe(2);
		expect(c.movement().full).toBe(2);
		expect(c.initiativeBonus()).toBe(2);
	});

	test("without a parent (raw data-in tests) the base value is returned", () => {
		expect(charWith({ ag: 40 }).effectiveCharacteristicValue("ag")).toBe(40);
	});

	test("stowed gear contributes nothing; carried gear does", () => {
		const effect = delta("s", -20);
		const stowed = withItems(charWith({ s: 40 }), [
			{ type: "gear", system: { equipState: "stowed", effects: [effect] } },
		]);
		expect(stowed.effectiveCharacteristicValue("s")).toBe(40);
		const carried = withItems(charWith({ s: 40 }), [
			{ type: "gear", system: { equipState: "carried", effects: [effect] } },
		]);
		expect(carried.effectiveCharacteristicValue("s")).toBe(20);
	});

	test("only matching characteristics and the live kind contribute", () => {
		const c = withItems(charWith({ s: 40, t: 40 }), [
			{
				type: "mutation",
				system: {
					effects: [delta("t", -10), { kind: "wounds-max", value: 5 }],
				},
			},
		]);
		expect(c.effectiveCharacteristicValue("s")).toBe(40);
		expect(c.effectiveCharacteristicValue("t")).toBe(30);
	});

	test("unnatural multiplies the effective bonus", () => {
		const c = withItems(charWith({ s: 40 }), [
			{ type: "mutation", system: { effects: [delta("s", -15)] } },
		]);
		c.characteristics.s.unnatural = 2;
		expect(c.effectiveCharacteristicBonus("s")).toBe(4); // floor(25/10)=2, ×2
	});
});

describe("NPC identity fields (bead lib6)", () => {
	test("faction/subfaction/npcType/size declared, blank-initial (PCs never need them)", async () => {
		const { Character } = (await import("./character")) as unknown as {
			Character: { defineSchema(): Record<string, unknown> };
		};
		const schema = Character.defineSchema();
		for (const key of ["faction", "subfaction", "npcType", "size", "notes"]) {
			const field = schema[key] as { opts?: { initial?: unknown } } | undefined;
			expect(field, `schema missing ${key}`).toBeDefined();
			expect(field?.opts?.initial).toBe("");
		}
		const threat = schema.threatLevel as {
			opts?: { initial?: unknown };
		} | undefined;
		expect(threat?.opts?.initial).toBe("");
	});

	test("template.json npc block carries no system keys (the schema owns them)", async () => {
		const template = (await import(
			"../../../../template.json"
		)) as unknown as {
			Actor: { types: string[]; npc: Record<string, unknown> };
		};
		// Still listed: template.json's `types` is the legacy declaration list
		// (the Create Actor dialog reads game.documentTypes — bead vnz3), kept
		// aligned with the registry so the file stays truthful.
		expect(template.Actor.types).toContain("npc");
		const npc = template.Actor.npc as Record<string, unknown>;
		// Bead fi3o: the npc block used to mirror the schema's identity fields.
		// They are now declared by the Character model, which owns the defaults
		// (asserted in the test above), and the test BELOW is what kept lib6's
		// "no silent drops" guarantee: a template key the schema does not
		// declare is precisely the k4z0 gap, so the block must carry none of
		// them.
		for (const key of [
			"faction",
			"subfaction",
			"npcType",
			"threatLevel",
			"size",
			"notes",
		]) {
			expect(npc[key], `npc.${key} must not be in the template`).toBeUndefined();
		}
		// The dead v9 "type" key stays dead (system.type read like the actor
		// type, which is why npcType exists).
		expect(npc.type).toBeUndefined();
		// What remains is load-bearing: the DOCUMENT-level token default, which
		// a TypeDataModel cannot supply.
		expect(npc.prototypeToken).toEqual({ bar1: { attribute: "wounds" } });
	});
});

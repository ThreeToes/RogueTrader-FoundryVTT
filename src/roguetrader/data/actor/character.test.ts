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

describe("NPC identity fields (bead lib6)", () => {
	test("faction/subfaction/npcType/size declared, blank-initial (PCs never need them)", async () => {
		const { Character } = (await import("./character")) as unknown as {
			Character: { defineSchema(): Record<string, unknown> };
		};
		const schema = Character.defineSchema();
		for (const key of ["faction", "subfaction", "npcType", "size"]) {
			const field = schema[key] as { opts?: { initial?: unknown } } | undefined;
			expect(field, `schema missing ${key}`).toBeDefined();
			expect(field?.opts?.initial).toBe("");
		}
		const threat = schema.threatLevel as {
			opts?: { initial?: unknown };
		} | undefined;
		expect(threat?.opts?.initial).toBe("");
	});

	test("template.json npc block matches the schema (no silent drops)", async () => {
		const template = (await import(
			"../../../../template.json"
		)) as unknown as {
			Actor: { types: string[]; npc: Record<string, unknown> };
		};
		expect(template.Actor.types).toContain("npc");
		const npc = template.Actor.npc as Record<string, unknown>;
		// k4z0 GAP 2: threatLevel was a number in the template but a string in
		// the schema — the template must carry the schema's blank initial.
		expect(npc.threatLevel).toBe("");
		// Renamed dead "type" key (system.type read like the actor type).
		expect(npc.npcType).toBe("");
		expect(npc.type).toBeUndefined();
		// size is a string label now (the book uses words; 4 was never
		// schema-backed).
		expect(npc.size).toBe("");
		for (const key of ["faction", "subfaction", "notes"]) {
			expect(npc[key]).toBe("");
		}
	});
});

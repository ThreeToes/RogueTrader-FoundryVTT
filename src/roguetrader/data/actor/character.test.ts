import { describe, expect, test } from "bun:test";
await import("../../../../tests/helpers/foundry-schema-stub");
const { Character } = await import("./character");

/** Minimal character with set characteristic values (test helper). */
function makeCharacter(characteristics: Record<string, number>): Character {
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

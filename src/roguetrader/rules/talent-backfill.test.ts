import { isBareTalent, talentBackfillPatch } from "./talent-backfill";

describe("bare legacy talent backfill (bead oaaz)", () => {
	test("bare: empty system, missing system, description-less + category-less", () => {
		expect(isBareTalent(undefined)).toBe(true);
		expect(isBareTalent({})).toBe(true);
		expect(isBareTalent({ effects: [] })).toBe(true);
	});

	test("not bare when a description OR category exists (manual talents never clobbered)", () => {
		expect(isBareTalent({ description: "homebrew" })).toBe(false);
		expect(isBareTalent({ category: "offence" })).toBe(false);
		expect(isBareTalent({ shortDescription: "terse" })).toBe(false);
	});

	test("patch carries every populated pack field", () => {
		const patch = talentBackfillPatch({
			category: "offence",
			tier: 2,
			prereqTalent: "",
			shortDescription: "terse",
			description: "prose",
			effects: [{ kind: "test-modifier", value: 10 }],
		});
		expect(patch).toEqual({
			category: "offence",
			tier: 2,
			prereqTalent: "",
			shortDescription: "terse",
			description: "prose",
			effects: [{ kind: "test-modifier", value: 10 }],
		});
	});

	test("patch skips unset pack fields; empty effects omitted (nothing to heal)", () => {
		expect(talentBackfillPatch({})).toEqual({});
		expect(talentBackfillPatch(undefined)).toEqual({});
		expect(talentBackfillPatch({ category: "defence", effects: [] })).toEqual({
			category: "defence",
		});
	});

	test("tier 0 in the pack is still copied (explicit value, not absence)", () => {
		expect(talentBackfillPatch({ tier: 0 })).toEqual({ tier: 0 });
	});
});
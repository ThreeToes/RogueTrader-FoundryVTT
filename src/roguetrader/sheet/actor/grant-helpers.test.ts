import { afterEach, describe, expect, test } from "bun:test";
import { talentGrant } from "./grant-helpers";

// Bead h1o5: parameterised talents are authored as BARE base docs in the
// pack ("Rival", "Resistance") while origins/careers grant concrete
// subject-qualified names ("Rival (Rogue Trader family)"). talentGrant
// must fall back to the base pack doc and clone it under the concrete
// name instead of warning + granting a bare item.

interface FakePackDoc {
	name: string;
	system: Record<string, unknown>;
}

const PACK_DOCS: FakePackDoc[] = [
	{
		name: "Resistance",
		system: {
			category: "defence",
			description: "Gain +10 bonus to Resistance Tests against Fear.",
		},
	},
	{
		name: "Air of Authority",
		system: { category: "offence", description: "Prerequisites: Fel 30." },
	},
];

function stubGame(docs: FakePackDoc[]) {
	(globalThis as Record<string, unknown>).game = {
		packs: {
			get: (id: string) =>
				id === "rogue-trader.talents"
					? { getDocuments: async () => docs }
					: undefined,
		},
	};
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>).game;
});

describe("talentGrant parameterised fallback (bead h1o5)", () => {
	test("resolves a subject-qualified name to the base pack doc", async () => {
		stubGame(PACK_DOCS);
		const payload = await talentGrant("Resistance (Fear)");
		expect(payload.name).toBe("Resistance (Fear)");
		expect(payload.type).toBe("talent");
		expect(payload.system).toMatchObject({
			category: "defence",
			description: "Gain +10 bonus to Resistance Tests against Fear.",
		});
	});

	test("exact-name matches still win", async () => {
		stubGame(PACK_DOCS);
		const payload = await talentGrant("Air of Authority");
		expect(payload.name).toBe("Air of Authority");
		expect(payload.system).toMatchObject({ category: "offence" });
	});

	test("unknown talents still warn and grant bare", async () => {
		stubGame(PACK_DOCS);
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...parts: unknown[]) => warnings.push(String(parts[0]));
		try {
			const payload = await talentGrant("Mystery Talent");
			expect(payload.name).toBe("Mystery Talent");
			expect(payload.system).toEqual({});
		} finally {
			console.warn = originalWarn;
		}
		expect(warnings.some((w) => w.includes("Mystery Talent"))).toBe(true);
	});

	test("missing pack still warns and grants bare", async () => {
		stubGame([]);
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...parts: unknown[]) => warnings.push(String(parts[0]));
		try {
			const payload = await talentGrant("Rival (Rogue Trader family)");
			expect(payload.system).toEqual({});
		} finally {
			console.warn = originalWarn;
		}
		expect(warnings.some((w) => w.includes("Rival"))).toBe(true);
	});
});
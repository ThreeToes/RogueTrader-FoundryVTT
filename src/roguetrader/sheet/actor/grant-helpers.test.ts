import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { findPackDoc, talentGrant, warnPackDocMissing } from "./grant-helpers";

// Bead h1o5: parameterised talents are authored as BARE base docs in the
// pack ("Rival", "Resistance") while origins/careers grant concrete
// subject-qualified names ("Rival (Rogue Trader family)"). talentGrant
// must fall back to the base pack doc and clone it under the concrete
// name instead of warning + granting a bare item.

interface FakePackDoc {
	name: string;
	type: string;
	system: Record<string, unknown>;
}

const PACK_DOCS: FakePackDoc[] = [
	{
		name: "Resistance",
		type: "talent",
		system: {
			category: "defence",
			description: "Gain +10 bonus to Resistance Tests against Fear.",
		},
	},
	{
		name: "Air of Authority",
		type: "talent",
		system: { category: "offence", description: "Prerequisites: Fel 30." },
	},
];

function stubGame(docs: FakePackDoc[]) {
	(globalThis as Record<string, unknown>).game = {
		packs: {
			get: (id: string) =>
				id === "rogue-trader.character-options"
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

describe("findPackDoc — the one pack-by-name resolve (bead 38io)", () => {
	test("casing-insensitive: 'resistance' and 'RESISTANCE' resolve as 'Resistance'", async () => {
		stubGame(PACK_DOCS);
		// The pack authors 'Resistance'; grant sources print every casing.
		for (const name of ["resistance", "RESISTANCE", "Resistance"]) {
			const doc = (await findPackDoc("talent", name)) as {
				name?: string;
			} | null;
			expect(doc?.name, name).toBe("Resistance");
		}
	});

	test("other Item types stay independent (skill not matched by a talent name)", async () => {
		stubGame([
			{ name: "Dodge", type: "skill", system: {} },
			{ name: "Dodge", type: "talent", system: {} },
		]);
		expect(
			((await findPackDoc("skill", "dodge")) as { type: string }).type,
		).toBe("skill");
		expect(
			((await findPackDoc("talent", "DODGE")) as { type: string }).type,
		).toBe("talent");
	});

	test("missing doc returns null without warning (callers own the miss)", async () => {
		stubGame(PACK_DOCS);
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...parts: unknown[]) => warnings.push(String(parts[0]));
		try {
			expect(await findPackDoc("talent", "Mystery Talent")).toBeNull();
		} finally {
			console.warn = originalWarn;
		}
		expect(warnings).toEqual([]);
	});

	test("options.pack resolves against another compendium pack, type-filtered", async () => {
		stubGame(PACK_DOCS);
		(globalThis as Record<string, unknown>).game = {
			packs: {
				get: (id: string) =>
					id === "rogue-trader.afflictions"
						? {
								getDocuments: async () => [
									{ name: "Ravaged", type: "mutation", system: {} },
									{ name: "RAVAGED", type: "madnessentry", system: {} },
								],
							}
						: undefined,
			},
		};
		const doc = (await findPackDoc("mutation", "RAVAGED", {
			pack: "rogue-trader.afflictions",
		})) as { name?: string; type?: string } | null;
		expect(doc?.type).toBe("mutation");
	});

	test("warnPackDocMissing is the one established warn", () => {
		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (...parts: unknown[]) => warnings.push(String(parts[0]));
		try {
			warnPackDocMissing("talent", "Iron Jaw", "granting a bare item");
		} finally {
			console.warn = originalWarn;
		}
		expect(warnings).toEqual([
			'rogue-trader | talent "Iron Jaw" not found in the character-options pack; granting a bare item',
		]);
	});
});

/**
 * Grep guard (bead 38io): findPackDoc OWNS pack-by-name resolution. A
 * surface that re-implements the exact-case docs.find((d) => d.name ===
 * name) idiom reintroduces divergent casing + missing-doc behaviour — fail
 * and point the author at findPackDoc(). The whitelist entries below are
 * NOT pack-doc resolves: owned-item checks and registry-entry lookups that
 * take no pack fetch at all.
 */
describe("findPackDoc grep guard (bead 38io)", () => {
	/**
	 * The divergent idiom: a single-line find whose ONLY condition is the
	 * case-sensitive exact name compare (`docs.find((d) => d.name === name)`).
	 * Compound owned-item checks (`item.type === ... && item.name === name`)
	 * are not pack resolves and pass.
	 */
	const IDIOM = /\.name\s*===\s*name\s*\)\s*[,;]?\s*$/;

	/** The case-insensitive resolve helper's own line — must appear ONCE. */
	const HELPER_IDIOM = /\.name\?\.toLowerCase\(\)\s*===\s*lower\b/g;

	/** Known non-pack users of the shape, each with its reason. */
	const WHITELIST: Readonly<Record<string, string>> = {
		// Action-catalog chips: CONFIG-registry entries, not compendium docs;
		// not a listed bead-38io surface (follow-up candidate).
		"src/roguetrader/sheet/actor/actions-view.ts":
			"registry action-entry chips, not a pack fetch",
	};

	function sourceFiles(dir: string): string[] {
		const out: string[] = [];
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
			else if (path.endsWith(".ts") && !path.endsWith(".test.ts"))
				out.push(path);
		}
		return out;
	}

	test("the case-insensitive resolve idiom exists exactly once (grant-helpers.ts)", () => {
		const hits = sourceFiles("src/roguetrader").flatMap((path) => {
			const text = readFileSync(path, "utf8");
			return HELPER_IDIOM.test(text) ? [path] : [];
		});
		expect(hits).toEqual(["src/roguetrader/sheet/actor/grant-helpers.ts"]);
	});

	test("no surface re-implements the case-sensitive pack-by-name find", () => {
		const offenders: string[] = [];
		for (const path of sourceFiles("src/roguetrader")) {
			if (Object.keys(WHITELIST).some((file) => path.includes(file))) {
				continue;
			}
			const hit = readFileSync(path, "utf8")
				.split("\n")
				.some((line) => IDIOM.test(line.trimEnd()));
			if (hit) offenders.push(path);
		}
		expect(
			offenders,
			`case-sensitive pack-by-name find found; use findPackDoc() from sheet/actor/grant-helpers.ts instead:`,
		).toEqual([]);
	});
});

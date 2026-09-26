/**
 * Changesets core library tests (bead foundryvtt-rogue-trader-m86c).
 *
 * Format parsing (frontmatter keyed by system slug, loud failures on
 * malformed input), largest-level-wins selection, release-notes rendering
 * and the src/packs leak guard. Fixtures are built in a temp dir — no
 * fixture changesets are committed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
	isPackReference,
	parseChangesetFile,
	parseChangesets,
	renderReleaseNotes,
	selectBump,
} from "./changesets.mjs";

describe("parseChangesetFile", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-changesets-"));
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
	});

	function write(name: string, content: string) {
		const path = join(dir, name);
		writeFileSync(path, content);
		return path;
	}

	it("parses each level", () => {
		for (const level of ["major", "minor", "patch"]) {
			const path = write(
				`${level}.md`,
				`---\n"rogue-trader": ${level}\n---\n\n- Did a ${level} thing.\n`,
			);
			const parsed = parseChangesetFile(path);
			expect(parsed.system).toBe("rogue-trader");
			expect(parsed.level).toBe(level);
			expect(parsed.body).toBe(`- Did a ${level} thing.\n`);
		}
	});

	it("rejects malformed frontmatter", () => {
		const path = write("bad.md", "no frontmatter here\n");
		expect(() => parseChangesetFile(path)).toThrow(/no --- YAML frontmatter/);
	});

	it("rejects unknown level", () => {
		const path = write("level.md", `---\n"rogue-trader": micro\n---\n\n- x\n`);
		expect(() => parseChangesetFile(path)).toThrow(/invalid level/);
	});

	it("rejects unknown system", () => {
		const path = write("system.md", `---\n"dark-heresy": minor\n---\n\n- x\n`);
		expect(() => parseChangesetFile(path)).toThrow(/unknown system/);
	});

	it("rejects empty body", () => {
		const path = write("empty.md", `---\n"rogue-trader": patch\n---\n\n\n`);
		expect(() => parseChangesetFile(path)).toThrow(/empty body/);
	});

	it("rejects several system keys in one file", () => {
		const path = write(
			"multi.md",
			`---\n"rogue-trader": patch\n"dark-heresy": minor\n---\n\n- x\n`,
		);
		expect(() => parseChangesetFile(path)).toThrow(/one file = one system/);
	});
});

describe("parseChangesets", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-changesets-"));
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reads *.md only, ignoring README.md", () => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "a-thing.md"),
			`---\n"rogue-trader": patch\n---\n\n- A.\n`,
		);
		writeFileSync(join(dir, "README.md"), "format reference\n");
		writeFileSync(join(dir, "notes.txt"), "not markdown\n");
		const parsed = parseChangesets(dir);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].level).toBe("patch");
	});
});

describe("selectBump", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-select-"));
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
	});

	function make(system: string, level: string, name: string) {
		const path = join(dir, `${name}.md`);
		writeFileSync(path, `---\n"${system}": ${level}\n---\n\n- ${name}\n`);
		return { path, system, level, body: `- ${name}\n` };
	}

	it("patch + patch -> patch", () => {
		const changesets = [make("rogue-trader", "patch", "one"), make("rogue-trader", "patch", "two")];
		expect(selectBump("rogue-trader", changesets).level).toBe("patch");
	});

	it("minor + patch -> minor", () => {
		const changesets = [make("rogue-trader", "patch", "p"), make("rogue-trader", "minor", "m")];
		expect(selectBump("rogue-trader", changesets).level).toBe("minor");
	});

	it("major + minor + patch -> major", () => {
		const changesets = [
			make("rogue-trader", "patch", "p"),
			make("rogue-trader", "minor", "m"),
			make("rogue-trader", "major", "j"),
		];
		expect(selectBump("rogue-trader", changesets).level).toBe("major");
	});

	it("foreign-system changesets are skipped, not consumed", () => {
		const changesets = [
			make("rogue-trader", "patch", "ours"),
			make("dark-heresy", "major", "theirs"),
		];
		const result = selectBump("rogue-trader", changesets);
		expect(result.level).toBe("patch");
		expect(result.consumed).toHaveLength(1);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]).toContain("theirs.md");
	});

	it("throws when there are no changesets for the system", () => {
		const changesets = [make("dark-heresy", "major", "foreign")];
		expect(() => selectBump("rogue-trader", changesets)).toThrow(
			/no changesets found for system/,
		);
	});
});

describe("renderReleaseNotes", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-render-"));
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
	});

	function make(level: string, name: string) {
		const path = join(dir, `${name}.md`);
		writeFileSync(path, `---\n"rogue-trader": ${level}\n---\n\n- ${name}\n`);
		return { path, system: "rogue-trader", level, body: `- ${name}` };
	}

	it("renders header and orders level desc then path", () => {
		const notes = renderReleaseNotes("rogue-trader", "0.3.0", [
			make("patch", "b-patch"),
			make("major", "a-major"),
			make("minor", "c-minor"),
		]);
		expect(notes).toStartWith("## Rogue Trader v0.3.0\n\n");
		const order = notes
			.split("\n\n")
			.slice(1)
			.map((group) => group.trim());
		expect(order).toEqual(["- a-major", "- c-minor", "- b-patch"]);
		expect(notes.endsWith("\n")).toBe(true);
	});

	it("keeps a bullet body as authored", () => {
		const notes = renderReleaseNotes("rogue-trader", "1.0.0", [
			make("minor", "bullet"),
		]);
		expect(notes).toContain("\n- bullet\n");
	});
});

describe("isPackReference", () => {
	it("flags src/packs paths", () => {
		expect(isPackReference("Added data under src/packs")).toBe(true);
		expect(isPackReference("Added src/packs/rogue_trader/x.yaml")).toBe(true);
		expect(isPackReference("moved to src/packs npcs")).toBe(true);
	});

	it("ignores prose that merely says packs or packer", () => {
		expect(isPackReference("Tightened the packer output")).toBe(false);
		expect(isPackReference("Documented the packs layout")).toBe(false);
	});
});
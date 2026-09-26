/**
 * Release-manifest bumper tests (bead 7nm5 phase 3, updated by 3joz).
 *
 * bumpVersion: strict x.y.z arithmetic + loud failures on malformed input
 * (never silently produce a weird version). bumpManifest: version/manifest/
 * download patching against a temp copy — the committed release manifest is
 * never touched by tests. bumpFromChangesets: the bump level is DERIVED
 * from temp-dir changeset fixtures (largest wins), zero changesets for the
 * system fails loudly with NO manifest write, notes land in a file, and a
 * consumed body referencing src/packs is refused.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { bumpFromChangesets, bumpManifest, bumpVersion } from "./bump-release-manifest.mjs";

function changeset(dir: string, name: string, system: string, level: string, body: string) {
	writeFileSync(
		join(dir, name),
		`---\n"${system}": ${level}\n---\n\n${body}\n`,
	);
	return join(dir, name);
}

describe("bumpVersion", () => {
	it("bumps each level correctly", () => {
		expect(bumpVersion("0.0.2", "patch")).toBe("0.0.3");
		expect(bumpVersion("0.0.9", "patch")).toBe("0.0.10");
		expect(bumpVersion("0.1.4", "minor")).toBe("0.2.0");
		expect(bumpVersion("1.9.9", "major")).toBe("2.0.0");
	});

	it("rejects non-strict semver loudly", () => {
		expect(() => bumpVersion("1.2", "patch")).toThrow(/not a strict/);
		expect(() => bumpVersion("1.2.x", "patch")).toThrow(/not a strict/);
		expect(() => bumpVersion("v1.2.3", "patch")).toThrow(/not a strict/);
		expect(() => bumpVersion("0.0.2", "micro")).toThrow(/invalid bump level/);
	});
});

describe("bumpManifest", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-bump-"));
	const manifestPath = join(dir, "rogue-trader-release.json");
	afterEach(() => {
		rmSync(manifestPath);
	});

	function seed(version: string) {
		const base = JSON.parse(
			readFileSync("system-manifests/rogue-trader-release.json", "utf8"),
		) as Record<string, unknown>;
		base.version = version;
		writeFileSync(manifestPath, JSON.stringify(base, null, 2));
	}

	it("patches version, manifest URL and download URL", () => {
		seed("0.0.2");
		const result = bumpManifest(manifestPath, "patch", "https://host/owner/repo");
		expect(result.version).toBe("0.0.3");
		expect(result.tag).toBe("v0.0.3");
		const written = JSON.parse(readFileSync(manifestPath, "utf8"));
		expect(written.version).toBe("0.0.3");
		expect(written.manifest).toBe(
			`https://host/owner/repo/raw/branch/master/${manifestPath}`,
		);
		expect(written.download).toBe(
			"https://host/owner/repo/releases/download/v0.0.3/rogue-trader.zip",
		);
	});

	// (kept) URL/version stamping must behave exactly as before.

	it("keeps packs[] and other manifest fields intact", () => {
		seed("0.0.2");
		bumpManifest(manifestPath, "minor", "https://host/owner/repo");
		const before = JSON.parse(
			readFileSync("system-manifests/rogue-trader-release.json", "utf8"),
		) as Record<string, unknown>;
		const written = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
			string,
			unknown
		>;
		expect(written.packs).toEqual(before.packs);
		expect(written.id).toBe(before.id);
		expect(written.languages).toEqual(before.languages);
	});
});

describe("bumpFromChangesets", () => {
	const dir = mkdtempSync(join(tmpdir(), "rt-bump-cs-"));
	const changesetDir = join(dir, "changeset");
	const manifestPath = join(dir, "rogue-trader-release.json");
	const notesPath = join(dir, "release-notes.md");
	afterEach(() => {
		rmSync(changesetDir, { recursive: true, force: true });
		rmSync(manifestPath, { force: true });
		rmSync(notesPath, { force: true });
	});

	function seed(version: string) {
		mkdirSync(changesetDir, { recursive: true });
		const base = JSON.parse(
			readFileSync("system-manifests/rogue-trader-release.json", "utf8"),
		) as Record<string, unknown>;
		base.version = version;
		writeFileSync(manifestPath, JSON.stringify(base, null, 2));
	}

	function run() {
		return bumpFromChangesets({
			system: "rogue-trader",
			changesetDir,
			manifestPath,
			notesPath,
		});
	}

	it("derives the largest level from temp-dir fixtures and stamps the manifest", () => {
		seed("0.0.2");
		const patchPath = changeset(
			changesetDir, "aaa-fix.md", "rogue-trader", "patch", "- Fixed something small.",
		);
		const minorPath = changeset(
			changesetDir, "zzz-feature.md", "rogue-trader", "minor", "- Added a feature.",
		);
		const result = run();
		// Largest level wins (minor beats patch).
		expect(result.version).toBe("0.1.0");
		expect(result.tag).toBe("v0.1.0");
		expect(result.download).toBe(
			`https://prancingpony.jumblerumbling.com/stephen/foundryvtt-rogue-trader/releases/download/v0.1.0/rogue-trader.zip`,
		);
		expect(result.consumed).toEqual([patchPath, minorPath]);
		expect(result.skippedCount).toBe(0);
		const written = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
		expect(written.version).toBe("0.1.0");
		expect(written.manifest).toBe(
			`https://prancingpony.jumblerumbling.com/stephen/foundryvtt-rogue-trader/raw/branch/master/${manifestPath}`,
		);
	});

	it("writes the rendered notes file with header and bodies", () => {
		seed("0.2.1");
		changeset(changesetDir, "aaa-fix.md", "rogue-trader", "patch", "- Fixed the gate.");
		changeset(changesetDir, "zzz-feature.md", "rogue-trader", "minor", "- Shared the psyker gate.");
		run();
		const notes = readFileSync(notesPath, "utf8");
		expect(notes).toBe(
			"## Rogue Trader v0.3.0\n\n- Shared the psyker gate.\n\n- Fixed the gate.\n",
		);
	});

	it("skipped-count stays 0 with multiple rogue-trader changesets (one-system registry)", () => {
		seed("0.0.2");
		changeset(changesetDir, "aaa.md", "rogue-trader", "patch", "- Ours.");
		changeset(changesetDir, "zzz.md", "rogue-trader", "patch", "- Ours too.");
		const result = run();
		expect(result.version).toBe("0.0.3");
		expect(result.skippedCount).toBe(0);
		expect(result.consumed).toHaveLength(2);
	});

	it("a changeset naming an unregistered system fails at parse time (one-system registry)", () => {
		seed("0.0.2");
		mkdirSync(changesetDir, { recursive: true });
		changeset(changesetDir, "foreign.md", "other-system", "major", "- Not for us.");
		expect(() => run()).toThrow(/unknown system: "other-system"/);
	});

	it("fails loudly on zero changesets and writes NO manifest/notes", () => {
		seed("0.0.2");
		mkdirSync(changesetDir, { recursive: true });
		const before = readFileSync(manifestPath, "utf8");
		expect(() => run()).toThrow(/no changesets found for system/);
		expect(readFileSync(manifestPath, "utf8")).toBe(before);
		expect(() => readFileSync(notesPath, "utf8")).toThrow(/ENOENT/);
	});

	it("refuses a consumed body referencing src/packs", () => {
		seed("0.0.2");
		changeset(
			changesetDir, "leak.md", "rogue-trader", "patch",
			"- Added npcs to src/packs/rogue_trader.",
		);
		const before = readFileSync(manifestPath, "utf8");
		expect(() => run()).toThrow(/src\/packs/);
		expect(readFileSync(manifestPath, "utf8")).toBe(before);
	});

	it("fails loudly on an unknown system slug", () => {
		expect(() => bumpFromChangesets({ system: "dark-heresy" })).toThrow(
			/unknown system/,
		);
	});
});
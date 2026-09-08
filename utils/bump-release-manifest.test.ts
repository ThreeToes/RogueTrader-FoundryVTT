/**
 * Release-manifest bumper tests (bead 7nm5 phase 3).
 *
 * bumpVersion: strict x.y.z arithmetic + loud failures on malformed input
 * (never silently produce a weird version). bumpManifest: version/manifest/
 * download patching against a temp copy — the committed release manifest is
 * never touched by tests.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { bumpManifest, bumpVersion } from "./bump-release-manifest.mjs";

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
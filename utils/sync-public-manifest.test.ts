import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setPublicDownload, syncPublicManifest } from "./sync-public-manifest.mjs";

const GITHUB_REPO = "ThreeToes/RogueTrader-FoundryVTT";

function manifestFixture(path, version, download = `dl-v${version}`) {
	writeFileSync(
		path,
		JSON.stringify({ id: "rogue-trader", version, download }, null, 4),
	);
}

describe("syncPublicManifest", () => {
	test("stamps the private version and the GitHub manifest/download URLs", () => {
		const dir = mkdtempSync(join(tmpdir(), "pub-manifest-"));
		const priv = join(dir, "private.json");
		const pub = join(dir, "public.json");
		manifestFixture(priv, "1.2.3");
		manifestFixture(pub, "0.0.1");

		const result = syncPublicManifest(pub, priv);
		expect(result.version).toBe("1.2.3");
		expect(result.tag).toBe("v1.2.3");
		const manifest = JSON.parse(readFileSync(pub, "utf8"));
		expect(manifest.version).toBe("1.2.3");
		expect(manifest.manifest).toBe(
			`https://raw.githubusercontent.com/${GITHUB_REPO}/master/${pub}`,
		);
		expect(manifest.download).toBe(
			`https://github.com/${GITHUB_REPO}/releases/download/v1.2.3/rogue-trader.zip`,
		);
	});

	test("fails loudly when the private manifest has no version", () => {
		const dir = mkdtempSync(join(tmpdir(), "pub-manifest-"));
		const priv = join(dir, "private.json");
		const pub = join(dir, "public.json");
		writeFileSync(priv, JSON.stringify({ id: "rogue-trader" }));
		manifestFixture(pub, "0.0.1");
		expect(() => syncPublicManifest(pub, priv)).toThrow(/no string version/);
	});
});

describe("setPublicDownload", () => {
	test("patches the download field and reports a change", () => {
		const dir = mkdtempSync(join(tmpdir(), "pub-manifest-"));
		const pub = join(dir, "public.json");
		manifestFixture(pub, "1.2.3");
		const result = setPublicDownload(
			`https://github.com/${GITHUB_REPO}/releases/download/v1.2.3/other.zip`,
			pub,
		);
		expect(result.changed).toBe(true);
		const manifest = JSON.parse(readFileSync(pub, "utf8"));
		expect(manifest.download).toBe(
			`https://github.com/${GITHUB_REPO}/releases/download/v1.2.3/other.zip`,
		);
	});

	test("no-ops (changed: false) when the URL is already current", () => {
		const dir = mkdtempSync(join(tmpdir(), "pub-manifest-"));
		const pub = join(dir, "public.json");
		manifestFixture(pub, "1.2.3", "already-set");
		const result = setPublicDownload("already-set", pub);
		expect(result.changed).toBe(false);
	});
});
/**
 * Release-manifest version bumper (bead 7nm5 phase 3).
 *
 * `bun utils/bump-release-manifest.mjs --bump=<major|minor|patch>` reads
 * system-manifests/rogue-trader-release.json, bumps its semver version, and
 * writes back the version + the Foundry manifest URLs:
 *
 * - `manifest`: STABLE raw URL for the committed manifest — Foundry consults
 *   it for update checks (https://foundryvtt.com/article/system-development/);
 *   it must never move. Overwritten each run (idempotent, deterministic).
 * - `download`: the release attachment URL — computed from the tag we are
 *   ABOUT to create (v{version}) so the manifest can be committed and tagged
 *   BEFORE the Forgejo release exists (Forgejo's release-download URL shape
 *   makes the URL deterministic pre-release, avoiding the circularity of
 *   creating the release first and patching the manifest after).
 *
 * Prints `version=<next>` (GITHUB_OUTPUT-compatible) for the workflow to
 * propagate. Loud failures on malformed manifest/level — never silent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_MANIFEST = "system-manifests/rogue-trader-release.json";
const RAW_BASE =
	"https://prancingpony.jumblerumbling.com/stephen/foundryvtt-rogue-trader";
const ARTIFACT_NAME = "rogue-trader.zip";

/** Bump a strict x.y.z semver by level. Throws on anything non-conforming. */
export function bumpVersion(version, level) {
	const parts = String(version).split(".");
	if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
		throw new Error(`not a strict x.y.z semver: "${version}"`);
	}
	const [major, minor, patch] = parts.map(Number);
	switch (level) {
		case "major":
			return [major + 1, 0, 0].join(".");
		case "minor":
			return [major, minor + 1, 0].join(".");
		case "patch":
			return [major, minor, patch + 1].join(".");
		default:
			throw new Error(`invalid bump level: "${level}" (major|minor|patch)`);
	}
}

/** Patch the release manifest in place; returns {version, tag, download}. */
export function bumpManifest(manifestPath, level, rawBase = RAW_BASE) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (typeof manifest.version !== "string") {
		throw new Error(`release manifest has no string version: ${manifestPath}`);
	}
	const version = bumpVersion(manifest.version, level);
	const tag = `v${version}`;
	manifest.version = version;
	manifest.manifest = `${rawBase}/raw/branch/master/${manifestPath}`;
	manifest.download = `${rawBase}/releases/download/${tag}/${ARTIFACT_NAME}`;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { version, tag, download: manifest.download };
}

function main() {
	const { argv } = process;
	const bumpArg = argv.find((arg) => arg.startsWith("--bump="));
	if (!bumpArg) {
		console.error("usage: bun utils/bump-release-manifest.mjs --bump=<level>");
		process.exit(1);
	}
	const level = bumpArg.slice("--bump=".length);
	let result;
	try {
		result = bumpManifest(DEFAULT_MANIFEST, level);
	} catch (error) {
		console.error(`bump-release-manifest: ${error.message}`);
		process.exit(1);
	}
	console.log(`version=${result.version}`);
	console.log(`tag=${result.tag}`);
	console.log(`download=${result.download}`);
}

if (import.meta.main) {
	main();
}
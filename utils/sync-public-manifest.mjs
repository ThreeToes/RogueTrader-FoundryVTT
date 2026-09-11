/**
 * Public-release manifest syncer (bead bpk2): keeps the PUBLIC Foundry-facing
 * manifest (system-manifests/rogue-trader-public.json — the GitHub mirror's
 * manifest/download surface) in step with the PRIVATE release manifest
 * (system-manifests/rogue-trader-release.json).
 *
 * The public build never carries compendium packs, so this manifest is the
 * Foundry-facing contract of the GitHub release. Modes:
 *
 * - `sync`   : read the private manifest's version, stamp it into the public
 *   manifest, and write the STABLE `manifest` raw URL + the deterministic
 *   pre-release `download` URL (releases/download/v{version}/rogue-trader.zip,
 *   same determinism trick as the private flow). Prints
 *   GITHUB_OUTPUT-compatible lines for the workflow.
 * - `set-download --url=<asset url>`: after the GitHub release exists, patch
 *   the `download` field with the asset URL the API reported (normally
 *   identical to the provisional URL — the manifest is only rewritten when it
 *   differs).
 *
 * Loud failures on malformed manifests — never silent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PUBLIC_MANIFEST = "system-manifests/rogue-trader-public.json";
const PRIVATE_MANIFEST = "system-manifests/rogue-trader-release.json";
const GITHUB_REPO = "ThreeToes/RogueTrader-FoundryVTT";
const GITHUB_BRANCH = "master";
const ARTIFACT_NAME = "rogue-trader.zip";

/** Stamp version + stable manifest URL + provisional download URL. */
export function syncPublicManifest(publicPath = PUBLIC_MANIFEST, privatePath = PRIVATE_MANIFEST) {
	const priv = JSON.parse(readFileSync(privatePath, "utf8"));
	const pub = JSON.parse(readFileSync(publicPath, "utf8"));
	if (typeof priv.version !== "string") {
		throw new Error(`private release manifest has no string version: ${privatePath}`);
	}
	const version = priv.version;
	const tag = `v${version}`;
	pub.version = version;
	pub.manifest = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${publicPath}`;
	pub.download = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${ARTIFACT_NAME}`;
	writeFileSync(publicPath, `${JSON.stringify(pub, null, 4)}\n`);
	return { version, tag, manifest: pub.manifest, download: pub.download };
}

/** Point the public manifest's download field at a concrete asset URL. */
export function setPublicDownload(url, publicPath = PUBLIC_MANIFEST) {
	const pub = JSON.parse(readFileSync(publicPath, "utf8"));
	if (pub.download === url) {
		console.log("set-download: manifest download already current — no change");
		return { changed: false, download: url };
	}
	pub.download = url;
	writeFileSync(publicPath, `${JSON.stringify(pub, null, 4)}\n`);
	return { changed: true, download: url };
}

function main() {
	const { argv } = process;
	const mode = argv[2];
	try {
		if (mode === "sync") {
			const result = syncPublicManifest();
			console.log(`version=${result.version}`);
			console.log(`tag=${result.tag}`);
			console.log(`download=${result.download}`);
		} else if (mode === "set-download") {
			const urlArg = argv.find((arg) => arg.startsWith("--url="));
			if (!urlArg) {
				console.error("usage: ... set-download --url=<asset url>");
				process.exit(1);
			}
			const result = setPublicDownload(urlArg.slice("--url=".length));
			if (result.changed) console.log(`download=${result.download}`);
		} else {
			console.error("usage: bun utils/sync-public-manifest.mjs <sync|set-download --url=...>");
			process.exit(1);
		}
	} catch (error) {
		console.error(`sync-public-manifest: ${error.message}`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}
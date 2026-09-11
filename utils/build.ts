import { existsSync, watch } from "node:fs";
import { cp, rm, readFile, writeFile } from "node:fs/promises";
import { bundlePacks, readManifestPacks } from "./compendia";
import { bundleCss } from "./css";
import { bundleTypescript } from "./javascript";

const WATCH_PATHS = [
	"./src",
	"./css",
	"./template",
	"./lang",
	"./system-manifests",
	"./src/packs",
];

async function copyStaticFiles() {
	// Which manifest ships as system.json (bead 7nm5 phase 3): dev builds ship
	// system-manifests/dev.json; release builds (Forgejo release-private
	// action) set RELEASE_MANIFEST=1 and ship rogue-trader-release.json — the
	// Foundry-facing manifest carrying version + manifest/download URLs.
	const isRelease = process.env.RELEASE_MANIFEST === "1";
	const manifestSource = isRelease
		? "./system-manifests/rogue-trader-release.json"
		: "./system-manifests/dev.json";
	if (!existsSync(manifestSource)) {
		throw new Error(`build: system manifest missing: ${manifestSource}`);
	}
	// Merge the privately-held packs array into the shipped manifest (both dev
	// and release builds). Release builds throw if the fragment is missing so
	// a stale packs-repo checkout cannot silently publish a packless system;
	// CI/local builds keep working without a packs clone.
	const packs = await readManifestPacks();
	const manifestSourceText = await readFile(manifestSource, "utf8");
	const manifestText = await packManifest(manifestSourceText, packs, isRelease);
	await writeFile("./release/rogue_trader/system.json", manifestText);
	await cp("./lang", "./release/rogue_trader/lang", { recursive: true, force: true });
	// template.json (document type declarations) ships with the system; the
	// create-dialog type lists read it, so a stale copy breaks new types.
	await cp("./template.json", "./release/rogue_trader/template.json", {
		force: true,
	});
	// Prune-then-copy: release/rogue_trader/template must mirror ./template exactly so
	// stale legacy templates never ship (release directory cleanup, v9o).
	await rm("./release/rogue_trader/template", { recursive: true, force: true });
	await cp("./template", "./release/rogue_trader/template", {
		recursive: true,
		force: true,
	});
	await cp("./asset", "./release/rogue_trader/asset", { recursive: true, force: true });
}

/**
 * Inject the packs array into a manifest read as text, preserving the rest of
 * the document verbatim (string splice, not a JSON round-trip, so formatting
 * and field order of the committed manifest survive the copy).
 */
function packManifest(
	source: string,
	packs: Array<Record<string, unknown>> | null,
	isRelease: boolean,
): string {
	if (packs) {
		if (!source.includes("\"packs\": []")) {
			throw new Error(
				"build: manifest no longer carries the empty `packs` stamp — update packManifest",
			);
		}
		return source.replace(
			'"packs": []',
			`"packs": ${JSON.stringify(packs, null, 4).replace(/\n/g, "\n    ")}`,
		);
	}
	if (!source.includes("\"packs\": []")) return source;
	if (isRelease) {
		throw new Error(
			"build: release manifest has no packs and manifest-packs.yaml is missing — clone the content repo",
		);
	}
	console.log("build: no manifest-packs.yaml (no packs clone) — shipping manifest without packs");
	return source;
}

async function build() {
	await bundleTypescript();
	await bundleCss();
	await bundlePacks();
	await copyStaticFiles();
}

async function watchMode() {
	await build();
	console.log(`Watching ${WATCH_PATHS.join(", ")}...`);

	let timeout: ReturnType<typeof setTimeout> | null = null;

	for (const path of WATCH_PATHS) {
		watch(path, { recursive: true }, (_event, filename) => {
			if (filename?.includes("release/")) return;

			if (timeout) clearTimeout(timeout);
			timeout = setTimeout(() => {
				console.log(
					`\n[${new Date().toLocaleTimeString()}] Change detected in ${path}/${filename}`,
				);
				build().catch(() => undefined);
			}, 150);
		});
	}
}

const isWatch = process.argv.includes("--watch");
if (isWatch) {
	await watchMode();
} else {
	await build();
}

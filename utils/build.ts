import { existsSync, watch } from "node:fs";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { bundlePacks, readManifestPacks } from "./compendia";
import { bundleCss } from "./css";
import { bundleTypescript } from "./javascript";
import { resolveSystemSlug, type SystemTarget, systemTarget } from "./systems";

const WATCH_PATHS = [
	"./src",
	"./css",
	"./template",
	"./lang",
	"./system-manifests",
	"./src/packs",
];

/**
 * Which manifest ships as system.json (bead 7nm5 phase 3): dev builds ship
 * system-manifests/dev.json; release builds (Forgejo release-private
 * action) set RELEASE_MANIFEST=1 and ship rogue-trader-release.json — the
 * Foundry-facing manifest carrying version + manifest/download URLs. A
 * PATH value ships that manifest instead (e.g. the public GitHub mirror
 * manifest, bead bpk2).
 *
 * The selector is RT's alone (bead w9sa.4): the sibling system has one
 * manifest and no release variants yet, so its target's `manifest` field is
 * shipped verbatim.
 */
function manifestSourceFor(target: SystemTarget): string {
	if (!target.selectsManifestFromReleaseEnv) return target.manifest;
	const releaseEnv = process.env.RELEASE_MANIFEST;
	if (!releaseEnv) return target.manifest;
	if (releaseEnv === "1") return "./system-manifests/rogue-trader-release.json";
	return releaseEnv;
}

async function copyStaticFiles(target: SystemTarget) {
	const manifestSource = manifestSourceFor(target);
	if (!existsSync(manifestSource)) {
		throw new Error(`build: system manifest missing: ${manifestSource}`);
	}
	const manifestSourceText = await readFile(manifestSource, "utf8");
	// Merge the privately-held packs array into the shipped manifest when a
	// content clone + fragment are present. Only the PRIVATE release manifest
	// demands packs (throw when the fragment is missing so a stale checkout
	// cannot silently publish a packless system); every other manifest — dev
	// builds, the packless public release manifest (bead bpk2) — simply ships
	// without packs, matching the documented empty-src/packs CI contract.
	//
	// A system that ships no packs (the sibling) skips the merge entirely: its
	// manifest is copied verbatim, so a packless package can never be handed a
	// pack list or fail on a missing fragment.
	const requiresPacks =
		target.selectsManifestFromReleaseEnv &&
		manifestSource === "./system-manifests/rogue-trader-release.json";
	const packs = target.bundlePacks ? await readManifestPacks() : null;
	const manifestText = packs
		? packManifest(manifestSourceText, packs, requiresPacks)
		: manifestSourceText;
	await writeFile(`./release/${target.packageDir}/system.json`, manifestText);
	if (!target.copyStaticTree) {
		console.log(
			`[build] ${target.slug}: no lang/ template/ asset/ tree yet — its own i18n, templates and art are later work (epic eg4g), and RT's files must never be copied across`,
		);
		return;
	}
	await cp("./lang", `./release/${target.packageDir}/lang`, {
		recursive: true,
		force: true,
	});
	// template.json ships with the system and is kept TRUTHFUL, but it is NOT
	// the creation gate: the Create Actor dialog reads game.documentTypes,
	// which comes from this manifest's `documentTypes` (bead vnz3). That is why
	// a type can be deliberately absent from template.json's `types` and still
	// be offered — `planet` is (created by planet-creator.ts), and `pc` is
	// excluded from documentTypes for the opposite reason. An earlier version
	// of this comment said the dialog read template.json, which sent a reader
	// hunting for a "missing" type that was never missing.
	await cp("./template.json", `./release/${target.packageDir}/template.json`, {
		force: true,
	});
	// Prune-then-copy: release/rogue_trader/template must mirror ./template exactly so
	// stale legacy templates never ship (release directory cleanup, v9o).
	await rm(`./release/${target.packageDir}/template`, {
		recursive: true,
		force: true,
	});
	await cp("./template", `./release/${target.packageDir}/template`, {
		recursive: true,
		force: true,
	});
	// Only the referenced slice of asset/ ships: the aptitude icon the
	// character-options aptitudes pack points at (systems/rogue-trader/asset/
	// icons/aptitudes/aptitude400.png). The rest of the former tree (DH fork
	// fonts/jpgs, 17 core-icon-replaced condition pngs, the DH logo) was dead
	// and was deleted (bead ty1l) — keep the copy narrow so orphans cannot
	// silently return.
	await cp("./asset/icons/aptitudes", `./release/${target.packageDir}/asset/icons/aptitudes`, {
		recursive: true,
		force: true,
	});
}

/**
 * Inject the packs array into a manifest read as text, preserving the rest of
 * the document verbatim (string splice, not a JSON round-trip, so formatting
 * and field order of the committed manifest survive the copy).
 */
function packManifest(
	source: string,
	packs: Array<Record<string, unknown>> | null,
	requiresPacks: boolean,
): string {
	if (packs) {
		if (!source.includes('"packs": []')) {
			throw new Error(
				"build: manifest no longer carries the empty `packs` stamp — update packManifest",
			);
		}
		return source.replace(
			'"packs": []',
			`"packs": ${JSON.stringify(packs, null, 4).replace(/\n/g, "\n    ")}`,
		);
	}
	if (!source.includes('"packs": []')) return source;
	if (requiresPacks) {
		throw new Error(
			"build: release manifest has no packs and manifest-packs.yaml is missing — clone the content repo",
		);
	}
	console.log(
		"build: no manifest-packs.yaml (no packs clone) — shipping manifest without packs",
	);
	return source;
}

async function build() {
	// Which system this build is for (bead w9sa.4): Rogue Trader unless a target
	// is named explicitly, so the RT release flows are unchanged and a second
	// system's package can only appear because someone asked for it.
	const target = systemTarget(resolveSystemSlug());
	if (target.slug !== "rogue-trader") {
		console.log(
			`[build] target: ${target.slug} -> release/${target.packageDir} (explicitly requested; NOT part of any release unless a workflow names it)`,
		);
	}
	await bundleTypescript(target.slug);
	if (target.bundleStyles) await bundleCss();
	if (target.bundlePacks) await bundlePacks();
	await copyStaticFiles(target);
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

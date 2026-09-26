/**
 * Release-manifest version bumper, driven by changesets (beads 7nm5 phase 3,
 * foundryvtt-rogue-trader-3joz).
 *
 * `bun utils/bump-release-manifest.mjs --system=<slug>` (default
 * `rogue-trader`) derives the bump level from the in-flight changesets in
 * `.changeset/` for the target system — the LARGEST level wins, and there is
 * NO manual bump-level override anywhere. The version source of truth is the
 * release manifest only.
 *
 * Per system (from the SYSTEMS registry in utils/changesets.mjs) it reads
 * system-manifests/<slug>-release.json, bumps its semver version, and writes
 * back the version + the Foundry manifest URLs:
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
 * The rendered release body is written to a FILE (`release-notes.md` at the
 * repo root, gitignored) — never a multiline $GITHUB_OUTPUT value.
 *
 * Zero changesets for the target system -> exit non-zero with a clear
 * message and NO manifest write. A consumed changeset body referencing
 * src/packs is refused loudly (decision 5, defence in depth). Loud failures
 * on malformed manifest/level — never silent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isPackReference, parseChangesets, renderReleaseNotes, selectBump, SYSTEMS } from "./changesets.mjs";

const DEFAULT_SYSTEM = "rogue-trader";
const DEFAULT_CHANGESET_DIR = ".changeset";
const NOTES_FILE = "release-notes.md";
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
export function bumpManifest(manifestPath, level, rawBase = RAW_BASE, artifact = ARTIFACT_NAME) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (typeof manifest.version !== "string") {
		throw new Error(`release manifest has no string version: ${manifestPath}`);
	}
	const version = bumpVersion(manifest.version, level);
	const tag = `v${version}`;
	manifest.version = version;
	manifest.manifest = `${rawBase}/raw/branch/master/${manifestPath}`;
	manifest.download = `${rawBase}/releases/download/${tag}/${artifact}`;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { version, tag, download: manifest.download };
}

/**
 * Derive the bump from changesets and apply it. Returns the workflow outputs
 * (version/tag/download/notes_file/consumed/skipped_count). Throws loudly on
 * no changesets for the system, pack references in consumed bodies, or a
 * malformed manifest.
 */
export function bumpFromChangesets({
	system = DEFAULT_SYSTEM,
	changesetDir = DEFAULT_CHANGESET_DIR,
	notesPath = NOTES_FILE,
	manifestPath,
} = {}) {
	if (!(system in SYSTEMS)) {
		throw new Error(
			`unknown system: "${system}" (known: ${Object.keys(SYSTEMS).join(", ")})`,
		);
	}
	const entry = SYSTEMS[system];
	const changesets = parseChangesets(changesetDir);
	const { level, consumed, skipped } = selectBump(system, changesets);
	for (const path of consumed) {
		const changeset = changesets.find((c) => c.path === path);
		if (isPackReference(changeset.body)) {
			throw new Error(
				`${path}: changeset body references src/packs — it would leak into the public release page; fix the body`,
			);
		}
	}
	const consumedChangesets = consumed.map((path) =>
		changesets.find((c) => c.path === path),
	);
	const result = bumpManifest(
		manifestPath ?? entry.manifest,
		level,
		entry.rawBase,
		entry.artifact,
	);
	const notes = renderReleaseNotes(system, result.version, consumedChangesets);
	if (notes.trim().length === 0) {
		throw new Error("rendered release notes are empty — refusing to release");
	}
	writeFileSync(notesPath, notes);
	return {
		...result,
		notesFile: notesPath,
		consumed,
		skippedCount: skipped.length,
	};
}

function main() {
	const { argv } = process;
	const systemArg = argv.find((arg) => arg.startsWith("--system="));
	const system = systemArg ? systemArg.slice("--system=".length) : DEFAULT_SYSTEM;
	let result;
	try {
		result = bumpFromChangesets({ system });
	} catch (error) {
		console.error(`bump-release-manifest: ${error.message}`);
		process.exit(1);
	}
	console.log(`version=${result.version}`);
	console.log(`tag=${result.tag}`);
	console.log(`download=${result.download}`);
	console.log(`notes_file=${result.notesFile}`);
	console.log(`consumed=${result.consumed.join(" ")}`);
	console.log(`skipped_count=${result.skippedCount}`);
}

if (import.meta.main) {
	main();
}
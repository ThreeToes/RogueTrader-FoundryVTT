/**
 * Changesets core library (bead foundryvtt-rogue-trader-m86c).
 *
 * Pure helpers for the in-repo changeset convention (.changeset/*.md with
 * YAML frontmatter keyed by system slug). No @changesets/cli dependency —
 * the format stays conventional, the machinery is ours:
 *
 * - One file = one system: frontmatter has exactly one `slug: level` key.
 * - The release bump is the LARGEST level present across all changesets for
 *   the target system; ONE version covers all in-flight changesets.
 * - Changesets naming another system are skipped and left in place.
 * - No changesets for the target system -> fail loudly (no release).
 * - A body must never reference src/packs (leaks into the public release
 *   page via verbatim mirroring); isPackReference() is the guard predicate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Registry of systems that may be named in changeset frontmatter. */
export const SYSTEMS = {
	"rogue-trader": {
		title: "Rogue Trader",
		manifest: "system-manifests/rogue-trader-release.json",
		artifact: "rogue-trader.zip",
		rawBase: "https://prancingpony.jumblerumbling.com/stephen/foundryvtt-rogue-trader",
	},
};

/** Semver levels ordered smallest first, so "largest wins" is data. */
export const LEVELS = ["patch", "minor", "major"];

/** Parse one changeset file: --- frontmatter + body. Throws loudly. */
export function parseChangesetFile(path) {
	const raw = readFileSync(path, "utf8");
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!match) {
		throw new Error(`${path}: no --- YAML frontmatter block`);
	}
	const lines = match[1]
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) {
		throw new Error(`${path}: empty frontmatter`);
	}
	const entries = lines.map((line) => {
		const idx = line.indexOf(":");
		if (idx < 0) {
			throw new Error(`${path}: malformed frontmatter line: "${line}"`);
		}
		return { system: line.slice(0, idx).trim().replace(/^"|"$/g, ""), level: line.slice(idx + 1).trim() };
	});
	if (entries.length > 1) {
		throw new Error(
			`${path}: one file = one system, found ${entries.length} frontmatter keys`,
		);
	}
	const { system, level } = entries[0];
	if (!(system in SYSTEMS)) {
		throw new Error(`${path}: unknown system: "${system}"`);
	}
	if (!LEVELS.includes(level)) {
		throw new Error(
			`${path}: invalid level "${level}" (expected one of ${LEVELS.join("|")})`,
		);
	}
	const body = match[2].replace(/^\r?\n/, "");
	if (body.trim().length === 0) {
		throw new Error(`${path}: empty body`);
	}
	return { path, system, level, body };
}

/** Read *.md (ignoring README.md) from a changeset directory. */
export function parseChangesets(dir = ".changeset") {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".md") && name !== "README.md")
		.sort()
		.map((name) => parseChangesetFile(join(dir, name)));
}

/** Select the bump level for a system: largest level wins. Throws if none. */
export function selectBump(system, changesets) {
	const consumed = [];
	const skipped = [];
	let level = null;
	for (const changeset of changesets) {
		if (changeset.system === system) {
			consumed.push(changeset.path);
			if (level === null || LEVELS.indexOf(changeset.level) > LEVELS.indexOf(level)) {
				level = changeset.level;
			}
		} else {
			skipped.push(changeset.path);
		}
	}
	if (consumed.length === 0) {
		throw new Error(
			`no changesets found for system "${system}" — refusing to release`,
		);
	}
	return { level, consumed, skipped };
}

/** Render the release body: header + one bullet group per changeset. */
export function renderReleaseNotes(system, version, changesets) {
	const title = SYSTEMS[system].title;
	const ordered = [...changesets].sort(
		(a, b) =>
			LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) ||
			a.path.localeCompare(b.path),
	);
	const body = ordered
		.map((changeset) => changeset.body.trimEnd())
		.join("\n\n");
	return `## ${title} v${version}\n\n${body}\n`;
}

/** True when text names src/packs or a src/packs/... path. */
export function isPackReference(text) {
	return /src\/packs/.test(String(text));
}
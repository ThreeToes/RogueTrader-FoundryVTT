/**
 * Build-target guards (bead w9sa.4).
 *
 * The repo now builds TWO Foundry systems from one source tree. The public
 * product is still Rogue Trader and nothing else, so these tests pin the
 * properties that keep the sibling accidental:
 *
 *   1. `bun run build` builds Rogue Trader — the default target, with no flag;
 *   2. the sibling is built ONLY when its slug is named explicitly, and an
 *      unknown slug is a loud failure rather than a silent fallback;
 *   3. the sibling's package lives in its own release directory, so building it
 *      can never overwrite or contaminate the RT package;
 *   4. no release workflow selects the sibling: the public release zips
 *      release/rogue_trader only, and its two loud gates (no packs, no private
 *      art) are still in place;
 *   5. outside `utils/systems.ts`, no build or release script names the sibling —
 *      adding it to a release flow has to be a deliberate, reviewable edit.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DH2_SYSTEM_ID } from "../src/ffg/domain/rule-knobs-dark-heresy";
import {
	DEFAULT_SYSTEM_SLUG,
	resolveSystemSlug,
	SYSTEM_TARGETS,
	systemTarget,
} from "./systems";

const RT_TARGET = systemTarget("rogue-trader");
const DH2_TARGET = systemTarget("dark-heresy-2e");

function read(file: string): string {
	return readFileSync(file, "utf8");
}

/** The text of one workflow step, from its heading to the next one. */
function stepBlock(workflow: string, stepName: string): string {
	const start = workflow.indexOf(`- name: ${stepName}`);
	expect(start).toBeGreaterThan(-1);
	const rest = workflow.slice(start + 1);
	const next = rest.search(/\n\s*- name: /);
	return next === -1 ? rest : rest.slice(0, next);
}

describe("the build target table", () => {
	it("has Rogue Trader as the default and only public target", () => {
		expect(DEFAULT_SYSTEM_SLUG).toBe("rogue-trader");
		expect(SYSTEM_TARGETS.filter((target) => target.publicRelease)).toEqual([
			RT_TARGET,
		]);
		expect(DH2_TARGET.publicRelease).toBe(false);
	});

	it("keeps every system's package directory and entry point distinct", () => {
		const dirs = SYSTEM_TARGETS.map((target) => target.packageDir);
		expect(new Set(dirs).size).toBe(dirs.length);
		const entries = SYSTEM_TARGETS.map((target) => target.entrypoint);
		expect(new Set(entries).size).toBe(entries.length);
		// The sibling's package can never overwrite RT's.
		expect(DH2_TARGET.packageDir).not.toBe(RT_TARGET.packageDir);
		for (const target of SYSTEM_TARGETS) {
			expect(existsSync(target.entrypoint)).toBe(true);
			expect(existsSync(target.manifest)).toBe(true);
		}
	});

	it("declares each system's id from the system's own data", () => {
		expect(RT_TARGET.systemId).toBe("rogue-trader");
		expect(DH2_TARGET.systemId).toBe(DH2_SYSTEM_ID);
	});

	it("ships RT's static tree, packs and stylesheet only for RT", () => {
		// The sibling must never be handed RT's lang files, templates, art or
		// packs: those are RT's content, and copying them across is a fork.
		for (const flag of [
			"copyStaticTree",
			"bundleStyles",
			"bundlePacks",
			"selectsManifestFromReleaseEnv",
		] as const) {
			expect(RT_TARGET[flag]).toBe(true);
			expect(DH2_TARGET[flag]).toBe(false);
		}
	});
});

describe("target selection is explicit", () => {
	it("defaults to Rogue Trader with no flag and no env", () => {
		expect(resolveSystemSlug([], {})).toBe("rogue-trader");
		// A build harness that passes unrelated flags (--watch) still builds RT.
		expect(resolveSystemSlug(["--watch"], {})).toBe("rogue-trader");
	});

	it("accepts the sibling by flag or by env", () => {
		expect(resolveSystemSlug(["--system", "dark-heresy-2e"], {})).toBe(
			"dark-heresy-2e",
		);
		expect(resolveSystemSlug(["--system=dark-heresy-2e"], {})).toBe(
			"dark-heresy-2e",
		);
		expect(resolveSystemSlug([], { SYSTEM: "dark-heresy-2e" })).toBe(
			"dark-heresy-2e",
		);
	});

	it("fails loudly on an unknown slug instead of falling back", () => {
		expect(() => resolveSystemSlug(["--system", "deathwatch"], {})).toThrow(
			/unknown build system "deathwatch"/,
		);
		expect(() => resolveSystemSlug(["--system"], {})).toThrow(/needs a slug/);
		expect(() => resolveSystemSlug([], { SYSTEM: "nope" })).toThrow(
			/unknown build system "nope"/,
		);
	});
});

describe("the dark-heresy-2e manifest", () => {
	const manifest = JSON.parse(read(DH2_TARGET.manifest)) as Record<
		string,
		unknown
	>;

	it("is the sibling system, and not Rogue Trader", () => {
		expect(manifest.id).toBe(DH2_TARGET.systemId);
		expect(manifest.id).toBe("dark-heresy-2e");
		expect(manifest.id).not.toBe("rogue-trader");
		expect(manifest.title).toBe("Dark Heresy 2nd Edition");
	});

	it("loads the sibling's own entry point", () => {
		// The bundle is built from src/dark_heresy_2e/entry-point.ts, so the
		// manifest must name it and nothing else.
		expect(manifest.esmodules).toEqual(["./entry-point.js"]);
		expect(read(DH2_TARGET.entrypoint)).toContain("darkHeresyInit()");
	});

	it("declares no packs, languages, styles or RT document types", () => {
		// Every one of those is later DH2 work; an empty declaration is honest,
		// and inheriting RT's would put RT's types in a DH2 world.
		expect(manifest.packs).toEqual([]);
		expect(manifest.languages).toBeUndefined();
		expect(manifest.styles).toBeUndefined();
		expect(manifest.documentTypes).toBeUndefined();
	});

	it("keeps the shipped RT manifests Rogue Trader's", () => {
		for (const manifest of [
			"system-manifests/dev.json",
			"system-manifests/rogue-trader-release.json",
			"system-manifests/rogue-trader-public.json",
		]) {
			expect((JSON.parse(read(manifest)) as { id: string }).id).toBe(
				"rogue-trader",
			);
		}
	});
});

describe("the public release stays RT-only", () => {
	const publicWorkflow = read(".forgejo/workflows/release-public.yaml");
	const privateWorkflow = read(".forgejo/workflows/release-private.yaml");

	it("selects no system in the public build", () => {
		// `bun run build` there == the default target == Rogue Trader.
		expect(publicWorkflow).toContain("run: bun run build");
		expect(publicWorkflow).not.toMatch(/--system/);
		expect(publicWorkflow).not.toMatch(/SYSTEM:/);
		expect(publicWorkflow).not.toMatch(/dark[-_]heresy/);
	});

	it("zips only the RT package", () => {
		expect(publicWorkflow).toContain(
			"cd release && zip -r ../rogue-trader.zip rogue_trader",
		);
		expect(publicWorkflow).not.toContain("dark_heresy_2e");
		expect(publicWorkflow).not.toContain("dark-heresy-2e");
	});

	it("still carries its loud no-packs and no-private-art gates", () => {
		// bead bpk2 + v2cn: the shipped zip must contain neither compendium
		// packs nor mirrored private art.
		expect(publicWorkflow).toContain(
			"::error::rogue-trader.zip contains compendium packs",
		);
		expect(publicWorkflow).toContain(
			"::error::rogue-trader.zip contains private pack assets",
		);
	});

	it("leaves the private release building Rogue Trader", () => {
		// The private flow does carry a `system` dispatch input (it feeds the
		// version bumper, whose SYSTEMS registry is RT's), but its BUILD step
		// must stay the default target: `bun run build` with RELEASE_MANIFEST=1
		// and no system selection, so the sibling can never reach the private
		// zip either.
		expect(privateWorkflow).toContain("default: rogue-trader");
		const build = stepBlock(
			privateWorkflow,
			"Build (with compendia, release manifest)",
		);
		expect(build).toContain("run: bun run build");
		expect(build).not.toMatch(/--system/);
		expect(build).not.toMatch(/SYSTEM:/);
		expect(privateWorkflow).not.toMatch(/dark[-_]heresy/);
	});
});

describe("no build or release script names the sibling by accident", () => {
	it("only utils/systems.ts (and this guard) do", () => {
		// Tests are excluded on purpose: the changesets machinery is tested with
		// a foreign system slug, and this guard is about SCRIPTS and WORKFLOWS.
		const allowed = new Set([
			path.normalize("utils/systems.ts"),
			path.normalize("utils/system-build-targets.test.ts"),
		]);
		const hits: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = path.join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (/\.(ts|mjs|yaml)$/.test(full) && !/\.test\.ts$/.test(full)) {
					if (/dark[-_]heresy/.test(read(full))) {
						hits.push(path.normalize(full));
					}
				}
			}
		};
		walk("utils");
		walk(".forgejo");
		expect(hits.filter((file) => !allowed.has(file))).toEqual([]);
	});
});

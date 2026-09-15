/**
 * Shipped-manifest guards (bead v7wo).
 *
 * The repo root used to carry a `system.json` that nothing read: the build
 * copies system-manifests/<variant>.json to release/rogue_trader/system.json
 * (utils/build.ts), and docs/AGENT-GUIDE.md records that `release/` is the
 * directory symlinked into the test world. The root file was not merely stale,
 * it was a FORK ARTEFACT — the upstream Dark Heresy 2E manifest with this
 * system's id/title pasted over a stale header:
 *   version   4.4.0.1
 *   manifest  github.com/Vendare/DarkHeresy2E-FoundryVTT/releases/.../system.json
 *   download  the same, i.e. the system would have tried to UPDATE ITSELF from
 *             another system's GitHub releases
 *   authors   JeansenVaars / Moo Man / Perfectro (the DH2E team, not ours)
 *   esmodules ["release/script/rogue-trader.js"] — a path that does not exist
 *   packs     a 25-entry fork-era list, where the committed manifests carry the
 *             documented `"packs": []` stamp and the build injects the real list
 * Deleting it removes a live hazard, not just clutter: anything that ever read
 * the root file (a dev install pointed at the repo, a CLI, a human) would have
 * seen the wrong version and a foreign update URL.
 *
 * These guards keep it deleted and keep the shipped manifests ours.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const MANIFESTS = [
	"system-manifests/dev.json",
	"system-manifests/rogue-trader-release.json",
	"system-manifests/rogue-trader-public.json",
];

const read = (path: string): Record<string, unknown> =>
	JSON.parse(readFileSync(path, "utf8"));

describe("repo manifest layout (bead v7wo)", () => {
	it("the repo root carries no system.json", () => {
		// The single source of truth is system-manifests/; the build publishes
		// release/rogue_trader/system.json. A root file can only be a stale
		// copy (that is exactly how the fork artefact survived), so its absence
		// is the invariant.
		expect(existsSync("system.json")).toBe(false);
	});

	it("the build ships from system-manifests and does not read the root", () => {
		const build = readFileSync("utils/build.ts", "utf8");
		expect(build).toContain("./system-manifests/dev.json");
		expect(build).toContain("./release/rogue_trader/system.json");
		// No reference to a root-level ./system.json as an INPUT.
		expect(/readFile\(\s*["']\.\/system\.json["']/.test(build)).toBe(false);
		expect(/existsSync\(\s*["']\.\/system\.json["']/.test(build)).toBe(false);
	});

	for (const manifest of MANIFESTS) {
		describe(manifest, () => {
			it("is this system, not the upstream fork it came from", () => {
				const data = read(manifest);
				expect(data.id).toBe("rogue-trader");
				expect(data.title).toBe("Rogue Trader");
				// The DH2E fork's identity must not reappear anywhere.
				const text = JSON.stringify(data);
				expect(text).not.toContain("DarkHeresy2E");
				expect(text).not.toContain("JeansenVaars");
				expect(text).not.toContain("cubicle7games.com");
				expect(data.version).not.toBe("4.4.0.1");
			});

			it("points its entry point at the real bundle, not the fork's path", () => {
				const data = read(manifest) as { esmodules?: unknown };
				expect(data.esmodules).toEqual(["./entry-point.js"]);
			});

			it("declares a semantic x.y.z version", () => {
				const data = read(manifest) as { version?: string };
				expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
			});

			it("carries the documented packs stamp (the build injects the list)", () => {
				const data = read(manifest) as { packs?: unknown };
				// Committed manifests ship "packs": [] — utils/build.ts merges the
				// privately-held fragment in. A non-empty list here means a stale
				// fork-era pack list was committed.
				expect(data.packs).toEqual([]);
			});
		});
	}
});

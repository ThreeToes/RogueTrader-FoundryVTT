/**
 * Which Foundry systems this repo can emit (bead w9sa.4).
 *
 * One entry per system, and this table is the ONLY place a system's package
 * directory, entry point and manifest are named. `bun run build` builds the
 * DEFAULT target — Rogue Trader — and nothing else, so the three RT release
 * flows (dev, the Forgejo private release, the public GitHub mirror) keep
 * producing byte-identical output; a second system is built ONLY when it is
 * named explicitly:
 *
 *   bun utils/build.ts --system dark-heresy-2e     # or SYSTEM=dark-heresy-2e bun run build
 *
 * WHY A TARGET TABLE AND NOT A COPIED TREE (epic hr6r, "reuse as much of this
 * code as possible instead of forking"): the second system resolves against
 * the SHARED src/ — src/ffg/** (the system-neutral kernel, ports, funnel and
 * roll pipeline) and src/rules-engine/** — and its own module holds only what
 * differs (the DH2 profile, the DH2 knob registry, the DH2 branding). There is
 * no src/dark_heresy_2e copy of src/roguetrader and no duplicated
 * src/rules-engine; `src/dark_heresy_2e/bootstrap/index.test.ts` walks the DH2
 * import graph and fails if it ever reaches src/roguetrader.
 *
 * FOLDER vs ID: Foundry reads the system's identity from the manifest's `id`
 * (BasePackage's schema declares `id` required, and RT has always shipped
 * release/rogue_trader with id "rogue-trader"), so `packageDir` is the package
 * folder name and `systemId` is the manifest id. They differ by the same
 * hyphen/underscore convention RT uses — there is no second system id.
 */

import { RT_SYSTEM_ID } from "../src/ffg/domain/rule-knobs";
import { DH2_SYSTEM_ID } from "../src/ffg/domain/rule-knobs-dark-heresy";
/** One buildable system. */
export interface SystemTarget {
	/** The build slug: the `--system` / `SYSTEM` value and the target's key. */
	readonly slug: string;
	/** The Foundry system id — the manifest's `id`, so game.system.id. */
	readonly systemId: string;
	/** The package directory under release/ (a zip's top-level folder). */
	readonly packageDir: string;
	/** The source module bundled into <packageDir>/entry-point.js. */
	readonly entrypoint: string;
	/** The manifest shipped as <packageDir>/system.json. */
	readonly manifest: string;
	/**
	 * RT's manifest is chosen by the RELEASE_MANIFEST env (dev / private
	 * release / public mirror, bead 7nm5 phase 3). A sibling system has ONE
	 * manifest and no release variants yet, so the selector is RT's alone.
	 */
	readonly selectsManifestFromReleaseEnv: boolean;
	/** Bundles css/ into <packageDir>/css/rogue-trader.css. */
	readonly bundleStyles: boolean;
	/** Copies lang/, template/, template.json and asset/ into the package. */
	readonly copyStaticTree: boolean;
	/** Runs the compendium packer (RT's packs live in src/packs/rogue_trader). */
	readonly bundlePacks: boolean;
	/**
	 * The system the public GitHub release ships. Exactly one, forever: the
	 * public mirror is the Rogue Trader product, and release-public.yaml
	 * builds the DEFAULT target, so a second system can only reach a release
	 * by someone editing that workflow (guarded by
	 * utils/system-build-targets.test.ts).
	 */
	readonly publicRelease: boolean;
}

/** Every buildable system. RT first: it is the default. */
export const SYSTEM_TARGETS: readonly SystemTarget[] = [
	{
		slug: "rogue-trader",
		systemId: RT_SYSTEM_ID,
		packageDir: "rogue_trader",
		entrypoint: "./src/roguetrader/entry-point.ts",
		manifest: "./system-manifests/dev.json",
		selectsManifestFromReleaseEnv: true,
		bundleStyles: true,
		copyStaticTree: true,
		bundlePacks: true,
		publicRelease: true,
	},
	{
		// The sibling system: its own entry point against the SHARED src/. No
		// stylesheet, no lang files, no templates, no packs yet — each of those
		// is a deliverable of the DH2 content/presentation work (epic eg4g), and
		// none of them may be RT's files copied across. The build says so on
		// stdout rather than shipping an empty or borrowed tree.
		slug: "dark-heresy-2e",
		systemId: DH2_SYSTEM_ID,
		packageDir: "dark_heresy_2e",
		entrypoint: "./src/dark_heresy_2e/entry-point.ts",
		manifest: "./system-manifests/dark-heresy-2e.json",
		selectsManifestFromReleaseEnv: false,
		bundleStyles: false,
		copyStaticTree: false,
		bundlePacks: false,
		publicRelease: false,
	},
];

/** Which system a bare `bun run build` builds: Rogue Trader, and nothing else. */
export const DEFAULT_SYSTEM_SLUG = "rogue-trader";

/** The target table by slug. Throws loudly on an unknown slug. */
export function systemTarget(slug: string): SystemTarget {
	const target = SYSTEM_TARGETS.find((entry) => entry.slug === slug);
	if (!target) {
		throw new Error(
			`unknown build system "${slug}" — known: ${SYSTEM_TARGETS.map((entry) => entry.slug).join(", ")}`,
		);
	}
	return target;
}

/**
 * Which system this build is for: `--system <slug>` / `--system=<slug>` on the
 * command line, else the `SYSTEM` env var, else the DEFAULT (Rogue Trader).
 *
 * Unknown flags are ignored (`--watch` must survive) but an unknown SLUG is a
 * loud failure: silently building the default when someone asked for the
 * sibling is how a package ends up missing from a release.
 */
export function resolveSystemSlug(
	argv: readonly string[] = process.argv.slice(2),
	env: Readonly<Record<string, string | undefined>> = process.env,
): string {
	const fromEnv = env.SYSTEM?.trim();
	if (fromEnv) {
		systemTarget(fromEnv); // loud on a typo
		return fromEnv;
	}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--system") {
			const next = argv[i + 1];
			if (!next) {
				throw new Error("--system needs a slug, e.g. --system dark-heresy-2e");
			}
			systemTarget(next);
			return next;
		}
		if (arg.startsWith("--system=")) {
			const slug = arg.slice("--system=".length);
			systemTarget(slug);
			return slug;
		}
	}
	return DEFAULT_SYSTEM_SLUG;
}

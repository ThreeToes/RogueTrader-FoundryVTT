import { DEFAULT_SYSTEM_SLUG, systemTarget } from "./systems";

/**
 * Bundle a system's entry point into <packageDir>/entry-point.js.
 *
 * One bundle per system, from ONE source tree: RT's entry point reaches
 * src/roguetrader/** and the shared src/ffg + src/rules-engine, and the
 * sibling's reaches only the shared layer plus its own module (bead w9sa.4,
 * epic hr6r). The slug defaults to Rogue Trader so every existing invocation
 * (`bun run build:js`, the build driver) produces the same bytes as before.
 */
export async function bundleTypescript(slug: string = DEFAULT_SYSTEM_SLUG) {
	const target = systemTarget(slug);
	const result = await Bun.build({
		entrypoints: [target.entrypoint],
		outdir: `./release/${target.packageDir}`,
		target: "browser",
	});

	if (!result.success) {
		console.error(`JavaScript build failed for ${target.slug}.`);

		for (const log of result.logs) {
			console.error(log);
		}

		throw new Error("JavaScript build failed");
	}
}

if (import.meta.main) {
	await bundleTypescript();
}

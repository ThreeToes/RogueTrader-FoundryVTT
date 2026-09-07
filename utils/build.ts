import { watch } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { bundlePacks } from "./compendia";
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
	await cp("./system-manifests/dev.json", "./release/rogue_trader/system.json", {
		force: true,
	});
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

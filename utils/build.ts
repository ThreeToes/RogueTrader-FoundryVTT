import { bundleTypescript } from "./javascript";
import { bundleCss } from "./css";
import { bundlePacks } from "./compendia";
import { cp } from "node:fs/promises";
import { watch } from "node:fs";

const WATCH_PATHS = [
	"./src",
	"./less",
	"./template",
	"./lang",
	"./system-manifests",
	"./src/packs",
];

async function copyStaticFiles() {
	await cp("./system-manifests/dev.json", "./release/system.json", {
		force: true,
	});
	await cp("./lang", "./release/lang", { recursive: true, force: true });
	await cp("./template", "./release/template", {
		recursive: true,
		force: true,
	});
	await cp("./asset", "./release/asset", { recursive: true, force: true });
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
				build().catch(() => {});
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

import { bundleTypescript } from "./javascript";
import { bundleCss } from "./css";
import { bundlePacks } from "./compendia";
import { cp } from "node:fs/promises";

async function copyStaticFiles() {
	await cp("./system-manifests/dev.json", "./release/system.json", {
		force: true,
	});
	await cp("./lang", "./release/lang", { recursive: true, force: true });
	await cp("./template", "./release/template", {
		recursive: true,
		force: true,
	});
}

async function build() {
	await bundleTypescript();
	await bundleCss();
	await bundlePacks();
	await copyStaticFiles();
}

await build();

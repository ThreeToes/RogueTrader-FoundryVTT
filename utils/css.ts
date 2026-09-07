import { readFile } from "node:fs/promises";

/**
 * Bundle the CSS sources into a single stylesheet (bead 5jv): the sources
 * were always plain CSS (the Less compile was a passthrough), so the build
 * is now a plain concatenation — no Less dependency, no compile step.
 */
const SOURCES = [
	"css/sheet-gear.css",
	"css/sheet-character.css",
	"css/chat-roll.css",
];
const DEST = "./release/rogue_trader/css/rogue-trader.css";

const parts: string[] = [];
for (const src of SOURCES) {
	const text = await readFile(src, "utf8");
	parts.push(`/* ${src} */\n${text}`);
}

await Bun.write(DEST, parts.join("\n"));
console.log(`[css] bundled ${SOURCES.length} sources -> ${DEST}`);

export async function bundleCss() {
	const parts: string[] = [];
	for (const src of SOURCES) {
		parts.push(`/* ${src} */\n${await readFile(src, "utf8")}`);
	}
	await Bun.write(DEST, parts.join("\n"));
}
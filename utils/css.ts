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
	// Bead wxut.4: the rules app window (separate file from the sheets because
	// it is a dialog, not a sheet; last in the bundle so its .rules-app-scoped
	// rules win over any shared chip/row anatomy they override.
	"css/rules-app.css",
];
const DEST = "./release/rogue_trader/css/rogue-trader.css";

export async function bundleCss() {
	const parts: string[] = [];
	for (const src of SOURCES) {
		parts.push(`/* ${src} */\n${await readFile(src, "utf8")}`);
	}

	await Bun.write(DEST, parts.join("\n"));
	console.log(`[css] bundled ${SOURCES.length} sources -> ${DEST}`);
}

if (import.meta.main) {
	await bundleCss();
}

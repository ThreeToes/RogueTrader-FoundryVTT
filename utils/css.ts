import { readFile } from "node:fs/promises";

/**
 * Bundle the CSS sources into a single stylesheet (bead 5jv): the sources
 * were always plain CSS (the Less compile was a passthrough), so the build
 * is now a plain concatenation — no Less dependency, no compile step.
 */
const SOURCES = [
	// Bead cmio.6: the shared system-neutral component layer comes FIRST —
	// "components before skins" — so every skin file's per-site modifiers keep
	// winning over the moved chip base / rules-app component rules exactly as
	// they did when those rules sat at the head of their own files.
	"css/40k-components.css",
	/* Shared sheet base: design tokens + the rules every sheet draws on
	   (headers, rows, armour body, meter/pip anatomy...). bead ophm split
	   the starship, NPC and career surfaces out into their own files —
	   they ride here, after the shared base (their original in-file
	   position), so the surface rules keep landing before sheet-character
	   and the chat layers. */
	"css/sheet-gear.css",
	// Bead ophm: the per-surface rules moved out of sheet-gear.css, bundled
	// right after it in their original relative order (career tables, then
	// the starship hull/refit/combat surfaces, then the NPC sheet).
	"css/sheet-career.css",
	"css/sheet-starship.css",
	"css/sheet-npc.css",
	"css/sheet-character.css",
	"css/chat-roll.css",
	// Bead 3j3b: the rest of the chat surface (critical / damage / initiative
	// / psychic / ship cards) — same token vocabulary as the roll cards,
	// loaded after them so any per-card refinement keeps winning.
	"css/chat-card.css",
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

import { readFile, mkdir } from "node:fs/promises";
import less from "less";

const LESS_DEST = "./release/css";
const LESS_SRC = "less/rogue-trader.less";

/**
 * Compile the LESS sources into a single CSS file.
 */
export async function compile() {
	const source = await Bun.file(LESS_SRC).text();

	const result = less.render(source, {
		filename: LESS_SRC,
		relativeUrls: true,
	});

	await Bun.Write(LESS_DEST, result.css);
}

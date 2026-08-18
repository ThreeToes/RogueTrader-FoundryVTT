async function bundleJavascript() {
	const result = await Bun.build({
		entrypoints: ["./script/rogue-trade.js"],
		outdir: "./release/script",
		target: "browser",
	});

	if (!result.success) {
		console.error("JavaScript build failed.");

		for (const log of result.logs) {
			console.error(log);
		}

		throw new Error("JavaScript build failed");
	}
}
export const bundle = bundleJavascript;

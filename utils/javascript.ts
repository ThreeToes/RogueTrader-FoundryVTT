export async function bundleTypescript() {
	const result = await Bun.build({
		entrypoints: ["./src/roguetrader/entry-point.ts"],
		outdir: "./release",
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

await bundleTypescript();

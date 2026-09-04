import { describe, expect, test } from "bun:test";
import { layoutLines, stitchColumns } from "../utils/extract-tables";

describe("stitchColumns", () => {
	test("joins aligned lines with ' | '", () => {
		// Two columns, two lines each.
		const rows = stitchColumns([
			["Carapace", "12/10/8/6"],
			["Flak", "8"],
		]);
		expect(rows).toBe("Carapace | Flak\n12/10/8/6 | 8\n");
	});

	test("pads short columns", () => {
		// Left column wrapped into two lines; right column only has one.
		const rows = stitchColumns([
			["Lasgun", "Common"],
			["w/ telescope", ""],
		]);
		expect(rows).toBe("Lasgun | w/ telescope\nCommon\n");
	});

	test("trims cells", () => {
		expect(stitchColumns([["  name  "]])).toBe("name\n");
	});

	test("empty input yields empty output", () => {
		expect(stitchColumns([])).toBe("\n");
	});
});

describe("layoutLines", () => {
	test("drops blank lines and trims", () => {
		expect(layoutLines("  a  \n\nb\n")).toEqual(["a", "b"]);
	});
});

import "../../../test-helpers/foundry-schema-stub";
import { describe, expect, test } from "bun:test";
import { Dynasty } from "./dynasty";

/**
 * Ship & Warrant Path record (bead 5pnl): the Dynasty model carries the picks
 * plus the path's derived totals, with blank-safe defaults so existing
 * dynasty actors need no migration.
 */
describe("Dynasty schema: warrant record (bead 5pnl)", () => {
	const schema = Dynasty.defineSchema() as unknown as Record<string, any>;

	test("the warrant record is a schema field with picks + totals", () => {
		const warrant = schema.warrant;
		expect(warrant).toBeDefined();
		expect(warrant.constructor.name).toBe("StubSchemaField");
		expect(warrant.fields.picks).toBeDefined();
		expect(warrant.fields.shipPoints).toBeDefined();
		expect(warrant.fields.profitFactor).toBeDefined();
	});

	test("derived totals default to 0 (blank warrant)", () => {
		const warrant = schema.warrant.fields;
		expect(warrant.shipPoints.opts.initial).toBe(0);
		expect(warrant.profitFactor.opts.initial).toBe(0);
		expect(warrant.shipPoints.opts.integer).toBe(true);
	});

	test("picks default to an empty typed-object map", () => {
		const picks = schema.warrant.fields.picks;
		expect(picks).toBeDefined();
		// TypedObjectField initial is a factory returning a fresh {} per doc.
		const initial = picks.opts.initial as () => Record<string, string>;
		expect(initial()).toEqual({});
	});

	test("the existing applied totals are unchanged", () => {
		expect(schema.profitFactor.opts.initial).toBe(40);
		expect(schema.shipPoints.fields.total.opts.initial).toBe(50);
		expect(schema.shipPoints.fields.spent.opts.initial).toBe(0);
	});
});

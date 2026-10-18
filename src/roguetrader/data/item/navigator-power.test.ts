import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { NavigatorPower } = await import("./navigator-power");

describe("NavigatorPower data model", () => {
	const schema = NavigatorPower.defineSchema() as unknown as Record<
		string,
		StubField
	>;

	test("characteristic default is a member of characteristicChoices", () => {
		const characteristic = schema.characteristic as StubField;
		const choices = NavigatorPower.characteristicChoices;
		expect(Object.keys(choices)).toContain(characteristic.opts.initial);
	});
});
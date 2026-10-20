import { describe, expect, test } from "bun:test";
import { StubField } from "../../../test-helpers/foundry-schema-stub";

await import("../../../test-helpers/foundry-schema-stub");

const { NavigatorPower } = await import("./navigator-power");

/** Grab a usable instance from the stub base (schema-stub TypeDataModel). */
const powerWithMastery = (mastery: string) => {
	const instance = new NavigatorPower(
		undefined as never,
		undefined as never,
	) as unknown as { mastery: string; masteryBonusValue: number };
	instance.mastery = mastery;
	return instance;
};

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

describe("masteryBonusValue (bead 6l68: loud on unknown mastery)", () => {
	let originalWarn: typeof console.warn;
	const warns: string[] = [];

	const captureWarns = (run: () => void) => {
		warns.length = 0;
		originalWarn = console.warn;
		console.warn = (...args: unknown[]) => {
			warns.push(args.join(" "));
		};
		try {
			run();
		} finally {
			console.warn = originalWarn;
		}
	};

	test("the book bonuses survive (+0/+10/+20, book p178)", () => {
		expect(powerWithMastery("novice").masteryBonusValue).toBe(0);
		expect(powerWithMastery("adept").masteryBonusValue).toBe(10);
		expect(powerWithMastery("master").masteryBonusValue).toBe(20);
	});

	test("case/whitespace-insensitive lookup (availability.ts shape)", () => {
		captureWarns(() => {
			expect(powerWithMastery("Adept").masteryBonusValue).toBe(10);
			expect(powerWithMastery(" master ").masteryBonusValue).toBe(20);
		});
		expect(warns).toHaveLength(0);
	});

	test("a typo'd mastery warns loudly and still reads +0", () => {
		captureWarns(() => {
			expect(powerWithMastery("adekt").masteryBonusValue).toBe(0);
		});
		expect(warns).toHaveLength(1);
		expect(warns[0]).toContain('unknown navigator mastery "adekt"');
	});
});
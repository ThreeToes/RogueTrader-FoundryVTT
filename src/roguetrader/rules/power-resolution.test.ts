import { registerPowerResolution, resolvePower } from "./power-resolution";

describe("power-resolution registry (bead sa6)", () => {
	test("built-in subtypes resolve", () => {
		expect(resolvePower("focus")).toEqual({ damage: false, sustained: false });
		expect(resolvePower("bolt")).toEqual({ damage: true, sustained: false });
		expect(resolvePower("zone")).toEqual({ damage: true, sustained: false });
	});

	test("unknown subtypes fall back to prose (display-only, never crash)", () => {
		expect(resolvePower("weird-custom")).toEqual({
			damage: false,
			sustained: false,
		});
		expect(resolvePower(undefined)).toEqual({ damage: false, sustained: false });
	});

	test("modules can register their own subtype entries", () => {
		registerPowerResolution("custom-drain", () => ({
			damage: false,
			sustained: true,
		}));
		expect(resolvePower("custom-drain")).toEqual({
			damage: false,
			sustained: true,
		});
	});
});
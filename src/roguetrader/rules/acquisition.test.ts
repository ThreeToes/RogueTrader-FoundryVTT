import { describe, expect, it } from "bun:test";
import {
	acquisitionTarget,
	availabilityModifier,
	isTrainedFor,
	resolveAcquisition,
	startingProfitFactorAndShipPoints,
	weaponTrainingCoverage,
} from "./acquisition";

describe("Table 1-5 starting PF/SP (p33)", () => {
	it("maps the 1d10 ladder", () => {
		expect(startingProfitFactorAndShipPoints(1)).toEqual({ profitFactor: 60, shipPoints: 30 });
		expect(startingProfitFactorAndShipPoints(2)).toEqual({ profitFactor: 50, shipPoints: 40 });
		expect(startingProfitFactorAndShipPoints(3)).toEqual({ profitFactor: 50, shipPoints: 40 });
		expect(startingProfitFactorAndShipPoints(4)).toEqual({ profitFactor: 40, shipPoints: 50 });
		expect(startingProfitFactorAndShipPoints(7)).toEqual({ profitFactor: 40, shipPoints: 50 });
		expect(startingProfitFactorAndShipPoints(8)).toEqual({ profitFactor: 30, shipPoints: 60 });
		expect(startingProfitFactorAndShipPoints(9)).toEqual({ profitFactor: 30, shipPoints: 60 });
		expect(startingProfitFactorAndShipPoints(10)).toEqual({ profitFactor: 20, shipPoints: 70 });
	});
});

describe("acquisition target (Core Rulebook p272-273)", () => {
	it("sums modifiers into the target", () => {
		const result = acquisitionTarget({
			profitFactor: 40,
			availabilityModifier: 30,
			scaleModifier: 30,
		});
		expect(result.target).toBe(100);
		expect(result.automatic).toBe("success");
	});

	it("auto-fails at 0 or less", () => {
		expect(
			acquisitionTarget({ profitFactor: 30, availabilityModifier: -30 }).automatic,
		).toBe("failure");
	});

	it("resolves rolls inside the band", () => {
		expect(resolveAcquisition({ profitFactor: 40 }, 41).success).toBe(false);
		expect(resolveAcquisition({ profitFactor: 40 }, 40).success).toBe(true);
		expect(resolveAcquisition({ profitFactor: 60, extra: 40 }, 1).success).toBe(true);
		expect(resolveAcquisition({ profitFactor: 20 }, 100).success).toBe(false);
	});
});

describe("availability modifiers (Table 9-35)", () => {
	it("maps the pack availability strings", () => {
		expect(availabilityModifier("plentiful")).toBe(30);
		expect(availabilityModifier("scarce")).toBe(0);
		expect(availabilityModifier("very-rare")).toBe(-20);
		expect(availabilityModifier("near-unique")).toBe(-50);
	});

	it("returns null for unknown strings", () => {
		expect(availabilityModifier("made-up")).toBeNull();
	});
});

describe("weaponTrainingCoverage (book printed pp272, 95, 100, 104-105)", () => {
	it("(Universal) covers the book-defined membership of its category", () => {
		const cov = weaponTrainingCoverage(["Basic Weapon Training (Universal)"]);
		// "The Universal group includes the Bolt, Las, Launcher, Melta, Plasma,
		// and SP groups" — note: Basic (Melta) alone is NOT a purchasable group.
		expect([...cov.byCategory.basic].sort()).toEqual([
			"bolt",
			"las",
			"launcher",
			"melta",
			"plasma",
			"sp",
		]);
		expect(cov.byCategory.melee).toBeUndefined();
	});

	it("Melee (Universal) includes Chain, Shock, and Power (p104)", () => {
		const cov = weaponTrainingCoverage(["Melee Weapon Training (Universal)"]);
		expect([...cov.byCategory.melee].sort()).toEqual(["chain", "power", "shock"]);
	});

	it("Heavy has no Universal group (p100)", () => {
		const cov = weaponTrainingCoverage(["Heavy Weapon Training (Bolt)"]);
		expect([...cov.byCategory.heavy]).toEqual(["bolt"]);
		const universal = weaponTrainingCoverage([
			"Heavy Weapon Training (Universal)",
		]);
		// Universal is not a sold Heavy group; only the explicit groups apply.
		expect([...universal.byCategory.heavy].sort()).toEqual([
			"bolt",
			"flame",
			"las",
			"launcher",
			"melta",
			"plasma",
			"primitive",
			"sp",
		]);
	});

	it("explicit groups come through without Universal (p95/p105)", () => {
		const cov = weaponTrainingCoverage(["Basic Weapon Training (Primitive)"]);
		expect([...cov.byCategory.basic]).toEqual(["primitive"]);
		const pistol = weaponTrainingCoverage(["Pistol Weapon Training (Las)"]);
		// Pistol explicit groups are Primitive only; Las is a Universal-group
		// family, so a specific Pistol (Las) talent is not a book talent — the
		// category regex still picks it up and covers las within pistol.
		expect([...pistol.byCategory.pistol]).toEqual(["las"]);
	});

	it("ignores non-training talents and blank lists", () => {
		expect(weaponTrainingCoverage(["Rapid Reload", "Frenzy"]).classes).toEqual(
			new Set(),
		);
		expect(weaponTrainingCoverage([]).classes).toEqual(new Set());
	});
});

describe("isTrainedFor (book printed p272 bullet 2 + p95)", () => {
	const cov = weaponTrainingCoverage([
		"Basic Weapon Training (Universal)",
		"Melee Weapon Training (Primitive)",
	]);

	it("covers family-matched weapons within their category", () => {
		expect(
			isTrainedFor(cov, { class: "basic", weaponFamily: "las", name: "Lasgun" }),
		).toBe(true);
		expect(
			isTrainedFor(cov, { class: "melee", weaponFamily: "primitive", name: "Sword" }),
		).toBe(true);
	});

	it("does not cross categories (Basic (Las) cannot take a Bow)", () => {
		expect(
			isTrainedFor(cov, { class: "basic", weaponFamily: "primitive", name: "Bow" }),
		).toBe(false);
		// ...and Melee (Primitive) cannot take a Chainsword.
		expect(
			isTrainedFor(cov, { class: "melee", weaponFamily: "chain", name: "Chainsword" }),
		).toBe(false);
	});

	it("thrown weapons: Thrown training OR melee family coverage", () => {
		const thrown = weaponTrainingCoverage(["Thrown Weapon Training (Universal)"]);
		expect(
			isTrainedFor(thrown, { class: "thrown", weaponFamily: "thrown", name: "Frag" }),
		).toBe(true);
		// A thrown primitive knife is also a melee primitive weapon.
		expect(
			isTrainedFor(cov, { class: "thrown", weaponFamily: "primitive", name: "Knife" }),
		).toBe(true);
		// But a thrown exotic needs the proficiency.
		expect(
			isTrainedFor(cov, { class: "thrown", weaponFamily: "exotic", name: "Witch Lance" }),
		).toBe(false);
	});

	it("exotic weapons require a matching Exotic Weapon Proficiency", () => {
		const exotic = weaponTrainingCoverage([
			"Exotic Weapon Proficiency (Shuriken Catapult)",
		]);
		expect(
			isTrainedFor(exotic, {
				class: "basic",
				weaponFamily: "exotic",
				name: "Shuriken Catapult",
			}),
		).toBe(true);
		expect(
			isTrainedFor(exotic, { class: "basic", weaponFamily: "exotic", name: "Needle Rifle" }),
		).toBe(false);
	});

	it("no family authored falls back to the class-level gate", () => {
		expect(isTrainedFor(cov, { class: "basic" })).toBe(true);
		expect(isTrainedFor(cov, { class: "heavy" })).toBe(false);
	});
});
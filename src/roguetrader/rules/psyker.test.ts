/**
 * isPsykerLike — the ONE psyker predicate for UI gating (bead n9x7, 2up0).
 *
 * Two hand-written copies used to exist and DRIFTED (the NPC copy dropped the
 * sorcery terms, silently hiding the psychic tab from sorcerous NPCs), so the
 * merged predicate needs every disjunct pinned by a test: a repeat of the
 * drift must fail here before gatePsykerTab can delete the tab for real.
 *
 * Pure — no Foundry stubs; views are built with buildActorView.
 */
import { describe, expect, test } from "bun:test";
import { buildActorView } from "../../ffg/domain/model/build";
import { isPsykerLike } from "./psyker";

describe("isPsykerLike (bead 2up0, merged n9x7 predicate)", () => {
	// --- Disjunct 1: the stored psyker flag ---------------------------------

	test("system.psyker === true is a psyker", () => {
		const view = buildActorView({ type: "pc", system: { psyker: true } });
		expect(isPsykerLike(view)).toBe(true);
	});

	test("system.psyker === false with nothing else is NOT a psyker", () => {
		const view = buildActorView({ type: "pc", system: { psyker: false } });
		expect(isPsykerLike(view)).toBe(false);
	});

	// --- Disjunct 2: Psy Rating --------------------------------------------

	test("psyRating: 1 is the minimum qualifying rating", () => {
		const view = buildActorView({ type: "npc", system: { psyRating: 1 } });
		expect(isPsykerLike(view)).toBe(true);
	});

	test("psyRating: 0 is NOT enough (no flag, no powers)", () => {
		const view = buildActorView({ type: "npc", system: { psyRating: 0 } });
		expect(isPsykerLike(view)).toBe(false);
	});

	test("absent psyRating behaves like 0", () => {
		const view = buildActorView({ type: "pc", system: {} });
		expect(isPsykerLike(view)).toBe(false);
	});

	// --- Disjunct 3: sorcery, both sources ---------------------------------

	test("an owned Sorcery talent rank satisfies the gate (the n9x7 drift case)", () => {
		// The NPC copy of the old predicate had dropped exactly this term: an
		// actor with a Sorcerer talent but psyker:false must still see the
		// psychic UI.
		const view = buildActorView({
			type: "npc",
			system: {},
			items: [
				{
					name: "Sorcerer",
					type: "talent",
					system: { effects: [{ kind: "sorcery-rank", value: 1 }] },
				},
			],
		});
		expect(isPsykerLike(view)).toBe(true);
	});

	test("a manual sorceryRank field satisfies the gate", () => {
		const view = buildActorView({
			type: "pc",
			system: { sorceryRank: "master-sorcerer" },
		});
		expect(isPsykerLike(view)).toBe(true);
	});

	// --- Disjunct 4: owned powers ------------------------------------------

	test("a psychicpower item alone is enough (flag/rating absent)", () => {
		const view = buildActorView({
			type: "pc",
			system: {},
			items: [
				{ name: "Smite", type: "psychicpower", system: {} },
			],
		});
		expect(isPsykerLike(view)).toBe(true);
	});

	test("a navigatorpower item alone counts — navigators are psykers (Core Rulebook p182)", () => {
		const view = buildActorView({
			type: "pc",
			system: {},
			items: [
				{
					name: "Warp Veil",
					type: "navigatorpower",
					system: {},
				},
			],
		});
		expect(isPsykerLike(view)).toBe(true);
	});

	test("other item types do not count", () => {
		const view = buildActorView({
			type: "pc",
			system: {},
			items: [
				{ name: "Weapon Prof", type: "talent", system: {} },
				{ name: "Lasgun", type: "ranged-weapon", system: {} },
			],
		});
		expect(isPsykerLike(view)).toBe(false);
	});

	// --- Non-character families (isCharacterView narrowing) ----------------

	test("a ship with no psyker fields and no powers is NOT a psyker", () => {
		const view = buildActorView({ type: "ship", system: {} });
		expect(isPsykerLike(view)).toBe(false);
	});

	test("a ship still counts via OWNED psychic/navigator powers without narrowing", () => {
		// Bead l2wz: non-character families cannot read psyker/psyRating
		// (system narrows to undefined), so owned powers must keep working —
		// the item scan is unconditional.
		const view = buildActorView({
			type: "ship",
			system: {},
			items: [{ name: "Smite", type: "psychicpower", system: {} }],
		});
		expect(isPsykerLike(view)).toBe(true);
	});

	// --- The regression the predicate exists for ---------------------------

	test("REGRESSION: a sorcerous NPC without the item-scan or sorcery terms would fail the gate", () => {
		// This is the exact n9x7 drift shape: all truth lives in the sorcery
		// terms + the power scan. If either term is dropped again, this goes
		// false and gatePsykerTab silently deletes the psychic tab.
		const view = buildActorView({
			type: "npc",
			system: { psyker: false, psyRating: 0 },
			items: [
				{
					name: "Master Sorcerer",
					type: "talent",
					system: { effects: [{ kind: "sorcery-rank", value: 2 }] },
				},
			],
		});
		expect(isPsykerLike(view)).toBe(true);
	});
});
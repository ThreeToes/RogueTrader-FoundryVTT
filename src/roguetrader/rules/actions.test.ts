/**
 * Combat-actions domain unit tests (bead 9r82): the prerequisite evaluator
 * against the printed precedents, the shared doc→entry mapper, the warmed
 * catalog pool and the lookup-card vars/dispatch.
 *
 * The print precedents come straight from the actions pack (Core Rulebook
 * Table 9-4 + prose): Brace Heavy Weapon "A Heavy weapon."; Full Auto Burst
 * "A ranged weapon capable of fully automatic fire."; Semi-Auto Burst
 * "A ranged weapon capable of semi-automatic fire."; Suppressing Fire
 * "A weapon capable of fully automatic fire."; Multiple Attacks "Two
 * weapons, or the Swift Attack or Lightning Attack talent."
 */
import { afterEach, describe, expect, test } from "bun:test";
import { resetPorts, setPorts } from "../../ffg/infrastructure/foundry/ports";
import type { Ports } from "../../ffg/application/ports";
import {
	actionAvailable,
	actionCapabilities,
	actionCostGlyphs,
	actionDifficulty,
	actionEntryFromDoc,
	actionLookupCardVars,
	actionRollCardVars,
	prereqKind,
	setActionCatalog,
	ensureActionCatalog,
	getActionCatalog,
	postActionLookupCard,
	ACTION_LOOKUP_TEMPLATE,
	type ActionEntry,
} from "./actions";

/**
 * One action entry, prereq + difficulty pre-classified (the mapper's
 * contract). Extra rollDifficulty drives the classification like the real
 * mapper does.
 */
function entry(
	name: string,
	prerequisites = "",
	extra: Partial<ActionEntry> = {},
): ActionEntry {
	const merged = {
		key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
		name,
		uuid: "Compendium.rogue-trader.actions.Item.test",
		actionCost: "Half",
		actionNote: "",
		subtypes: "",
		prerequisites,
		shortDescription: "Short line.",
		rollTest: "",
		rollDifficulty: "",
		prereqKind: prereqKind(prerequisites),
		...extra,
	};
	return { ...merged, difficulty: actionDifficulty(merged.rollDifficulty) };
}

describe("prereqKind (bead 9r82 data-driven mapping)", () => {
	test("the printed pack texts classify to their machine kinds", () => {
		expect(prereqKind("")).toBe("none");
		expect(prereqKind("A Heavy weapon.")).toBe("heavy-weapon");
		expect(
			prereqKind("A ranged weapon capable of fully automatic fire."),
		).toBe("ranged-full-auto");
		expect(
			prereqKind("A ranged weapon capable of semi-automatic fire."),
		).toBe("ranged-semi-auto");
		expect(prereqKind("A weapon capable of fully automatic fire.")).toBe(
			// rateOfFire (and thus automatic fire) only exists on ranged
			// weapons, so the short printed sentence and the ranged one are the
			// same machine capability.
			"ranged-full-auto",
		);
		expect(
			prereqKind("Two weapons, or the Swift Attack or Lightning Attack talent."),
		).toBe("two-weapons-or-assault");
	});

	test("an unrecognized printed text THROWS (loud, never silently available)", () => {
		expect(() => prereqKind("A pet squig.")).toThrow(/machine kind/);
	});
});

/** Loose owned-item shapes (weapons: equip-state + class + rateOfFire). */
function weapon(extra: {
	type: string;
	class: string;
	equipState?: string;
	rateOfFire?: { burst?: number; fullAuto?: number };
}) {
	return { name: "Weapon", type: extra.type, system: extra };
}

describe("actionCapabilities + actionAvailable (print precedents)", () => {
	test("Brace Heavy Weapon: a READY Heavy weapon meets it (p238)", () => {
		const brace = () => entry("Brace Heavy Weapon", "A Heavy weapon.");
		const caps = actionCapabilities([
			weapon({ type: "ranged-weapon", class: "heavy", equipState: "carried" }),
		]);
		expect(caps.heavyWeapon).toBeTrue();
		expect(actionAvailable(brace(), caps)).toBeTrue();

		// No heavy weapon at all → grey.
		const bare = actionCapabilities([]);
		expect(actionAvailable(brace(), bare)).toBeFalse();

		// Heavy but STOWED (bracing happens in hand — the equip gate).
		const stowed = actionCapabilities([
			weapon({ type: "ranged-weapon", class: "heavy", equipState: "stowed" }),
		]);
		expect(actionAvailable(brace(), stowed)).toBeFalse();
		expect(caps.readyWeapons).toBe(1);
	});

	test("Full Auto Burst: a ready ranged weapon with fullAuto > 0 (p239)", () => {
		const burst = () =>
			entry(
				"Full Auto Burst",
				"A ranged weapon capable of fully automatic fire.",
			);
		const caps = actionCapabilities([
			weapon({
				type: "ranged-weapon",
				class: "basic",
				equipState: "carried",
				rateOfFire: { fullAuto: 6 },
			}),
		]);
		expect(actionAvailable(burst(), caps)).toBeTrue();

		// Single-shot only (fullAuto 0, burst > 0 is semi not full) → grey.
		const semiOnly = actionCapabilities([
			weapon({
				type: "ranged-weapon",
				class: "basic",
				equipState: "carried",
				rateOfFire: { burst: 2 },
			}),
		]);
		expect(actionAvailable(burst(), semiOnly)).toBeFalse();
	});

	test("Semi-Auto Burst: a ready ranged weapon with burst > 0 (p241)", () => {
		const semi = () =>
			entry(
				"Semi-Auto Burst",
				"A ranged weapon capable of semi-automatic fire.",
			);
		const caps = actionCapabilities([
			weapon({
				type: "ranged-weapon",
				class: "basic",
				equipState: "carried",
				rateOfFire: { burst: 2, fullAuto: 6 },
			}),
		]);
		expect(actionAvailable(semi(), caps)).toBeTrue();

		const single = actionCapabilities([
			weapon({
				type: "ranged-weapon",
				class: "pistol",
				equipState: "carried",
				rateOfFire: { fullAuto: 0 },
			}),
		]);
		expect(actionAvailable(semi(), single)).toBeFalse();
	});

	test("Suppressing Fire: 'A weapon capable of fully automatic fire' equals the same machine capability (p242)", () => {
		const suppress = () =>
			entry("Suppressing Fire", "A weapon capable of fully automatic fire.");
		const caps = actionCapabilities([
			weapon({
				type: "ranged-weapon",
				class: "basic",
				equipState: "carried",
				rateOfFire: { fullAuto: 4 },
			}),
		]);
		expect(actionAvailable(suppress(), caps)).toBeTrue();
		// Melee weapons carry no rateOfFire — they cannot fire automatically.
		const melee = actionCapabilities([
			weapon({ type: "melee-weapon", class: "melee", equipState: "carried" }),
		]);
		expect(actionAvailable(suppress(), melee)).toBeFalse();
	});

	test("Multiple Attacks: two ready weapons OR Swift/Lightning Attack (p240)", () => {
		const multi = () =>
			entry(
				"Multiple Attacks",
				"Two weapons, or the Swift Attack or Lightning Attack talent.",
			);
		const two = actionCapabilities([
			weapon({ type: "melee-weapon", class: "melee", equipState: "carried" }),
			weapon({ type: "melee-weapon", class: "melee", equipState: "carried" }),
		]);
		expect(actionAvailable(multi(), two)).toBeTrue();

		// One weapon, but the book's OR: the Lightning Attack talent alone.
		const talentOnly = actionCapabilities([
			{ name: "Lightning Attack", type: "talent" },
		]);
		expect(actionAvailable(multi(), talentOnly)).toBeTrue();

		// Case-insensitive ownership check (Swift attack / SWIFT ATTACK).
		const swift = actionCapabilities([
			{ name: "swift attack", type: "talent" },
		]);
		expect(actionAvailable(multi(), swift)).toBeTrue();

		// neither branch → grey.
		const none = actionCapabilities([
			weapon({ type: "melee-weapon", class: "melee", equipState: "carried" }),
		]);
		expect(actionAvailable(multi(), none)).toBeFalse();

		// Unreadied weapons do not count as "two weapons".
		const stowed = actionCapabilities([
			weapon({ type: "melee-weapon", class: "melee", equipState: "stowed" }),
			weapon({ type: "ranged-weapon", class: "basic", equipState: "stowed" }),
		]);
		expect(stowed.readyWeapons).toBe(0);
		expect(actionAvailable(multi(), stowed)).toBeFalse();
	});

	test("actions without prerequisites are always available (26 of 31)", () => {
		const aim = entry("Aim");
		expect(aim.prereqKind).toBe("none");
		expect(
			actionAvailable(aim, actionCapabilities([])),
		).toBeTrue();
	});
});

describe("the warmed catalog (talent-catalog contract)", () => {
	afterEach(() => {
		setActionCatalog([]);
		resetPorts();
	});

	test("the shared mapper carries the machine fields per pack doc", () => {
		const mapped = actionEntryFromDoc({
			name: "Aim",
			uuid: "Compendium.rogue-trader.actions.Item.abc",
			system: {
				actionCost: "Half/Full",
				subtypes: "Concentration",
				shortDescription: "+10 bonus to hit as a Half Action…",
				description: "<p>Prose.</p>",
			},
		});
		expect(mapped.key).toBe("aim");
		expect(mapped.prereqKind).toBe("none");
		expect(mapped.actionCost).toBe("Half/Full");
		expect(mapped.rollTest).toBe("");
		expect(mapped.uuid).toBe(
			"Compendium.rogue-trader.actions.Item.abc",
		);
	});

	test("the mapper classifies a printed roll spec + prerequisite", () => {
		const mapped = actionEntryFromDoc({
			name: "Brace Heavy Weapon",
			system: {
				actionCost: "Half",
				prerequisites: "A Heavy weapon.",
				roll: { test: "ballistic-skill", difficulty: "" },
			},
		});
		expect(mapped.prereqKind).toBe("heavy-weapon");
		expect(mapped.rollTest).toBe("ballistic-skill");
	});

	test("ensureActionCatalog fills ONLY action-typed docs, pool-first", async () => {
		let calls = 0;
		const load = async () => {
			calls += 1;
			return [
				{ type: "action", name: "Aim", system: {} },
				{ type: "mutation", name: "Not an action", system: {} },
			];
		};
		const first = await ensureActionCatalog(load);
		expect(calls).toBe(1);
		expect(first.map((e) => e.name)).toEqual(["Aim"]);
		expect(getActionCatalog().length).toBe(1);
		// Second ensure is pool-first: the loader is not called again.
		await ensureActionCatalog(load);
		expect(calls).toBe(1);
	});

	test("an empty pack fetch leaves the pool untouched (content-optional)", async () => {
		setActionCatalog([]);
		const rows = await ensureActionCatalog(async () => []);
		expect(rows).toEqual([]);
	});
});

describe("the lookup card (lookup dispatch, fake ports)", () => {
	afterEach(() => {
		resetPorts();
	});

	test("the card vars carry the pack-doc link + cost + terse line", () => {
		const vars = actionLookupCardVars({
			entry: entry("Aim"),
			labels: { cost: "Action Type", description: "Action Description" },
		});
		expect(vars.titleDoc.link).toEqual({
			action: "openPackDoc",
			uuid: "Compendium.rogue-trader.actions.Item.test",
			name: "Aim",
		});
		expect(vars.cost).toBe("Half");
		expect(vars.description).toBe("Short line.");
	});

	test("the Varies note rides the cost; no uuid degrades the link", () => {
		const vars = actionLookupCardVars({
			entry: entry("Reload", "", {
				uuid: "",
				actionCost: "Varies",
				actionNote: "Varies by weapon",
			}),
			labels: { cost: "Action Type", description: "Action Description" },
		});
		expect(vars.cost).toBe("Varies (Varies by weapon)");
		expect(vars.titleDoc.link).toBeNull();
	});

	test("postActionLookupCard posts the lookup template through the chat port", async () => {
		const posted: Array<{ template: string; vars: unknown }> = [];
		setPorts({
			chat: {
				async post(
					_actor: unknown,
					template: string,
					vars: Record<string, unknown>,
				) {
					posted.push({ template, vars });
					return { id: "one" };
				},
			},
		} as unknown as Ports);
		await postActionLookupCard({
			actor: { uuid: "Actor.abc" },
			entry: entry("Aim"),
			labels: { cost: "Action Type", description: "Action Description" },
		});
		expect(posted.length).toBe(1);
		expect(posted[0].template).toBe(ACTION_LOOKUP_TEMPLATE);
		expect(
			(posted[0].vars as { titleDoc: { link: { uuid: string } } }).titleDoc
				.link.uuid,
		).toBe("Compendium.rogue-trader.actions.Item.test");
	});
});

/**
 * The printed difficulty → machine bits mapping (bead et5a). The pack
 * prints exactly "" (no test), "Hard (–20)", "Challenging (+0)" and bare
 * "Opposed"; the parenthesised value is the book's own number, parsed —
 * NOT the TestDialog ladder's step values (which are unverified).
 */
describe("actionCostGlyphs (the tab's cost glyphs, owner request)", () => {
	test("maps the printed cost words", () => {
		expect(actionCostGlyphs("Half")).toBe("\u25D1"); // ◑
		expect(actionCostGlyphs("Full")).toBe("\u274D"); // ❍
		expect(actionCostGlyphs("Reaction")).toBe("\u21AB"); // ↫
		// Compound printed costs map part by part (Move, Aim, Grapple).
		expect(actionCostGlyphs("Half/Full")).toBe("\u25D1/\u274D");
		expect(actionCostGlyphs("")).toBe("");
	});

	test("an unmapped printed word keeps its word (no invented glyphs)", () => {
		expect(actionCostGlyphs("Varies")).toBe("Varies");
		expect(actionCostGlyphs("Varies/Full")).toBe("Varies/\u274D");
	});
});

describe("actionDifficulty (bead et5a data-driven mapping)", () => {
	test("the printed pack labels classify to their machine bits", () => {
		expect(actionDifficulty("")).toEqual({ kind: "none", value: 0 });
		expect(actionDifficulty("Hard (–20)")).toEqual({
			kind: "numeric",
			value: -20,
		});
		expect(actionDifficulty("Challenging (+0)")).toEqual({
			kind: "numeric",
			value: 0,
		});
		expect(actionDifficulty("Opposed")).toEqual({ kind: "opposed", value: 0 });
	});

	test("unmapped labels fail loudly", () => {
		expect(() => actionDifficulty("Very Hard")).toThrow(
			/extend actionDifficulty/,
		);
	});

	test("the roll-result card carries the lookup anatomy + the result", () => {
		const vars = actionRollCardVars({
			entry: entry("Called Shot", "", { rollDifficulty: "Hard (–20)" }),
			labels: { cost: "Action Type", description: "Action Description" },
			result: {
				target: 80,
				roll: 23,
				outcomeLabel: "Success (+3 degrees)",
				outcomeClass: "success",
				opposedNote: "",
			},
		});
		expect(vars.cost).toBe("Half");
		expect(vars.target).toBe(80);
		expect(vars.roll).toBe(23);
		expect(vars.outcomeClass).toBe("success");
		expect(vars.opposedNote).toBe("");
	});
});
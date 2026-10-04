/**
 * Card condition auto-suggest (epic vr1o, bead ronn):
 *
 * - postCriticalCard derives a one-click Stunned suggestion from LANDED
 *   critical rows whose printed text names the condition (the accurate
 *   trigger: rows are free prose, no structured column, so text-matching the
 *   page-cited content is what the machinery actually has);
 * - template guards: only cards whose context carries a suggestion render
 *   the button — every other card (damage, toxic, miss) shows none;
 * - bootstrap/hooks.ts dispatches button.rt-apply-condition to
 *   presentation/chat-actions.ts applyConditionFromCard;
 * - the dispatch walks the SHARED condition write path (rules/conditions.ts
 *   conditionEffectData -> ports.actors.createEffects, via rolls/fear.ts
 *   applyCondition): applies exactly once (disabled button), LOUD-FAILS on a
 *   missing target, and enforces the apply-damage ownership gate;
 * - the toxic damage card carries NO condition button: the book's Toxic
 *   failure (Core Rulebook p117) is 1d10 Impact damage — damage/fatigue, not
 *   a registry condition ("poisoned" is deliberately not in
 *   SYSTEM_STATUSES).
 */

import { afterEach, afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Ports } from "../../ffg/application/ports";

// Foundry globals stubbed BEFORE the dynamic import (chat-doc-open pattern:
// the import chain reaches ApplicationV2-derived sheet classes).
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "foundry"]) {
	originalGlobals[key] =
		key === "foundry"
			? (globalThis as Record<string, unknown>).foundry
			: (globalThis as Record<string, unknown>).game;
}
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
		handlebars: { renderTemplate: async () => "" },
	},
	utils: { fromUuidSync: () => null },
};
(globalThis as Record<string, unknown>).game = { user: { isGM: true } };

const { getPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { applyConditionFromCard } = await import("./chat-actions");
const { postCriticalCard } = await import("../rules/criticals");

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
	resetPorts();
});

afterAll(() => {
	// The foundry/game stubs are GLOBALS: restore them, or the next test file
	// inherits a barebones API surface (full-suite isolation pattern).
	for (const key of ["game", "foundry"]) {
		if (originalGlobals[key] === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else
			(globalThis as Record<string, unknown>)[key] = originalGlobals[key];
	}
});

// ---------------------------------------------------------------------------
// postCriticalCard: the suggestion derivation.
// ---------------------------------------------------------------------------

interface PostedCard {
	template: string;
	vars: Record<string, unknown>;
}

/** Fake chat port: record what the critical card would render. */
function captureCard(): { posted: PostedCard[] } {
	const posted: PostedCard[] = [];
	setPorts({
		...getPorts(),
		chat: {
			...getPorts().chat,
			post: async (
				_actor: unknown,
				template: string,
				vars: Record<string, unknown>,
			) => {
				posted.push({ template, vars });
				return { id: "msg-1" };
			},
		} as unknown as Ports["chat"],
	});
	return { posted };
}

describe("postCriticalCard condition suggestion (bead ronn)", () => {
	test("a landed row whose printed text names stun suggests the stunned status", async () => {
		const { posted } = captureCard();
		const actor = { uuid: "Actor.victim" };
		await postCriticalCard(
			actor,
			{
				effects: [
					{
						id: "crit-1",
						location: "head",
						severity: 3,
						table: "Critical Hit (Energy, Head)",
						roll: 3,
						source: "core",
						text: "The attack cooks off the target's ear, leaving him Stunned for 1 Round and inflicting 1 level of Fatigue.",
					},
				],
				woundsApplied: 2,
				excess: 4,
				overrideUsed: false,
			},
			{ damageType: "Energy", location: "head" },
		);
		expect(posted).toHaveLength(1);
		expect(posted[0]!.template).toBe(
			"systems/rogue-trader/template/chat/critical.hbs",
		);
		expect(posted[0]!.vars.conditionSuggestions).toEqual([
			{ statusId: "stunned", labelKey: "STATUS.STUNNED" },
		]);
		// The button resolves the victim through data-target.
		expect(posted[0]!.vars.targetUuid).toBe("Actor.victim");
	});

	test('"Stuns him" prose matches too (no trailing word-boundary)', async () => {
		const { posted } = captureCard();
		await postCriticalCard(
			{ uuid: "Actor.victim" },
			{
				effects: [
					{
						id: "crit-1",
						location: "body",
						severity: 7,
						table: "Critical Hit (Impact, Body)",
						roll: 7,
						source: "core",
						text: "The force of the burst knocks the target to the ground and Stuns him for 1 Round.",
					},
				],
				woundsApplied: 0,
				excess: 7,
				overrideUsed: false,
			},
			{ damageType: "Impact", location: "body" },
		);
		expect(posted[0]!.vars.conditionSuggestions).toHaveLength(1);
	});

	test("a row that does NOT imply a condition shows no suggestion", async () => {
		const { posted } = captureCard();
		await postCriticalCard(
			{ uuid: "Actor.victim" },
			{
				effects: [
					{
						id: "crit-1",
						location: "body",
						severity: 2,
						table: "Critical Hit (Energy, Body)",
						roll: 2,
						source: "core",
						text: "The blast punches the air from the target's body, inflicting 1 level of Fatigue upon him.",
					},
				],
				woundsApplied: 3,
				excess: 1,
				overrideUsed: false,
			},
			{ damageType: "Energy", location: "body" },
		);
		expect(posted[0]!.vars.conditionSuggestions).toEqual([]);
	});

	test("a MANUAL row (table content missing) never suggests a condition", async () => {
		const { posted } = captureCard();
		await postCriticalCard(
			{ uuid: "Actor.victim" },
			{
				effects: [
					{
						id: "crit-1",
						location: "head",
						severity: 3,
						table: "Critical Hit (Energy, Head)",
						roll: 0,
						source: "core",
						text: "",
						manual: true,
					},
				],
				woundsApplied: 1,
				excess: 2,
				overrideUsed: false,
			},
			{ damageType: "Energy", location: "head" },
		);
		expect(posted[0]!.vars.conditionSuggestions).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Template guards: only condition-implying cards render the button.
// ---------------------------------------------------------------------------

describe("template scan guards (bead ronn)", () => {
	const criticalTemplate = readFileSync(
		new URL("../../../template/chat/critical.hbs", import.meta.url),
		"utf8",
	);

	test("critical.hbs renders the button ONLY inside the suggestion block", () => {
		expect(criticalTemplate).toMatch(/rt-apply-condition/);
		// Exactly one occurrence, and it sits behind the suggestions gate.
		expect(criticalTemplate.match(/rt-apply-condition/g)).toHaveLength(1);
		expect(criticalTemplate).toMatch(
			/\{\{#if conditionSuggestions\.length\}\}[\s\S]*rt-apply-condition/,
		);
	});

	test("cards WITHOUT condition-implying outcomes carry NO button", () => {
		for (const name of [
			"damage.hbs",
			"roll.hbs",
			"fear-shock.hbs",
			"mutation-roll.hbs",
			"ship-repair.hbs",
			"ship-salvo.hbs",
		]) {
			const source = readFileSync(
				new URL(`../../../template/chat/${name}`, import.meta.url),
				"utf8",
			);
			expect(
				source.includes("rt-apply-condition"),
				`${name} must not carry a condition apply button`,
			).toBeFalse();
		}
	});

	test("bootstrap/hooks.ts dispatches the button to applyConditionFromCard", () => {
		const source = readFileSync(
			new URL("../bootstrap/hooks.ts", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(/applyConditionFromCard/);
		expect(source).toMatch(/button\.rt-apply-condition/);
	});

	test("the two new i18n keys exist in ALL FOUR languages", () => {
		for (const key of [
			"CHAT.CONDITION_APPLY_HINT",
			"CHAT.CONDITION_TARGET_MISSING",
		]) {
			for (const lang of ["en", "es", "fr", "pl"] as const) {
				const dict = JSON.parse(
					readFileSync(`lang/${lang}.json`, "utf8"),
				) as Record<string, string>;
				expect(
					dict[key],
					`${lang}.json has a non-empty ${key}`,
				).toBeTruthy();
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Dispatch: fake ports, the apply path, loud-fails.
// ---------------------------------------------------------------------------

function fakeButton(data: {
	condition?: string;
	target?: string;
}): HTMLButtonElement & { dataset: Record<string, string | undefined> } {
	return { dataset: { ...data } } as unknown as HTMLButtonElement & {
		dataset: Record<string, string | undefined>;
	};
}

describe("applyConditionFromCard dispatch (bead ronn)", () => {
	function fakeApplyPorts() {
		const created: Array<{
			actor: unknown;
			data: Array<Record<string, unknown>>;
		}> = [];
		const warns: Array<{ key: string; vars?: unknown }> = [];
		setPorts({
			...getPorts(),
			actors: {
				...getPorts().actors,
				createEffects: async (actor, data) => {
					created.push({ actor, data: [...data] });
				},
				deleteEffects: async () => {
					throw new Error("deleteEffects must not run for an empty actor");
				},
			},
			notify: {
				...getPorts().notify,
				warn: (key: string, vars?: unknown) => {
					warns.push({ key, vars });
				},
			},
		});
		return { created, warns };
	}

	test("applies the condition through ports.actors.createEffects, exactly once", async () => {
		const { created, warns } = fakeApplyPorts();
		const victim = { effects: [], isOwner: true };
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => victim },
		};
		const button = fakeButton({ condition: "stunned", target: "Actor.victim" });
		await applyConditionFromCard(button);
		await applyConditionFromCard(button); // disabled after the first click
		expect(created).toHaveLength(1);
		expect(created[0]!.actor).toBe(victim);
		// c9nt funnel shape: the status registers as an ActiveEffect the
		// funnel sees (statuses key), snap-out flagged, no silent modifier.
		const effect = created[0]!.data[0]!;
		expect(effect.statuses).toEqual(["stunned"]);
		expect(effect["flags.rogue-trader.snapOut"]).toBe(true);
		expect(effect.changes).toBeUndefined(); // testPenalty 0, no silent write
		expect(effect.duration).toBeUndefined(); // printed duration is manual
		expect(warns).toEqual([]);
	});

	test("a missing target LOUD-FAILS (notify warn), never a silent no-op", async () => {
		const { created, warns } = fakeApplyPorts();
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => null },
		};
		await applyConditionFromCard(
			fakeButton({ condition: "stunned", target: "Actor.gone" }),
		);
		expect(created).toEqual([]);
		expect(warns).toEqual([
			{ key: "CHAT.CONDITION_TARGET_MISSING", vars: { target: "Actor.gone" } },
		]);
	});

	test("an outcome with NO registry condition never writes", async () => {
		const { created, warns } = fakeApplyPorts();
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => null },
		};
		// Unknown id / no condition — e.g. a card button stamped wrong.
		await applyConditionFromCard(
			fakeButton({ condition: "poisoned", target: "Actor.victim" }),
		);
		await applyConditionFromCard(fakeButton({ target: "Actor.victim" }));
		expect(created).toEqual([]);
		expect(warns).toEqual([]);
	});

	test("ownership gate: a non-owner non-GM click never writes", async () => {
		const { created, warns } = fakeApplyPorts();
		const victim = { effects: [], isOwner: false };
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => victim },
		};
		globals.game = { user: { isGM: false } };
		await applyConditionFromCard(
			fakeButton({ condition: "stunned", target: "Actor.victim" }),
		);
		expect(created).toEqual([]);
		expect(warns).toEqual([]); // ownership is checked silently, like apply-damage
		globals.game = { user: { isGM: true } }; // restore for other tests
	});
});
/**
 * Explicit funnel-contributor registration (bead i4b0).
 *
 * The RT contributors (attack-context fire-mode bonus, origin traits) used to
 * register by import side effect from the rules/funnel shim, so a caller
 * importing the roll pipeline or the adapter directly saw a registry missing
 * the fire-mode row unless some other module had imported the shim first.
 *
 * THE PIN: this file deliberately does NOT import "rules/funnel" (the
 * side-effect shim). It imports the RT roll modules the way a future caller
 * would — the RT pipeline shim and the ffg funnel directly — and asserts the
 * fire-mode row still appears. The strongest form runs the file in isolation
 * (`bun test src/roguetrader/rules/funnel-registration.test.ts`), where the
 * module registry is fresh: on the old code the first collection missed the
 * row entirely. In the full suite another file may already have registered
 * the contributors, which is why the idempotency assertions matter too.
 *
 * The modules load through ports/content, which tolerate an absent Foundry
 * global; only the i18n port needs a stub for the modifier labels.
 */

const originalGame = (globalThis as Record<string, unknown>).game;
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};

const { collectTestModifiers, testContributors } = await import(
	"../../ffg/application/funnel"
);
// The view builder from the domain layer — loose objects in, ActorView out.
const { buildActorView } = await import("../../ffg/domain/model/build");
// The RT pipeline shim — WITHOUT the rules/funnel side-effect shim in the
// graph of this file. Imported for its registration side effect, exactly as
// a future roll flow would import it.
await import("../presentation/rolls/pipeline");
const {
	registerRtFunnelContributors,
	RT_FUNNEL_CONTRIBUTOR_TYPES,
} = await import("./funnel-registration");

import { afterAll, describe, expect, test } from "bun:test";

afterAll(() => {
	if (originalGame === undefined) {
		delete (globalThis as Record<string, unknown>).game;
	} else {
		(globalThis as Record<string, unknown>).game = originalGame;
	}
});

const view = () => buildActorView({});

describe("registerRtFunnelContributors (bead i4b0)", () => {
	test("the fire-mode row is present on a bare pipeline import (no shim)", () => {
		const mods = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "burst" },
		);
		expect(mods.find((m) => m.id === "attack:fire-mode:burst")?.value).toBe(
			10,
		);
		const full = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "full" },
		);
		expect(full.find((m) => m.id === "attack:fire-mode:full")?.value).toBe(
			20,
		);
	});

	test("both RT contributor source types are registered", () => {
		registerRtFunnelContributors();
		const types = new Set(testContributors.types());
		for (const type of RT_FUNNEL_CONTRIBUTOR_TYPES) {
			expect(types.has(type)).toBe(true);
		}
	});

	test("a repeat call is idempotent — no extra fire-mode row", () => {
		registerRtFunnelContributors();
		const mods = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "burst" },
		);
		expect(
			mods.filter((m) => m.id === "attack:fire-mode:burst"),
		).toHaveLength(1);
	});
});
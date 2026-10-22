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

import type { TestContributor } from "../../ffg/application/funnel";
import { rtCore } from "../../ffg/domain/system-profile";
import type { TestContributorPorts } from "../../ffg/application/funnel";

/**
 * Bead x4ly: the RT attack-context contributor binds its config + i18n from
 * the CONTEXT ports, so a test pinning its rows threads a port double.
 */
const rtPorts: TestContributorPorts = {
	config: {
		homebrew: () => null,
		profile: () => rtCore,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
	},
	i18n: { t: (key: string) => key },
};

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

// Bead 4tx6, FOREIGN-FIRST registration: before anything RT is imported, a
// (fictional) foreign module registers its own contributors under the SAME
// type keys the RT registrar owns. With the old keys-based applied-guard this
// made the RT registrar skip itself — the RT rows would silently vanish (the
// missing-row class bead i4b0 exists to kill). With reference de-dupe (bead
// 00z5) the RT fns append BESIDE them, never get substituted for, and the
// namespaced RT keys hold a separate list entirely. The stubs are kept as
// handles so afterAll can off them — a suite registration must not leak into
// the next suite in this process.
const foreignStubs: ReadonlyArray<readonly [string, TestContributor]> = [
	["attack-context", () => []],
	["origin-traits", () => []],
	["weapon-qualities", () => []],
];
for (const [type, fn] of foreignStubs) testContributors.register(type, fn);
// The view builder from the domain layer — loose objects in, ActorView out.
const { buildActorView } = await import("../../ffg/domain/model/build");
// The RT pipeline shim — WITHOUT the rules/funnel side-effect shim in the
// graph of this file. Imported for its registration side effect, exactly as
// a future roll flow would import it.
await import("../presentation/rolls/pipeline");
const {
	registerRtFunnelContributors,
	RT_FUNNEL_CONTRIBUTOR_TYPES,
	RT_FUNNEL_NAMESPACE,
} = await import("./funnel-registration");
// The exact RT contributor handles, for the identity-based guard assertions
// (bead 4tx6).
const { attackContextContributor } = await import("./homebrew");
const { originTraitsContributor } = await import("./origin-traits");
const { weaponQualitiesContributor } = await import("./weapon-qualities");

import { afterAll, describe, expect, test } from "bun:test";

afterAll(() => {
	if (originalGame === undefined) {
		delete (globalThis as Record<string, unknown>).game;
	} else {
		(globalThis as Record<string, unknown>).game = originalGame;
	}
	// Bead 00z5 teardown: everything this file registered — the foreign
	// stubs (bare keys) and nothing else — leaves the registry via off.
	for (const [type, fn] of foreignStubs) testContributors.off(type, fn);
});

const view = () => buildActorView({});

describe("registerRtFunnelContributors (bead i4b0)", () => {
	// Bead 4tx6: this file registers FOREIGN stubs under the RT type keys
	// BEFORE importing the pipeline (see the top of the file), so this
	// assertion — run in isolation — fails against any keys-based guard that
	// a foreign registration could satisfy.
	test("the fire-mode row is present on a bare pipeline import (no shim)", () => {
		const mods = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "burst", ports: rtPorts },
		);
		expect(mods.find((m) => m.id === "attack:fire-mode:burst")?.value).toBe(
			10,
		);
		const full = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "full", ports: rtPorts },
		);
		expect(full.find((m) => m.id === "attack:fire-mode:full")?.value).toBe(
			20,
		);
	});

	// Bead 00z5: RT's registrations live under the RT namespace, so the raw
	// storage keys carry the RT_FUNNEL_NAMESPACE prefix.
	test("both RT contributor source types are registered", () => {
		registerRtFunnelContributors();
		const types = new Set(testContributors.types());
		for (const type of RT_FUNNEL_CONTRIBUTOR_TYPES) {
			expect(types.has(`${RT_FUNNEL_NAMESPACE}:${type}`)).toBe(true);
		}
	});

	test("a repeat call is idempotent — no extra fire-mode row", () => {
		registerRtFunnelContributors();
		const mods = collectTestModifiers(
			view(),
			{ kind: "attack", key: "bs", fireMode: "burst", ports: rtPorts },
		);
		expect(
			mods.filter((m) => m.id === "attack:fire-mode:burst"),
		).toHaveLength(1);
	});

	// Bead 4tx6 + 00z5: the registration is reference-deduped AND namespaced.
	// A foreign module's contributors under the same (bare) type keys —
	// stubbed in at the top of this file — live in a separate list from RT's
	// namespaced one; the exact RT handles sit beside them, each exactly once.
	test("a foreign registration of the same type keys does not satisfy the guard", () => {
		registerRtFunnelContributors();
		const attackHandlers = testContributors.contributorsFor(
			"attack-context",
			RT_FUNNEL_NAMESPACE,
		);
		const originHandlers = testContributors.contributorsFor(
			"origin-traits",
			RT_FUNNEL_NAMESPACE,
		);
		const qualityHandlers = testContributors.contributorsFor(
			"weapon-qualities",
			RT_FUNNEL_NAMESPACE,
		);
		expect(attackHandlers).toContain(attackContextContributor);
		expect(originHandlers).toContain(originTraitsContributor);
		expect(qualityHandlers).toContain(weaponQualitiesContributor);
		// No duplicate RT registration on the repeat call (or on the shim's
		// module-load call earlier in the graph).
		expect(
			attackHandlers.filter((fn) => fn === attackContextContributor),
		).toHaveLength(1);
		expect(
			originHandlers.filter((fn) => fn === originTraitsContributor),
		).toHaveLength(1);
		expect(
			qualityHandlers.filter((fn) => fn === weaponQualitiesContributor),
		).toHaveLength(1);
	});
});
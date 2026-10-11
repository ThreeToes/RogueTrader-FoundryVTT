/**
 * The profile() accessor on the config port (bead yojf): presentation/rolls
 * and rules/adapter resolve the kernel profile through ports.config.profile()
 * instead of importing rtCore, so a sibling system module swaps one binding.
 *
 * Bead w9sa.8 widened that accessor off RT's `SystemProfile` onto
 * `RuleProfile & Partial<SystemBranding>`, so a sibling's KERNEL + BRANDING
 * profile can be returned at all — the last test here is the proof, fuelled with
 * `dh2Core`-shaped data.
 *
 * The Foundry globals are stubbed before the dynamic import because the ports
 * module touches the Foundry implementation set at load.
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {};

import { afterAll, describe, expect, test } from "bun:test";
import { messageFlagNamespace } from "../../../ffg/application/chat-flags";
import { dh2Core } from "../../../ffg/domain/system-profile-dark-heresy";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

describe("config port profile()", () => {
	test("the Foundry config port resolves the composed RT profile", async () => {
		const { foundryPorts, resetPorts } = await import(
			"../../infrastructure/foundry/ports"
		);
		const { rtCore, DEFAULT_SYSTEM_PROFILE } = await import(
			"../../../ffg/domain/system-profile"
		);
		resetPorts();
		const profile = foundryPorts.config.profile();
		// One object, both layers: identity with the composed RT profile.
		expect(profile).toBe(rtCore);
		expect(profile).toBe(DEFAULT_SYSTEM_PROFILE);
		expect(profile.critOnDouble).toBe(true);
	});

	test("a test/front-end can swap the binding without touching call sites", async () => {
		const { getPorts, setPorts, resetPorts } = await import(
			"../../infrastructure/foundry/ports"
		);
		const { NO_CONTENT_PORT } = await import("../../../ffg/application/ports");
		const base = (await import("../../infrastructure/foundry/ports"))
			.foundryPorts;
		setPorts({
			...base,
			content: NO_CONTENT_PORT,
			config: {
				homebrew: () => null,
				originTraits: () => [],
				profile: () => ({
					...base.config.profile(),
					id: "sibling-core",
					critOnDouble: false,
				}),
			},
		});
		try {
			expect(getPorts().config.profile().id).toBe("sibling-core");
			expect(getPorts().config.profile().critOnDouble).toBe(false);
		} finally {
			resetPorts();
		}
	});

	// Bead w9sa.8 (audit finding A1): the seam used to be RT-only, because
	// `profile()` promised RT's own creation/advancement constants and a
	// DarkHeresyProfile cannot carry them. A kernel + branding object can now be
	// returned, and every consumer that reads only KERNEL fields is none the
	// wiser — which is the whole point of the widening.
	test("a dh2Core-shaped kernel + branding profile drives the same seam", async () => {
		const { foundryPorts, getPorts, setPorts, resetPorts } = await import(
			"../../infrastructure/foundry/ports"
		);
		resetPorts();
		setPorts({
			...foundryPorts,
			config: {
				homebrew: () => null,
				originTraits: () => [],
				packIds: () => ({ rolltables: null }),
				profile: () => ({
					id: dh2Core.id,
					critOnDouble: false,
					autoFailRoll: 100,
					autoPassRoll: 1,
					primitiveArmourDouble: false,
					righteousFury: dh2Core.righteousFury,
					hitLocations: dh2Core.hitLocations,
					characteristics: dh2Core.characteristics,
					messageFlagNamespace: "dark-heresy-2e",
					rollCardTemplate: "systems/dark-heresy-2e/template/chat/roll.hbs",
				}),
			},
		});
		try {
			const profile = getPorts().config.profile();
			// Kernel field reads resolve to the sibling's verified values.
			expect(profile.id).toBe("dh2-core");
			expect(profile.critOnDouble).toBe(false);
			expect(profile.autoPassRoll).toBe(1);
			expect(profile.characteristics?.keys).toContain("ifl");
			// `packBase()` in presentation/rules-app.ts reads exactly this.
			expect(getPorts().config.profile().id).toBe("dh2-core");
			// The branding consumers read the sibling's own branding.
			expect(messageFlagNamespace(getPorts())).toBe("dark-heresy-2e");
		} finally {
			resetPorts();
		}
	});
});

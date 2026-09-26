/**
 * The profile() accessor on the config port (bead yojf): presentation/rolls
 * and rules/adapter resolve the kernel profile through ports.config.profile()
 * instead of importing rtCore, so a sibling system module swaps one binding.
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
	notifications: { warn: () => undefined, error: () => undefined, info: () => undefined },
};
(globalThis as Record<string, unknown>).foundry = {};

import { afterAll, describe, expect, test } from "bun:test";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
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
});
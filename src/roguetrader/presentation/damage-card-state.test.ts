/**
 * Damage-card applied-state mirror (t2ei follow-on): the render-time flip of
 * the Apply button FROM the damageApply flag.
 *
 * - Pure decision: flag payload -> button attribute map (appliedDamageButtonState);
 * - Element mirror: mirrorDamageCardAppliedState applies the map onto the
 *   card's Apply button via faked element objects (dom-wire / image-actions
 *   precedent — no DOM library in the repo) and the ports seam for the flag
 *   read (apply-damage-card.test.ts precedent);
 * - Hook wiring: the register function hooks "renderChatMessageHTML" and
 *   bootstrap/hooks.ts registers it — the combat-end source-scan precedent.
 *   The hook body itself is a one-line delegation to the mirror, which the
 *   mirror tests already cover, so the captured callback is smoke-fired.
 */
import { afterEach, afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Foundry globals stubbed BEFORE the dynamic import (apply-damage-card
// precedent: the import chain reaches classes that destructure foundry at
// module load).
const originalGlobals: Record<string, unknown> = {};
const globals = globalThis as Record<string, unknown>;
for (const key of ["game", "foundry", "Hooks"]) {
	originalGlobals[key] = globals[key];
}
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	documents: { ChatMessage: { get: () => undefined } },
	utils: { fromUuidSync: () => null },
};
globals.game = {
	user: { isGM: true },
	i18n: {
		localize: (k: string) => `L:${k}`,
		format: (k: string, v?: Record<string, string>) => `L:${k}:${JSON.stringify(v)}`,
	},
};

const { resetPorts } = await import(
	"../infrastructure/foundry/ports"
);
const {
	appliedDamageButtonState,
	mirrorDamageCardAppliedState,
	registerDamageCardStateHook,
} = await import("./damage-card-state");

const NAMESPACE = "rogue-trader";

afterEach(() => {
	resetPorts();
	globals.game = {
		user: { isGM: true },
		i18n: {
			localize: (k: string) => `L:${k}`,
			format: (k: string, v?: Record<string, string>) => `L:${k}:${JSON.stringify(v)}`,
		},
	};
});

afterAll(() => {
	for (const key of ["game", "foundry", "Hooks"]) {
		if (originalGlobals[key] === undefined) delete globals[key];
		else globals[key] = originalGlobals[key];
	}
});

/** A button fake with the exact surface paintAppliedDamageButton touches. */
class FakeButton {
	disabled = false;
	attributes = new Map<string, string>();
	dataset: Record<string, string> = {};
	#aria = "";
	setAttribute(name: string, value: string): void {
		this.#aria = `${name}=${value}`;
		this.attributes.set(name, value);
	}
	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}
	/** The aria-disabled attribute value as the browser would report it. */
	get ariaDisabled(): string {
		return this.attributes.get("aria-disabled") ?? "";
	}
	/** The whole setAttribute log, order-sensitive. */
	attr(name: string): string | undefined {
		return name === "aria-disabled" ? this.#aria || undefined : this.attributes.get(name);
	}
}

function mirrorHarness(
	button: FakeButton | null,
): { html: { querySelector: (selector: string) => FakeButton | null } } {
	return { html: { querySelector: () => button } };
}

describe("appliedDamageButtonState (flag -> attribute map)", () => {
	test("an applied flag disables the button and titles it DAMAGE.APPLIED", () => {
		expect(appliedDamageButtonState({ applied: true, wounds: 4 })).toEqual({
			disabled: true,
			tooltipKey: "DAMAGE.APPLIED",
			tooltipVars: { wounds: "4" },
		});
	});

	test("an applied flag without a wound count interpolates a placeholder", () => {
		expect(appliedDamageButtonState({ applied: true })).toEqual({
			disabled: true,
			tooltipKey: "DAMAGE.APPLIED",
			tooltipVars: { wounds: "?" },
		});
	});

	test("an unconsumed (or absent) flag leaves the button enabled", () => {
		expect(appliedDamageButtonState({ applied: false })).toEqual({
			disabled: false,
			tooltipKey: null,
		});
		expect(appliedDamageButtonState({ wounds: 5 })).toEqual({
			disabled: false,
			tooltipKey: null,
		});
		expect(appliedDamageButtonState(undefined)).toEqual({
			disabled: false,
			tooltipKey: null,
		});
	});
});

describe("mirrorDamageCardAppliedState", () => {
	test("a consumed card's Apply button renders disabled", () => {
		const button = new FakeButton();
		mirrorDamageCardAppliedState(
			{
				flags: {
					[NAMESPACE]: { damageApply: { applied: true, wounds: 5 } },
				},
			},
			mirrorHarness(button).html,
		);
		expect(button.disabled).toBe(true);
		expect(button.ariaDisabled).toBe("true");
		// The disabled tooltip reuses the apply toast string (shipped in all
		// four languages) with the wound count interpolated — localize(key)
		// would render the raw {wounds} placeholder.
		expect(button.dataset.tooltip).toBe('L:DAMAGE.APPLIED:{"wounds":"5"}');
	});

	test("an unconsumed card's Apply button stays enabled, no affordances", () => {
		const button = new FakeButton();
		button.setAttribute("aria-disabled", "true");
		button.dataset.tooltip = "stale";
		mirrorDamageCardAppliedState(
			{
				flags: {
					[NAMESPACE]: { damageApply: { applied: false, wounds: 5 } },
				},
			},
			mirrorHarness(button).html,
		);
		expect(button.disabled).toBe(false);
		expect(button.ariaDisabled).toBe("");
		expect(button.dataset.tooltip).toBeUndefined();
	});

	test("a card with no flags (roll card, legacy card) stays enabled", () => {
		const button = new FakeButton();
		mirrorDamageCardAppliedState({ flags: {} }, mirrorHarness(button).html);
		expect(button.disabled).toBe(false);
	});

	test("a card with no Apply button (miss card) is a no-op", () => {
		expect(() =>
			mirrorDamageCardAppliedState(
				{ flags: { [NAMESPACE]: { damageApply: { applied: true } } } },
				{ querySelector: () => null },
			),
		).not.toThrow();
		expect(() =>
			mirrorDamageCardAppliedState(
				{ flags: {} },
				{ querySelector: () => null },
			),
		).not.toThrow();
	});

	test("a missing/empty html surface (core message shell) is a no-op", () => {
		expect(() => mirrorDamageCardAppliedState({}, undefined)).not.toThrow();
		expect(() => mirrorDamageCardAppliedState({}, {})).not.toThrow();
	});
});

describe("registerDamageCardStateHook (wiring)", () => {
	test("hooks renderChatMessageHTML and the callback mirrors the flag", () => {
		let captured: ((...args: unknown[]) => void) | null = null;
		globals.Hooks = {
			on: (name: string, fn: unknown) => {
				if (name === "renderChatMessageHTML") captured = fn as typeof captured;
			},
		};
		registerDamageCardStateHook();
		if (!captured) throw new Error("renderChatMessageHTML hook was not registered");
		const handler = captured as (...args: unknown[]) => void;
		const button = new FakeButton();
		handler(
			{ flags: { [NAMESPACE]: { damageApply: { applied: true, wounds: 3 } } } },
			{ querySelector: () => button },
		);
		expect(button.disabled).toBe(true);
		expect(button.dataset.tooltip).toBe('L:DAMAGE.APPLIED:{"wounds":"3"}');
	});

	test("bootstrap/hooks.ts registers the damage-card state hook", () => {
		const source = readFileSync(
			new URL("../bootstrap/hooks.ts", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(/registerDamageCardStateHook\(\)/);
	});
});
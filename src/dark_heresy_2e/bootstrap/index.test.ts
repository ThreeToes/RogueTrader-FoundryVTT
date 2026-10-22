/**
 * Headless boot test for the sibling system (bead w9sa.4).
 *
 * RT's composition root has `src/roguetrader/bootstrap/bootstrap.test.ts`; this
 * is the DH2 equivalent. Everything Foundry-shaped is stubbed, so it runs under
 * `bun test` with no Foundry, and the assertions are about what the boot WIRED
 * rather than what it rendered:
 *
 *   - the entry point Foundry loads registers exactly one init hook;
 *   - firing init installs DH2's registry and DH2's profile through the SAME
 *     shared registrars RT uses (no forked seam, no RT file touched);
 *   - the active profile is `dh2Core` plus DH2's branding — RT's constants are
 *     absent, not defaulted;
 *   - the shared consumers (chat-flag namespace, the kernel resolvers) read
 *     DH2's values through the port;
 *   - the DH2 module graph reaches ONLY the shared core and its own module,
 *     never `src/roguetrader` (the epic hr6r no-fork guarantee).
 *
 * PROCESS HYGIENE (the reason for the saves below): bun runs every suite in ONE
 * process, and both seams this boot claims are module-level state. The knob
 * registry has an official reset; the config seam does not, so the previous
 * values are captured and handed back on the way out. A leaked DH2 override
 * would retune every RT suite that runs afterwards.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// --- Foundry stubs (installed before the composition root is imported) -----

type HookFn = (...args: never[]) => unknown;

const hooks = {
	once: new Map<string, HookFn[]>(),
	on: new Map<string, HookFn[]>(),
};

/** Every `game.settings.register` call the DH2 boot makes (expected: none). */
const settingsRegistrations: Array<{ ns: string; key: string }> = [];

const globals = globalThis as Record<string, unknown>;
const saved = { Hooks: globals.Hooks, game: globals.game };

globals.Hooks = {
	once: (name: string, fn: HookFn) => {
		hooks.once.set(name, [...(hooks.once.get(name) ?? []), fn]);
	},
	on: (name: string, fn: HookFn) => {
		hooks.on.set(name, [...(hooks.on.get(name) ?? []), fn]);
	},
};
globals.game = {
	system: { id: "dark-heresy-2e", documentTypes: {} },
	settings: {
		register: (ns: string, key: string) => {
			settingsRegistrations.push({ ns, key });
		},
	},
};

// --- The module graph under test (and the seams it claims) ------------------

const { darkHeresyInit, DARK_HERESY_SYSTEM_ID } = await import("./index");
const { foundryPorts, setConfigOverrides } = await import(
	"../../ffg/infrastructure/foundry/ports"
);
const { messageFlagNamespace } = await import(
	"../../ffg/application/chat-flags"
);
const { locationForHit, resolveTest } = await import(
	"../../rules-engine/index"
);
const {
	knobByKey,
	resetRuleKnobRegistryForTests,
	ruleKnobRegistry,
	ruleKnobs,
	RT_SYSTEM_ID,
	ruleProfilePackKindFor,
} = await import("../../ffg/domain/rule-knobs");
const {
	DARK_HERESY_RULE_KNOBS,
	DARK_HERESY_RULE_KNOB_REGISTRY,
	DH2_SYSTEM_ID,
} = await import("../../ffg/domain/rule-knobs-dark-heresy");
const { dh2Core } = await import("../../ffg/domain/system-profile-dark-heresy");
const {
	DARK_HERESY_PROFILE,
	DARK_HERESY_ROLLTABLES_PACK,
	DARK_HERESY_ROLL_CARD_TEMPLATE,
} = await import("../profile");

/**
 * The values in force before this boot claims its seams. Reinstate them on the
 * way out so no later suite sees DH2's profile or DH2's knobs.
 */
const previousProfile = foundryPorts.config.profile();
const previousPackIds = foundryPorts.config.packIds();

function restoreSharedSeams(): void {
	resetRuleKnobRegistryForTests();
	// The config seam has no reset (unlike the knob registry's), so the previous
	// values are handed back through it. Observationally identical: the same
	// profile object and the same pack ids are what the port resolves before and
	// after this file runs.
	setConfigOverrides({
		profile: () => previousProfile,
		packIds: () => previousPackIds,
	});
}

afterAll(() => {
	restoreSharedSeams();
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete globals[key];
		else globals[key] = value;
	}
});

/** Fire every callback registered for a hook. */
function fire(name: string): void {
	for (const fn of hooks.once.get(name) ?? []) fn();
	for (const fn of hooks.on.get(name) ?? []) fn();
}

// --- Tests ------------------------------------------------------------------

describe("the DH2 entry point (bead w9sa.4)", () => {
	/** How many init callbacks are registered so far. */
	function initHooks(): number {
		return hooks.once.get("init")?.length ?? 0;
	}

	test("the root boots the system its own registry names", () => {
		// Criterion 2: the system id, the profile id and the profile provider are
		// DATA (DH2_SYSTEM_ID, dh2Core.id), not a copy of RT's.
		expect(DARK_HERESY_SYSTEM_ID).toBe(DH2_SYSTEM_ID);
		expect(DARK_HERESY_SYSTEM_ID).toBe("dark-heresy-2e");
		expect(DARK_HERESY_SYSTEM_ID).not.toBe(RT_SYSTEM_ID);
		expect(dh2Core.id).toBe("dh2-core");
		expect(DARK_HERESY_PROFILE.id).toBe(dh2Core.id);
	});

	test("the composition root registers exactly one init hook per call", () => {
		// RT's root registers one hook and puts everything inside it; DH2's must
		// do the same, or the boot order silently changes.
		const before = initHooks();
		darkHeresyInit();
		expect(initHooks()).toBe(before + 1);
		// Idempotent: calling it again only adds another hook, and firing init
		// twice re-installs the same bindings (last write wins, no throw).
		darkHeresyInit();
		expect(initHooks()).toBe(before + 2);
		expect(() => fire("init")).not.toThrow();
	});

	test("the module Foundry loads registers exactly one init hook", async () => {
		// The entry point is what the manifest's `esmodules` names; importing it
		// IS the boot. It must call the composition root once, no more.
		const before = initHooks();
		await import("../entry-point");
		expect(initHooks()).toBe(before + 1);
	});

	test("firing init wires the shared seams without throwing", () => {
		// That alone catches a bad import, an unguarded Foundry global or a
		// registrar this root forgot to call.
		expect(() => fire("init")).not.toThrow();
	});

	test("the boot registers no RT settings under RT's namespace", () => {
		// RT's config root registers three rule-profile settings plus a menu
		// under "rogue-trader". A DH2 world must see none of that: its own
		// settings surface is later work, and inheriting RT's would write house
		// rules into the wrong namespace.
		expect(settingsRegistrations).toEqual([]);
	});

	test("a second boot re-installs cleanly (idempotent, last write wins)", () => {
		fire("init");
		expect(ruleKnobRegistry()).toBe(DARK_HERESY_RULE_KNOB_REGISTRY);
		expect(foundryPorts.config.profile()).toBe(DARK_HERESY_PROFILE);
	});
});

describe("the knob registry a DH2 world runs on", () => {
	test("DH2's registry is the ACTIVE one, and it is not RT's", () => {
		expect(ruleKnobRegistry()).toBe(DARK_HERESY_RULE_KNOB_REGISTRY);
		expect(ruleKnobRegistry().systemId).toBe(DH2_SYSTEM_ID);
		expect(ruleKnobRegistry().systemId).not.toBe(RT_SYSTEM_ID);
		expect(ruleKnobs()).toBe(DARK_HERESY_RULE_KNOBS);
		expect(ruleKnobs().length).toBeGreaterThan(0);
	});

	test("a DH2-only knob resolves and an RT-only one does not", () => {
		// The inverted fire-mode sign and the flat untrained penalty are exactly
		// the values that must never be readable through RT's keys.
		expect(knobByKey("test.automaticFailureRoll")?.coreValue).toBe(100);
		expect(knobByKey("combat.fireModeBonus.burst")).toBeUndefined();
		expect(knobByKey("psychic.pushCap.sanctioned")).toBeUndefined();
		expect(knobByKey("advancement.eliteAdvanceBaseCost")).toBeUndefined();
	});

	test("the cross-system pack kind follows DH2's system id", () => {
		// bead w9sa.2 derives the kind from the registry's systemId, so an RT
		// rule-profile pack can never be merged into a DH2 world.
		expect(ruleProfilePackKindFor(ruleKnobRegistry().systemId)).toBe(
			"dark-heresy-2e.rule-profiles",
		);
	});
});

describe("the profile a DH2 world reads through the shared port", () => {
	test("it is dh2Core's kernel data plus DH2's branding", () => {
		const profile = foundryPorts.config.profile();
		expect(profile).toBe(DARK_HERESY_PROFILE);
		expect(profile.id).toBe(dh2Core.id);
		expect(profile.id).toBe("dh2-core");
		// Kernel fields are the sibling's own verified values, read back off
		// dh2Core so the profile-module cast cannot hide a restated number.
		expect(profile.critOnDouble).toBe(dh2Core.critOnDouble);
		expect(profile.autoFailRoll).toBe(dh2Core.autoFailRoll);
		expect(profile.autoPassRoll).toBe(dh2Core.autoPassRoll);
		expect(profile.primitiveArmourDouble).toBe(dh2Core.primitiveArmourDouble);
		expect(profile.hitLocations).toBe(dh2Core.hitLocations);
		expect(profile.characteristics).toBe(dh2Core.characteristics);
	});

	test("RT's rules data is absent, not defaulted", () => {
		const profile = foundryPorts.config.profile() as unknown as Record<
			string,
			unknown
		>;
		expect("fireModeBonus" in profile).toBe(false);
		expect("characteristicBase" in profile).toBe(false);
		expect("pointBuyBudget" in profile).toBe(false);
		expect("pushCap" in profile).toBe(false);
		// cmio.2 (approved cmio.1 report): DH2's untrainedPenalty COLLAPSES onto
		// the kernel's untrainedSkill union — the absence pin above the collapse
		// era is now the opposite pin.
		expect(profile.untrainedSkill).toEqual({
			model: "flat-penalty",
			penalty: -20,
		});
		// The one concept that SHARES RT's field shape is now the kernel union
		// (cmio.2): DH2 keeps the per-advance semantics.
		expect(profile.eliteAdvanceCost).toEqual({
			model: "per-advance",
		});
	});

	test("DH2's branding is composed, not copied from RT", () => {
		const profile = foundryPorts.config.profile();
		expect(profile.messageFlagNamespace).toBe("dark-heresy-2e");
		expect(profile.rollCardTemplate).toBe(
			"systems/dark-heresy-2e/template/chat/roll.hbs",
		);
		expect(DARK_HERESY_ROLL_CARD_TEMPLATE).toBe(profile.rollCardTemplate);
		expect(profile.messageFlagNamespace).not.toBe("rogue-trader");
	});

	test("the pack ids are DH2's (none installed yet, honestly null)", () => {
		expect(foundryPorts.config.packIds()).toEqual({ rolltables: null });
		expect(DARK_HERESY_ROLLTABLES_PACK).toBeNull();
	});

	test("the shared consumers resolve DH2's values through the port", () => {
		// The chat-flag namespace and the kernel resolvers take the ACTIVE
		// profile from the port, so DH2's data reaches them with no edit.
		expect(messageFlagNamespace(foundryPorts.config)).toBe("dark-heresy-2e");
		const profile = foundryPorts.config.profile();
		// Table 7-3, read on the REVERSED digits of the roll (20 reads as 02).
		expect(locationForHit(20, profile)).toBe("head");
		expect(locationForHit(88, profile)).toBe("left-leg");
		// DH2's verified auto-pass band (printed p22) read through the kernel.
		expect(resolveTest({ target: 1, roll: 1, profile }).success).toBe(true);
		expect(resolveTest({ target: 50, roll: 99, profile }).success).toBe(false);
	});

	test("the homebrew and content providers are the shared honest defaults", () => {
		// House rules and warmed content need DH2's own settings surface and
		// packs (epic eg4g); until then the shared defaults are the truth.
		expect(foundryPorts.config.homebrew()).toBeNull();
		expect(foundryPorts.config.originTraits()).toEqual([]);
	});
});

describe("the DH2 module graph (epic hr6r: reuse, do not fork)", () => {
	/** Every relative import in a source file, resolved to absolute paths. */
	function importsOf(file: string): string[] {
		const source = readFileSync(file, "utf8");
		const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
		const out: string[] = [];
		let match = re.exec(source);
		while (match) {
			const spec = match[1];
			if (spec.startsWith(".")) {
				const base = path.resolve(path.dirname(file), spec);
				for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
					if (existsSync(candidate)) {
						out.push(candidate);
						break;
					}
				}
			}
			match = re.exec(source);
		}
		return out;
	}

	function reachableFrom(entry: string): Set<string> {
		const seen = new Set<string>();
		const queue = [entry];
		while (queue.length > 0) {
			const file = queue.shift() as string;
			if (seen.has(file)) continue;
			seen.add(file);
			for (const next of importsOf(file)) {
				if (!seen.has(next)) queue.push(next);
			}
		}
		return seen;
	}

	test("the entry point reaches only the shared core and DH2's own module", () => {
		const graph = reachableFrom(
			path.resolve("src/dark_heresy_2e/entry-point.ts"),
		);
		const roots = [...graph].map((file) =>
			path.relative(process.cwd(), file).replaceAll("\\", "/"),
		);
		const foreign = roots.filter(
			(file) =>
				!file.startsWith("src/ffg/") &&
				!file.startsWith("src/rules-engine/") &&
				!file.startsWith("src/dark_heresy_2e/"),
		);
		// A single entry here would mean a copied RT tree (or a fork of one).
		expect(foreign).toEqual([]);
		// And the shared layers are genuinely reached — that is the point.
		expect(roots).toContain("src/ffg/domain/rule-knobs-dark-heresy.ts");
		expect(roots).toContain("src/ffg/infrastructure/foundry/ports.ts");
		expect(roots).toContain("src/rules-engine/profile.ts");
		expect(graph.size).toBeGreaterThan(5);
	});

	test("the DH2 module owns no RT file (directory listing, not just imports)", () => {
		const files: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = path.join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (full.endsWith(".ts")) files.push(full);
			}
		};
		walk("src/dark_heresy_2e");
		// Three files by design: the branded profile, the composition root and
		// the entry point. A fourth that is not a test means a tree was copied in.
		expect(files.filter((file) => !file.endsWith(".test.ts")).length).toBe(3);
	});
});

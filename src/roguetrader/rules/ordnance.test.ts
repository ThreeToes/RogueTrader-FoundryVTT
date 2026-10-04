/**
 * The shared ordnance decrement helper (bead 9b95 F1): one read/write/
 * announce path for BOTH the auto-consume funnel (adapter.ts) and the
 * manual −1 chip (chat-actions.ts) — whose only deliberate difference is
 * what an empty or corrupt quantity means, expressed as `onEmpty`.
 *
 * `shotsForFireMode` (bead 9b95 F6) is the pure shots-spent mapping the
 * consume uses; its edge cases are pinned here.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
	decrementQuantity,
	shotsForFireMode,
} from "./ordnance";
import { foundryPorts, resetPorts, setPorts } from "../infrastructure/foundry/ports";

const warnings: Array<[string, Record<string, unknown> | undefined]> = [];
const infos: Array<[string, Record<string, unknown> | undefined]> = [];

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: { localize: (key: string) => key, format: (key: string) => key },
	system: { id: "rogue-trader" },
};

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

afterEach(() => {
	resetPorts();
	warnings.length = 0;
	infos.length = 0;
});

/** A quantity-bearing item that records its patches. */
function itemDoc(quantity: unknown) {
	const patches: Array<Record<string, unknown>> = [];
	const doc = {
		id: "i1",
		name: "Frag Missile",
		system: { quantity },
		update: async (patch: object) => {
			const p = patch as { system?: { quantity?: unknown } };
			if (p.system) Object.assign(doc.system, p.system);
			patches.push(patch as Record<string, unknown>);
		},
		patches,
	};
	return doc;
}

function wirePorts(): void {
	setPorts({
		...foundryPorts,
		notify: {
			...foundryPorts.notify,
			warn: (key: string, vars?: Record<string, unknown>) => {
				warnings.push([key, vars]);
			},
			info: (key: string, vars?: Record<string, unknown>) => {
				infos.push([key, vars]);
			},
		},
	});
}

describe("decrementQuantity (bead 9b95 F1)", () => {
	test("refuse: an empty item warns ROLL.LAUNCHER_UNLOADED and writes nothing", async () => {
		wirePorts();
		const doc = itemDoc(0);
		const result = await decrementQuantity(doc, {
			onEmpty: "refuse",
			weaponName: "Missile Launcher",
		});
		expect(result).toBeNull();
		expect(warnings).toContainEqual([
			"ROLL.LAUNCHER_UNLOADED",
			{ weapon: "Missile Launcher" },
		]);
		expect(doc.patches).toEqual([]);
	});

	test("refuse: a non-finite (corrupt) quantity warns and writes nothing", async () => {
		wirePorts();
		const doc = itemDoc("abc");
		const result = await decrementQuantity(doc, { onEmpty: "refuse" });
		expect(result).toBeNull();
		// No weapon name given: the item's own name fills the warn context.
		expect(warnings).toContainEqual([
			"ROLL.LAUNCHER_UNLOADED",
			{ weapon: "Frag Missile" },
		]);
		expect(doc.patches).toEqual([]);
	});

	test("clamp (the manual chip): an empty item books 0 and still announces", async () => {
		wirePorts();
		const doc = itemDoc(0);
		const result = await decrementQuantity(doc, { onEmpty: "clamp" });
		// Today's manual −1 chip behaviour: Math.max(0, -1) = 0, write + info.
		expect(result).toBe(0);
		expect(doc.patches).toEqual([{ system: { quantity: 0 } }]);
		expect(infos).toEqual([
			["CHAT.AMMO_SPENT", { name: "Frag Missile", quantity: 0 }],
		]);
		expect(warnings).toEqual([]);
	});

	test("clamp: a non-finite (corrupt) quantity is refused SILENTLY, no write", async () => {
		wirePorts();
		const doc = itemDoc("abc");
		const result = await decrementQuantity(doc, { onEmpty: "clamp" });
		expect(result).toBeNull();
		expect(doc.patches).toEqual([]);
		expect(warnings).toEqual([]);
		expect(infos).toEqual([]);
	});

	test("shots > 1 clamps the write at 0 instead of going negative", async () => {
		wirePorts();
		const doc = itemDoc(2);
		const result = await decrementQuantity(doc, {
			onEmpty: "refuse",
			shots: 3,
		});
		expect(result).toBe(0);
		expect(doc.patches).toEqual([{ system: { quantity: 0 } }]);
	});
});

describe("shotsForFireMode (bead 9b95 F6)", () => {
	const rof = { singleShot: true, burst: 3, fullAuto: 10 };

	test("single is always one shot", () => {
		expect(shotsForFireMode("single", rof)).toBe(1);
		expect(shotsForFireMode("single", undefined)).toBe(1);
	});

	test("burst / full read the launcher's printed RoF", () => {
		expect(shotsForFireMode("burst", rof)).toBe(3);
		expect(shotsForFireMode("full", rof)).toBe(10);
	});

	test("no mode + single-shot-only launcher = 1 (book-accurate fallback)", () => {
		expect(
			shotsForFireMode(undefined, { singleShot: true, burst: 0, fullAuto: 0 }),
		).toBe(1);
		expect(shotsForFireMode(undefined, undefined)).toBe(1);
	});

	test("no mode + a burst-capable launcher REFUSES (never a silent 1)", () => {
		expect(shotsForFireMode(undefined, rof)).toBeNull();
	});

	test("a mode the launcher's RoF does not print REFUSES", () => {
		expect(
			shotsForFireMode("burst", { singleShot: true, burst: 0, fullAuto: 0 }),
		).toBeNull();
		expect(shotsForFireMode("full", undefined)).toBeNull();
		expect(shotsForFireMode("full", { burst: "–", fullAuto: "–" })).toBeNull();
	});

	test("book string RoF values coerce (the tables print '3'/'10')", () => {
		expect(shotsForFireMode("burst", { burst: "3", fullAuto: "10" })).toBe(3);
		expect(shotsForFireMode("full", { burst: "3", fullAuto: "10" })).toBe(10);
	});
});
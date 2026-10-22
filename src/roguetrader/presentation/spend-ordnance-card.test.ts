/**
 * spendOrdnanceFromCard: the ordnance-spend chip on the damage card (bead
 * 4obp / 9b95, refusal unified by yqa4).
 *
 * The chip spends ONE unit of the fired ordnance through the SHARED
 * decrementQuantity helper. A spend is a WRITE, so the chip asks the write
 * predicate canModify (not the roll predicate canRoll) — the same port path
 * the apply-damage and apply-condition card buttons gate on — and the
 * refusal is LOUD (PERMISSION.NOT_APPLY_OWNER with the item as {actor}),
 * never a silent no-op: the chip was printed with an outcome on it.
 *
 * Refusal pattern follows the sibling suites (apply-damage-card.test.ts /
 * apply-condition-card.test.ts): a Permissions double whose canModify answer
 * — not the document's isOwner — controls the button.
 */
import { afterEach, afterAll, describe, expect, test } from "bun:test";
import type { Ports } from "../../ffg/application/ports";

// Foundry globals stubbed BEFORE the dynamic import (apply-damage-card
// pattern: the import chain reaches classes that destructure foundry at
// module load).
const originalGlobals: Record<string, unknown> = {};
const globals = globalThis as Record<string, unknown>;
for (const key of ["game", "foundry"]) {
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
globals.game = { user: { isGM: true } };

const { getPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { spendOrdnanceFromCard } = await import("./chat-actions");

afterEach(() => {
	resetPorts();
	globals.foundry = {
		...globals.foundry,
		utils: { fromUuidSync: () => null },
	};
	globals.game = { user: { isGM: true } };
});

afterAll(() => {
	for (const key of ["game", "foundry"]) {
		if (originalGlobals[key] === undefined) delete globals[key];
		else globals[key] = originalGlobals[key];
	}
});

/**
 * A fired-ordnance item resolved by the button's data-uuid: quantity-bearing,
 * records the update patches the items port hands it.
 */
function fakeOrdnance(quantity: number) {
	const patches: Array<Record<string, unknown>> = [];
	const doc = {
		id: "o1",
		name: "Frag Missile",
		isOwner: true,
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

/** A chip button: only a data-uuid (the fired item's), no message ancestry. */
function fakeChip(uuid = "Item.o1"): HTMLButtonElement {
	return {
		disabled: false,
		dataset: { uuid },
	} as unknown as HTMLButtonElement;
}

/**
 * Wire the spend path's seams: records warns (refusals) + infos (the
 * CHAT.AMMO_SPENT toast) and forwards item writes through the doc's own
 * update — while capturing whether the button was ALREADY disabled when the
 * write landed (the double-spend guard, pinned below).
 */
function spendPorts() {
	const warns: Array<{ key: string; vars?: unknown }> = [];
	const infos: Array<{ key: string; vars?: unknown }> = [];
	const patches: Array<Record<string, unknown>> = [];
	setPorts({
		...getPorts(),
		notify: {
			...getPorts().notify,
			info: (key: string, vars?: Record<string, unknown>) => {
				infos.push({ key, vars });
			},
			warn: (key: string, vars?: unknown) => {
				warns.push({ key, vars });
			},
		},
		items: {
			update: async (item: unknown, patch: Record<string, unknown>) => {
				patches.push(patch);
				await (item as { update(patch: object): Promise<void> }).update(
					patch,
				);
			},
		} satisfies Ports["items"],
	});
	return { warns, infos, patches };
}

describe("spendOrdnanceFromCard (the damage card's ordnance chip)", () => {
	test("a non-owner's spend is refused LOUDLY through the write predicate — quantity untouched", async () => {
		// Permissions double: canModify false controls the button even though
		// the document itself says isOwner true — the port is the ONE
		// ownership answer (same posture as the apply-damage/condition
		// suites' doubles).
		setPorts({
			...getPorts(),
			permissions: { canRoll: () => true, canModify: () => false },
		});
		const ordnance = fakeOrdnance(3);
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => ordnance },
		};
		const button = fakeChip();
		const { warns, infos } = spendPorts();

		await spendOrdnanceFromCard(button);

		// bead yqa4: a no-op whose button carries an outcome is explained —
		// with the APPLY refusal copy, the item as {actor}, not the roll one.
		expect(warns).toEqual([
			{ key: "PERMISSION.NOT_APPLY_OWNER", vars: { "actor": "Frag Missile" } },
		]);
		// No write ran: the quantity stays parked, no spend toast.
		expect(ordnance.patches).toEqual([]);
		expect(infos).toEqual([]);
		// The refusal returns BEFORE the disable: a later owner-facing click
		// still works (the refusal does not brick the chip).
		expect(button.disabled).toBe(false);
	});

	test("owner path spends one unit, and the write always lands with the chip already disabled (double-spend guard)", async () => {
		setPorts({
			...getPorts(),
			permissions: { canRoll: () => true, canModify: () => true },
		});
		const ordnance = fakeOrdnance(3);
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => ordnance },
		};
		const button = fakeChip();
		const { warns, infos } = spendPorts();

		await spendOrdnanceFromCard(button);

		// The shared helper wrote 3 -> 2 through the items port and announced
		// the spend (the happy path, previously untested for the chip).
		expect(ordnance.patches).toEqual([{ system: { quantity: 2 } }]);
		expect(infos).toEqual([
			{
				key: "CHAT.AMMO_SPENT",
				vars: { name: "Frag Missile", quantity: 2 },
			},
		]);
		expect(warns).toEqual([]);
		// Disable-before-write: the chip is already disabled by the time the
		// decrement is awaited, so a second click while the write is in
		// flight cannot double-spend (a resolved button cannot originate a
		// real DOM click — the sibling suites' posture).
		expect(button.disabled).toBe(true);
	});
});
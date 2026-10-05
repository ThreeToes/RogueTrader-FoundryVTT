/**
 * rollDamageButton retryable-failure contract (bead pk1j, owner ruling
 * 2026-10-04): a failed damage roll must NOT dead-end the card. Before the
 * fix the button was disabled synchronously and never re-enabled on a throw,
 * while the rolled marker was only persisted on success — a re-render then
 * re-armed a button whose pipeline threw forever. Now:
 *
 * - failure → button RE-ENABLED, rolled flag NOT persisted, the error is
 *   surfaced (console.error + a visible notify.warn CHAT.DAMAGE_ROLL_FAIL);
 * - success → unchanged invariants: rolled: true persisted, button stays
 *   resolved (disabled);
 * - an already-rolled flag still short-circuits the guard.
 */
import { afterEach, afterAll, describe, expect, test } from "bun:test";

// Foundry globals stubbed BEFORE the dynamic import (chat-doc-open pattern):
// the import chain reaches classes that destructure foundry at module load.
const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "foundry", "warn", "error"]) {
	originalGlobals[key] =
		key === "warn" || key === "error"
			? console[key]
			: (globalThis as Record<string, unknown>)[key];
}
const globals = globalThis as Record<string, unknown>;
interface FoundryStub {
	documents: { ChatMessage: { get: () => unknown } };
	utils: { fromUuidSync: () => unknown };
}
const fnd = () => globals.foundry as FoundryStub;
globals.foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
	documents: {
		ChatMessage: { get: () => undefined },
	},
	utils: { fromUuidSync: () => null },
};

const { getPorts, resetPorts, setPorts } = await import(
	"../infrastructure/foundry/ports"
);
const { rollDamageButton } = await import("./chat-actions");

const NAMESPACE = "rogue-trader";

/** A flag-carrying fake message: records update() payloads. */
function fakeMessage(
	flag: Record<string, unknown> | undefined,
	update?: (u: object) => Promise<void>,
) {
	const updates: object[] = [];
	return {
		message: {
			flags: { [NAMESPACE]: { damageRoll: flag } },
			update: async (u: object) => {
				updates.push(u);
				await update?.(u);
			},
		} as unknown as {
			flags: Record<string, Record<string, unknown>>;
			update: (u: object) => Promise<void>;
		},
		updates,
	};
}

/** A message element wrapper carrying the message id (dataset.messageId). */
function fakeButton(
	messageId?: string,
	disabled = false,
): HTMLButtonElement {
	return {
		disabled,
		closest: () =>
			messageId === undefined ? undefined : { dataset: { messageId } },
	} as unknown as HTMLButtonElement;
}

/** Capture notify.warn + console.error (the loud-fail observability seams). */
function captureObservability(): Array<Record<string, unknown>> {
	const captured: Array<Record<string, unknown>> = [];
	setPorts({
		...getPorts(),
		notify: {
			...getPorts().notify,
			warn: (key: string, vars?: unknown) => {
				captured.push({ level: "warn", key, vars });
			},
		},
	});
	return captured;
}

afterEach(() => {
	resetPorts();
	// Reset the two mutable stub points the tests swap out.
	fnd().documents.ChatMessage.get = () => undefined;
	fnd().utils.fromUuidSync = () => null;
	console.error = originalGlobals.error as typeof console.error;
});

afterAll(() => {
	for (const key of ["game", "foundry"]) {
		if (originalGlobals[key] === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = originalGlobals[key];
	}
	console.warn = originalGlobals.warn as typeof console.warn;
	console.error = originalGlobals.error as typeof console.error;
});

describe("rollDamageButton (bead pk1j retryable failure)", () => {
	test("failure: button re-enabled, rolled flag NOT persisted, error surfaced", async () => {
		const { message, updates } = fakeMessage({
			attackerUuid: "Actor.boom",
		});
		fnd().documents.ChatMessage.get = () => message;
		// The adapter pipeline throws (simulating the unresolvable-doc /
		// failed-write class of failure through the uuid boundary).
		fnd().utils.fromUuidSync = () => {
			throw new Error("uuid backend died");
		};
		const notifications = captureObservability();
		const errors: string[] = [];
		console.error = (m: unknown) => {
			errors.push(String(m));
		};
		const button = fakeButton("msg1");
		await rollDamageButton(button);
		expect(button.disabled).toBe(false);
		expect(updates).toEqual([]); // rolled: true was NEVER persisted
		expect(notifications).toEqual([{ level: "warn", key: "CHAT.DAMAGE_ROLL_FAIL" }]);
		expect(errors.some((e) => e.includes("damage roll failed"))).toBe(true);
	});

	test("a failing flag write takes the same retryable path (rolled not persisted)", async () => {
		const { message } = fakeMessage({ attackerUuid: undefined }, async () => {
			throw new Error("flag write refused");
		});
		fnd().documents.ChatMessage.get = () => message;
		const notifications = captureObservability();
		const button = fakeButton("msg1");
		await rollDamageButton(button);
		expect(button.disabled).toBe(false);
		expect(notifications[0]!.key).toBe("CHAT.DAMAGE_ROLL_FAIL");
	});

	test("success (unchanged invariants): rolled flag persisted, button stays resolved", async () => {
		const { message, updates } = fakeMessage({
			attackerUuid: "Actor.gone",
			weaponUuid: undefined,
		});
		fnd().documents.ChatMessage.get = () => message;
		// fromUuidSync resolves nothing → the adapter's early return (no throw):
		// the roll pipeline "succeeds" the way an empty-fallback flag does.
		const notifications = captureObservability();
		const button = fakeButton("msg1");
		await rollDamageButton(button);
		expect(updates).toHaveLength(1);
		expect(
			(updates[0] as { flags: Record<string, Record<string, unknown>> }).flags[
				NAMESPACE
			].damageRoll,
		).toEqual({ attackerUuid: "Actor.gone", weaponUuid: undefined, rolled: true });
		// Success keeps the button resolved (disabled — no second roll).
		expect(button.disabled).toBe(true);
		expect(notifications).toEqual([]);
	});

	test("an already-rolled flag short-circuits (no update, no throw)", async () => {
		const { message, updates } = fakeMessage({ rolled: true });
		fnd().documents.ChatMessage.get = () => message;
		const button = fakeButton("msg1");
		await rollDamageButton(button);
		expect(updates).toEqual([]);
		expect(button.disabled).toBe(false); // untouched guard: not even disabled
	});
});
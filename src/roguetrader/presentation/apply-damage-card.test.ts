/**
 * applyDamageFromCard branch logic (bead t2ei):
 *
 * Before the fix the guard was `if (!message || !data || data.applied)` — an
 * ALREADY-applied card fell into the LEGACY fallback branch (button-dataset
 * wounds), so a second click on a re-rendered card subtracted the same wounds
 * a second time and re-rolled critical severity. Now the cases are split:
 *
 * - `!message || !data` → legacy fallback (button dataset), for pre-flag cards;
 * - `data.applied` → silent early return, NOTHING applies again;
 * - otherwise the normal flagged apply path runs.
 *
 * A resolved (disabled) button also short-circuits before anything happens,
 * matching applyConditionFromCard.
 */
import { afterEach, afterAll, describe, expect, test } from "bun:test";
import type { Ports } from "../../ffg/application/ports";

// Foundry globals stubbed BEFORE the dynamic import (damage-roll-button
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
const { applyDamageFromCard } = await import("./chat-actions");

const NAMESPACE = "rogue-trader";

/** A victim actor: records the update payloads handed to actor.update. */
function fakeVictim(startingWounds = 5) {
	const updates: Array<Record<string, unknown>> = [];
	return {
		actor: {
			system: { wounds: { value: startingWounds, max: 10 } },
			isOwner: true,
			update: async (data: object) => {
				updates.push(data as Record<string, unknown>);
			},
		},
		updates,
	};
}

interface FakeMessage {
	messageEl: { dataset: { messageId: string } };
	message: {
		flags: Record<string, Record<string, unknown>>;
		update: (u: object) => Promise<void>;
	};
	updates: object[];
}

/**
 * A flag-carrying fake chat message (damageApply): update() merges the flag
 * write back so a re-read sees applied: true — the shape a RE-RENDERED
 * message actually carries.
 */
function fakeMessage(damageApply: Record<string, unknown>): FakeMessage {
	const updates: object[] = [];
	const message: FakeMessage["message"] = {
		flags: { [NAMESPACE]: { damageApply: { ...damageApply } } },
		update: async (u: object) => {
			updates.push(u);
			const payload = (
				(u as { flags: Record<string, Record<string, unknown>> }).flags[
					NAMESPACE
				] as { damageApply: Record<string, unknown> }
			).damageApply;
			message.flags[NAMESPACE].damageApply = {
				...message.flags[NAMESPACE].damageApply,
				...payload,
			};
		},
	};
	const messageEl: FakeMessage["messageEl"] = {
		dataset: { messageId: "msg1" },
	};
	return { messageEl, message, updates };
}

/**
 * Point the stubs at a message (or nothing — the button's .message ancestry
 * resolves through this handle; undefined = no message element at all).
 */
let harness: { messageEl?: FakeMessage["messageEl"]; message?: FakeMessage["message"] } = {};

/** A button stub: .message ancestry + dataset + disabled state. */
function fakeButton(
	data: { target?: string; wounds?: string } = {},
	disabled = false,
): HTMLButtonElement {
	return {
		disabled,
		closest: () => harness.messageEl ?? undefined,
		dataset: { ...data },
	} as unknown as HTMLButtonElement & { dataset: Record<string, string | undefined> };
}

afterEach(() => {
	resetPorts();
	globals.foundry = {
		...globals.foundry,
		documents: { ChatMessage: { get: () => undefined } },
		utils: { fromUuidSync: () => null },
	};
	globals.game = { user: { isGM: true } };
	harness = {};
});

afterAll(() => {
	for (const key of ["game", "foundry"]) {
		if (originalGlobals[key] === undefined) delete globals[key];
		else globals[key] = originalGlobals[key];
	}
});

/** Wire the ports seams + ChatMessage.get, and count the effective applies. */
function captures(): {
	appliedToasts: string[];
	chatPosts: Array<{ template: string }>;
} {
	const appliedToasts: string[] = [];
	const chatPosts: Array<{ template: string }> = [];
	setPorts({
		...getPorts(),
		notify: {
			...getPorts().notify,
			info: (key: string) => {
				appliedToasts.push(key);
			},
		},
		chat: {
			...getPorts().chat,
			post: async (
				_actor: unknown,
				template: string,
				_vars: Record<string, unknown>,
			) => {
				chatPosts.push({ template });
				return { id: "crit-1" };
			},
		} as unknown as Ports["chat"],
	});
	return { appliedToasts, chatPosts };
}

describe("applyDamageFromCard (bead t2ei double-apply)", () => {
	test("an ALREADY-applied card returns early: no wounds, no updates, no card", async () => {
		const victim = fakeVictim();
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => victim.actor },
		};
		const wire = fakeMessage({
			wounds: 5,
			targetUuid: "Actor.victim",
			applied: true,
		});
		harness = { messageEl: wire.messageEl, message: wire.message };
		globals.foundry = {
			...globals.foundry,
			documents: { ChatMessage: { get: () => wire.message } },
		};
		const counted = captures();
		// Re-rendered messages re-arm the button; the applied flag (not the
		// button state) must gate this.
		await applyDamageFromCard(
			fakeButton({ target: "Actor.victim", wounds: "5" }),
		);
		expect(victim.updates).toEqual([]); // wounds UNTOUCHED
		// No critical card re-posted, no applied toast: nothing ran at all.
		expect(counted.chatPosts).toEqual([]);
		expect(counted.appliedToasts).toHaveLength(0);
	});

	test("second click on a re-rendered card changes NOTHING (apply once, flag then gates)", async () => {
		const victim = fakeVictim();
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => victim.actor },
		};
		const wire = fakeMessage({
			wounds: 5,
			targetUuid: "Actor.victim",
			applied: false,
			damageType: "Impact",
			location: "body",
		});
		harness = { messageEl: wire.messageEl, message: wire.message };
		globals.foundry = {
			...globals.foundry,
			documents: { ChatMessage: { get: () => wire.message } },
		};
		const counted = captures();
		await applyDamageFromCard(
			fakeButton({ target: "Actor.victim", wounds: "5" }),
		);
		expect(victim.updates).toEqual([
			{ system: { wounds: { value: 0 } } },
		]); // applied exactly once...
		expect(wire.updates).toHaveLength(1); // ...flag stamped applied: true
		expect(
			(wire.updates[0] as { flags: Record<string, Record<string, unknown>> })
				.flags[NAMESPACE].damageApply,
		).toMatchObject({ applied: true, wounds: 5 });
		// Re-render arms a fresh enabled button over the SAME (now-applied)
		// message flags — the real double-apply path from the bead report.
		await applyDamageFromCard(
			fakeButton({ target: "Actor.victim", wounds: "5" }),
		);
		expect(victim.updates).toEqual([
			{ system: { wounds: { value: 0 } } },
		]); // ...and NOT twice
		expect(counted.appliedToasts).toHaveLength(1);
	});

	test("a legacy card without the flag still applies via the button-dataset fallback", async () => {
		const victim = fakeVictim();
		globals.foundry = {
			...globals.foundry,
			utils: { fromUuidSync: () => victim.actor },
		};
		const counted = captures();
		// No message element → no message, no flag: pre-flag-card fallback.
		await applyDamageFromCard(
			fakeButton({ target: "Actor.victim", wounds: "5" }),
		);
		// The fallback apply is fire-and-forget; flush it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(victim.updates).toEqual([
			{ system: { wounds: { value: 0 } } },
		]);
		expect(counted.appliedToasts).toHaveLength(1);
	});

	test("a disabled button short-circuits before anything runs", async () => {
		const victim = fakeVictim();
		let resolved = 0;
		globals.foundry = {
			...globals.foundry,
			utils: {
				fromUuidSync: () => {
					resolved += 1;
					return victim.actor;
				},
			},
		};
		const counted = captures();
		await applyDamageFromCard(
			fakeButton({ target: "Actor.victim", wounds: "5" }, true),
		);
		expect(resolved).toBe(0); // not even the uuid boundary ran
		expect(counted.appliedToasts).toHaveLength(0);
	});

	describe("applyDamageFromCard ownership gate (bead eolv)", () => {
		/** Wire a warn-capturing notify WITHOUT touching permissions. */
		function warnCapture(): { warns: Array<{ key: string; vars?: unknown }> } {
			const warns: Array<{ key: string; vars?: unknown }> = [];
			setPorts({
				...getPorts(),
				notify: {
					...getPorts().notify,
					warn: (key: string, vars?: unknown) => {
						warns.push({ key, vars });
					},
				},
			});
			return { warns };
		}

		test("a non-owner click applies NOTHING and warns LOUDLY (was a silent no-op)", async () => {
			const victim = fakeVictim();
			victim.actor.isOwner = false;
			globals.foundry = {
				...globals.foundry,
				utils: { fromUuidSync: () => victim.actor },
			};
			const { warns } = warnCapture();
			await applyDamageFromCard(
				fakeButton({ target: "Actor.victim", wounds: "5" }),
			);
			expect(victim.updates).toEqual([]); // wounds UNTOUCHED
			// bead eolv: the refusal used to be silent, answering a different
			// access rule per entry point — now it matches the roll pipeline's
			// loud warn.
			expect(warns).toEqual([
				{ key: "ROLL.NOT_OWNER", vars: { "actor": "Actor.victim" } },
			]);
		});

		test("the Permissions port double controls the button (canModify)", async () => {
			const victim = fakeVictim();
			globals.foundry = {
				...globals.foundry,
				utils: { fromUuidSync: () => victim.actor },
			};
			const warns: string[] = [];
			setPorts({
				...getPorts(),
				permissions: {
					canRoll: () => true,
					canModify: () => false, // the double's refusal, not isOwner's
				},
				notify: {
					...getPorts().notify,
					warn: (key: string) => {
						warns.push(key);
					},
				},
			});
			await applyDamageFromCard(
				fakeButton({ target: "Actor.victim", wounds: "5" }),
			);
			expect(victim.updates).toEqual([]);
			expect(warns).toContain("ROLL.NOT_OWNER");
		});
	});
});
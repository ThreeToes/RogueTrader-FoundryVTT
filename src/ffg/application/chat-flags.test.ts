/**
 * The FFG-generic chat-flag machinery (bead p7jv): the namespace is profile
 * data resolved through the config port, not a hardcoded string.
 */
import { describe, expect, it } from "bun:test";
import { messageFlagNamespace, postCard, readMessageFlag } from "./chat-flags";
import type { Ports } from "./ports";

/** Minimal fake ports: only config.profile() and nothing else is touched. */
function fakePorts(profile: { messageFlagNamespace: string }): Ports {
	return {
		config: { profile: () => profile },
	} as unknown as Ports;
}

describe("chat-flags (ffg application)", () => {
	it("resolves the flag namespace from the config port's profile", () => {
		expect(
			messageFlagNamespace(fakePorts({ messageFlagNamespace: "dh2" })),
		).toBe("dh2");
	});

	it("reads a flag under the ACTIVE system's namespace", () => {
		const ports = fakePorts({ messageFlagNamespace: "dh2" });
		const message = {
			flags: { dh2: { damageRoll: { hitRoll: 42 } } },
		};
		expect(readMessageFlag(ports, message, "damageRoll")).toEqual({
			hitRoll: 42,
		});
		// A foreign namespace (e.g. rogue-trader cards in a DH2 world) is not read.
		const rtMessage = {
			flags: { "rogue-trader": { damageRoll: { hitRoll: 1 } } },
		};
		expect(readMessageFlag(ports, rtMessage, "damageRoll")).toBeUndefined();
	});

	it("tolerates an absent message", () => {
		const ports = fakePorts({ messageFlagNamespace: "rogue-trader" });
		expect(readMessageFlag(ports, undefined, "damageApply")).toBeUndefined();
	});

	// Bead wvkd: Dice So Nice! only animates a chat message that CARRIES rolls
	// (core's ChatMessage#isRoll is `this.rolls.length > 0`), so postCard is the
	// seam where the dice port's evaluated Roll has to survive.
	describe("postCard threads the evaluated rolls to the chat port", () => {
		/** Every argument the chat port received, so `rolls` can be read back. */
		const posts: unknown[][] = [];
		const ports = {
			config: { profile: () => ({ messageFlagNamespace: "rogue-trader" }) },
			chat: {
				post: async (...args: unknown[]) => {
					posts.push(args);
					return { id: "msg-1" };
				},
			},
		} as unknown as Ports;

		it("passes the dice port's rolls through as the last argument", async () => {
			posts.length = 0;
			// Opaque on purpose: the application layer may only CARRY it.
			const rolls: readonly unknown[] = [{ formula: "1d100" }];
			await postCard(
				ports,
				{ uuid: "Actor.1" },
				"template/chat/roll.hbs",
				{ roll: 42 },
				{ "rogue-trader": { damageRoll: { hitRoll: 42 } } },
				rolls,
			);
			expect(posts).toHaveLength(1);
			// (actor, template, vars, flags, rolls) — the chat port's order.
			expect(posts[0]).toHaveLength(5);
			expect(posts[0][1]).toBe("template/chat/roll.hbs");
			expect(posts[0][3]).toEqual({
				"rogue-trader": { damageRoll: { hitRoll: 42 } },
			});
			expect(posts[0][4]).toBe(rolls);
		});

		it("leaves rolls absent for a card with no dice to animate", async () => {
			posts.length = 0;
			await postCard(ports, { uuid: "Actor.1" }, "template/chat/roll.hbs", {});
			expect(posts).toHaveLength(1);
			// No throw, no invented `rolls`: the message stays roll-less.
			expect(posts[0][4]).toBeUndefined();
		});
	});
});

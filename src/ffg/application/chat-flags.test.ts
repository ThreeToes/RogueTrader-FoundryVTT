/**
 * The FFG-generic chat-flag machinery (bead p7jv): the namespace is profile
 * data resolved through the config port, not a hardcoded string.
 */
import { describe, expect, it } from "bun:test";
/** A full sibling profile, retagged: keeps the fake a real ConfigProfile. */
import { rtCore } from "../domain/system-profile";
import { messageFlagNamespace, postCard, readMessageFlag } from "./chat-flags";
import type { Chat, ConfigPort } from "./ports";

/** Minimal fake config port: only profile() is touched. */
function fakeConfig(profile: { messageFlagNamespace: string }): ConfigPort {
	return {
		homebrew: () => null,
		originTraits: () => [],
		packIds: () => ({ rolltables: null }),
		profile: () => ({
			...rtCore,
			messageFlagNamespace: profile.messageFlagNamespace,
		}),
	};
}

describe("chat-flags (ffg application)", () => {
	it("resolves the flag namespace from the config port's profile", () => {
		expect(
			messageFlagNamespace(fakeConfig({ messageFlagNamespace: "dh2" })),
		).toBe("dh2");
	});

	it("reads a flag under the ACTIVE system's namespace", () => {
		const config = fakeConfig({ messageFlagNamespace: "dh2" });
		const message = {
			flags: { dh2: { damageRoll: { hitRoll: 42 } } },
		};
		expect(readMessageFlag(config, message, "damageRoll")).toEqual({
			hitRoll: 42,
		});
		// A foreign namespace (e.g. rogue-trader cards in a DH2 world) is not read.
		const rtMessage = {
			flags: { "rogue-trader": { damageRoll: { hitRoll: 1 } } },
		};
		expect(readMessageFlag(config, rtMessage, "damageRoll")).toBeUndefined();
	});

	it("tolerates an absent message", () => {
		const config = fakeConfig({ messageFlagNamespace: "rogue-trader" });
		expect(readMessageFlag(config, undefined, "damageApply")).toBeUndefined();
	});

	// Bead wvkd: Dice So Nice! only animates a chat message that CARRIES rolls
	// (core's ChatMessage#isRoll is `this.rolls.length > 0`), so postCard is the
	// seam where the dice port's evaluated Roll has to survive.
	//
	// Narrow port (foundryvtt-rogue-trader-hprt): postCard now takes the Chat
	// port alone, so the fake needs no `as unknown as Ports` cast.
	describe("postCard threads the evaluated rolls to the chat port", () => {
		/** Every argument the chat port received, so `rolls` can be read back. */
		const posts: unknown[][] = [];
		const chat: Chat = {
			post: async (...args: unknown[]) => {
				posts.push(args);
				return { id: "msg-1" };
			},
			postHtml: async () => undefined,
			update: async () => undefined,
		};

		it("passes the dice port's rolls through as the last argument", async () => {
			posts.length = 0;
			// Opaque on purpose: the application layer may only CARRY it.
			const rolls: readonly unknown[] = [{ formula: "1d100" }];
			await postCard(
				chat,
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
			await postCard(chat, { uuid: "Actor.1" }, "template/chat/roll.hbs", {});
			expect(posts).toHaveLength(1);
			// No throw, no invented `rolls`: the message stays roll-less.
			expect(posts[0][4]).toBeUndefined();
		});
	});
});

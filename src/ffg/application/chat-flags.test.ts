/**
 * The FFG-generic chat-flag machinery (bead p7jv): the namespace is profile
 * data resolved through the config port, not a hardcoded string.
 */
import { describe, expect, it } from "bun:test";
import {
	messageFlagNamespace,
	readMessageFlag,
} from "./chat-flags";
import type { Ports } from "./ports";

/** Minimal fake ports: only config.profile() and nothing else is touched. */
function fakePorts(profile: { messageFlagNamespace: string }): Ports {
	return {
		config: { profile: () => profile },
	} as unknown as Ports;
}

describe("chat-flags (ffg application)", () => {
	it("resolves the flag namespace from the config port's profile", () => {
		expect(messageFlagNamespace(fakePorts({ messageFlagNamespace: "dh2" }))).toBe(
			"dh2",
		);
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
});
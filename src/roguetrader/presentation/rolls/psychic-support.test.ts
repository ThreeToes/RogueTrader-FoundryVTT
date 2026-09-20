/**
 * Psychic support through the ports (epic kof0, beads xkad + nkwa).
 *
 * The regression these pin: rollPhenomena used to call `foundryContent`
 * directly instead of the ContentPort, so swapping in a fake (or
 * NO_CONTENT_PORT) had no effect on Psychic Phenomena and the
 * content-optional path was untestable here. The third case asserts the port
 * is actually consulted, which is the part the other two cannot prove.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { ContentPort } from "../../application/ports";
import { NO_CONTENT_PORT } from "../../application/ports";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../../infrastructure/foundry/ports";
import { rollPhenomena } from "./psychic-support";

const cards: string[] = [];

afterEach(() => {
	resetPorts();
	cards.length = 0;
});

/** A port set whose dice always roll 42 and whose chat records the card. */
function portsWith(find: ContentPort["find"]) {
	return {
		...foundryPorts,
		dice: {
			roll: async (formula: string) => ({
				total: 42,
				dice: [{ result: 42, faces: 100 }],
				terms: [{ class: "Die", faces: 100, results: [42] }],
				formula,
			}),
		},
		chat: {
			...foundryPorts.chat,
			postHtml: async (
				_actor: { uuid?: string },
				content: string,
			): Promise<{ id?: string }> => {
				cards.push(content);
				return { id: "msg-phenomena" };
			},
		},
		// Echo keys so the assertions can see which string was used.
		i18n: { t: (key: string) => key },
		content: { ...NO_CONTENT_PORT, find },
	};
}

describe("rollPhenomena reads the table through the content port (bead xkad)", () => {
	test("a missing table still posts the roll plus the manual-apply note", async () => {
		setPorts(portsWith(async () => null));
		await rollPhenomena({ name: "Psyker" } as never, {});
		expect(cards).toHaveLength(1);
		// Content-optional: the card is never empty and never silent.
		expect(cards[0]).toContain("PSYCHIC_POWER.TABLE_MISS");
		expect(cards[0]).toContain("42");
	});

	test("an installed table supplies the result text", async () => {
		setPorts(
			portsWith(async () => ({
				name: "Psychic Phenomena",
				results: [{ text: "The air screams.", range: [1, 100] }],
			})),
		);
		await rollPhenomena({ name: "Psyker" } as never, {});
		expect(cards).toHaveLength(1);
		expect(cards[0]).toContain("The air screams.");
		expect(cards[0]).not.toContain("PSYCHIC_POWER.TABLE_MISS");
	});

	test("the injected content port is actually consulted", async () => {
		const asked: string[] = [];
		setPorts(
			portsWith(async (pack, name) => {
				asked.push(`${pack}/${name}`);
				return null;
			}),
		);
		await rollPhenomena({ name: "Psyker" } as never, {});
		// Exactly one lookup, through the port (the old code called
		// foundryContent and this array would have stayed empty).
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain("rogue-trader.rolltables");
	});
});

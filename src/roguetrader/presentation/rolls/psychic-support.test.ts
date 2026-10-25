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
import type { ContentPort } from "../../../ffg/application/ports";
import { NO_CONTENT_PORT } from "../../../ffg/application/ports";
import {
	foundryPorts,
	resetPorts,
	setPorts,
} from "../../infrastructure/foundry/ports";
import {
	applyPowerCorruption,
	postPowerDamage,
	rollPhenomena,
} from "./psychic-support";
import { actorFixture } from "../../../test-helpers/actor-fixture";

const cards: string[] = [];
const varsOf: Array<Record<string, unknown>> = [];

/**
 * The caster: the shared actor fixture (an owned document). These paths only
 * write through the ports' fakes, so the document itself stays non-writable.
 */
const psyker = () => actorFixture({ name: "Psyker" });

afterEach(() => {
	resetPorts();
	cards.length = 0;
	varsOf.length = 0;
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
			// Bead oy8z: the cards post through the shared postCard template
			// path now, so record post(template, vars) instead of raw HTML.
			post: async (
				_actor: { uuid?: string },
				template: string,
				vars: Record<string, unknown>,
			): Promise<{ id?: string }> => {
				cards.push(template);
				varsOf.push(vars);
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
		await rollPhenomena(psyker(), {});
		expect(cards).toHaveLength(1);
		// Bead oy8z: the card renders from the postCard template path.
		expect(cards[0]).toContain("psychic-phenomena.hbs");
		// Content-optional: the card is never empty and never silent.
		expect(varsOf[0].text).toBe("PSYCHIC_POWER.TABLE_MISS");
		expect(varsOf[0].total).toBe(42);
	});

	test("an installed table supplies the result text", async () => {
		setPorts(
			portsWith(async () => ({
				name: "Psychic Phenomena",
				results: [{ text: "The air screams.", range: [1, 100] }],
			})),
		);
		await rollPhenomena(psyker(), {});
		expect(cards).toHaveLength(1);
		// The pack's table prose is passed as DATA (template-escaped), not
		// interpolated into hand-built HTML (bead oy8z).
		expect(varsOf[0].text).toBe("The air screams.");
		expect(varsOf[0].total).toBe(42);
	});

	test("the injected content port is actually consulted", async () => {
		const asked: string[] = [];
		setPorts(
			portsWith(async (pack, name) => {
				asked.push(`${pack}/${name}`);
				return null;
			}),
		);
		await rollPhenomena(psyker(), {});
		// Exactly one lookup, through the port (the old code called
		// foundryContent and this array would have stayed empty).
		expect(asked).toHaveLength(1);
		expect(asked[0]).toContain("rogue-trader.rolltables");
	});
});

describe("postPowerDamage + applyPowerCorruption post template cards (bead oy8z)", () => {
	test("the damage card posts the expression and total as template vars", async () => {
		setPorts(portsWith(async () => null));
		await postPowerDamage(psyker(), "Fire Bolt", "1d10+4");
		expect(cards).toHaveLength(1);
		expect(cards[0]).toContain("psychic-damage.hbs");
		expect(varsOf[0].label).toBe("PSYCHIC_POWER.DAMAGE_ROLL");
		// The authored expression and item-derived label are DATA — the
		// template escapes them; this test pins that nothing raw reaches chat
		// as markup.
		expect(varsOf[0].damage).toBe("1d10+4");
		expect(varsOf[0].total).toBe(42);
	});

	test("the corruption card posts the gain as template vars", async () => {
		const updates: unknown[] = [];
		setPorts({
			...portsWith(async () => null),
			actors: {
				...foundryPorts.actors,
				update: async (_actor: unknown, data: unknown) => {
					updates.push(data);
				},
			},
		});
		await applyPowerCorruption(
			psyker(),
			{
				name: "Summon Daemon",
				system: { effects: [{ kind: "corruption", dice: "1d10+4" }] },
			} as never,
		);
		expect(cards).toHaveLength(1);
		expect(cards[0]).toContain("psychic-corruption.hbs");
		expect(varsOf[0].label).toBe("PSYCHIC_POWER.CORRUPTION_GAIN");
		expect(varsOf[0].gained).toBe(42);
		// The track was actually adjusted, not just posted.
		expect(updates).toEqual([{ "system.corruption": 42 }]);
	});

	test("no corruption effects, no card", async () => {
		setPorts(portsWith(async () => null));
		await applyPowerCorruption(psyker(), {
			name: "Fire Bolt",
			system: { effects: [] },
		} as never);
		expect(cards).toHaveLength(0);
	});
});

/**
 * The NEUTRAL Foundry config port (bead w9sa.8, audit finding A1).
 *
 * `ConfigPort.profile()` used to be typed on Rogue Trader's own `SystemProfile`,
 * which meant a sibling system's profile could not be returned through the
 * shared port at all — the biggest fork risk the w9sa.5 audit found. The port is
 * now the kernel `RuleProfile` plus OPTIONAL system branding, so this file pins
 * both halves of the contract:
 *
 *  • the NEUTRAL default still resolves the shared default profile (RT is
 *    byte-identical), and
 *  • a `dh2Core`-shaped KERNEL + BRANDING object — one carrying none of RT's
 *    creation/advancement constants — rides the `setConfigOverrides` seam and is
 *    readable by every consumer that only touches kernel fields.
 *
 * The Foundry globals are stubbed before the dynamic import because the ports
 * module touches the Foundry implementation set at load.
 */

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string, _vars?: Record<string, unknown>) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};
(globalThis as Record<string, unknown>).foundry = {};

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { locationForHit, resolveTest } from "../../../rules-engine/index";
import { messageFlagNamespace, postCard } from "../../application/chat-flags";
import type { ConfigProfile, DiceResult, Ports } from "../../application/ports";
import { dh2Core } from "../../domain/system-profile-dark-heresy";
import { DEFAULT_SYSTEM_PROFILE } from "../../domain/system-profile";

afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

/**
 * A sibling system's profile as the widened port accepts it: `dh2Core`'s
 * KERNEL-readable values plus its own branding — and NOT ONE of RT's
 * creation/advancement constants (`characteristicBase`, `pointBuyBudget`,
 * `fireModeBonus`, `pushCap`, `untrainedSkill`, `eliteAdvanceBaseCost`, ...),
 * which is precisely the shape the old `profile(): SystemProfile` refused.
 *
 * The four rule fields are written as literals rather than read off `dh2Core`
 * because `DarkHeresyProfile` deliberately types them `T | undefined`
 * (`system-profile-dark-heresy.ts`'s `Omit<RuleProfile, ...>` + `| undefined`
 * re-declarations) to pin what the book verifies. `dh2KernelMatchesDh2Core`
 * below asserts every literal equals the sibling's own value, so this fixture
 * cannot drift from it.
 *
 * `satisfies ConfigProfile` is the type-level half of the proof. A test file
 * sits outside both tsconfigs so bun strips it, but the annotation documents
 * (and would enforce) that the shape is assignable.
 */
const dh2KernelProfile = {
	// Printed p22: nothing about doubles — character Criticals come from damage
	// exceeding wounds (p232). RT, by contrast, IS crit-on-double.
	critOnDouble: false,
	// Printed p22: "if the result is 100, then the test automatically fails".
	autoFailRoll: 100,
	// Printed p22: "if the result of the percentile roll is 1, the test
	// automatically succeeds". DH1's remembered 01-05 does NOT apply.
	autoPassRoll: 1,
	// VERIFIED ABSENT (printed p227): Step Five subtracts Toughness bonus plus
	// Armour points; "Primitive (X)" is a WEAPON quality (p148), not an armour
	// rule.
	primitiveArmourDouble: false,
	righteousFury: dh2Core.righteousFury,
	// Table 7-3, printed p226: identical bands to RT's Table 9-6, read on the
	// reversed digits of the roll.
	hitLocations: dh2Core.hitLocations,
	// Ten characteristics, Influence last (printed pp21-22).
	characteristics: dh2Core.characteristics,
	id: dh2Core.id,
	// The sibling's own branding. The template path is the sibling module's to
	// choose — bead w9sa.9 owns deriving a root from the active system id.
	messageFlagNamespace: "dark-heresy-2e",
	rollCardTemplate: "systems/dark-heresy-2e/template/chat/roll.hbs",
} satisfies ConfigProfile;

describe("the neutral config port's profile() (bead w9sa.8)", () => {
	test("the neutral default still resolves the shared default profile", async () => {
		const { foundryPorts } = await import("./ports");
		// RT is byte-identical: the same object the RT shim re-exports.
		expect(foundryPorts.config.profile()).toBe(DEFAULT_SYSTEM_PROFILE);
	});

	test("a kernel + branding profile with NO RT constants rides the override seam", async () => {
		const { foundryPorts, setConfigOverrides } = await import("./ports");
		// `configOverrides` is module-level and has no reset, so a leaked
		// override would retune every suite bun runs afterwards (one process).
		// Clear it on the way out.
		setConfigOverrides({ profile: () => dh2KernelProfile });
		try {
			const profile = foundryPorts.config.profile();
			expect(profile).toBe(dh2KernelProfile);
			expect(profile.id).toBe(dh2Core.id);

			// The fixture IS dh2Core-shaped: every rule field equals the
			// sibling's own verified value (its `| undefined` typing is the
			// pinned hole, not a value we invented here).
			expect(dh2KernelProfile.critOnDouble).toBe(dh2Core.critOnDouble);
			expect(dh2KernelProfile.autoFailRoll).toBe(dh2Core.autoFailRoll);
			expect(dh2KernelProfile.autoPassRoll).toBe(dh2Core.autoPassRoll);
			expect(dh2KernelProfile.primitiveArmourDouble).toBe(
				dh2Core.primitiveArmourDouble,
			);

			// --- kernel consumers: every field-only read resolves ------------
			// The kernel rules resolvers take a RuleProfile and read nothing
			// else, so a sibling profile drives them unchanged.
			// Table 7-3, read on the REVERSED digits of the roll (20 reads as 02).
			expect(locationForHit(20, profile)).toBe("head");
			expect(locationForHit(88, profile)).toBe("left-leg");
			expect(resolveTest({ target: 50, roll: 1, profile }).success).toBe(true);
			// DH2's verified auto-pass band (printed p22: a roll of 1 auto-succeeds)
			// is read THROUGH the kernel, not from an RT default.
			expect(resolveTest({ target: 1, roll: 1, profile }).success).toBe(true);
			// The auto-FAIL band is deliberately NOT asserted here: the kernel's
			// comparison is `roll > autoFailRoll`, so with DH2's verified 100 the
			// band never fires on a d100. That off-by-one is open bead vhfh, not
			// this one's business — asserting it here would pin the bug.

			// --- branding consumers ------------------------------------------
			// The two "the system" fields are the only non-kernel data the
			// shared machinery reads, and they resolve from the sibling's own
			// values rather than a hardcoded RT namespace.
			expect(messageFlagNamespace(foundryPorts)).toBe("dark-heresy-2e");
			expect(profile.rollCardTemplate).toBe(
				"systems/dark-heresy-2e/template/chat/roll.hbs",
			);

			// The rule data RT owns is genuinely ABSENT, not defaulted: the
			// sibling profile does not pretend to carry RT's constants.
			expect("fireModeBonus" in profile).toBe(false);
			expect("characteristicBase" in profile).toBe(false);
			expect("pushCap" in profile).toBe(false);
			expect("eliteAdvanceBaseCost" in profile).toBe(false);
		} finally {
			setConfigOverrides({ profile: undefined });
		}
	});

	test("clearing the override restores the neutral default", async () => {
		const { foundryPorts } = await import("./ports");
		expect(foundryPorts.config.profile()).toBe(DEFAULT_SYSTEM_PROFILE);
	});

	test("a profile with NO branding refuses loudly instead of guessing a namespace", async () => {
		const { foundryPorts, setConfigOverrides } = await import("./ports");
		setConfigOverrides({
			profile: () => ({
				id: "unbranded-core",
				critOnDouble: false,
				autoFailRoll: null,
				autoPassRoll: null,
				primitiveArmourDouble: false,
				righteousFury: { enabled: false, trigger: "damaging-hit" },
				hitLocations: {},
			}),
		});
		try {
			// The KERNEL half of the widened contract still works fine: branding
			// is optional precisely so a system that has not branded yet can boot.
			expect(foundryPorts.config.profile().critOnDouble).toBe(false);
			// The BRANDING half refuses rather than writing chat flags under
			// `undefined` — the silent bug this repo refuses.
			expect(() => messageFlagNamespace(foundryPorts)).toThrow(
				/messageFlagNamespace/,
			);
		} finally {
			setConfigOverrides({ profile: undefined });
		}
	});
});

// --- The chat port's speaker (bead 0fl6) ---------------------------------
//
// The bug: core's ChatMessage.getSpeaker only honours an actor that IS a
// document, so handing it the roll pipeline's ActorView fell through to the
// user's impersonated character — every roll card came out labelled with the
// PLAYER's name and no actor link, so the card's name could not be clicked
// through to the character either.

/** The globals the chat stub swaps in, restored after each test. */
const stubbedGame = (globalThis as Record<string, unknown>).game;
const stubbedFoundry = (globalThis as Record<string, unknown>).foundry;

/** The character being rolled FOR — deliberately NOT the user's own actor. */
const rollingCharacter = {
	id: "actor-lachlan",
	name: "Lachlan",
	uuid: "Actor.actor-lachlan",
	documentName: "Actor",
	getActiveTokens: () => [
		{
			controlled: false,
			// Core's CASE 2 reads the TokenDocument off the PlaceableObject.
			document: {
				id: "tok-lachlan",
				parent: { id: "scene-1" },
				actor: { id: "actor-lachlan" },
			},
		},
	],
};

/** The player's own character: what the pre-fix card was labelled with. */
const impersonatedCharacter = {
	id: "actor-campbell",
	name: "Campbell",
	uuid: "Actor.actor-campbell",
	documentName: "Actor",
	getActiveTokens: () => [],
};

/** The view the roll pipeline builds and hands to the chat port. */
const rollingView = {
	id: "actor-lachlan",
	uuid: "Actor.actor-lachlan",
	name: "Lachlan",
	type: "pc",
};

/** Every ChatMessage.create call the port made, so the speaker can be read. */
const created: Array<{
	speaker: Record<string, unknown>;
	content: string;
	flags?: unknown;
}> = [];

/** Whatever the port handed getSpeaker as the speaking actor. */
let speakerActor: unknown;

/**
 * A stub of core's own decision tree (client/documents/chat-message.mjs:
 * 231-272), close enough to tell the fix from the bug: a DOCUMENT names the
 * card and links it to the actor (CASE 2), while anything else falls through
 * to the impersonated character (CASE 5) and then the user's own name
 * (CASE 6). `documentName` stands in for core's `instanceof Actor`.
 */
function coreGetSpeaker({
	actor,
}: {
	actor?: unknown;
} = {}): Record<string, unknown> {
	speakerActor = actor;
	const documentName = (actor as { documentName?: unknown } | null | undefined)
		?.documentName;
	if (typeof documentName === "string" && documentName.endsWith("Actor")) {
		const doc = actor as {
			id?: string;
			name?: string;
			getActiveTokens?: () => Array<{
				document?: {
					id?: string;
					parent?: { id?: string };
					actor?: { id?: string };
				};
				id?: string;
				parent?: { id?: string };
				actor?: { id?: string };
			}>;
		};
		const alias = doc.name;
		const token = (doc.getActiveTokens?.() ?? []).shift();
		if (token) {
			const tokenDocument = token.document ?? token;
			return {
				scene: tokenDocument.parent?.id ?? null,
				actor: tokenDocument.actor?.id ?? null,
				token: tokenDocument.id ?? null,
				alias,
			};
		}
		return { scene: "scene-1", actor: doc.id ?? null, token: null, alias };
	}
	// CASE 5/6: the user's impersonated character, then the user's own name.
	const user = (
		globalThis as {
			game?: {
				user?: { name: string; character: { id: string; name: string } | null };
			};
		}
	).game?.user;
	if (user?.character) {
		return {
			scene: "scene-1",
			actor: user.character.id,
			token: null,
			alias: user.character.name,
		};
	}
	return {
		scene: "scene-1",
		actor: null,
		token: null,
		alias: user?.name ?? null,
	};
}

/** Install the chat stub: a different `game.user.character` and a `fromUuid`. */
function stubChatGlobals(fromUuid: (uuid: string) => unknown): void {
	(globalThis as Record<string, unknown>).game = {
		i18n: {
			localize: (key: string) => key,
			format: (key: string) => key,
		},
		system: { id: "rogue-trader" },
		user: { name: "Stephen", character: impersonatedCharacter },
	};
	(globalThis as Record<string, unknown>).foundry = {
		applications: {
			handlebars: { renderTemplate: async () => "<div>card</div>" },
		},
		documents: {
			ChatMessage: {
				create: async (data: {
					speaker: Record<string, unknown>;
					content: string;
					flags?: unknown;
				}) => {
					created.push(data);
					return { id: `msg-${created.length}` };
				},
				getSpeaker: coreGetSpeaker,
			},
		},
		utils: { fromUuid },
	};
}

describe("the chat port's speaker (bead 0fl6)", () => {
	afterEach(() => {
		(globalThis as Record<string, unknown>).game = stubbedGame;
		(globalThis as Record<string, unknown>).foundry = stubbedFoundry;
		created.length = 0;
		speakerActor = undefined;
	});

	test("post labels the card with the CHARACTER, not the player", async () => {
		stubChatGlobals(async () => rollingCharacter);
		const { foundryPorts } = await import("./ports");
		const message = await foundryPorts.chat.post(
			rollingView,
			"systems/rogue-trader/template/chat/roll.hbs",
			{ title: "Awareness" },
			{ "rogue-trader": { roll: true } },
		);
		expect(message).toEqual({ id: "msg-1" });
		expect(created).toHaveLength(1);
		// The document, not the view, reached getSpeaker — CASE 2.
		expect(speakerActor).toBe(rollingCharacter);
		expect(created[0].speaker).toEqual({
			scene: "scene-1",
			actor: "actor-lachlan",
			token: "tok-lachlan",
			alias: "Lachlan",
		});
		// The rest of the message is untouched.
		expect(created[0].content).toBe("<div>card</div>");
		expect(created[0].flags).toEqual({ "rogue-trader": { roll: true } });
	});

	test("postHtml resolves the same speaker and passes content through", async () => {
		stubChatGlobals(async () => rollingCharacter);
		const { foundryPorts } = await import("./ports");
		await foundryPorts.chat.postHtml(rollingView, "<p>7 damage</p>");
		expect(created).toHaveLength(1);
		expect(created[0].content).toBe("<p>7 damage</p>");
		expect(created[0].speaker).toEqual({
			scene: "scene-1",
			actor: "actor-lachlan",
			token: "tok-lachlan",
			alias: "Lachlan",
		});
	});

	test("a caller that already holds the document passes it straight through", async () => {
		// Nothing may be resolved: the actor IS the document already.
		stubChatGlobals(() => {
			throw new Error("speakerFor resolved a document that was given");
		});
		const { foundryPorts } = await import("./ports");
		await foundryPorts.chat.post(rollingCharacter, "tmpl.hbs", {});
		expect(speakerActor).toBe(rollingCharacter);
		expect(created[0].speaker).toEqual({
			scene: "scene-1",
			actor: "actor-lachlan",
			token: "tok-lachlan",
			alias: "Lachlan",
		});
	});

	test("an unresolvable uuid degrades to today's behaviour instead of throwing", async () => {
		stubChatGlobals(async () => null);
		const { foundryPorts } = await import("./ports");
		const message = await foundryPorts.chat.post(rollingView, "tmpl.hbs", {});
		// The card is still posted; only the labelling falls back.
		expect(message).toEqual({ id: "msg-1" });
		expect(created).toHaveLength(1);
		// The view was handed through unchanged, so core's CASE 5/6 stamped the
		// player's own character — the pre-fix behaviour, deliberately kept for
		// an actor that cannot be resolved (a deleted character, a LevelDB comp
		// actor, a stub that only knows fromUuidSync).
		expect(speakerActor).toBe(rollingView);
		expect(created[0].speaker).toEqual({
			scene: "scene-1",
			actor: "actor-campbell",
			token: null,
			alias: "Campbell",
		});
		expect((created[0].speaker as { actor: unknown }).actor).not.toBe(
			"actor-lachlan",
		);
	});
});

// --- Attaching rolls to the chat message (bead wvkd) ---------------------
//
// The bug: the dice port threw the evaluated Roll away and kept only
// primitives, and the chat port posted a message with no `rolls` — so every
// card (skill, characteristic, damage, psychic, fear, ship) was invisible to
// Dice So Nice!. DSN hooks `createChatMessage` and asks
// `shouldInterceptMessage(msg)`, which needs `msg.isRoll` (core:
// `ChatMessage#isRoll` is `this.rolls.length > 0`) AND at least one roll with
// dice in it. Nothing else about the card matters to the module.
//
// The stub below models the one slice of core that matters for the decision
// this bead had to make (step 4): core renders its OWN roll table into the
// message only when the content holds no element children
// (client/documents/chat-message.mjs:483-486), and it stamps the dice sound
// for a roll message (_preCreate, :538-540). Everything else is DSN's gate.

/** The globals the roll stub swaps in, restored after each test. */
const rollStubGame = (globalThis as Record<string, unknown>).game;
const rollStubFoundry = (globalThis as Record<string, unknown>).foundry;

/** Every ChatMessage.create call the roll stub saw, in core's terms. */
const rollMessages: Array<{
	speaker: Record<string, unknown>;
	content: string;
	flags?: unknown;
	rolls?: unknown[];
	isRoll: boolean;
	sound?: string;
	contentCoreReplaced: boolean;
}> = [];

/** Core's `CONFIG.sounds.dice`, stamped on a roll message by _preCreate. */
const CORE_DICE_SOUND = "sounds/dice.wav";

/**
 * A DSN-like `ChatMessage.create` stub: it records what REALLY reaches core
 * on create (speaker, content, flags, rolls) plus the two derived facts the
 * message would then carry — `isRoll` (core) and whether core replaced our
 * content with its own roll table.
 */
function coreCreateChatMessage(data: {
	speaker: Record<string, unknown>;
	content: string;
	flags?: unknown;
	rolls?: unknown[];
}) {
	const rolls = data.rolls ?? [];
	const isRoll = rolls.length > 0;
	// Core client/documents/chat-message.mjs:483-486 — "Ensure the content does
	// not already contain custom HTML". Our card templates render elements, so
	// core leaves them alone; a content-less message gets core's roll table.
	const contentCoreReplaced = isRoll && !/<[a-z]/i.test(data.content);
	const message = {
		speaker: data.speaker,
		content: contentCoreReplaced
			? `<div class="dice-roll">core's own roll table</div>`
			: data.content,
		flags: data.flags,
		...(isRoll ? { rolls } : {}),
		...(isRoll ? { sound: CORE_DICE_SOUND } : {}),
		isRoll,
		contentCoreReplaced,
	};
	rollMessages.push(message);
	return { id: `msg-${rollMessages.length}` };
}

/**
 * Install the roll-message stub. `render` stands in for Handlebars: it returns
 * a REALISTIC card fragment (elements, plus our own `{{roll}}` value) so the
 * core-content rule can be observed rather than assumed.
 */
function stubRollMessageGlobals(
	render: (template: string, vars: Record<string, unknown>) => Promise<string>,
): void {
	(globalThis as Record<string, unknown>).game = {
		i18n: {
			localize: (key: string) => key,
			format: (key: string) => key,
		},
		system: { id: "rogue-trader" },
		user: { name: "Stephen", character: null },
	};
	(globalThis as Record<string, unknown>).foundry = {
		applications: {
			handlebars: { renderTemplate: render },
		},
		documents: {
			ChatMessage: {
				create: coreCreateChatMessage,
				getSpeaker: coreGetSpeaker,
			},
		},
		utils: { fromUuid: async () => null },
	};
}

afterEach(() => {
	(globalThis as Record<string, unknown>).game = rollStubGame;
	(globalThis as Record<string, unknown>).foundry = rollStubFoundry;
	rollMessages.length = 0;
});

/** A DiceResult in the shape the Foundry dice port now returns (bead wvkd). */
function diceResultWithRoll(roll: unknown, total: number): DiceResult {
	return {
		total,
		dice: [{ result: total, faces: 100 }],
		terms: [{ class: "Die", faces: 100, results: [total] }],
		formula: "1d100",
		rolls: [roll],
	};
}

/** A DiceResult in the shape every HEADLESS fake still returns: numbers only. */
function diceResultWithoutRolls(total: number): DiceResult {
	return {
		total,
		dice: [{ result: total, faces: 100 }],
		terms: [{ class: "Die", faces: 100, results: [total] }],
		formula: "1d100",
	};
}

/**
 * Dice So Nice!'s OWN gate (dice-so-nice main.js, shouldInterceptMessage):
 * the message must be a roll AND carry at least one roll with dice in it.
 * Everything DSN animates is decided by this one predicate.
 */
function diceSoNiceWouldAnimate(
	message: (typeof rollMessages)[number],
): boolean {
	return (
		message.isRoll &&
		(message.rolls ?? []).some(
			(roll) => Number((roll as { dice?: unknown[] }).dice?.length ?? 0) > 0,
		)
	);
}

describe("the dice port keeps the evaluated Roll (bead wvkd)", () => {
	test("dice.roll hands the Roll itself on, next to the primitives", async () => {
		class FakeRoll {
			total = 42;
			terms = [
				{
					class: "Die",
					faces: 100,
					results: [{ result: 42, discarded: false }],
				},
			];
			async evaluate(): Promise<this> {
				return this;
			}
		}
		(globalThis as Record<string, unknown>).foundry = {
			dice: { Roll: FakeRoll },
		};
		try {
			const { foundryPorts } = await import("./ports");
			const result = await foundryPorts.dice.roll("1d100");
			// The primitives the card reads are unchanged (bead k98i: term-level
			// Tearing/Righteous Fury properties stay).
			expect(result.total).toBe(42);
			expect(result.terms).toEqual([
				{ class: "Die", faces: 100, results: [42] },
			]);
			// ...and the Roll survives so the message it rides can be roll-type.
			// Core's own Roll#toMessage attaches the instance exactly like this
			// (client/dice/roll.mjs:943: `messageData.rolls = [this]`).
			expect(result.rolls).toHaveLength(1);
			expect(result.rolls?.[0]).toBeInstanceOf(FakeRoll);
		} finally {
			(globalThis as Record<string, unknown>).foundry = rollStubFoundry;
		}
	});
});

describe("the chat port attaches rolls to the message (bead wvkd)", () => {
	test("a card whose dice port returned a Roll becomes a roll-type message", async () => {
		const evaluatedRoll = { formula: "1d100", dice: [{ faces: 100 }] };
		stubRollMessageGlobals(
			async (_template, vars) =>
				`<div class="rogue-trader chat roll"><span class="value">${String(vars.roll)}</span></div>`,
		);
		const { foundryPorts } = await import("./ports");
		const ports: Ports = {
			...foundryPorts,
			dice: { roll: async () => diceResultWithRoll(evaluatedRoll, 42) },
		};
		const rolled = await ports.dice.roll("1d100");
		const message = await postCard(
			ports,
			rollingView,
			"systems/rogue-trader/template/chat/roll.hbs",
			{ title: "Awareness", roll: rolled.total },
			{ "rogue-trader": { damageRoll: { hitRoll: 42 } } },
			rolled.rolls,
		);

		expect(message).toEqual({ id: "msg-1" });
		expect(rollMessages).toHaveLength(1);
		const posted = rollMessages[0];
		// The Roll is attached, so core's isRoll is true and DSN's gate
		// opens — this is the whole bug, and this assert is the whole fix.
		expect(posted.isRoll).toBe(true);
		expect(diceSoNiceWouldAnimate(posted)).toBe(true);
		expect(posted.rolls).toEqual([evaluatedRoll]);
		expect(posted.flags).toEqual({
			"rogue-trader": { damageRoll: { hitRoll: 42 } },
		});
		// Core stamps the dice sound for a roll message (_preCreate, :538-540).
		expect(posted.sound).toBe(CORE_DICE_SOUND);
	});

	test("our card keeps its own look — core does not add a second dice display", async () => {
		const evaluatedRoll = { formula: "1d100", dice: [{ faces: 100 }] };
		stubRollMessageGlobals(
			async (_template, vars) =>
				`<div class="rogue-trader chat roll"><span class="value">${String(vars.roll)}</span></div>`,
		);
		const { foundryPorts } = await import("./ports");
		const ports: Ports = {
			...foundryPorts,
			dice: { roll: async () => diceResultWithRoll(evaluatedRoll, 42) },
		};
		const rolled = await ports.dice.roll("1d100");
		await postCard(
			ports,
			rollingView,
			"systems/rogue-trader/template/chat/roll.hbs",
			{ title: "Awareness", roll: rolled.total },
			undefined,
			rolled.rolls,
		);

		const posted = rollMessages[0];
		// Step 4's decision: the card KEEPS its own display of the roll. Every
		// RT card template renders element children, and core only renders its
		// roll table into the message when the content has none
		// (client/documents/chat-message.mjs:483-486) — so the number our
		// template prints with {{roll}} is not duplicated beside core's table.
		expect(posted.contentCoreReplaced).toBe(false);
		expect(posted.content).toBe(
			`<div class="rogue-trader chat roll"><span class="value">42</span></div>`,
		);
	});

	test("the contrast: content with no elements WOULD take core's roll table", async () => {
		const evaluatedRoll = { formula: "1d100", dice: [{ faces: 100 }] };
		// The same stub with a content-less card (the shape core's own
		// Roll#toMessage produces: `content: String(this.total)`).
		stubRollMessageGlobals(async (_template, vars) => String(vars.roll));
		const { foundryPorts } = await import("./ports");
		const ports: Ports = {
			...foundryPorts,
			dice: { roll: async () => diceResultWithRoll(evaluatedRoll, 42) },
		};
		const rolled = await ports.dice.roll("1d100");
		await postCard(
			ports,
			rollingView,
			"tmpl.hbs",
			{ roll: rolled.total },
			undefined,
			rolled.rolls,
		);

		// This is WHY our cards keep their own look: every RT chat template
		// renders element children (verified against template/chat/*.hbs), so
		// core's roll table is never added — the rule only bites a bare number.
		const posted = rollMessages[0];
		expect(posted.contentCoreReplaced).toBe(true);
		expect(posted.content).toBe(
			`<div class="dice-roll">core's own roll table</div>`,
		);
	});

	test("a card whose dice port returned no Roll still posts, roll-less", async () => {
		stubRollMessageGlobals(async () => "<div>card</div>");
		const { foundryPorts } = await import("./ports");
		// The shape every headless suite injects: no `rolls` at all.
		const ports: Ports = {
			...foundryPorts,
			dice: { roll: async () => diceResultWithoutRolls(42) },
		};
		const rolled = await ports.dice.roll("1d100");
		expect(rolled.rolls).toBeUndefined();

		const message = await postCard(
			ports,
			rollingView,
			"systems/rogue-trader/template/chat/roll.hbs",
			{ title: "Awareness", roll: rolled.total },
			undefined,
			rolled.rolls,
		);

		// pf2e's with/without property: no throw, no `rolls` on the message, no
		// dice sound — exactly the pre-wvkd behaviour.
		expect(message).toEqual({ id: "msg-1" });
		expect(rollMessages).toHaveLength(1);
		const posted = rollMessages[0];
		expect("rolls" in posted).toBe(false);
		expect(posted.isRoll).toBe(false);
		expect(diceSoNiceWouldAnimate(posted)).toBe(false);
		expect(posted.sound).toBeUndefined();
		expect(posted.content).toBe("<div>card</div>");
	});

	test("an explicitly EMPTY roll list is treated the same way", async () => {
		stubRollMessageGlobals(async () => "<div>card</div>");
		const { foundryPorts } = await import("./ports");
		const parts = await foundryPorts.chat.post(
			rollingView,
			"tmpl.hbs",
			{},
			undefined,
			[],
		);
		expect(parts).toEqual({ id: "msg-1" });
		expect("rolls" in rollMessages[0]).toBe(false);
		expect(rollMessages[0].isRoll).toBe(false);
	});
});

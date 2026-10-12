/**
 * Foundry implementations of the ports (epic kof0, phase 3; hoisted from
 * src/roguetrader/infrastructure/foundry/ports.ts in bead 8ycd so the port
 * implementations are system-neutral).
 *
 * The ONLY place the rules layer's Foundry calls live. `getPorts()` returns the
 * Foundry set by default; tests (and future alternative front-ends) call
 * `setPorts(fake)` to run the rules headlessly.
 *
 * System-specific config (RT homebrew/origin-trait providers, RT pack ids)
 * rides the setConfigOverrides seam — a sibling system module registers its
 * overrides instead of this file reading CONFIG.<SYSTEM> constants, which
 * would hard-couple it to Rogue Trader.
 */

import type {
	Actors,
	Chat,
	Clock,
	ConfigPort,
	Dice,
	DiceResult,
	I18n,
	Items,
	Notify,
	Permissions,
	Ports,
	Targets,
} from "../../application/ports";
import { actorView } from "./actor-view";
import { foundryContent } from "./content";
import { DEFAULT_SYSTEM_PROFILE } from "../../domain/system-profile";

const dice: Dice = {
	async roll(formula: string): Promise<DiceResult> {
		// Every other port tolerates an absent Foundry global; dice cannot roll
		// without it, so say so instead of throwing an opaque ReferenceError
		// (bead c9s3: headless runs inject a fake Dice port).
		if (typeof foundry === "undefined") {
			throw new Error(
				`dice.roll("${formula}") — Foundry is not available; inject a Dice port for headless runs`,
			);
		}
		const roll = new foundry.dice.Roll(formula);
		await roll.evaluate();
		const terms =
			(
				roll as unknown as {
					terms?: Array<{
						class?: string;
						faces?: number;
						results?: Array<{ result: number; discarded?: boolean }>;
					}>;
				}
			).terms ?? [];
		const kept: DiceResult["dice"] = [];
		const rolledTerms: DiceResult["terms"] = [];
		for (const term of terms) {
			const faces = term.faces ?? 0;
			if (faces <= 0) continue;
			const results: number[] = [];
			for (const result of term.results ?? []) {
				if (result.discarded) continue;
				results.push(result.result);
				kept.push({ result: result.result, faces });
			}
			// Keep the term grouping (bead k98i): Tearing and Righteous Fury are
			// properties of the damage TERM, not of the whole formula.
			rolledTerms.push({ class: term.class, faces, results });
		}
		// Bead wvkd: the evaluated Roll is handed on as well — Dice So Nice!
		// only animates a chat message that carries rolls (core's
		// ChatMessage#isRoll is `this.rolls.length > 0`), and discarding it here
		// left every card invisible to the module. Core's own Roll#toMessage
		// takes exactly this shape (client/dice/roll.mjs:943:
		// `messageData.rolls = [this]`), and the ChatMessage schema JSONField
		// serializes the instance through Roll#toJSON.
		return {
			total: roll.total ?? 0,
			dice: kept,
			terms: rolledTerms,
			formula,
			rolls: [roll],
		};
	},
};

/**
 * What a chat speaker can be built from (bead 0fl6): the roll pipeline's
 * ActorView, or a real Actor document when the caller already holds one.
 */
type SpeakerActor = { uuid?: string; name?: string; documentName?: string };

/** The in-world actor uuid shape ("Actor.<id>"); tokens and compendium docs differ. */
const WORLD_ACTOR_UUID = /^Actor\.[^.]+$/;

/**
 * A Foundry document, STRUCTURALLY (bead 0fl6): `documentName` is core's own
 * discriminator and every real document carries it, including the stubs
 * headless tests build. `instanceof foundry.documents.Actor` cannot be used
 * here — that class only exists once Foundry boots, and the chat port has to
 * answer in tests too.
 */
function asDocument(value: unknown): { documentName: string } | null {
	const documentName = (value as { documentName?: unknown } | null | undefined)
		?.documentName;
	return typeof documentName === "string" && documentName.endsWith("Actor")
		? (value as { documentName: string })
		: null;
}

/**
 * Resolve the actor a card speaks AS to a real document, or hand back what we
 * were given (bead 0fl6).
 *
 * `ChatMessage.getSpeaker` only honours an actor that IS a document (core
 * client/documents/chat-message.mjs:237, CASE 2): it then labels the card with
 * the character's name and links it to the actor. Hand it the roll pipeline's
 * ActorView instead and it falls through to CASE 5/6, stamping the card with
 * the PLAYER's name and no actor link — which is why every roll, damage and
 * critical card came out labelled with the user's name.
 *
 * A uuid that does not resolve, a stub that only knows `fromUuidSync`, or a
 * headless run with no `foundry` global at all: degrade to passing the view
 * through (today's behaviour) rather than losing the card.
 */
async function speakerFor(actor: SpeakerActor): Promise<unknown> {
	// A caller that already holds the document passes it straight through.
	if (asDocument(actor)) return actor;
	// Narrowed to a string here so the resolver below cannot be handed undefined.
	const uuid = actor.uuid;
	if (typeof uuid !== "string" || !WORLD_ACTOR_UUID.test(uuid)) return actor;
	try {
		// The LevelDB-safe resolver (bead wwuc): content.ts takes the pack
		// shapes directly and everything else through fromUuid.
		const doc = await foundryContent.document(uuid);
		if (doc && asDocument(doc)) return doc;
	} catch {
		// A document we cannot resolve is not a reason to drop the card.
	}
	return actor;
}

const chat: Chat = {
	async post(actor, template, vars, flags, rolls) {
		const content = await foundry.applications.handlebars.renderTemplate(
			template,
			vars,
		);
		return (await foundry.documents.ChatMessage.create({
			speaker: foundry.documents.ChatMessage.getSpeaker({
				actor: (await speakerFor(actor)) as never,
			}),
			content,
			...(flags ? { flags } : {}),
			// Bead wvkd: attach the evaluated rolls so the message is roll-type and
			// Dice So Nice! animates it. The ONLY cast to core's Roll type in the
			// codebase lives here — above this line `rolls` is an opaque list, so
			// the application layer never names a Foundry type.
			...(rolls?.length ? { rolls: rolls as foundry.dice.Roll[] } : {}),
		})) as { id?: string } | undefined;
	},
	async postHtml(actor, content, rolls) {
		return (await foundry.documents.ChatMessage.create({
			speaker: foundry.documents.ChatMessage.getSpeaker({
				actor: (await speakerFor(actor)) as never,
			}),
			content,
			// Bead wvkd: the same animation contract as post (above).
			...(rolls?.length ? { rolls: rolls as foundry.dice.Roll[] } : {}),
		})) as { id?: string } | undefined;
	},
	async update(messageId, data) {
		const message = foundry.documents.ChatMessage.get(messageId) as
			| { update?: (update: object) => Promise<void> }
			| undefined;
		// Loud, not silent (bead c9s3): a missing message used to swallow the
		// amendment, so the to-hit card silently lost its Roll Damage button.
		if (typeof message?.update !== "function") {
			throw new Error(
				`chat.update — ChatMessage "${messageId}" was not found; the card was NOT amended`,
			);
		}
		await message.update(data);
	},
};

function currentTargetActor(): Actor | undefined {
	return (
		game as unknown as { user?: { targets?: Set<{ actor?: Actor }> } }
	).user?.targets
		?.values()
		?.next()?.value?.actor;
}

const targets: Targets = {
	view() {
		const actor = currentTargetActor();
		return actor ? actorView(actor) : null;
	},
	actor() {
		return currentTargetActor() ?? null;
	},
};

const clock: Clock = {
	round() {
		const g = (globalThis as { game?: { combat?: { round?: number } } }).game;
		return Number(g?.combat?.round ?? 0) || 0;
	},
};

/** Resolve an i18n key, tolerating an absent Foundry global (tests/headless). */
function localise(key: string, vars?: Record<string, unknown>): string {
	const api = (
		globalThis as {
			game?: {
				i18n?: {
					localize(k: string): string;
					format(k: string, v: Record<string, string>): string;
				};
			};
		}
	).game?.i18n;
	if (!api) return key;
	return vars
		? api.format(key, vars as Record<string, string>)
		: api.localize(key);
}

function notifications():
	| {
			warn(m: string): void;
			info(m: string): void;
			error(m: string): void;
	  }
	| undefined {
	return (
		globalThis as {
			ui?: {
				notifications?: {
					warn(m: string): void;
					info(m: string): void;
					error(m: string): void;
				};
			};
		}
	).ui?.notifications;
}

const notify: Notify = {
	warn(key, vars) {
		notifications()?.warn(localise(key, vars));
	},
	info(key, vars) {
		notifications()?.info(localise(key, vars));
	},
	error(key, vars) {
		notifications()?.error(localise(key, vars));
	},
};

const i18n: I18n = {
	t: (key, vars) => localise(key, vars),
};

/**
 * i18n KEY_SHAPE (bead dfdv): UPPER_SNAKE segments joined with dots — the
 * shape every label key takes ("ROLL.AIM_HALF", "QUALITY.ACCURATE"). Free
 * text (weapon names, custom rows, already-localized labels) never matches.
 */
export const KEY_SHAPE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+$/;

/**
 * Localize a modifier label that is an i18n KEY (bead dfdv): the display
 * seams (TestDialog contributor rows, runTest's card analysis) pass every
 * label through here — KEY-shaped labels resolve through i18n, free text
 * passes through untouched (idempotent: localized text no longer matches).
 */
export function localizeLabel(label: string): string {
	return KEY_SHAPE.test(label) ? localise(label) : label;
}

/**
 * System-specific config overrides (bead 8ycd): a sibling system module (or a
 * future world setting) swaps these hooks rather than editing this file. Each
 * hook falls back to the neutral default when not overridden.
 */
let configOverrides: Partial<ConfigPort> = {};

/** Register system-specific config overrides (idempotent, last write wins). */
export function setConfigOverrides(overrides: Partial<ConfigPort>): void {
	configOverrides = { ...configOverrides, ...overrides };
}

const config: ConfigPort = {
	// Bead yojf: the active profile binding. The neutral default is the shared
	// FFG profile; a system module overrides it via setConfigOverrides.
	profile() {
		return configOverrides.profile?.() ?? DEFAULT_SYSTEM_PROFILE;
	},
	homebrew() {
		return configOverrides.homebrew?.() ?? null;
	},
	originTraits() {
		return configOverrides.originTraits?.() ?? [];
	},
	packIds() {
		return configOverrides.packIds?.() ?? { rolltables: null };
	},
};

/**
 * Shared loud-failure writer guard (bead c9s3, deduped by bead 9b95/F3):
 * these ports used to optional-chain, so an unresolvable document turned the
 * write into an invisible no-op and the caller went on posting cards claiming
 * the write had landed. Throws unless the document exposes the writer method;
 * the message names the port and the method (some tests pin them).
 */
function requireDocumentWriter(
	doc: unknown,
	label: string,
	method: string,
): Record<string, unknown> {
	const candidate = doc as Record<string, unknown> | null;
	if (typeof candidate?.[method] !== "function") {
		throw new Error(
			`${label} — document is missing or has no ${method}(); the write was NOT applied`,
		);
	}
	return candidate;
}

const actors: Actors = {
	async update(actor, patch) {
		const doc = requireDocumentWriter(actor, "actors.update", "update") as {
			update: (update: object) => Promise<void>;
		};
		await doc.update(patch);
	},
	async createEffects(actor, data) {
		const doc = requireDocumentWriter(
			actor,
			"actors.createEffects",
			"createEmbeddedDocuments",
		) as {
			createEmbeddedDocuments: (
				type: string,
				data: object[],
			) => Promise<unknown>;
		};
		await doc.createEmbeddedDocuments("ActiveEffect", data);
	},
	async deleteEffects(actor, ids) {
		const doc = requireDocumentWriter(
			actor,
			"actors.deleteEffects",
			"deleteEmbeddedDocuments",
		) as {
			deleteEmbeddedDocuments: (
				type: string,
				ids: string[],
			) => Promise<unknown>;
		};
		await doc.deleteEmbeddedDocuments("ActiveEffect", ids);
	},
};

/**
 * Ownership check (bead qiuo).
 *
 * Fails CLOSED: when the document cannot tell us who owns it, the roll is
 * refused. A permission check that defaults to "allow" is not a permission
 * check — the whole point is that the caller could not previously be trusted.
 *
 * `isOwner` already answers "true" for a GM, so no GM branch is needed.
 */
const permissions: Permissions = {
	canRoll(actor) {
		const doc = actor as { isOwner?: unknown } | null | undefined;
		return doc?.isOwner === true;
	},
};

/**
 * Item document writes (bead 65sq): the ammo auto-consume funnel decrements
 * a launcher's loaded ordnance through here; mirrors actors.update's
 * loud-failure contract (bead c9s3).
 */
const items: Items = {
	async update(item, patch) {
		const doc = requireDocumentWriter(item, "items.update", "update") as {
			update: (update: object) => Promise<void>;
		};
		await doc.update(patch);
	},
};

/** The Foundry port set (the production default). */
export const foundryPorts: Ports = {
	dice,
	chat,
	targets,
	clock,
	notify,
	i18n,
	config,
	// Lazy (bead 8ycd): content.ts imports getPorts() from this module, so the
	// foundryContent binding is only touched at first use, not at module init.
	get content() {
		return foundryContent;
	},
	actors,
	items,
	permissions,
};

let current: Ports = foundryPorts;

/** The ports the rules currently use. */
export function getPorts(): Ports {
	return current;
}

/** Swap in a different port set (tests, alternative front-ends). */
export function setPorts(ports: Ports): void {
	current = ports;
}

/** Restore the Foundry default (test teardown). */
export function resetPorts(): void {
	current = foundryPorts;
}

/**
 * Foundry implementations of the ports (epic kof0, phase 3).
 *
 * The ONLY place the rules layer's Foundry calls live. `getPorts()` returns the
 * Foundry set by default; tests (and future alternative front-ends) call
 * `setPorts(fake)` to run the rules headlessly.
 */

import type {
	Actors,
	Chat,
	Clock,
	ConfigPort,
	Dice,
	DiceResult,
	I18n,
	Notify,
	Permissions,
	Ports,
	Targets,
} from "../../application/ports";
import { actorView } from "./actor-view";
import { foundryContent } from "./content";

const dice: Dice = {
	async roll(formula: string): Promise<DiceResult> {
		// Every other port tolerates an absent Foundry global; dice cannot roll
		// without it, so say so instead of throwing an opaque ReferenceError
		// (bead c9s3: headless runs inject a fake Dice port).
		if (typeof foundry === "undefined") {
			throw new Error(
				`rogue-trader: dice.roll("${formula}") — Foundry is not available; inject a Dice port for headless runs`,
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
		return { total: roll.total ?? 0, dice: kept, terms: rolledTerms, formula };
	},
};

const chat: Chat = {
	async post(actor, template, vars, flags) {
		const content = await foundry.applications.handlebars.renderTemplate(
			template,
			vars,
		);
		return (await foundry.documents.ChatMessage.create({
			speaker: foundry.documents.ChatMessage.getSpeaker({ actor: actor as never }),
			content,
			...(flags ? { flags } : {}),
		})) as { id?: string } | undefined;
	},
	async postHtml(actor, content) {
		return (await foundry.documents.ChatMessage.create({
			speaker: foundry.documents.ChatMessage.getSpeaker({ actor: actor as never }),
			content,
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
				`rogue-trader: chat.update — ChatMessage "${messageId}" was not found; the card was NOT amended`,
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
	return vars ? api.format(key, vars as Record<string, string>) : api.localize(key);
}

function notifications(): { warn(m: string): void; info(m: string): void } | undefined {
	return (
		globalThis as {
			ui?: { notifications?: { warn(m: string): void; info(m: string): void } };
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
};

const i18n: I18n = {
	t: (key, vars) => localise(key, vars),
};

const config: ConfigPort = {
	homebrew() {
		if (typeof CONFIG === "undefined") return null;
		const provider = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { homebrew?: { getProfile?: () => unknown } };
			}
		).ROGUE_TRADER?.homebrew?.getProfile;
		return provider?.() ?? null;
	},
	originTraits() {
		if (typeof CONFIG === "undefined") return [];
		const provider = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { originTraits?: { getDefs?: () => unknown[] } };
			}
		).ROGUE_TRADER?.originTraits?.getDefs;
		return provider?.() ?? [];
	},
};

const actors: Actors = {
	async update(actor, patch) {
		const doc = actor as
			| { update?: (update: object) => Promise<void> }
			| null;
		// Loud, not silent (bead c9s3): these ports used to optional-chain, so an
		// unresolvable document turned the write into a no-op and the caller went
		// on to post a card claiming the effect had landed.
		if (typeof doc?.update !== "function") {
			throw new Error(
				"rogue-trader: actors.update — document is missing or has no update(); the write was NOT applied",
			);
		}
		await doc.update(patch);
	},
	async createEffects(actor, data) {
		const doc = actor as
			| {
					createEmbeddedDocuments?: (
						type: string,
						data: object[],
					) => Promise<unknown>;
			  }
			| null;
		if (typeof doc?.createEmbeddedDocuments !== "function") {
			throw new Error(
				"rogue-trader: actors.createEffects — document is missing or has no createEmbeddedDocuments(); the ActiveEffect was NOT created",
			);
		}
		await doc.createEmbeddedDocuments("ActiveEffect", data);
	},
	async deleteEffects(actor, ids) {
		const doc = actor as
			| {
					deleteEmbeddedDocuments?: (
						type: string,
						ids: string[],
					) => Promise<unknown>;
			  }
			| null;
		if (typeof doc?.deleteEmbeddedDocuments !== "function") {
			throw new Error(
				"rogue-trader: actors.deleteEffects — document is missing or has no deleteEmbeddedDocuments(); the ActiveEffect was NOT deleted",
			);
		}
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

/** The Foundry port set (the production default). */
export const foundryPorts: Ports = {
	dice,
	chat,
	targets,
	clock,
	notify,
	i18n,
	config,
	content: foundryContent,
	actors,
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

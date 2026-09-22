/**
 * Ports (epic kof0, phase 3): the boundary between the rules and Foundry.
 *
 * The rules take these as plain values, so they can run headlessly in tests and
 * so the system can degrade gracefully when content is missing. This file grows
 * one port at a time as the adapters are migrated; `ContentPort` is first
 * because content-optional is the load-bearing requirement.
 *
 * CONTENT-OPTIONAL PRINCIPLE (owner, 2026-09):
 *   Manual entry is the baseline. With no compendium content a player rolls the
 *   base target and sets modifiers by hand in the TestDialog. Installing the
 *   content only ADDS automation (auto-collected modifiers, table lookups) — it
 *   never gates a roll and its absence never produces a broken or silent card.
 */

import type { ActorView } from "../domain/model/actor";

/** Which content the world has installed (cheap to probe; no doc loading). */
export interface ContentCapabilities {
	/** The critical-hit RollTables (core + battlesuit) are installed. */
	criticalTables: boolean;
	/** The Psychic Phenomena / Perils tables are installed. */
	phenomenaTables: boolean;
	/** Origin-trait definitions are warmed (the funnel contributor). */
	originTraits: boolean;
	/** The skill catalog is warmed (createActor grants). */
	skillCatalog: boolean;
}

/** The "no compendiums installed" default: everything falls back to manual. */
export const NO_CONTENT: ContentCapabilities = {
	criticalTables: false,
	phenomenaTables: false,
	originTraits: false,
	skillCatalog: false,
};

/** One RollTable-shaped document, as far as the rules read it. */
export interface ContentTable {
	name?: string;
	formula?: string;
	results?: Iterable<{ text?: string; range?: [number, number] }>;
}

/** Read-only access to compendium content, tolerant of absence. */
export interface ContentPort {
	/** Cheap capability probe (no document loading). */
	capabilities(): ContentCapabilities;
	/** Every document in a pack; empty when the pack is absent. */
	documents(packId: string): Promise<unknown[]>;
	/** One document by name; null when the pack or document is absent. */
	find(packId: string, name: string): Promise<ContentTable | null>;
}

/** The port used when no content provider has been wired (tests, headless). */
export const NO_CONTENT_PORT: ContentPort = {
	capabilities: () => NO_CONTENT,
	documents: async () => [],
	find: async () => null,
};

// ---------------------------------------------------------------------------
// Roll ports (dice / chat / targets / clock)
// ---------------------------------------------------------------------------

/** One kept die from a roll: its face value and how many sides it had. */
export interface DiceDie {
	result: number;
	faces: number;
}

/**
 * One term of a roll (bead k98i): a term is the unit the formula actually
 * rolled, so "the damage die" and "discard the lowest damage die" can be
 * answered. The flattened `DiceResult.dice` list cannot: it merges a mixed
 * formula like 1d10+1d5 into one bag of dice.
 */
export interface DiceTerm {
	/** Foundry term class ("Die" for dice). Absent on hand-built fakes. */
	class?: string;
	/** Sides per die in this term (0/absent for non-dice terms). */
	faces: number;
	/** Kept (non-discarded) results, in roll order. */
	results: number[];
}

/** One evaluated dice roll, in plain numbers. */
export interface DiceResult {
	/** The roll total. */
	total: number;
	/** Every kept die, flattened (for triggers that scan all dice). */
	dice: DiceDie[];
	/** The same dice grouped by the term that rolled them. */
	terms: DiceTerm[];
	/** The formula that was rolled (echoed for cards/tests). */
	formula: string;
}

/** Roll dice. The only place `foundry.dice.Roll` is allowed to be called. */
export interface Dice {
	roll(formula: string): Promise<DiceResult>;
}

/** Post and amend chat cards. */
export interface Chat {
	/** Render a template and post it as the actor's card. */
	post(
		actor: { uuid?: string },
		template: string,
		vars: Record<string, unknown>,
		flags?: unknown,
	): Promise<{ id?: string } | undefined>;
	/** Post raw HTML content. */
	postHtml(
		actor: { uuid?: string },
		content: string,
	): Promise<{ id?: string } | undefined>;
	/** Amend an existing message (e.g. attach a damage-roll flag). */
	update(messageId: string, data: Record<string, unknown>): Promise<void>;
}

/** The user's current target. */
export interface Targets {
	/** The target's read model, or null. */
	view(): ActorView | null;
	/** The target's raw document (for writes), or null. */
	actor(): unknown;
}

/** Combat round, or 0 outside combat. */
export interface Clock {
	round(): number;
}

/** Player-facing notifications (localised by the implementation). */
export interface Notify {
	warn(key: string, vars?: Record<string, unknown>): void;
	info(key: string, vars?: Record<string, unknown>): void;
}

/** Localisation. Domain/application return keys; this resolves them. */
export interface I18n {
	t(key: string, vars?: Record<string, unknown>): string;
}

/**
 * Who is acting and what they may do (bead qiuo).
 *
 * The roll pipeline needs this because a roll must be refused for an entity the
 * requester does not own — including from a chat-card button, which every user
 * can see and click.
 */
export interface Permissions {
	/**
	 * May the CURRENT user roll for this actor?
	 *
	 * Implementations must fold the GM case in. In Foundry a GM holds OWNER on
	 * every document, so `isOwner` is already true for them; a separate
	 * "or is the GM" branch here would be redundant and would rot if the GM
	 * permission model is ever tuned.
	 */
	canRoll(actor: unknown): boolean;
}

/** World configuration the rules read (homebrew profile, warmed content). */
export interface ConfigPort {
	homebrew(): unknown;
	originTraits(): unknown[];
}

/** Document writes the rules perform (never a read — reads use ActorView). */
export interface Actors {
	/** Apply an update patch to a document. */
	update(actor: unknown, patch: Record<string, unknown>): Promise<void>;
	/** Create embedded ActiveEffects on an actor (token marker + modifiers). */
	createEffects(actor: unknown, data: Record<string, unknown>[]): Promise<void>;
	/** Delete embedded ActiveEffects from an actor by id. */
	deleteEffects(actor: unknown, ids: string[]): Promise<void>;
}

/** The aggregate every rules operation receives. */
export interface Ports {
	dice: Dice;
	chat: Chat;
	targets: Targets;
	clock: Clock;
	notify: Notify;
	i18n: I18n;
	config: ConfigPort;
	content: ContentPort;
	actors: Actors;
	permissions: Permissions;
}

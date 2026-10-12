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

import type { ActorView } from "../../ffg/domain/model/actor";
import type {
	SystemBranding,
	SystemProfile,
} from "../../ffg/domain/system-profile";
import type { RuleProfile } from "../../rules-engine/profile";

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
	/**
	 * Every document in a pack, or NULL when the pack is not installed —
	 * distinct from an empty pack, so a caller can warn loudly (once) about a
	 * missing pack instead of degrading silently (bead p7o5: the sheet-side
	 * pack fetches moved onto this shape).
	 */
	documentsOrNull(packId: string): Promise<unknown[] | null>;
	/** One document by name; null when the pack or document is absent. */
	find(packId: string, name: string): Promise<ContentTable | null>;
	/**
	 * Resolve a document by stamped uuid; null when it is unresolvable.
	 *
	 * "Compendium.<pack>.<type>.<id>" resolves DIRECTLY from the pack — not
	 * via generic uuid resolution — because that silently returns undefined
	 * in-world for our LevelDB comps even when the document is there (bead
	 * wwuc). Other uuid shapes go through the adapter's generic resolution.
	 */
	document(uuid: string): Promise<unknown | null>;
}

/** The port used when no content provider has been wired (tests, headless). */
export const NO_CONTENT_PORT: ContentPort = {
	capabilities: () => NO_CONTENT,
	documents: async () => [],
	documentsOrNull: async () => null,
	find: async () => null,
	document: async () => null,
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
	/**
	 * The evaluated Roll itself, opaque (bead wvkd). Dice So Nice! only animates
	 * a chat message that carries rolls — core's `ChatMessage#isRoll` is
	 * `this.rolls.length > 0` — and this port used to throw the Roll away, so
	 * every card the system posted was invisible to it. The primitives above
	 * still drive the card; the Roll is for the ANIMATION only.
	 *
	 * Opaque on purpose: the cast to `foundry.dice.Roll` belongs to the
	 * infrastructure dice port, never to this layer. Optional (additive)
	 * because every headless suite injects a fake Dice port and a fake that
	 * knows only the numbers must keep working.
	 */
	rolls?: readonly unknown[];
}

/** Roll dice. The only place `foundry.dice.Roll` is allowed to be called. */
export interface Dice {
	roll(formula: string): Promise<DiceResult>;
}

/** Post and amend chat cards. */
export interface Chat {
	/**
	 * Render a template and post it as the actor's card.
	 *
	 * `rolls` (bead wvkd): evaluated rolls to ATTACH to the message, which is
	 * what makes Dice So Nice! animate it. Opaque here — the cast to
	 * `foundry.dice.Roll` lives in the infrastructure chat port. Absent or
	 * empty leaves the message roll-less, which is exactly the pre-wvkd
	 * behaviour: the card still posts, the dice just do not animate.
	 */
	post(
		actor: { uuid?: string },
		template: string,
		vars: Record<string, unknown>,
		flags?: unknown,
		rolls?: readonly unknown[],
	): Promise<{ id?: string } | undefined>;
	/**
	 * Post raw HTML content.
	 *
	 * `rolls` carries the same animation contract as `post` (bead wvkd).
	 */
	postHtml(
		actor: { uuid?: string },
		content: string,
		rolls?: readonly unknown[],
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
	error(key: string, vars?: Record<string, unknown>): void;
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

/**
 * What `ConfigPort.profile()` promises (bead w9sa.8): the whole KERNEL rules
 * profile every pure resolver reads, plus the two OPTIONAL system-BRANDING
 * fields. Named so the port declaration and the sibling-profile tests share
 * one contract instead of restating the intersection.
 */
export type ConfigProfile = RuleProfile & Partial<SystemBranding>;

/** World configuration the rules read (homebrew profile, warmed content). */
export interface ConfigPort {
	homebrew(): unknown;
	originTraits(): unknown[];
	/**
	 * Compendium pack ids the content port probes (bead 8ycd). System-specific
	 * DATA: the default returns null (no packs installed) and a sibling system
	 * overrides it via the config-override seam so the infrastructure content
	 * module stays system-neutral.
	 */
	packIds(): { rolltables: string | null };
	/**
	 * The active profile: the kernel `RuleProfile` (bead yojf) the pure
	 * resolvers read — crit handling, hit locations, and the sibling-system
	 * extension points — plus the OPTIONAL system BRANDING
	 * (`messageFlagNamespace`, `rollCardTemplate`). presentation/rolls/
	 * pipeline.ts and rules/adapter.ts resolve through this instead of
	 * importing rtCore, so a sibling module swaps one binding here.
	 *
	 * WIDENED OFF RT's `SystemProfile` (bead w9sa.8, audit finding A1): the port
	 * used to promise RT's own creation/advancement constants
	 * (`characteristicBase`, `pointBuyBudget`, `fireModeBonus`, `pushCap`),
	 * which are RT RULES data a sibling supplies under its own shape — so a
	 * `DarkHeresyProfile` could not be returned through the shared port at all,
	 * the biggest fork risk the w9sa.5 audit found. Kernel PLUS branding is the
	 * whole contract every consumer actually needs: the rules resolvers read
	 * kernel fields only, and the two branding fields are the only "the system"
	 * data on the profile. RT's own `SystemProfile` still satisfies it (it is
	 * `RuleProfile & SystemBranding` + RT constants), so RT is byte-identical.
	 */
	profile(): ConfigProfile;
}

/**
 * Compile-time proof of the widening (bead w9sa.8).
 *
 * BOTH directions matter and only one is expressible as a type alias, so the
 * other is pinned at test level (see `ffg/infrastructure/foundry/ports.test.ts`
 * and `roguetrader/infrastructure/foundry/profile-port.test.ts`, which fuel the
 * seam with a `dh2Core`-shaped kernel+branding profile):
 *
 *  • THIS alias proves the widening did not MOVE anything: RT's `SystemProfile`
 *    is still assignable to the port's return type, field for field, so every
 *    RT consumer compiled unchanged. Widen the port back to `SystemProfile` (or
 *    drop a branding field off `SystemProfile`) and it stops compiling.
 *  • `*.test.ts` files sit outside BOTH tsconfigs (`exclude: **\/*.test.ts`),
 *    so a `satisfies` written in a test would be stripped and prove nothing.
 *    That is why the assertion lives here, in the typechecked application
 *    layer, where `bun run typecheck` actually reads it.
 */
type _RtProfileStillFitsTheWidenedPort = SystemProfile extends ConfigProfile
	? true
	: never;
/**
 * Item document writes the rules perform (bead 65sq): embedded items an actor
 * carries (ordnance consumption, ...). Never a read — reads use ActorView or
 * the domain resolvers.
 */
export interface Items {
	/** Apply an update patch to an item document. */
	update(item: unknown, patch: Record<string, unknown>): Promise<void>;
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
	items: Items;
	permissions: Permissions;
}

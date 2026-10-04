/**
 * The generic roll request/handler contract (bead p7jv, extracted from
 * roguetrader/rules/roll-contract.ts).
 *
 * This file carries only the SYSTEM-NEUTRAL base: the shared request data,
 * the funnel context, the per-kind handler interface shape and the
 * PreparedRoll plumbing. The RollKind union, the per-kind request shapes and
 * the kind-data map are system-specific and stay in the importing system's
 * layer (RT: roguetrader/rules/roll-contract.ts), which specialises the
 * generic contract here.
 *
 * Types only — no runtime code. Foundry-free: the actor is typed `unknown`
 * here (tsconfig.pure.json runs with `types: []`, so Foundry ambient types do
 * not exist at this layer); the RT layer narrows it back to `Actor`.
 */

import type { Modifier, TestOutcome } from "../../rules-engine/index";
import type { TestKind } from "../domain/model/test";
import type { MessageFlags } from "./chat-flags";

// ---------------------------------------------------------------------------
// Requests (shared base)
// ---------------------------------------------------------------------------

/** Shared request data. The title is derived per kind in the handler. */
export interface RollBase {
	/** The actor document the roll is made for (the system narrows the type). */
	actor: unknown;
	/** Bypass the modify dialog (fast-forward). */
	skipDialog?: boolean;
}

/**
 * Funnel context passed through to collectTestModifiers (bead hyv/r1k).
 */
export interface RollContext {
	aimed?: boolean;
	fireMode?: "single" | "burst" | "full";
	flags?: Record<string, boolean>;
	/** Skill-item test name (bead r1k) for "skill:<name>" effect keys. */
	skillName?: string;
}

/** Minimal shape of the TestDialog result the hooks consume. */
export interface TestDialogResultLike {
	modifiers: Modifier[];
	/** Guarded condition toggles chosen in the dialog (bead xu83). */
	flags?: Record<string, boolean>;
	attack?: {
		fireMode?: "single" | "burst" | "full";
		aimed?: boolean;
		aimFull?: boolean;
		flags?: Record<string, boolean>;
	};
}

// ---------------------------------------------------------------------------
// Prepared roll + handler
// ---------------------------------------------------------------------------

/**
 * Everything the shared pipeline needs once the handler has prepared.
 *
 * `K` is the system's roll-kind literal; `KindDataMap` is the system's map
 * from kind to the per-kind data a handler carries from prepare() to after()
 * (bead ezys) — kinds with nothing to carry map to `undefined` and simply
 * omit kindData.
 */
export interface PreparedRoll<
	K extends string = string,
	KindDataMap extends Record<K, unknown> = Record<string, unknown>,
> {
	/** Human card/dialog title (actor-qualified). */
	title: string;
	/** Unmodified target (characteristic / skill value). */
	baseTarget: number;
	/** Funnel test kind ("characteristic" | "skill" | "attack" | "focus-power"). */
	testKind: TestKind;
	/** Funnel test key (characteristic key or title surrogate). */
	testKey: string;
	/** Pre-dialog modifier rows (psy bonus, mastery, untrained, caller). */
	initialModifiers: Modifier[];
	/** Weapon shape for funnel effect collection (weapon kind only). */
	weapon: { type: string; special?: string[] } | null;
	/**
	 * Guarded condition flags this handler sets from its own dialog controls
	 * (bead xu83): the generic pre-roll condition toggles must not duplicate
	 * them (e.g. the melee Charge checkbox already drives "charging").
	 */
	handledConditionFlags?: string[];
	/** Pre-dialog funnel context (skill name). */
	context: RollContext;
	/** Extra roll-card template vars (e.g. showDamageButton). */
	templateVars?: Record<string, unknown>;
	/** Flags set on the roll card at creation time. */
	flags?: MessageFlags;
	/** Profile override (bead sa6: Focus Power 91+ auto-fail). */
	autoFailRoll?: number | null;
	/** Profile override (bead jpbm: Fearless auto-passes the Fear Test). */
	autoPassRoll?: number | null;
	/** Kind-specific data carried from prepare to after (see KindDataMap). */
	kindData?: KindDataMap[K];
}

/**
 * Per-kind handler. Every hook is optional except prepare (validation +
 * derived data); performRoll runs prepare -> dialog -> post-dialog rows ->
 * shared test pipeline -> after. Handlers that need Foundry UI do it inside
 * their hooks so the orchestrator stays Foundry-shape-free.
 *
 * `RequestMap` is the system's discriminated request union; the hooks receive
 * the member whose `kind` matches `K`.
 */
export interface RollHandler<
	K extends string = string,
	RequestMap extends { kind: string } = { kind: string },
	KindDataMap extends Record<K, unknown> = Record<string, unknown>,
> {
	/** Validate + resolve the request. Null = bail (warnings already shown). */
	prepare(
		request: Extract<RequestMap, { kind: K }>,
	): Promise<PreparedRoll<K, KindDataMap> | null>;
	/** Extra TestDialog config (weapon: attack-context selectors). */
	dialogConfig?(
		request: Extract<RequestMap, { kind: K }>,
		prepared: PreparedRoll<K, KindDataMap>,
	): object;
	/** Post-dialog modifier rows (weapon: Aim / Inaccurate cancellation). */
	postDialogModifiers?(
		request: Extract<RequestMap, { kind: K }>,
		prepared: PreparedRoll<K, KindDataMap>,
		dialog: TestDialogResultLike,
	): Modifier[];
	/** Funnel context that depends on the dialog result (weapon: fire mode). */
	testContext?(
		request: Extract<RequestMap, { kind: K }>,
		prepared: PreparedRoll<K, KindDataMap>,
		dialog: TestDialogResultLike | null,
	): RollContext;
	/** Post-card follow-up (damage flag, evasion, phenomena, power damage). */
	after?(
		request: Extract<RequestMap, { kind: K }>,
		prepared: PreparedRoll<K, KindDataMap>,
		outcome: TestOutcome,
		messageId: string | null,
		/**
		 * Resolved test numbers + final modifier list (bead jpbm). `context` is
		 * the funnel context the test actually ran with (bead 9b95 F6) — the
		 * weapon after-hook stamps its fire mode onto the damageRoll flag so the
		 * auto-consume can compute the shots spent.
		 */
		info?: { target: number; modifiers: Modifier[]; context?: RollContext },
	): Promise<void>;
}
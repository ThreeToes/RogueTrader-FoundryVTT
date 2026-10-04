/**
 * Typed chat-message flags + the shared card poster (beads mvu2 + p7jv).
 *
 * The generic, system-neutral half of the flag machinery: the damageRoll /
 * damageApply flag shapes, the namespaced flags map, a flag reader and
 * postCard — the one renderTemplate + ChatMessage.create sequence every roll
 * card goes through.
 *
 * PLACEMENT (bead p7jv): this moved out of roguetrader/rules/chat-flags.ts so
 * a sibling 40k system can reuse it. The NAMESPACE is not hardcoded here: it
 * is profile DATA (`SystemProfile.messageFlagNamespace`) and is passed in —
 * the roguetrader shim (rules/chat-flags.ts) resolves it through
 * `ports.config.profile().messageFlagNamespace`.
 *
 * The module is application-layer and Foundry-free: per the architecture
 * boundary (src/roguetrader/architecture.test.ts) application may not import
 * infrastructure's getPorts(), so every function takes the `Ports` value as a
 * parameter instead. Callers at the rules/presentation layers wire it with
 * getPorts().
 */

import type { Ports } from "./ports";

// ---------------------------------------------------------------------------
// Flag shapes (FFG-generic)
// ---------------------------------------------------------------------------

/** Card button data for the manual damage roll (to-hit card button). */
export interface DamageRollFlag {
	attackerUuid?: string;
	weaponUuid?: string;
	targetUuid?: string | null;
	hitRoll?: number;
	/** To-hit outcome was critical (gates critical-damage talent effects). */
	critical?: boolean;
	/**
	 * The fire mode selected in the attack dialog at to-hit time (bead 9b95
	 * F6): the auto-consume computes the shots spent from it; absent when the
	 * to-hit was fast-forwarded (skipDialog) — then the consume falls back to
	 * the launcher's RoF (single-shot-only = 1, else refuse).
	 */
	fireMode?: "single" | "burst" | "full";
	rolled?: boolean;
}

/** Apply-damage button data (damage card button, bead ncc). */
export interface DamageApplyFlag {
	wounds?: number;
	targetUuid?: string;
	applied?: boolean;
	/**
	 * Damage type + hit location (bead ks3k): the apply step needs both to pick
	 * the right critical table once wounds run out. The card already displays
	 * them, so this only stops the click handler recomputing them.
	 */
	damageType?: string;
	location?: string;
}

/**
 * The system-neutral flag payload carried under the namespace key. This is
 * not only the roll-card flags: every stamp the system writes under its
 * namespace reads back through here (bead pwn0) — the ActiveEffect snap-out
 * marker, the packer's compendiumSource stamp and the acquisition source
 * stamp. The shapes stay structural so any 40k profile can reuse them.
 */
export interface MessageFlagPayload {
	damageRoll?: DamageRollFlag;
	damageApply?: DamageApplyFlag;
	/** ActiveEffect marker: the condition can end via a snap-out Test. */
	snapOut?: boolean;
	/** Packer stamp on compendium items: the source pack uuid (et3x). */
	compendiumSource?: string;
	/** Packer stamp on compendium items: the build-time source bucket. */
	source?: string;
}

/**
 * Chat-message flags keyed by the profile's `messageFlagNamespace`.
 * `MessageFlags<"rogue-trader">` is the RT shape; the generic form is a
 * string-indexed map so pipeline code can pass flags without knowing the
 * active system.
 */
export type MessageFlags<N extends string = string> = {
	[K in N]?: MessageFlagPayload;
};

// ---------------------------------------------------------------------------
// Read + post machinery
// ---------------------------------------------------------------------------

/** The active chat-flag namespace, from the config port's profile. */
export function messageFlagNamespace(ports: Ports): string {
	return ports.config.profile().messageFlagNamespace;
}

/** Extract a system flag off a chat message (or flag payload). */
export function readMessageFlag<T extends keyof MessageFlagPayload>(
	ports: Ports,
	message: { flags?: Record<string, Record<string, unknown>> } | undefined,
	flag: T,
): MessageFlagPayload[T] | undefined {
	const namespace = messageFlagNamespace(ports);
	return message?.flags?.[namespace]?.[flag] as MessageFlagPayload[T] | undefined;
}

/**
 * Post a roll card: render the template and create the chat message with
 * speaker + flags. The single shared tail of every roll pipeline.
 */
export async function postCard(
	ports: Ports,
	actor: { uuid?: string },
	template: string,
	vars: Record<string, unknown>,
	flags?: MessageFlags,
): Promise<{ id?: string } | undefined> {
	return ports.chat.post(actor, template, vars, flags);
}
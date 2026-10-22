/**
 * Damage-card applied state at render time (follow-on to bead t2ei).
 *
 * Foundry bakes chat card HTML at post time. After an apply the damageApply
 * message flag records `applied: true` and the click gate in chat-actions.ts
 * returns silently — but a RE-RENDERED card (reopened from history, or
 * re-rendered by a message update) carried the baked enabled Apply button:
 * its click was a silently ignored no-op, the DAMAGE.APPLIED toast replayed
 * nowhere. This module flips the button FROM the flag at render time so the
 * card's UI tells the truth. No template surgery — flags are readable at hook
 * time — and no click-handling change: the chat-actions gate stays the
 * enforcement layer, this only mirrors state.
 */

import {
	type DamageApplyFlag,
	readMessageFlag,
} from "../../ffg/application/chat-flags";

import { getPorts } from "../infrastructure/foundry/ports";

/**
 * Pure flag -> button-attribute map (unit-tested; no i18n call inside, so the
 * tooltip travels as its key plus its interpolation vars).
 */
export interface AppliedDamageButtonState {
	/** Whether the card is consumed: the Apply control must be disabled. */
	disabled: boolean;
	/** Tooltip i18n key for the disabled control; null leaves it untitled. */
	tooltipKey: string | null;
	/** Interpolation vars for the tooltip key ( DAMAGE.APPLIED's {wounds}). */
	tooltipVars?: Record<string, string>;
}

/**
 * The decision the render hook enforces: a card whose damageApply flag
 * carries `applied` is consumed — disable the button and title it with the
 * same DAMAGE.APPLIED string the apply toast used. Anything else (no flag,
 * not applied yet) stays enabled.
 */
export function appliedDamageButtonState(
	data: DamageApplyFlag | undefined,
): AppliedDamageButtonState {
	if (data?.applied) {
		// DAMAGE.APPLIED carries a {wounds} placeholder in every language, so
		// the count rides along; a legacy card without the wound count still
		// interpolates instead of showing the raw placeholder string.
		return {
			disabled: true,
			tooltipKey: "DAMAGE.APPLIED",
			tooltipVars: { wounds: String(data.wounds ?? "?") },
		};
	}
	return { disabled: false, tooltipKey: null };
}

/**
 * Mirror the state onto one button (Foundry-free apart from the tooltip
 * localization at hook time): the disabled attribute plus the ARIA +
 * data-tooltip disabled affordance. Idempotent — the hook fires on every
 * render — and a re-armed (unconsumed) render strips the affordances again.
 */
export function paintAppliedDamageButton(
	button: HTMLButtonElement & { dataset: Record<string, string> },
	state: AppliedDamageButtonState,
): void {
	button.disabled = state.disabled;
	if (state.disabled) {
		button.setAttribute("aria-disabled", "true");
		// format (not localize): DAMAGE.APPLIED interpolates {wounds}, so the
		// raw key alone would render the placeholder literally.
		button.dataset.tooltip = game.i18n.format(
			state.tooltipKey ?? "",
			state.tooltipVars,
		);
	} else {
		// The damage template stamps no tooltip/aria on the enabled button, so
		// clearing here cannot erase someone else's attribute.
		button.removeAttribute("aria-disabled");
		delete button.dataset.tooltip;
	}
}

/**
 * Read the damageApply flag off a rendered message and mirror it onto the
 * card's Apply button. No button (miss card) or no message is a no-op — the
 * hook fires for EVERY message, damage or otherwise.
 */
export function mirrorDamageCardAppliedState(
	message: unknown,
	html: unknown,
): void {
	const button = (
		html as { querySelector?: (selector: string) => Element | null } | null
	)?.querySelector?.("button.apply-damage");
	if (!button) return;
	const state = appliedDamageButtonState(
		readMessageFlag(getPorts().config, message as never, "damageApply") as
			| DamageApplyFlag
			| undefined,
	);
	paintAppliedDamageButton(
		button as HTMLButtonElement & { dataset: Record<string, string> },
		state,
	);
}

/**
 * Register the render-time mirror (adapter side). v14.366 runtime verified
 * against core ChatMessage#renderHTML (client/documents/chat-message.mjs):
 * the hook is "renderChatMessageHTML", called with (message, html:
 * HTMLElement, messageData) for EVERY message rendered into the chat log —
 * fresh post, reopen from history, and update-triggered re-renders — so the
 * consumed card is also disabled when foundry's baked HTML still shows it
 * enabled. fvtt-types v13 declares the same hook signature
 * (client/hooks.d.mts renderChatMessageHTML).
 */
export function registerDamageCardStateHook(): void {
	Hooks.on("renderChatMessageHTML", (message, html) => {
		mirrorDamageCardAppliedState(message, html);
	});
}

/**
 * Token context-menu combat entries (epic wjpi, bead dt8t): "Roll Initiative"
 * on a token, sibling of creator-menus.ts (table-driven, presentation layer
 * owns the registration, rules/adapter owns the document write).
 *
 * CORE-MENU DISCOVERY (v14.366 runtime, foundry.mjs): Foundry has NO
 * right-click context menu on CANVAS tokens — a canvas right-click opens the
 * Token HUD (Token#_onClickRight) and there is no getTokenContextOptions hook.
 * The core token context menu that DOES exist is the Scene-Navigation Tokens
 * tab (PlaceableTab): it wires `.placeable-entry` with
 * `get${documentClass.documentName}PlaceableContextOptions` →
 * getTokenPlaceableContextOptions (foundry.mjs PlaceableTab._onFirstRender,
 * parentClassHooks: false). That is the entry this module registers; the
 * character-sheet button covers rolling straight from the sheet.
 *
 * The entry is offered ONLY where a roll can actually happen (bead qiuo fails
 * closed, extended by bead nt34 F1): core's Combat#rollInitiative only rolls
 * combatants where `combatant.isOwner`, so a non-owner could never complete
 * the roll anyway — AND the adapter's shape gate (rules/adapter.ts
 * rollInitiativeAction) only accepts character-shaped systems that carry an
 * initiativeBonus() model, so owned vehicle/starship tokens must not see a
 * dead entry whose click silently no-ops. canRollToken mirrors both gates.
 */

import { rollInitiativeAction } from "../rules/adapter";
import { type ContextMenuEntryOption } from "./context-menu-entry";

type TokenMenuDocument = {
	actor?: {
		isOwner?: boolean;
		system?: { initiativeBonus?: unknown };
	} | null;
};

/**
 * Resolve the TokenDocument behind a Tokens-tab entry element, mirroring the
 * core resolver (PlaceableTab#_getPlaceableFromElement): closest
 * `[data-entry-id]` → the viewed scene's embedded tokens collection.
 */
function resolveToken(element?: HTMLElement): TokenMenuDocument | undefined {
	const entryId = element?.closest<HTMLElement>("[data-entry-id]")?.dataset
		.entryId;
	if (!entryId) return undefined;
	const scene = canvas.scene;
	const tokens = scene?.tokens as unknown as
		| { get: (id: string) => TokenMenuDocument | undefined }
		| undefined;
	return tokens?.get(entryId);
}

/** Can the current user roll THIS token's initiative? */
function canRollToken(element?: HTMLElement): boolean {
	const token = resolveToken(element);
	if (!token?.actor?.isOwner) return false;
	// Mirror the adapter's shape gate (rules/adapter.ts rollInitiativeAction):
	// only character-shaped systems carry an initiativeBonus() model, so an
	// owned vehicle/starship token does not get a dead entry whose click
	// silently no-ops (bead nt34 F1).
	return (
		typeof token.actor.system?.initiativeBonus === "function"
	);
}

/** Register the token context-menu combat entries. */
export function registerTokenContextMenus(): void {
	// The Hooks-as-unknown cast is LOAD-BEARING (bead nt34 F11 review):
	// getTokenPlaceableContextOptions is a v14-only PlaceableTab hook that
	// fvtt-types v13 does not declare, so plain Hooks.on (as combat-end.ts
	// gets away with for the typed "deleteCombat" document hook) fails
	// typecheck. Same pattern as creator-menus.ts; aligned when v13/v14
	// types agree.
	const hooksOn = Hooks as unknown as {
		on: (name: string, fn: unknown) => void;
	};
	hooksOn.on(
		"getTokenPlaceableContextOptions",
		(_app: unknown, options: ContextMenuEntryOption[]) => {
			options.push({
				label: "COMBAT.ROLL_INITIATIVE",
				icon: "fa-solid fa-dice-d10",
				visible: (element) => canRollToken(element),
				onClick: (_event, element) => {
					const token = resolveToken(element);
					if (!token?.actor) return;
					rollInitiativeAction(token.actor as never).catch((error) =>
						console.error("rogue-trader: initiative roll failed", error),
					);
				},
			});
		},
	);
}
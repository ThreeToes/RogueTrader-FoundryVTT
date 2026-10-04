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
 * The entry is offered ONLY on tokens the current user owns (bead qiuo fails
 * closed): core's Combat#rollInitiative only rolls combatants where
 * `combatant.isOwner`, so a non-owner could never complete the roll anyway.
 */

import { rollInitiativeAction } from "../rules/adapter";

/** Tokens-tab context-menu entry (v14 ContextMenuEntry shape). */
type TokensTabEntryOption = {
	label: string;
	icon: string;
	onClick: (event?: PointerEvent, element?: HTMLElement) => void;
	/** v14 name — the old `condition` logs a deprecation warning at render. */
	visible?: (element?: HTMLElement) => boolean;
};

type TokenMenuDocument = {
	actor?: {
		isOwner?: boolean;
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
	return Boolean(token?.actor?.isOwner);
}

/** Register the token context-menu combat entries. */
export function registerTokenContextMenus(): void {
	const hooksOn = Hooks as unknown as {
		on: (name: string, fn: unknown) => void;
	};
	hooksOn.on(
		"getTokenPlaceableContextOptions",
		(_app: unknown, options: TokensTabEntryOption[]) => {
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
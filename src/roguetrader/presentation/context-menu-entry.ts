/**
 * The shared context-menu entry type (bead nt34 F11): v14 ContextMenuEntry
 * shape, narrowed to the fields OUR menus push. creator-menus.ts and
 * token-menus.ts both build these options, so ONE type lives here — added
 * fields are made once, not duplicated per menu. Registration itself stays
 * per-menu: creator-menus' triple-hook registration is a deliberate,
 * tested divergence (v13/v14 core hook-name divergence) — do not "unify" it.
 */

/** One sidebar/directory context-menu entry (v14 ContextMenuEntry shape). */
export type ContextMenuEntryOption = {
	label: string;
	icon: string;
	onClick: (event?: PointerEvent, element?: HTMLElement) => void;
	/** v14 name — the old `condition` logs a deprecation warning at render. */
	visible?: (element?: HTMLElement) => boolean;
};
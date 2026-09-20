/**
 * Actor-directory creator menus (epic kof0, phase 5): the "Create …" entries
 * on the Actors sidebar context menu, extracted from the composition root.
 *
 * Each entry is offered ONLY on its own actor type (bead ugd2) and opens the
 * matching wizard in update-in-place mode, so no actor-creation permission is
 * needed. Foundry v13/v14 expose the menu under three different hook names, so
 * all three are registered defensively (a double fire is harmless — the
 * callback only pushes into whatever array the firing hook passed).
 */

import { getPorts } from "../infrastructure/foundry/ports";
import { CharacterCreator } from "../sheet/actor/character-creator";
import { PlanetCreator } from "../sheet/actor/planet-creator";
import { ShipCreator } from "../sheet/actor/ship-creator";
import { WarrantCreator } from "../sheet/actor/warrant-creator";

/** Actor-directory context-menu entry (v14 ContextMenuEntry shape). */
type DirectoryEntryOption = {
	label: string;
	icon: string;
	onClick: (event?: PointerEvent, element?: HTMLElement) => void;
	condition?: (element?: HTMLElement) => boolean;
};

/**
 * Resolve the world actor behind a directory entry context-menu target. v14
 * entry markup carries data-entry-id (document-partial.hbs); older cores used
 * data-document-id.
 */
function resolveEntryActor(
	element?: HTMLElement,
): foundry.documents.Actor | undefined {
	const entryEl = element?.closest<HTMLElement>(
		"[data-entry-id], [data-document-id]",
	);
	const resolvedId =
		entryEl?.dataset.entryId ??
		entryEl?.dataset.documentId ??
		element?.dataset?.documentId;
	if (!resolvedId) return undefined;
	return (
		game.actors as unknown as { get: (id: string) => unknown }
	).get(resolvedId) as foundry.documents.Actor | undefined;
}

/** Register every creator entry on the Actors directory context menu. */
export function registerCreatorMenus(): void {
	const user = game.user as unknown as {
		isGM?: boolean;
		hasPermission?: (p: string) => boolean;
	};
	const canCreateActors = Boolean(
		user?.isGM || user?.hasPermission?.("ACTOR_CREATE"),
	);
	const hooksOn = Hooks as unknown as {
		on: (name: string, fn: unknown) => void;
	};
	const register = (entry: (app: unknown, options: DirectoryEntryOption[]) => void) => {
		hooksOn.on("getActorContextOptions", entry);
		hooksOn.on("getEntryContextAbstractSidebarTab", entry);
		hooksOn.on("getActorDirectoryEntryContext", entry);
	};
	const denyPermission = () => {
		getPorts().notify.warn("CREATOR.NO_CREATE_PERMISSION");
	};

	// Character creator (bead ay0): "Create Explorer (Origin Path)".
	register((_app, entryOptions) => {
		entryOptions.push({
			label: "CREATOR.MENU",
			icon: "fa-solid fa-user-plus",
			condition: (element) => resolveEntryActor(element)?.type === "explorer",
			onClick: (_event, element) => {
				const candidate = resolveEntryActor(element);
				const actor = (
					candidate?.system as { characteristics?: unknown } | undefined
				)?.characteristics
					? candidate
					: undefined;
				if (!actor && !canCreateActors) {
					denyPermission();
					return;
				}
				new CharacterCreator({ actor } as never).render({
					force: true,
				} as never);
			},
		});
	});

	// Ship creator (bead 9cre): "Create Ship (wizard)".
	register((_app, entryOptions) => {
		entryOptions.push({
			label: "SHIP_CREATOR.MENU",
			icon: "fa-solid fa-rocket",
			condition: (element) => resolveEntryActor(element)?.type === "starship",
			onClick: (_event, element) => {
				const actor = resolveEntryActor(element);
				const isStarship = actor && (actor.type as string) === "starship";
				if (!isStarship && !canCreateActors) {
					denyPermission();
					return;
				}
				new ShipCreator({ actor: isStarship ? actor : undefined } as never).render(
					{ force: true } as never,
				);
			},
		});
	});

	// Planet creator (owner ask, planet tables): "Create Planet (wizard)".
	register((_app, entryOptions) => {
		entryOptions.push({
			label: "PLANET_CREATOR.MENU",
			icon: "fa-solid fa-globe",
			condition: (element) => resolveEntryActor(element)?.type === "planet",
			onClick: (_event, element) => {
				const actor = resolveEntryActor(element);
				const isPlanet = actor && (actor.type as string) === "planet";
				if (!isPlanet && !canCreateActors) {
					denyPermission();
					return;
				}
				new PlanetCreator({
					actor: isPlanet ? actor : undefined,
				} as never).render({ force: true } as never);
			},
		});
	});

	// Ship & Warrant Path creator (epic 1d2n, bead d7a9): "Create Warrant".
	register((_app, entryOptions) => {
		entryOptions.push({
			label: "WARRANT_CREATOR.MENU",
			icon: "fa-solid fa-scroll",
			condition: (element) => resolveEntryActor(element)?.type === "dynasty",
			onClick: (_event, element) => {
				const actor = resolveEntryActor(element);
				const isDynasty = actor && (actor.type as string) === "dynasty";
				if (!isDynasty && !canCreateActors) {
					denyPermission();
					return;
				}
				new WarrantCreator({
					actor: isDynasty ? actor : undefined,
				} as never).render({ force: true } as never);
			},
		});
	});
}

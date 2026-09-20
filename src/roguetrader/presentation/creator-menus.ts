/**
 * Actor-directory creator menus (epic kof0, phase 5; table-driven per bead
 * 5hqg): the "Create …" entries on the Actors sidebar context menu, extracted
 * from the composition root.
 *
 * Each entry is offered ONLY on its own actor type (bead ugd2) and opens the
 * matching wizard in update-in-place mode, so no actor-creation permission is
 * needed. Foundry v13/v14 expose the menu under three different hook names, so
 * all three are registered defensively (a double fire is harmless — the
 * callback only pushes into whatever array the firing hook passed).
 *
 * The four entries differ only in their label, icon, actor type and which
 * wizard they open, so they are a table. Adding a creator is one entry.
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

type CreatorActor = foundry.documents.Actor | undefined;

/**
 * One creator: which actor type offers it, whether a candidate actor can be
 * used as its target, and how to open it.
 */
type CreatorEntry = {
	/** i18n key for the menu label. */
	labelKey: string;
	/** FontAwesome classes for the menu icon. */
	icon: string;
	/** The actor type whose directory entry offers this creator. */
	actorType: string;
	/**
	 * Can this actor be used as the creator's target (update-in-place)?
	 *
	 * The character creator is the odd one out: it prefills from any actor
	 * carrying a `characteristics` block, so it tests the system shape rather
	 * than the type. Stated per entry because that difference is real, not an
	 * accident of how the four were written.
	 */
	usable: (actor: CreatorActor) => boolean;
	/** Open the wizard, targeting `actor` when there is one. */
	open: (actor: CreatorActor) => void;
};

/** The actor-type predicate shared by the three type-matched creators. */
function isType(actor: CreatorActor, type: string): boolean {
	return actor !== undefined && (actor.type as string) === type;
}

const CREATORS: readonly CreatorEntry[] = [
	{
		// Character creator (bead ay0): "Create Explorer (Origin Path)".
		labelKey: "CREATOR.MENU",
		icon: "fa-solid fa-user-plus",
		actorType: "explorer",
		usable: (actor) =>
			Boolean(
				(actor?.system as { characteristics?: unknown } | undefined)
					?.characteristics,
			),
		open: (actor) => new CharacterCreator({ actor }).render({ force: true }),
	},
	{
		// Ship creator (bead 9cre): "Create Ship (wizard)".
		labelKey: "SHIP_CREATOR.MENU",
		icon: "fa-solid fa-rocket",
		actorType: "starship",
		usable: (actor) => isType(actor, "starship"),
		open: (actor) => new ShipCreator({ actor }).render({ force: true }),
	},
	{
		// Planet creator (owner ask, planet tables): "Create Planet (wizard)".
		labelKey: "PLANET_CREATOR.MENU",
		icon: "fa-solid fa-globe",
		actorType: "planet",
		usable: (actor) => isType(actor, "planet"),
		open: (actor) => new PlanetCreator({ actor }).render({ force: true }),
	},
	{
		// Ship & Warrant Path creator (epic 1d2n, bead d7a9): "Create Warrant".
		labelKey: "WARRANT_CREATOR.MENU",
		icon: "fa-solid fa-scroll",
		actorType: "dynasty",
		usable: (actor) => isType(actor, "dynasty"),
		open: (actor) => new WarrantCreator({ actor }).render({ force: true }),
	},
];

/**
 * Resolve the world actor behind a directory entry context-menu target. v14
 * entry markup carries data-entry-id (document-partial.hbs); older cores used
 * data-document-id.
 */
function resolveEntryActor(element?: HTMLElement): CreatorActor {
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
	).get(resolvedId) as CreatorActor;
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
	const register = (
		entry: (app: unknown, options: DirectoryEntryOption[]) => void,
	) => {
		hooksOn.on("getActorContextOptions", entry);
		hooksOn.on("getEntryContextAbstractSidebarTab", entry);
		hooksOn.on("getActorDirectoryEntryContext", entry);
	};

	for (const creator of CREATORS) {
		register((_app, entryOptions) => {
			entryOptions.push({
				label: creator.labelKey,
				icon: creator.icon,
				condition: (element) =>
					isType(resolveEntryActor(element), creator.actorType),
				onClick: (_event, element) => {
					const candidate = resolveEntryActor(element);
					const actor = creator.usable(candidate) ? candidate : undefined;
					// Creating a NEW actor needs the permission; targeting an
					// existing one (update-in-place) does not.
					if (!actor && !canCreateActors) {
						getPorts().notify.warn("CREATOR.NO_CREATE_PERMISSION");
						return;
					}
					creator.open(actor);
				},
			});
		});
	}
}

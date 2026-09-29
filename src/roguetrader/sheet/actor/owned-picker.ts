/**
 * Shared base for the owned-item pickers (Skill, Talent, Psychic), so their
 * plumbing lives once (bead ypvc).
 *
 * WHAT IT OWNS
 *   - `actor`, and the constructor that fills it;
 *   - `ownedItemNames(type)`, the owned-items set (filter by type, map to
 *     name) each picker computed inline;
 *   - `pickerOptions()`, which builds the DEFAULT_OPTIONS shell (id, classes,
 *     position, resizable window, actions) — mirroring
 *     CreatorApplication.creatorOptions.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: `_prepareContext` bodies (skill reads the
 * pack catalog, talent localizes the registry, psychic carries
 * restricted/powerClass metadata) and the grant actions (they genuinely
 * differ: custom-skill form, talent prereq confirms, psychic uuid fetch).
 * A base abstracting those would be a worse abstraction than the duplication.
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

/** Structural shape of the DEFAULT_OPTIONS shell pickerOptions builds. */
interface PickerOptions<
	Actions extends Record<string, unknown> = Record<string, unknown>,
> {
	id: string;
	classes: string[];
	position: { width: number; height: number };
	window: { title: string; resizable: boolean };
	actions: Actions;
}

export abstract class OwnedItemPicker extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	/** The actor receiving the picked items. */
	actor: foundry.documents.Actor;

	constructor(options: { actor: foundry.documents.Actor } & object) {
		super(options as never);
		this.actor = options.actor;
	}

	/** Names of `type` items the actor already owns (drives the owned marker). */
	protected ownedItemNames(type: string): Set<string | null> {
		return new Set(
			this.actor.items
				.filter((item) => (item.type as string) === type)
				.map((item) => item.name),
		);
	}

	/**
	 * The DEFAULT_OPTIONS shell every picker shares: identity, resizable
	 * window and the subclass's own actions.
	 */
	protected static pickerOptions<Actions extends Record<string, unknown>>(config: {
		/** DOM id for the window. */
		id: string;
		/** Extra class after "rogue-trader sheet". */
		slug: string;
		/** i18n key for the window title. */
		titleKey: string;
		width: number;
		height: number;
		/** The subclass's own action handlers, keyed by action name. */
		actions: Actions;
	}): PickerOptions<Actions> {
		return {
			id: config.id,
			classes: ["rogue-trader", "sheet", config.slug],
			position: { width: config.width, height: config.height },
			window: { title: config.titleKey, resizable: true },
			actions: { ...config.actions },
		};
	}
}
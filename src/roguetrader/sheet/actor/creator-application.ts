/**
 * Shared wizard shell for the actor creators (epic kof0, bead 7ife).
 *
 * The four creators (character, ship, planet, warrant) are step wizards over
 * the same machinery, but each had written it out separately and their
 * vocabulary had drifted: two kept the step in `creatorState.step` and two in
 * a bare `stepIndex`, and the finish action was named `create` in one and
 * `finish` in the other three. This is that machinery once.
 *
 * WHAT IT OWNS
 *   - `step`, `targetActor` and `name`, and the constructor that fills them;
 *   - the `prev` / `next` action handlers, with the last-step bound coming
 *     from the subclass's `lastStep` and an `onEnterStep` hook for per-step
 *     side effects (the character creator rolls its Origin dice on step 2);
 *   - `creatorOptions()`, which builds the DEFAULT_OPTIONS shell (id, classes,
 *     window, and the two shared actions merged with the subclass's own).
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: `_prepareContext` and the finish action.
 * Those are where the four genuinely differ, and a base that tried to abstract
 * them would be a worse abstraction than the duplication.
 *
 * Tested by sheet/actor/creators.test.ts, which was written BEFORE this
 * existed — the creators had no coverage at all before that.
 */

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ApplicationV2 } = foundry.applications.api;

export abstract class CreatorApplication extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	/** The actor being updated in place (context-menu entry), if any. */
	targetActor: foundry.documents.Actor | null = null;

	/** The wizard's name field (planet and warrant creators take a `name`). */
	name = "";

	/** Current step. */
	step = 0;

	/** The last step index (inclusive). */
	protected abstract get lastStep(): number;

	/**
	 * Runs when a step is entered, before it renders. Override for per-step
	 * side effects; the default does nothing.
	 */
	protected async onEnterStep(_step: number): Promise<void> {
		// Intentionally empty: most creators have nothing to do on entry.
	}

	constructor(
		options: { actor?: foundry.documents.Actor; name?: string } & object = {},
	) {
		super(options as never);
		this.targetActor = options.actor ?? null;
		this.name = options.name ?? this.targetActor?.name ?? "";
	}

	/** Step back one, clamped at the first step. */
	static async onPrev(this: CreatorApplication): Promise<void> {
		this.step = Math.max(0, this.step - 1);
		this.render({ force: true });
	}

	/** Step forward one, clamped at `lastStep`. */
	static async onNext(this: CreatorApplication): Promise<void> {
		const next = Math.min(this.lastStep, this.step + 1);
		await this.onEnterStep(next);
		this.step = next;
		this.render({ force: true });
	}

	/**
	 * The DEFAULT_OPTIONS shell every creator shares: identity, window and the
	 * two step actions, merged with the subclass's own actions.
	 */
	protected static creatorOptions(config: {
		/** DOM id for the window. */
		id: string;
		/** Extra class after "rogue-trader sheet". */
		slug: string;
		/** i18n key for the window title. */
		titleKey: string;
		width: number;
		height: number;
		/** The subclass's own action handlers, keyed by action name. */
		actions: Record<string, unknown>;
	}): object {
		return {
			id: config.id,
			classes: ["rogue-trader", "sheet", config.slug],
			position: { width: config.width, height: config.height },
			window: { title: config.titleKey, resizable: true },
			actions: {
				...config.actions,
				prev: CreatorApplication.onPrev,
				next: CreatorApplication.onNext,
			},
		};
	}
}

/**
 * Planet creation wizard (owner ask): mirrors the ship-creator's wizard
 * patterns (step state machine, permissive picks + loud failures) for the
 * SOI world generator (Stars of Inequity Ch I, Tables 1-6..1-27).
 *
 * Each stage draws on the gametables pack's `game-table` rows for its kind
 * (soi-planet-body, soi-gravity, ...), clamping the die + per-stage GM
 * modifier (the book's cross-table modifiers — e.g. Low-Mass Body's –7 to
 * Gravity — are printed in the drawn row's prose; the modifier stepper is
 * how the GM applies them). The drawn row is attached to the planet and
 * the headline profile field is stamped from the row name.
 *
 * Stages whose book table is "roll N times" (territory terrain, resource
 * presence, landmarks) attach their reference row only — the GM rolls those
 * manually and can drag-attach extra rows on the planet sheet. Finish
 * creates/updates a `planet` actor with the profile snapshot + embedded
 * rows (grantedBy: "planet-creator" provenance; a re-run wipes only
 * creator-installed rows, manual drops survive — iufv pattern).
 */
import { getPackDocuments } from "../pack-resolve";
import {
	matchRollMap,
	parseRollMap,
	resultLabelFromRow,
	rollMatchesRange,
} from "../../rules/planet-tables";
import { sheetContext } from "../context";
import { CreatorApplication } from "./creator-application";

/** One draw stage of the world-generation sequence. */
interface PlanetStage {
	/** Profile field the drawn row fills ("" = attach-only). */
	key: string;
	/** The book's table label for the stage heading. */
	labelKey: string;
	/** gametables kind the rows come from. */
	kind: string;
	/** Die size for the draw (d10, or d5 for territories). */
	die: number;
	/** Stage hint (how modifiers are applied / per-territory note). */
	hintKey: string;
	/** How the die draw resolves to a row/sub-result. */
	mode: "ranged" | "count" | "map" | "subtable";
}

/**
 * The world-generation sequence (SOI Ch I). Order matters: several rolls
 * are modified by earlier draws, so the stages roll in book order and the
 * GM applies each printed modifier via the stepper.
 */
const STAGES: PlanetStage[] = [
	{ key: "body", labelKey: "PLANET.BODY", kind: "soi-planet-body", die: 10, hintKey: "PLANET_CREATOR.HINT_BODY", mode: "ranged" },
	{ key: "gravity", labelKey: "PLANET.GRAVITY", kind: "soi-gravity", die: 10, hintKey: "PLANET_CREATOR.HINT_GRAVITY", mode: "ranged" },
	{ key: "orbital", labelKey: "PLANET.ORBITAL", kind: "soi-orbital", die: 100, hintKey: "PLANET_CREATOR.HINT_ORBITAL", mode: "ranged" },
	{ key: "atmosphere", labelKey: "PLANET.ATMOSPHERE", kind: "soi-atmosphere", die: 10, hintKey: "PLANET_CREATOR.HINT_ATMOSPHERE", mode: "ranged" },
	{ key: "composition", labelKey: "PLANET_CREATOR.COMPOSITION", kind: "soi-atmo-comp", die: 10, hintKey: "PLANET_CREATOR.HINT_COMPOSITION", mode: "ranged" },
	{ key: "climate", labelKey: "PLANET.CLIMATE", kind: "soi-climate", die: 10, hintKey: "PLANET_CREATOR.HINT_CLIMATE", mode: "ranged" },
	{ key: "habitability", labelKey: "PLANET.HABITABILITY", kind: "soi-habitability", die: 10, hintKey: "PLANET_CREATOR.HINT_HABITABILITY", mode: "ranged" },
	// Reference rows: the kind carries ONE row whose prose holds the roll
	// map (Table 1-13/1-26) — the draw resolves via parseRollMap.
	{ key: "territories", labelKey: "PLANET.TERRITORIES", kind: "soi-territories-count", die: 5, hintKey: "PLANET_CREATOR.HINT_TERRITORIES", mode: "count" },
	{ key: "inhabitants", labelKey: "PLANET.INHABITANTS", kind: "soi-inhabitants", die: 10, hintKey: "PLANET_CREATOR.HINT_INHABITANTS", mode: "map" },
	{ key: "development", labelKey: "PLANET.DEVELOPMENT", kind: "soi-development", die: 10, hintKey: "PLANET_CREATOR.HINT_DEVELOPMENT", mode: "subtable" },
];

/** Fields the drawn row's name fills on the planet actor snapshot. */
const FIELD_BY_STAGE: Record<string, string> = {
	body: "body",
	gravity: "gravity",
	orbital: "orbitalFeature",
	atmosphere: "atmosphere",
	climate: "climate",
	habitability: "habitability",
	inhabitants: "inhabitants",
};

interface StageState {
	/** GM modifier applied to the die (book cross-table modifiers). */
	modifier: number;
	/** The drawn pack row's uuid ("" until rolled). */
	uuid: string;
	/** The drawn row's name + roll label for the summary list. */
	name: string;
	roll: string;
	summary: string;
	/** The raw (unmodified) die result shown next to the draw. */
	result: number;
	/** The resolved sub-result label (species, territory count, ...). */
	label: string;
}

interface PackRow {
	uuid: string;
	name: string;
	roll: string;
	summary: string;
}

function emptyStages(): Record<string, StageState> {
	const stages: Record<string, StageState> = {};
	for (const s of STAGES) {
		stages[s.key] = {
			modifier: 0,
			uuid: "",
			name: "",
			roll: "",
			summary: "",
			result: 0,
			label: "",
		};
	}
	return stages;
}


export class PlanetCreator extends CreatorApplication {
	static DEFAULT_OPTIONS = CreatorApplication.creatorOptions({
		id: "rogue-trader-planet-creator",
		slug: "planet-creator",
		titleKey: "PLANET_CREATOR.TITLE",
		width: 640,
		height: 560,
		actions: {
			roll: PlanetCreator.#onRoll,
			bump: PlanetCreator.#onBump,
			finish: PlanetCreator.#onFinish,
		},
	});

	/** The last draw stage. */
	protected get lastStep(): number {
		return STAGES.length - 1;
	}

	/** Profile snapshot written to the planet actor at finish. */
	profile: Record<string, string> = {};

	/** Per-stage draw state (modifier + drawn row). */
	stages = emptyStages();

	static PARTS = {
		form: {
			template:
				"systems/rogue-trader/template/sheet/actor/planet-creator.hbs",
		},
	};

	/** gametables-pack rows for a kind (loud empty warning per bead wwuc). */
	async #stageOptions(kind: string): Promise<PackRow[]> {
		const docs = (await getPackDocuments("rogue-trader.gametables")) as Array<{
			uuid?: string;
			id?: string;
			name?: string;
			type?: string;
			system?: { kind?: string; roll?: string; shortDescription?: string };
		}>;
		return docs
			.filter((d) => d.type === "game-table" && d.system?.kind === kind)
			.map((d) => ({
				uuid: d.uuid ?? "",
				name: d.name ?? "",
				roll: d.system?.roll ?? "",
				summary: d.system?.shortDescription ?? "",
			}));
	}

	/** The stage's drawn row (resolved from the pack, for the detail panel). */
	async #drawnDetail(): Promise<{
		name: string;
		summary: string;
		description: string;
	} | null> {
		const stage = STAGES[this.step];
		if (!stage) return null;
		const drawn = this.stages[stage.key];
		if (!drawn.uuid) return null;
		const doc = (await foundry.utils.fromUuid(drawn.uuid)) as unknown as {
			name?: string;
			system?: { shortDescription?: string; description?: string };
		} | null;
		if (!doc) return null;
		return {
			name: doc.name ?? drawn.name,
			summary: doc.system?.shortDescription ?? "",
			description: doc.system?.description ?? "",
		};
	}

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(await super._prepareContext(_options as never));
		const index = Math.max(0, Math.min(this.step, STAGES.length - 1));
		this.step = index;
		const stage = STAGES[index];
		const drawn = this.stages[stage.key];
		// Development rows are keyed by species (roll field = species name);
		// the inhabitants draw feeds that stage's species filter.
		context.species = resultLabelFromRow(this.stages.inhabitants.name);
		context.stage = {
			key: stage.key,
			label: game.i18n.localize(stage.labelKey),
			hint: game.i18n.localize(stage.hintKey),
			// 1-based display (owner bug report: "0/9" was confusing).
			number: index + 1,
			index,
			total: STAGES.length,
			die: stage.die,
			state: drawn,
			last: index === STAGES.length - 1,
			drawnDetail: await this.#drawnDetail(),
		};
		context.name = this.name;
		// Running summary of every drawn row so far.
		context.drawn = STAGES.filter((s) => this.stages[s.key].uuid).map((s) => ({
			label: game.i18n.localize(s.labelKey),
			name: this.stages[s.key].label || resultLabelFromRow(this.stages[s.key].name),
			roll: this.stages[s.key].roll,
		}));
		return context;
	}

	protected override async _onRender(
		context: unknown,
		options: unknown,
	): Promise<void> {
		await super._onRender(context as never, options as never);
		// Free-text name input wires imperatively per AGENT-GUIDE §3 (only
		// change events reach data-action).
		const input = this.element?.querySelector<HTMLInputElement>(
			'input[name="planet-name"]',
		);
		if (input && !input.dataset.wired) {
			input.dataset.wired = "1";
			input.addEventListener("input", () => {
				this.name = input.value;
			});
		}
	}

	/**
	 * Roll the stage's die (+ GM modifier, NOT clamped — the SOI tables use
	 * open-ended bounds like "0 or lower"/"11 or higher", so modified
	 * results legitimately fall outside the die's face range) and resolve
	 * the draw per the stage mode.
	 */
	async #onRollStage(stageKey: string): Promise<void> {
		const stage = STAGES.find((s) => s.key === stageKey);
		if (!stage) return;
		const state = this.stages[stageKey];
		const roll = new foundry.dice.Roll(`1d${stage.die}`);
		await roll.evaluate();
		const raw = roll.total ?? 1;
		// Effective result keeps the book's open-ended semantics: e.g.
		// Climate 10 + 2 → 12 matches "11 or higher"; no clamping.
		const result = raw + state.modifier;
		const options = await this.#stageOptions(stage.kind);
		if (options.length === 0) {
			ui.notifications?.warn(
				game.i18n.format("PLANET_CREATOR.NO_ROWS", { kind: stage.kind }),
			);
			return;
		}
		// Gravity/Orbital rows split per planetary body type — filter to the
		// drawn Body's family (Rocky vs Gas Giant).
		const filtered =
			stage.key === "gravity" || stage.key === "orbital"
				? filterByBodyType(options, resultLabelFromRow(this.stages.body.name))
				: options;
		if (filtered.length === 0) {
			ui.notifications?.warn(
				game.i18n.format("PLANET_CREATOR.NO_ROWS", { kind: stage.kind }),
			);
			return;
		}
		let row: PackRow | undefined;
		let label = "";
		if (stage.mode === "count") {
			// Number of Territories (Table 1-13): the kind carries ONE
			// reference row; the count is the die + modifiers.
			row = filtered[0];
			label = String(result);
		} else if (stage.mode === "map") {
			// Inhabitants (Table 1-26): one reference row, the die resolves
			// against its prose roll map.
			row = filtered[0];
			label = matchRollMap(parseRollMap(row.summary), result) ?? "";
		} else if (stage.mode === "subtable") {
			// Development (Table 1-27): rows are keyed by species — pick the
			// inhabitants species' row, then resolve its prose sub-map.
			const species = this.stages.inhabitants.label;
			row = filtered.find(
				(o) =>
					o.roll.toLowerCase() === species.toLowerCase() ||
					o.name.toLowerCase().includes(species.toLowerCase()),
			);
			if (!row) {
				ui.notifications?.warn(
					game.i18n.format("PLANET_CREATOR.NO_SPECIES_ROW", {
						species,
					}),
				);
				return;
			}
			label = matchRollMap(parseRollMap(row.summary), result) ?? "";
		} else {
			row = filtered.find((o) => rollMatchesRange(o.roll, result));
			if (row) label = resultLabelFromRow(row.name);
		}
		if (!row) {
			ui.notifications?.warn(
				game.i18n.format("PLANET_CREATOR.NO_MATCH", {
					result: String(result),
				}),
			);
			return;
		}
		state.uuid = row.uuid;
		state.name = row.name;
		state.roll = row.roll;
		state.summary = row.summary;
		state.result = raw;
		state.label = label;
		// Snapshot the headline profile field: ranged stages use the drawn
		// row's name; reference stages use the resolved sub-result.
		const field = FIELD_BY_STAGE[stageKey];
		if (field) {
			this.profile = {
				...this.profile,
				[field]: label || resultLabelFromRow(row.name),
			};
		}
		if (stageKey === "territories") {
			this.profile = {
				...this.profile,
				territories: label,
			};
		}
		this.render({ force: true });
	}

	static async #onRoll(
		this: PlanetCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const stageKey = target.dataset.stage ?? "";
		await this.#onRollStage(stageKey);
	}

	static async #onBump(
		this: PlanetCreator,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const stageKey = target.dataset.stage;
		if (!stageKey) return;
		const state = this.stages[stageKey];
		if (!state) return;
		state.modifier += Number(target.dataset.delta ?? 0);
		this.render({ force: true });
	}

	/** Create/update the planet actor with the profile + attached rows. */
	static async #onFinish(this: PlanetCreator): Promise<void> {
		// At least one draw is required (a bare name creates an empty world).
		const drawnStages = STAGES.filter((s) => this.stages[s.key].uuid);
		const payloads: Array<Record<string, unknown>> = [];
		for (const stage of drawnStages) {
			const state = this.stages[stage.key];
			const doc = (await foundry.utils.fromUuid(state.uuid)) as unknown as {
				name?: string;
				system?: Record<string, unknown>;
			} | null;
			if (!doc?.system) {
				console.warn(
					`rogue-trader | planet creator: drawn row "${state.name}" (${state.uuid}) did not resolve; skipped loudly`,
				);
				continue;
			}
			payloads.push({
				...(doc as unknown as Record<string, unknown>),
				system: {
					...(doc.system ?? {}),
					grantedBy: "planet-creator",
				},
			});
		}
		const systemPayload = { ...this.profile };
		if (this.targetActor) {
			const target = this.targetActor as unknown as {
				update: (data: object) => Promise<unknown>;
				items: Array<{
					id?: string;
					type?: string;
					system?: { grantedBy?: string };
				}>;
				createEmbeddedDocuments: (
					t: string,
					data: object[],
				) => Promise<unknown>;
				deleteEmbeddedDocuments: (
					t: string,
					ids: string[],
				) => Promise<unknown>;
				sheet?: { render: (options?: object) => unknown };
			};
			// iufv reconcile: wipe previously creator-installed rows; manual
			// drag-attached rows survive.
			const stale = target.items
				.filter(
					(i) =>
						i.type === "game-table" &&
						i.system?.grantedBy === "planet-creator",
				)
				.map((i) => i.id)
				.filter((id): id is string => Boolean(id));
			if (stale.length > 0) {
				await target.deleteEmbeddedDocuments("Item", stale);
			}
			await target.update({
				name: this.name || this.targetActor.name,
				system: systemPayload,
			} as never);
			if (payloads.length > 0) {
				await target.createEmbeddedDocuments("Item", payloads);
			}
			this.close();
			target.sheet?.render({});
			return;
		}
		const actor = (await foundry.documents.Actor.create({
			name: this.name || game.i18n.localize("PLANET_CREATOR.DEFAULT_NAME"),
			type: "planet",
			system: systemPayload,
		} as never)) as unknown as {
			createEmbeddedDocuments: (
				t: string,
				data: object[],
			) => Promise<unknown>;
			sheet?: { render: (options?: object) => unknown };
		};
		if (!actor) return;
		if (payloads.length > 0) {
			await actor.createEmbeddedDocuments("Item", payloads);
		}
		this.close();
		actor.sheet?.render({});
	}
}
/** Gravity/Orbital option families: filter to the drawn Body's type. */
function filterByBodyType(rows: PackRow[], bodyLabel: string): PackRow[] {
	const gasGiant = bodyLabel.toLowerCase().includes("gas giant");
	const wanted = gasGiant ? "gas giant" : "rocky";
	const matches = rows.filter((o) =>
		`${o.roll} ${o.name}`.toLowerCase().includes(wanted),
	);
	// Loud-ish fallback: unknown labels return the unfiltered list.
	return matches.length > 0 ? matches : rows;
}

/**
 * Table 8-10 Manoeuvre row handlers (epic necp bead g53f, Core Rulebook
 * pp213-215, 218). The shared ship-action handler (S1, presentation/rolls/
 * ship-action.ts) owns the combined-test machinery for EVERY ship-action row;
 * this module holds only what the MANOEUVRE rows add on top:
 *
 * - The default Manoeuvre is FREE — no test (printed p213, file page-0214:
 *   "This is the default action of a starship … players do not have the
 *   option of simply not moving their ship") — it renders as an
 *   informational chip, never a roll (`defaultManoeuvreChip`).
 * - The boarding lock gate (p215): a boarded ship takes no Manoeuvre
 *   Actions (S2's shipLockGate, "manoeuvre" class).
 * - The Silent Running interplay (p218): a related test advances ONE
 *   difficulty step — a VISIBLE −10 row on the RT ladder — and the default
 *   Manoeuvre itself requires an Ordinary (+10) test while the flag stands.
 * - Disengage (pp214-215): the may-not-perform-within-8-VUs gate is a GM
 *   PROMPT with manual distance entry (v1 has no spatial sim, owner ruling
 *   in the bead) — never an automatic refusal; the card posts both sides'
 *   requirements, the no-re-engage note and the Stern-Chase exclusion.
 * - Success-gated turn flag writes (decision 3): Come to New Heading's −20
 *   BS this turn (p214) and Evasive Manoeuvres' −10 both halves (p215).
 *   S2 owns the CONSUMPTION (salvoTurnFlagRows); this module only WRITES.
 * - The facing note (printed p213, file page-0214): transports, raiders,
 *   frigates and hulls of equivalent size may turn up to 90 degrees, all
 *   other hulls 45 — stated on the card for the GM, never enforced (v1
 *   non-goal: no turn-angle machinery).
 *
 * Dispatch: `manoeuvreRowHandlers` is keyed by the pack row's verbatim NAME
 * (every Table 8-10 row shares the printed test
 * "pilot-space-craft+manoeuvrability", so the name is the row's only
 * discriminator). A ship-action row whose name is in the map gets the
 * manoeuvre overlay; every other row (the Table 8-11 extended rows) stays
 * on the generic S1 path.
 */

import type {
	Modifier,
	ShipTurnFlag,
	ShipTurnFlagKey,
} from "../../../rules-engine/index";
import { shipLockGate } from "../../../rules-engine/index";
import type { ShipBoardingState } from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { escapeDocumentData } from "../roll-prompts";

// ------------------------------------------------------------- facing (p213)

/**
 * The hull classes the book's 90-degree rule covers (printed p213, file
 * page-0214): "Transports, raiders, frigates, and other ships of equivalent
 * size (i.e., Hull Integrity and Available Space) can turn up to 90 degrees
 * … all other ships may turn up to 45 degrees instead." Ship classes follow
 * the ships pack's `hullClass` slugs; escort (Battlefleet Koronus) is
 * frigate-equivalent. Anything UNKNOWN falls to the book default (45).
 */
const FACING_90_CLASSES: readonly string[] = [
	"transport",
	"raider",
	"frigate",
	"escort",
];

/** The allowed turn for a hull class, in degrees (90 or 45). */
export function facingDegrees(hullClass: string): 45 | 90 {
	return FACING_90_CLASSES.includes(hullClass.trim().toLowerCase())
		? 90
		: 45;
}

/** The facing rule as a GM-visible i18n label (never enforced in v1). */
export function facingLabel(hullClass: string): string {
	return getPorts().i18n.t("SHIP_ACTION.FACING_NOTE", {
		degrees: facingDegrees(hullClass),
	});
}

// --------------------------------------------------------------- the rows

/** The success-gated turn flag a row writes (decision 3, S2 consumes). */
export interface ManoeuvreFlagSpec {
	/** Stable flag id (re-application REPLACES, never stacks). */
	id: string;
	key: ShipTurnFlagKey;
	/** Signed BS modifier the flag carries. */
	value: number;
	/** The localised "flag set" confirmation line's i18n key. */
	confirmKey: string;
}

/** A manoeuvre row's extra behaviour over the generic S1 combined test. */
export interface ManoeuvreRow {
	/** Stable machine key (notes, i18n). */
	key: string;
	/** The flag written on success (Come to New Heading, Evasive, p214-215). */
	flag?: ManoeuvreFlagSpec;
	/**
	 * Disengage's distance gate (printed p214: may not be performed within
	 * 8 VUs of any enemy): a GM PROMPT with manual entry, not a spatial sim.
	 */
	distanceGate?: boolean;
}

/**
 * The Table 8-10 rows (bead ca3x's pack names verbatim). All six carry the
 * overlay so the Silent Running step row and the facing note land on every
 * manoeuvre; the after-effects differ per row.
 */
export const manoeuvreRowHandlers: Readonly<
	Record<string, ManoeuvreRow>
> = {
	"Adjust Bearing": { key: "adjust-bearing" },
	"Adjust Speed": { key: "adjust-speed" },
	"Adjust Speed & Bearing": { key: "adjust-speed-bearing" },
	"Come to New Heading": {
		key: "come-to-new-heading",
		// Core Rulebook p214: "The ship suffers –20 to any Ballistic Skill
		// Tests to fire its weapons during this turn." Target "all" — the
		// penalty is weapon-wide; expiresAtTurn null = cleared at the ship's
		// next own Strategic Turn (S2's expiry discipline).
		flag: {
			id: "flag:come-to-new-heading",
			key: "come-to-new-heading-bs-penalty",
			value: -20,
			confirmKey: "SHIP_ACTION.HEADING_SET",
		},
	},
	Disengage: { key: "disengage", distanceGate: true },
	"Evasive Manoeuvres": {
		key: "evasive",
		// Core Rulebook p215: −10 to all shooting directed at the ship AND
		// the same −10 to its own fire — ONE flag, BOTH read paths are S2's
		// (salvoTurnFlagRows reads the firer's and the target's flags); this
		// bead only writes. Flat −10: each degree imposes the same −10 (the
		// book's "Success (and every subsequent degree of success)" does not
		// stack a value it names once).
		flag: {
			id: "flag:evasive",
			key: "evasive",
			value: -10,
			confirmKey: "SHIP_ACTION.EVASIVE_SET",
		},
	},
};

/** The manoeuvre row for a ship-action item's name, or null. */
export function manoeuvreRow(name: string): ManoeuvreRow | null {
	return manoeuvreRowHandlers[name] ?? null;
}

// ------------------------------------------------------------ prepare-side

/**
 * The Disengage distance gate's prompt (Core Rulebook p214): a MANUAL entry
 * of the current distance to the nearest enemy ship in VUs — a GM prompt,
 * NOT an auto-refusal from any spatial model (v1 non-goal). Null = skipped
 * (cancel): the gate never blocks without an answer.
 */
async function promptDisengageDistance(): Promise<number | null> {
	const ports = getPorts();
	const result = (await foundry.applications.api.DialogV2.input({
		window: { title: ports.i18n.t("SHIP_ACTION.DISENGAGE_DISTANCE_TITLE") },
		content: `<p>${ports.i18n.t("SHIP_ACTION.DISENGAGE_DISTANCE_PROMPT")}</p>`,
		ok: { label: ports.i18n.t("SHIP_COMBAT.CRITICAL_APPLY") },
	})) as { distance?: string } | null;
	const entered = result?.distance?.trim();
	if (!entered) return null;
	const value = Number(entered);
	return Number.isFinite(value) ? Math.max(0, value) : null;
}

/**
 * The manoeuvre overlay's prepare side. Returns the EXTRA pre-dialog
 * modifier rows (the Silent Running one-step advance), or null when the row
 * must be REFUSED (the boarding lock, or the Disengage gate where the GM
 * confirms within 8 VUs — the manual-entry prompt, not a spatial refusal).
 */
export async function manoeuvreRowPrepare(
	row: ManoeuvreRow,
	ship: Actor,
): Promise<Modifier[] | null> {
	const ports = getPorts();
	// The boarding lock (Core Rulebook p215): "neither of them can take
	// Manoeuvre or Shooting Actions" — the manoeuvre class refuses loudly
	// before any prompt or dialog (the salvo handler's "shooting" mirror).
	const lockGate = shipLockGate(
		(systemOf(ship) as unknown as { boardedWith?: ShipBoardingState })
			.boardedWith,
		"manoeuvre",
	);
	if (!lockGate.allowed) {
		ports.notify.warn("SHIP_COMBAT.BOARDED_NO_MANOEUVRE");
		return null;
	}
	if (row.distanceGate) {
		// Disengage (printed p214): "This Manoeuvre may not be performed if
		// the starship is within 8 VUs of any enemy." The GM answers with a
		// MANUAL distance entry (owner ruling: no spatial sim in v1);
		// cancelling skips the gate entirely — the card still posts the
		// requirement. A confirmed entry below 8 refuses LOUDLY.
		const distance = await promptDisengageDistance();
		if (distance !== null && distance < 8) {
			ports.notify.warn("SHIP_ACTION.DISENGAGE_WITHIN_8", {
				ship: ship.name ?? "",
			});
			return null;
		}
	}
	const extra: Modifier[] = [];
	// Silent Running interplay (Core Rulebook p218): "the difficulty of all
	// related Skill Tests increases by one step" — one RT-ladder step (−10)
	// as a VISIBLE row; a silent modifier is a bug.
	const starship = systemOf(ship) as unknown as {
		silentRunning?: boolean;
		hullClass?: string;
	};
	if (starship.silentRunning) {
		extra.push({
			id: "ship:silent-running",
			source: { type: "item", label: "SHIP_ACTION.SILENT_RUNNING" },
			label: ports.i18n.t("SHIP_ACTION.SILENT_RUNNING_STEP"),
			value: -10,
		});
	}
	return extra;
}

// -------------------------------------------------------------- after-side

/**
 * The manoeuvre overlay's after side: the success-gated turn-flag writes
 * (Come to New Heading p214, Evasive Manoeuvres p215) and the row's GM note
 * card — the facing note (p213) plus, for Disengage, both sides'
 * requirements, the no-fire-either-way note and the no-re-engage /
 * Stern-Chase exclusion (pp214-215). Runs for BOTH outcomes: Disengage's
 * no-fire note holds whether the test succeeded or failed (p215).
 */
export async function manoeuvreRowAfter(
	row: ManoeuvreRow,
	ship: Actor,
	outcome: { success: boolean; degrees: number },
): Promise<void> {
	const ports = getPorts();
	const starship = systemOf(ship) as unknown as {
		turnFlags?: ShipTurnFlag[];
		hullClass?: string;
	};
	const notes: string[] = [
		// The facing note rides EVERY manoeuvre card (p213, GM-visible,
		// never enforced in v1).
		facingLabel(starship.hullClass ?? ""),
	];
	if (row.flag) {
		if (outcome.success) {
			// One write per success (the bead 6l68 idiom): the same key is
			// REPLACED — re-manoeuvring never stacks; persistent flags
			// (Repel Boarders!) are never touched by a manoeuvre row.
			const spec = row.flag;
			const surviving = (starship.turnFlags ?? []).filter(
				(flag) => !(flag.key === spec.key && !flag.persistent),
			);
			const flag: ShipTurnFlag = {
				id: spec.id,
				key: spec.key,
				value: spec.value,
				target: "all",
				expiresAtTurn: null,
				persistent: false,
			};
			await ports.actors.update(ship, {
				system: { turnFlags: [...surviving, flag] },
			});
			notes.push(ports.i18n.t(spec.confirmKey));
		}
		// A failure writes nothing: the flag machinery only fires on success
		// (the book gives the benefit to a scored success, p214-215).
	} else if (row.distanceGate) {
		// Disengage (Core Rulebook pp214-215): the card posts BOTH sides'
		// requirements — the opposed side rolls manually (owner standing
		// ruling) — and the no-fire note holds either way.
		notes.push(ports.i18n.t("SHIP_ACTION.DISENGAGE_OPPOSED_NOTE"));
		notes.push(ports.i18n.t("SHIP_ACTION.DISENGAGE_NO_FIRE"));
		if (outcome.success) {
			notes.push(
				ports.i18n.t("SHIP_ACTION.DISENGAGE_NO_REENGAGE"),
			);
		}
	}
	await postManoeuvreNotes(ship, notes);
}

// ------------------------------------------------------------- the note card

/** One GM-note card for a manoeuvre roll (the postHtml note idiom, the
 * evasion-precedent weapon.ts): header = the ship, one `<p class="note">`
 * per localised line — document-data interpolation escapes like everywhere.
 */
async function postManoeuvreNotes(
	ship: Actor,
	notes: string[],
): Promise<void> {
	const ports = getPorts();
	try {
		await ports.chat.postHtml(
			ship,
			`<div class="rogue-trader chat action">` +
				`<div class="background border"><h1>${escapeDocumentData(
					ship.name ?? "",
				)}</h1>${notes
					.map((note) => `<p class="note">${note}</p>`)
					.join("")}</div></div>`,
		);
	} catch (error) {
		console.error("rogue-trader | manoeuvre note card failed", error);
	}
}

// ------------------------------------------------- the default Manoeuvre chip

/**
 * The default Manoeuvre (Core Rulebook p213, file page-0214): FREE — the
 * ship moves directly forward by its full Speed value or half its Speed
 * value, then may turn; "players do not have the option of simply not
 * moving their ship". On a failed Manoeuvre Action the ship falls back to
 * exactly this (p214). It involves NO TEST on the open void — the chip is
 * informational and rolls no dice; the facing note (90° vs 45°, p213) and,
 * under Silent Running (p218), the Ordinary (+10) requirement + halved
 * Speed + betrayed-position rules ride the same chip.
 */
export async function defaultManoeuvreChip(ship: Actor): Promise<void> {
	const ports = getPorts();
	const starship = systemOf(ship) as unknown as {
		silentRunning?: boolean;
		hullClass?: string;
	};
	const notes = [
		// The default Manoeuvre is FREE — no test (p213): the chip is purely
		// informational. Under Silent Running (p218) the DEFAULT manoeuvre
		// becomes a rolled Ordinary (+10) Pilot (Space Craft)+ Manoeuvrability
		// test — the chip SAYS so (the halved Speed and the betrayed-position
		// consequence too); the rolled form waits for the Ship Combat tab's
		// chip wiring (bead 7gcm), because a FREE manoeuvre owns no
		// ship-action item to route through the combined-test pipeline.
		ports.i18n.t("SHIP_ACTION.DEFAULT_MANOEUVRE"),
		facingLabel(starship.hullClass ?? ""),
	];
	if (starship.silentRunning) {
		notes.push(
			ports.i18n.t("SHIP_ACTION.DEFAULT_MANOEUVRE_SILENT_RUNNING"),
		);
	}
	await ports.chat.postHtml(
		ship,
		`<div class="rogue-trader chat action">` +
			`<div class="background border"><h1>${escapeDocumentData(
				ship.name ?? "",
			)} — ${ports.i18n.t("SHIP_ACTION.DEFAULT_MANOEUVRE_TITLE")}</h1>` +
			notes.map((note) => `<p class="note">${note}</p>`).join("") +
			`</div></div>`,
	);
}
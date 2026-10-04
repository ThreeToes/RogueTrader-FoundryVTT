/**
 * Encumbrance rules (pure, data-in/data-out).
 *
 * Core Rulebook p267-268: the amount a character can carry depends on the SUM
 * of his Strength Bonus and Toughness Bonus, looked up in the non-linear
 * Table 9-33 (printed p268; extracted raw text file page-0269 — verified
 * 2026-10-04 against page-0269.raw.txt, all three columns, 21 rows each).
 * "If a character attempts to carry more than his normal carrying limits (but
 * less than his lifting limit), he is Encumbered" (p268).
 *
 * Advisory-not-gate posture (owner decision xhcc): nothing behaviour-locks on
 * this; the load bar and cache take-warning just report correctly. The
 * Encumbered PENALTIES (-10 movement tests, AB-1 for movement/Initiative,
 * TB-hours fatigue clock, p268) are separate machinery, deliberately not
 * implemented here — see the report on bead qhkv.
 */

/** Core Rulebook Table 9-33, "Maximum Carrying Weight" column (printed p268;
 * verified against src/packs/extracted-text/rt_core/page-0269.raw.txt).
 * Index = the sum of Strength Bonus and Toughness Bonus, 0..20. */
export const CARRYING_WEIGHT_TABLE = [
	0.9, 2.25, 4.5, 9, 18, 27, 36, 45, 56, 67, 78, 90, 112, 225, 337, 450, 675,
	900, 1350, 1800, 2250,
] as const;

/** Core Rulebook Table 9-33, "Maximum Lifting Weight" column (printed p268;
 * verified against page-0269.raw.txt). Index = SB+TB, 0..20. */
export const LIFTING_WEIGHT_TABLE = [
	2.25, 4.5, 9, 18, 36, 54, 72, 90, 112, 135, 157, 180, 225, 450, 675, 900,
	1350, 1800, 2700, 3600, 4500,
] as const;

/** Core Rulebook Table 9-33, "Maximum Pushing Weight" column (printed p268;
 * verified against page-0269.raw.txt). Index = SB+TB, 0..20. Exported as
 * pure book data for later display use; unused by code paths today. */
export const PUSHING_WEIGHT_TABLE = [
	4.5, 9, 18, 36, 72, 108, 144, 180, 225, 270, 315, 360, 450, 900, 1350, 1800,
	2700, 3600, 5400, 7200, 9000,
] as const;

const TABLE_MAX = 20;

/** Table 9-33 lookup by SB+TB, clamped to the printed 0..20 range. */
export function carryingCapacity(strengthBonus: number): number {
	const index = Math.min(TABLE_MAX, Math.max(0, Math.floor(strengthBonus)));
	return CARRYING_WEIGHT_TABLE[index];
}

/** Table 9-33 Lifting column lookup (same clamping), for the encumbered/over
 * boundary. Kept alongside carryingCapacity so the two can never drift. */
export function liftingCapacity(strengthBonus: number): number {
	const index = Math.min(TABLE_MAX, Math.max(0, Math.floor(strengthBonus)));
	return LIFTING_WEIGHT_TABLE[index];
}

export interface EncumbranceOutcome {
	/** Carried weight in kg (caller-aggregated, echoed for display). */
	weight: number;
	/** Carrying capacity in kg (0 = no capacity available). */
	capacity: number;
	/** weight / capacity, clamped 0..1 (0 when capacity unset). */
	ratio: number;
	/**
	 * 0..100 progress percentage for bars; can exceed 100 when over capacity.
	 */
	percent: number;
	/**
	 * Book states (p268): ok = weight <= Carrying Weight; encumbered =
	 * weight > Carrying Weight (up to the Lifting Weight). "over" (> Lifting
	 * Weight) is a UI convention for the bar, NOT a book state — the book
	 * simply says the character cannot carry more than his Lifting Weight.
	 */
	state: "ok" | "encumbered" | "over";
	/** i18n key for the state label (keys are uppercase in the lang files). */
	stateLabel:
		| "INVENTORY.STATE_OK"
		| "INVENTORY.STATE_ENCUMBERED"
		| "INVENTORY.STATE_OVER";
}

/** Table 9-33 lookup for weight and the lifting/over boundary. */
export function resolveEncumbrance(
	weightKg: number,
	capacityKg: number,
	liftingKg = 0,
): EncumbranceOutcome {
	const weight = Math.max(0, weightKg);
	const capacity = Math.max(0, capacityKg);
	const lifting = Math.max(0, liftingKg);
	const ratio = capacity > 0 ? weight / capacity : 0;
	const percent = Math.round(ratio * 100);
	// Advisory posture: no capacity known (0) can never be encumbered/over.
	let state: EncumbranceOutcome["state"];
	if (capacity <= 0) {
		state = "ok";
	} else if (weight <= capacity) {
		state = "ok";
	} else if (capacity === lifting || weight > lifting) {
		// No lifting data (or past it): everything above carrying is "over".
		// Book boundary is still carrying < weight for encumbered; with lifting
		// known and weight inside it, this branch is not reached.
		state = "over";
	} else {
		state = "encumbered";
	}
	const stateLabel =
		`INVENTORY.STATE_${state.toUpperCase()}` as EncumbranceOutcome["stateLabel"];
	return { weight, capacity, ratio, percent, state, stateLabel };
}

/** Minimal owned-item shape for the encumbrance weight sum. */
export interface CarriedItemLike {
	type?: string;
	weight?: number;
	/** Copies of this item that ride along (Gear base; 0 means spent). */
	quantity?: number;
	/** Accepted for structural compatibility with raw items; IGNORED by the
	 * sum (stowed counts — owner decision 2026-09-08, bead xhcc). */
	equipState?: string;
}

/**
 * Total carried load (owner decision 2026-09-08, bead xhcc): ALL inventoried
 * weight counts — worn and stowed armour, carried AND stowed weapons/gear.
 * Stowed items are still hauled on the person, so they weigh; this supersedes
 * bead yar's READY-only rule (which zeroed a fully stowed load). Equip state
 * remains meaningful for the attack equip-gate (rules/adapter.ts), which is
 * unaffected. Each item's weight is multiplied by its quantity (default 1;
 * bead 1sxq follow-up — a stack of 6 frag grenades weighs 6x, not once, and
 * a depleted quantity-0 stack weighs nothing). Negative weights and
 * quantities clamp to zero per item.
 */
export function carriedWeight(items: CarriedItemLike[]): number {
	return items.reduce(
		(sum, item) =>
			sum +
			Math.max(0, item.weight ?? 0) *
				Math.max(0, Math.floor(item.quantity ?? 1)),
		0,
	);
}

/**
 * Owned-item types that count toward carried weight.
 *
 * ONE definition, shared by every surface that shows a load (the character
 * sheet's bar and the cache sheet's take-check). Two copies of this list is
 * exactly how the two would drift apart.
 */
export const CARRIED_ITEM_TYPES = [
	"melee-weapon",
	"ranged-weapon",
	"armour",
	"gear",
] as const;

/**
 * Minimal owned-item shape: its type and its system data.
 *
 * `system` is `unknown` rather than `{ weight?: unknown }` on purpose: a real
 * Foundry Item's `system` is typed as `UnknownSourceData` by fvtt-types, which
 * is not assignable to an object-with-optional-weight, so a narrower shape
 * makes every call site cast. The weight is read defensively below instead.
 */
export interface OwnedItemLike {
	type?: string;
	system?: unknown;
}

/**
 * Encumbrance for an actor's owned items, keyed on the Core Rulebook p267
 * rule: capacity comes from Table 9-33 at the sum of Strength Bonus and
 * Toughness Bonus (pass sbPlusTb = SB + TB). The caller may pass the manual
 * maxCarriage override as `capacityOverride`; when that is set (> 0) the
 * manual field wins (existing owner decision) and the table is the default.
 *
 * The type filter lives here rather than at each call site. Note this counts
 * STOWED items too — owner decision 2026-09-08, bead xhcc, which superseded
 * bead yar's READY-only rule (a fully stowed load still weighs).
 */
export function actorEncumbrance(
	items: Iterable<OwnedItemLike>,
	sbPlusTb: number,
	capacityOverride = 0,
): EncumbranceOutcome {
	const carried: CarriedItemLike[] = [];
	for (const item of items) {
		if (!(CARRIED_ITEM_TYPES as readonly string[]).includes(item.type ?? "")) {
			continue;
		}
		const system = item.system as
			| { weight?: unknown; quantity?: unknown }
			| undefined;
		const weight = Number(system?.weight ?? 0);
		const quantity = Number(system?.quantity ?? 1);
		carried.push({
			type: item.type,
			weight: Number.isFinite(weight) ? weight : 0,
			quantity: Number.isFinite(quantity) ? quantity : 1,
		});
	}
	const capacity =
		capacityOverride > 0 ? capacityOverride : carryingCapacity(sbPlusTb);
	// Manual-override wins for the OVER boundary too: make lifting track the
	// capacity in use so the bar's banding stays monotonic.
	const lifting = capacityOverride > 0 ? capacity : liftingCapacity(sbPlusTb);
	return resolveEncumbrance(carriedWeight(carried), capacity, lifting);
}
/**
 * Encumbrance rules (pure, data-in/data-out).
 *
 * v1 scope: carried weight is aggregated by the caller (sum of owned item
 * weights); capacity comes from the actor's manual maxCarriage field.
 * Thresholds are centralised here as the single place to tune (values are
 * remembered RT core rules, VERIFY against the book - the SB-based capacity
 * derivation deliberately stays OUT until the equip-state/container schema
 * work lands, see bead 94p).
 */

export interface EncumbranceOutcome {
	/** Carried weight in kg (caller-aggregated, echoed for display). */
	weight: number;
	/** Capacity in kg (0 = no capacity set). */
	capacity: number;
	/** weight / capacity, clamped 0..1 (0 when capacity unset). */
	ratio: number;
	/**
	 * 0..100 progress percentage for bars; can exceed 100 when over capacity.
	 */
	percent: number;
	/** ok < ENCUMBERED_AT, encumbered from ENCUMBERED_AT, over past 100%. */
	state: "ok" | "encumbered" | "over";
	/** i18n key for the state label (keys are uppercase in the lang files). */
	stateLabel:
		| "INVENTORY.STATE_OK"
		| "INVENTORY.STATE_ENCUMBERED"
		| "INVENTORY.STATE_OVER";
}

export const ENCUMBERED_AT = 0.8; // fraction of capacity (VERIFY)

/**
 * Default kilograms of capacity per Strength Bonus (best-effort RT core rule,
 * VERIFY against the book). Used only when the manual maxCarriage field is 0.
 */
export const CAPACITY_PER_STRENGTH_BONUS = 3; // VERIFY

/** Derived capacity from Strength Bonus when no manual value is set. */
export function deriveCapacity(strengthBonus: number): number {
	return Math.max(0, strengthBonus) * CAPACITY_PER_STRENGTH_BONUS;
}

export function resolveEncumbrance(
	weightKg: number,
	capacityKg: number,
): EncumbranceOutcome {
	const weight = Math.max(0, weightKg);
	const capacity = Math.max(0, capacityKg);
	const ratio = capacity > 0 ? weight / capacity : 0;
	const percent = Math.round(ratio * 100);
	let state: EncumbranceOutcome["state"] = "ok";
	if (capacity > 0 && ratio > 1) state = "over";
	else if (capacity > 0 && ratio >= ENCUMBERED_AT) state = "encumbered";
	const stateLabel =
		`INVENTORY.STATE_${state.toUpperCase()}` as EncumbranceOutcome["stateLabel"];
	return { weight, capacity, ratio, percent, state, stateLabel };
}

/** Minimal owned-item shape for the encumbrance weight sum. */
export interface CarriedItemLike {
	type?: string;
	weight?: number;
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
 * unaffected. Negative weights clamp to zero per item.
 */
export function carriedWeight(items: CarriedItemLike[]): number {
	return items.reduce((sum, item) => sum + Math.max(0, item.weight ?? 0), 0);
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
 * Encumbrance for an actor's owned items and Strength Bonus.
 *
 * The type filter lives here rather than at each call site. Note this counts
 * STOWED items too — owner decision 2026-09-08, bead xhcc, which superseded
 * bead yar's READY-only rule (a fully stowed load still weighs).
 */
export function actorEncumbrance(
	items: Iterable<OwnedItemLike>,
	strengthBonus: number,
): EncumbranceOutcome {
	const carried: CarriedItemLike[] = [];
	for (const item of items) {
		if (!(CARRIED_ITEM_TYPES as readonly string[]).includes(item.type ?? "")) {
			continue;
		}
		const weight = Number(
			(item.system as { weight?: unknown } | undefined)?.weight ?? 0,
		);
		carried.push({ type: item.type, weight });
	}
	return resolveEncumbrance(carriedWeight(carried), deriveCapacity(strengthBonus));
}

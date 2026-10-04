/**
 * Ordnance quantity bookkeeping, shared by every decrement site (bead 9b95
 * F1): the auto-consume funnel (rules/adapter.ts consumeFiredOrdnance) and the
 * damage card's manual −1 chip (presentation/chat-actions.ts
 * spendOrdnanceFromCard) MUST read, write and announce through this one helper
 * so their semantics cannot drift apart again. The only deliberate difference
 * — what an empty (or corrupt) quantity means — is explicit in the signature.
 *
 * Foundry-facing (uses the ports); the shots-spent mapping below is pure.
 */

import { getPorts } from "../infrastructure/foundry/ports";

/** Structural view of a quantity-bearing item document. */
interface QuantityBearingItem {
	name?: string;
	system?: { quantity?: unknown };
}

/** What an empty/corrupt quantity means for a decrement. */
export type DecrementEmptyBehaviour =
	/** The item is DRY: warn ROLL.LAUNCHER_UNLOADED and write NOTHING. */
	| "refuse"
	/** Manual spend chip: keep today's behaviour — clamp at 0 and still book. */
	| "clamp";

/** The launcher's RoF block (numbers or the book's "–" strings). */
export interface RateOfFireLike {
	singleShot?: boolean | string;
	burst?: number | string;
	fullAuto?: number | string;
}

/** Fire modes the attack dialog offers (mirrors RollContext.fireMode). */
export type FireMode = "single" | "burst" | "full";

/**
 * How many shots one attack spends, from the selected fire mode and the
 * launcher's own rateOfFire (bead 9b95 F6 — book RoF semantics, Core
 * Rulebook Tables 5-5/5-6: single = 1, burst = the burst column, full auto =
 * the full column):
 *
 *   - "single" (or no mode with a single-shot-only launcher) is 1;
 *   - "burst"/"full" read the launcher's printed RoF value;
 *   - NO mode available (the sheet quick-damage path carries no to-hit
 *     context) is 1 ONLY when the launcher is single-shot-only — otherwise
 *     it REFUSES, because "one damage roll = one shot" is book-true only for
 *     S/–/– launchers and silently consuming 1 for a burst is wrong.
 *
 * Returns `null` when the shots cannot be resolved honestly (a burst/full
 * mode with a missing/zero RoF value, or a burst-capable launcher with no
 * mode available): the caller must warn and skip the consume, never guess.
 */
export function shotsForFireMode(
	fireMode: FireMode | null | undefined,
	rateOfFire: RateOfFireLike | null | undefined,
): number | null {
	if (fireMode === "single") return 1;
	const burst = Number(rateOfFire?.burst ?? 0);
	const fullAuto = Number(rateOfFire?.fullAuto ?? 0);
	const singleOnly = !(burst > 0 || fullAuto > 0);
	if (fireMode === undefined || fireMode === null) {
		return singleOnly ? 1 : null;
	}
	const printed = fireMode === "burst" ? burst : fullAuto;
	// A mode the weapon's RoF does not support is corrupt configuration —
	// the dialog offered a mode the launcher cannot print shots for.
	return Number.isFinite(printed) && printed > 0 ? printed : null;
}

/** The outcome of a decrement (the item's new quantity) — never written. */
export type DecrementResult = number | null;

/**
 * Decrement an item's quantity through the items port (loud-failure
 * convention, bead c9s3 — a failed write throws) and announce the spend with
 * CHAT.AMMO_SPENT.
 *
 * Returns the NEW quantity, or `null` when the item was REFUSED on empty
 * semantics (`onEmpty: "refuse"`: not finite or <= 0 — warned, no write) or
 * carries a non-finite quantity under `onEmpty: "clamp"` (corrupt bookkeeping
 * is never "fixed" by a spend; today's manual chip simply did nothing).
 *
 * A refused item is always a loud or silent NO-WRITE — the helper never
 * guesses and never clamps a refusal into a spend.
 */
export async function decrementQuantity(
	item: unknown,
	options: {
		onEmpty: DecrementEmptyBehaviour;
		/** Shots spent in one go (default 1 — the manual chip). */
		shots?: number;
		/** The weapon name in the ROLL.LAUNCHER_UNLOADED warn (refuse). */
		weaponName?: string;
	},
): Promise<DecrementResult> {
	const doc = item as (QuantityBearingItem & {
		name?: string;
	}) | null;
	const ports = getPorts();
	const shots = Math.max(1, Number(options.shots ?? 1));
	const current = Number(doc?.system?.quantity ?? 0);
	// A non-finite quantity is corrupt bookkeeping — writing NaN through the
	// port would be worse than refusing (refuse mode already warns below with
	// the weapon context; the manual chip historically stayed silent).
	if (!Number.isFinite(current)) {
		if (options.onEmpty === "refuse") {
			ports.notify.warn("ROLL.LAUNCHER_UNLOADED", {
				weapon: options.weaponName ?? doc?.name ?? "",
			});
		}
		return null;
	}
	if (options.onEmpty === "refuse" && current <= 0) {
		// Same warn-and-refuse path an unloaded launcher takes (bead 65sq).
		ports.notify.warn("ROLL.LAUNCHER_UNLOADED", {
			weapon: options.weaponName ?? doc?.name ?? "",
		});
		return null;
	}
	// Clamp for the burst-with-low-stock edge: firing more shots than the
	// item holds must not start writing negative quantities; the shooter
	// still sees the 0 remainder on the chip / card.
	const next = Math.max(0, current - shots);
	await ports.items.update(item, { system: { quantity: next } });
	ports.notify.info("CHAT.AMMO_SPENT", { name: doc?.name ?? "", quantity: next });
	return next;
}
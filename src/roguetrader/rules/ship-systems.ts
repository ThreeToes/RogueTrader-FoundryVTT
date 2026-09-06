/**
 * Starship systems kernel (bead om4j): pure, Foundry-free derivations over
 * the ship's installed component items. The sheet recomputes these on every
 * render so space/SP/power never drift from the installed items (Ch. VIII
 * audit finding, 2026-09-06).
 *
 * Core Rulebook references:
 * - Power: drives GENERATE ("35 Generated", Table 8-3, book p201), everything
 *   else draws a flat number; unpowered components don't function (p198-199).
 * - Space / SP: per-component columns in Tables 8-3..8-5; SP tokens are
 *   "-" (free), "1".."3", or "+1"/"+2" (Table 8-8, book p207 — the "+" form
 *   is the additional SP cost over the hull).
 * - Void shields: Single Void Shield Array = 1 shield, Multiple = 2 shields
 *   (Table 8-3, book p201; NPC statlines list the shield count).
 * - Weapon capacity slots: Dorsal/Prow/Port/Starboard (Table 8-4, book p202);
 *   broadsides must occupy a Port or Starboard slot (Table 8-4 "Broadside").
 */

export interface ShipComponentLike {
	name: string;
	power: string;
	space: number;
	sp: string;
	category?: string;
}

export interface ShipWeaponLike extends ShipComponentLike {
	slot?: string;
	special?: string;
}

export const WEAPON_SLOTS = ["dorsal", "prow", "port", "starboard"] as const;
export type WeaponSlot = (typeof WEAPON_SLOTS)[number];

/** Power a component GENERATES: "35 Generated" -> 35 (Table 8-3, book p201). */
export function parsePowerGenerated(power: string): number {
	const m = /(\d+)\s*generated/i.exec(power ?? "");
	return m ? Number(m[1]) : 0;
}

/** Power a component DRAWS: plain "5" -> 5; "-" -> 0; "35 Generated" -> 0. */
export function parsePowerDraw(power: string): number {
	const text = (power ?? "").trim();
	if (parsePowerGenerated(text) > 0) return 0;
	const n = Number(text);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * SP token to number (Table 8-8, book p207): "-" -> 0, "1".."3" as-is,
 * "+1"/"+2" -> the additional cost as a positive number.
 */
export function parseSpToken(sp: string): number {
	const text = (sp ?? "").trim();
	if (!text || text === "-") return 0;
	const n = Number(text.replace(/^\+/, ""));
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Void shields granted by an installed component (Table 8-3, book p201). */
export function voidShieldsGranted(name: string): number {
	const n = name ?? "";
	if (/multiple void shield/i.test(n)) return 2;
	if (/single void shield/i.test(n)) return 1;
	return 0;
}

/**
 * Parse a hull's weaponCapacity statline into per-slot counts. The pack uses
 * two verbatim forms (Table 8-4, book p202): "1 Prow, 1 Port, 1 Starboard"
 * and "Dorsal 1, Prow 1".
 */
export function parseWeaponCapacity(
	capacity: string,
): Partial<Record<WeaponSlot, number>> {
	const slots: Partial<Record<WeaponSlot, number>> = {};
	for (const raw of (capacity ?? "").split(",")) {
		const token = raw.trim();
		const m = /^(?:(\d+)\s+(\w+)|(\w+)\s+(\d+))$/.exec(token);
		if (!m) continue;
		const count = Number(m[1] ?? m[4]);
		const slot = (m[2] ?? m[3] ?? "").toLowerCase() as WeaponSlot;
		if (!WEAPON_SLOTS.includes(slot) || !Number.isFinite(count)) continue;
		slots[slot] = (slots[slot] ?? 0) + count;
	}
	return slots;
}

export interface DerivedShipStats {
	powerGenerated: number;
	powerUsed: number;
	/** max(0, used - generated): an unmet power deficit (book p198-199). */
	powerDeficit: number;
	spaceUsed: number;
	spSpent: number;
	voidShieldsMax: number;
}

/** Derive the ship's running totals from its installed component items. */
export function deriveShipStats(components: ShipComponentLike[]): DerivedShipStats {
	let powerGenerated = 0;
	let powerUsed = 0;
	let spaceUsed = 0;
	let spSpent = 0;
	let voidShieldsMax = 0;
	for (const c of components) {
		powerGenerated += parsePowerGenerated(c.power);
		powerUsed += parsePowerDraw(c.power);
		spaceUsed += c.space ?? 0;
		spSpent += parseSpToken(c.sp);
		voidShieldsMax += voidShieldsGranted(c.name);
	}
	return {
		powerGenerated,
		powerUsed,
		powerDeficit: Math.max(0, powerUsed - powerGenerated),
		spaceUsed,
		spSpent,
		voidShieldsMax,
	};
}

export interface WeaponSlotIssue {
	/** Weapon component name. */
	name: string;
	/** Machine-readable issue kind for i18n keying. */
	kind: "unassigned" | "unknown-slot" | "over-capacity" | "broadside-slot";
	/** The offending slot, if any. */
	slot?: string;
}

/**
 * Validate installed weapon components against the hull's declared capacity
 * slots (bead om4j, loud-failure convention): every weapon needs a slot, the
 * slot must exist on the hull and not exceed its count, and broadsides
 * (Table 8-4 "Broadside") must take Port or Starboard.
 */
export function validateWeaponSlots(
	capacity: string,
	weapons: ShipWeaponLike[],
): WeaponSlotIssue[] {
	const slots = parseWeaponCapacity(capacity);
	const used: Partial<Record<WeaponSlot, number>> = {};
	const issues: WeaponSlotIssue[] = [];

	for (const w of weapons) {
		const slot = (w.slot ?? "").toLowerCase();
		if (!slot) {
			issues.push({ name: w.name, kind: "unassigned" });
			continue;
		}
		if (!WEAPON_SLOTS.includes(slot as WeaponSlot) || !(slot in slots)) {
			issues.push({ name: w.name, kind: "unknown-slot", slot });
			continue;
		}
		const isBroadside = /broadside/i.test(`${w.name} ${w.special ?? ""}`);
		if (isBroadside && slot !== "port" && slot !== "starboard") {
			issues.push({ name: w.name, kind: "broadside-slot", slot });
			continue;
		}
		used[slot as WeaponSlot] = (used[slot as WeaponSlot] ?? 0) + 1;
	}

	for (const [slot, count] of Object.entries(used)) {
		const max = slots[slot as WeaponSlot] ?? 0;
		if ((count ?? 0) > max) {
			issues.push({
				name: slot,
				kind: "over-capacity",
				slot,
			});
		}
	}
	return issues;
}
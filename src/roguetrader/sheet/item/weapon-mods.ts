/**
 * Weapon-modification install/remove helpers (bead huaf): a weapon lists its
 * attached mods as owned item ids in `system.modifications` (the
 * loadedAmmoId pattern at array strength). Install keeps ONE doc as the
 * source of truth (dedupe + dangling-id compaction); the profile fold
 * (ffg/domain/model/attack.ts) reads the attached mods' effect rows.
 */

/** Structural shape of an owned weapon the mod machinery mutates. */
export interface WeaponWithMods {
	system?: { modifications?: string[] };
	update?: (data: object) => Promise<void>;
}

/** Read + compact the attachments: one id per entry, none dangling. */
export function attachedModIds(
	weapon: { system?: { modifications?: string[] } },
	owns: (id: string) => boolean,
): string[] {
	const ids = weapon.system?.modifications ?? [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of ids) {
		const id = String(raw);
		if (!id || seen.has(id) || !owns(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/** Install: append (deduped) and write back in one update. */
export async function installMod(
	weapon: WeaponWithMods,
	itemId: string,
	owns: (id: string) => boolean,
): Promise<void> {
	const ids = attachedModIds(weapon, owns);
	if (ids.includes(itemId)) return;
	await weapon.update?.({
		system: { modifications: [...ids, itemId] },
	});
}

/** Uninstall: drop the id (the mod item itself stays owned; delete by hand). */
export async function removeMod(
	weapon: WeaponWithMods,
	itemId: string,
	owns: (id: string) => boolean,
): Promise<void> {
	if (!weapon.update) return;
	await weapon.update({
		system: { modifications: attachedModIds(weapon, owns).filter((id) => id !== itemId) },
	});
}
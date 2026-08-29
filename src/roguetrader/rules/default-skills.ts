/**
 * Default common-skill grants at actor creation.
 *
 * The catalog compendium carries `common: true` flags on skills every
 * character begins with (RAW-minimal: Speak Language (Low Gothic)). Any
 * pc/npc actor created with no items receives grant clones of those items.
 * Actors created WITH items (NPC statblocks, compendium imports) are left
 * untouched.
 */

export interface SkillSourceLike {
	type: string;
	name: string;
	system: { common?: boolean; characteristic?: string; ladder?: number };
}

export interface SkillGrant {
	name: string;
	type: "skill";
	system: { characteristic: string; ladder: number };
}

/** Pure filter/clone: pick common catalog skills as fresh owned items. */
export function defaultSkillItems(catalog: SkillSourceLike[]): SkillGrant[] {
	return catalog
		.filter((entry) => entry.type === "skill" && entry.system?.common === true)
		.map((entry) => ({
			name: entry.name,
			type: "skill" as const,
			system: {
				characteristic: entry.system.characteristic ?? "int",
				ladder: 1,
			},
		}));
}

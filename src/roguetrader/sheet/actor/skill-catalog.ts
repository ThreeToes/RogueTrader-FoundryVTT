/**
 * Skill catalog access: the compendium pack of skill definitions, cached
 * after first load (the pack itself rarely changes during a session).
 */
export interface CatalogSkill {
	id: string;
	name: string;
	characteristic: string;
	advanced: boolean;
	common: boolean;
}

let cache: CatalogSkill[] | null = null;
let loading: Promise<CatalogSkill[]> | null = null;

/** Load (and cache) the skill catalog from the compendium pack. */
export async function getSkillCatalog(): Promise<CatalogSkill[]> {
	if (cache) return cache;
	loading ??= (async () => {
		const pack = game.packs.get("rogue-trader.skills");
		if (!pack) return [];
		const documents = (await pack.getDocuments()) as foundry.documents.Item[];
		cache = documents
			.map((doc) => {
				const system = doc.system as unknown as {
					characteristic: string;
					advanced?: boolean;
					common?: boolean;
				};
				return {
					id: doc.id,
					name: doc.name ?? doc.id,
					characteristic: system.characteristic,
					advanced: system.advanced === true,
					common: system.common === true,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
		return cache;
	})();
	return loading;
}

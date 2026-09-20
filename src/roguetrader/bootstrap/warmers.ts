/**
 * Ready-time content warmers (epic kof0, phase 5).
 *
 * The funnel contributors and the creators resolve synchronously, so the
 * compendium-backed pools are pre-warmed at `ready` rather than looked up per
 * roll. Every warmer is tolerant of a missing pack (content-optional): an
 * absent pack leaves the pool empty and the rule degrades to manual entry.
 *
 * Split out of the sheet/init.ts composition root.
 */

import { migrateLegacyActors, withoutLegacyCharacterTypes } from "../migrations";
import {
	firstStr,
	nested,
	num,
	optionalStr,
	packSystem,
	str,
	strArray,
} from "../data/pack-fields";
import type { SkillSourceLike } from "../rules/default-skills";
import {
	setHeirloomEntries,
	type HeirloomEntry,
	type HeirloomGrantKind,
} from "../rules/heirlooms";
import {
	originEntryFromDoc,
	setOriginEntries,
} from "../rules/origins";
import type { OriginTraitDef } from "../rules/origin-traits";
import {
	isWarrantRow,
	setWarrantEntries,
	type WarrantEntry,
	type WarrantRow,
} from "../rules/warrant";
import { getCharacterOptionDocs, getPackDocuments } from "../sheet/pack-resolve";
import { rogueTraderConfig } from "./config";

/**
 * The warmed common-skill catalog, used by the createActor grant hook. The
 * sheet backfill path loads the pack on demand and does not need this cache.
 */
let commonSkillCatalog: SkillSourceLike[] = [];

/** The warmed common-skill catalog (empty until `ready`). */
export function getCommonSkillCatalog(): SkillSourceLike[] {
	return commonSkillCatalog;
}

/** Origin traits cache (bead tgq9): the funnel contributor is sync. */
function warmOriginTraits(): void {
	let originTraitDefs: OriginTraitDef[] = [];
	Hooks.once("ready", () => {
		getCharacterOptionDocs("origintrait").then((rawDocs) => {
			const docs = rawDocs as Array<foundry.documents.Item>;
			originTraitDefs = docs.map((doc) => {
				const s = packSystem(doc);
				return {
					name: doc.name ?? "",
					originKey: str(s, "originKey"),
					traitKey: str(s, "traitKey"),
					kind: str(s, "kind", "note") as OriginTraitDef["kind"],
					testKey: str(s, "testKey"),
					value: num(s, "value"),
					grantKind: str(s, "grantKind"),
					text: firstStr(s, "description", "shortDescription"),
				};
			});
		});
	});
	rogueTraderConfig().originTraits = { getDefs: () => originTraitDefs };
}

/**
 * Origin Path chart cache (epic 1gb7): the chart content lives in the
 * `origins` pack; warm the pure module's pool at ready so the creator and
 * sheet resolve entries synchronously.
 */
function warmOrigins(): void {
	Hooks.once("ready", () => {
		getCharacterOptionDocs("origin").then((rawDocs) => {
			const docs = rawDocs as Array<foundry.documents.Item>;
			// The mapping is SHARED with the rules module (bead ghmn bug fix):
			// building it inline here silently dropped `species` and `replaces`,
			// so every entry looked human and the creator offered every species'
			// rows on the human Origin Path.
			setOriginEntries(docs.map((doc) => originEntryFromDoc(doc)));
		});
	});
}

/**
 * Heirloom grant templates (Table 1-2, epic 1gb7 follow-up): the per-heirloom
 * grant payloads live in the `equipment` pack (bead n7hu); warm the pure
 * module's pool at ready.
 */
function warmHeirlooms(): void {
	Hooks.once("ready", () => {
		getPackDocuments("rogue-trader.equipment").then((rawDocs) => {
			// The equipment pack also holds arms/gear; keep the heirloom types.
			const docs = (rawDocs as Array<foundry.documents.Item>).filter(
				(doc) => doc.type === "heirloom",
			);
			setHeirloomEntries(
				docs.map((doc) => {
					const s = packSystem(doc);
					const range = nested(s, "range");
					const grant = nested(s, "grant");
					return {
						key: str(s, "key"),
						name: doc.name ?? "",
						range: [num(range, "low"), num(range, "high")],
						table: optionalStr(s, "table"),
						grant: {
							kind: str(grant, "kind", "pack-item") as HeirloomGrantKind,
							pack: optionalStr(grant, "pack"),
							item: optionalStr(grant, "item"),
							craftsmanship: optionalStr(grant, "craftsmanship"),
							rename: optionalStr(grant, "rename"),
							noteText: optionalStr(grant, "noteText"),
						},
					} satisfies HeirloomEntry;
				}),
			);
		});
	});
}

/**
 * Ship & Warrant Path option pool (epic 1d2n): the chart content lives in the
 * `warrant` pack; warm the pure module's pool at ready so the creator and the
 * Dynasty sheet resolve options synchronously.
 */
function warmWarrant(): void {
	Hooks.once("ready", () => {
		getPackDocuments("rogue-trader.warrant").then((rawDocs) => {
			const docs = (rawDocs as Array<foundry.documents.Item>).filter(
				(doc) => doc.type === "warrant-option",
			);
			setWarrantEntries(
				docs
					.map((doc) => {
						const s = packSystem(doc);
						const mechanics = nested(s, "mechanics");
						return {
							key: str(s, "key"),
							row: str(s, "row") as WarrantRow,
							col: num(s, "col"),
							name: doc.name ?? "",
							description: str(s, "description"),
							mechanics: {
								shipPoints: num(mechanics, "shipPoints"),
								profitFactor: num(mechanics, "profitFactor"),
								notes: strArray(mechanics, "notes"),
							},
						} satisfies WarrantEntry;
					})
					.filter((entry) => entry.key && isWarrantRow(entry.row)),
			);
		});
	});
}

/**
 * Madness track rows (epic 1g2t): the sheet's trauma/malignancy tests read the
 * track rows. Afflictions are owned Items (epic nt8k) whose effects feed the
 * item-effects funnel directly, so no def cache is needed here any more.
 */
function warmMadness(): void {
	let madnessRows: Array<{
		kind: string;
		rollMin: number;
		rollMax: number;
		degree: string;
		modifier: number;
	}> = [];
	Hooks.once("ready", () => {
		getPackDocuments("rogue-trader.afflictions").then((madnessRaw) => {
			// The afflictions pack also holds mutations; keep the madness rows.
			const madnessDocs = (madnessRaw as Array<foundry.documents.Item>).filter(
				(doc) => doc.type === "madnessentry",
			);
			madnessRows = madnessDocs.map((doc) => {
				const s = packSystem(doc);
				return {
					kind: str(s, "kind"),
					rollMin: num(s, "rollMin"),
					rollMax: num(s, "rollMax", 999),
					degree: str(s, "degree"),
					modifier: num(s, "modifier"),
				};
			});
		});
	});
	rogueTraderConfig().madness = { getRows: () => madnessRows };
}

/** Warm the skills pack for the createActor grant hook. */
function warmSkillCatalog(): void {
	Hooks.once("ready", () => {
		getCharacterOptionDocs("skill").then((rawDocs) => {
			const docs = rawDocs as Array<foundry.documents.Item>;
			commonSkillCatalog = docs.map(
				(doc) => doc.toObject() as SkillSourceLike,
			);
		});
	});
}

/**
 * Legacy character-type migration (bead ow8w): pc/acolyte -> explorer,
 * clone-recreate at ready (GM-only, logs old->new ids).
 */
function migrateLegacyTypes(): void {
	Hooks.once("ready", () => {
		migrateLegacyActors()
			.catch((error) =>
				console.error("rogue-trader | legacy-actor migration crashed:", error),
			)
			.finally(() => {
				// The legacy "pc" model must exist through boot (legacy documents
				// parse before ready) but must NOT keep being offered, so drop it
				// from the live config once the migration has run.
				const cfg = CONFIG as unknown as {
					Actor?: { dataModels?: Record<string, unknown> };
				};
				delete cfg.Actor?.dataModels?.pc;
				// Bead vnz3: deleting the dataModel does NOT rebuild the type
				// registry the Create Actor dropdown reads, so "pc" kept showing
				// up as a raw, unlocalised entry. The registry is
				// game.documentTypes (an ARRAY of names) — NOT
				// game.system.documentTypes (an object MAP), which is what the
				// previous code filtered behind an `Array.isArray` guard that
				// was therefore always false and silently did nothing. Strip the
				// legacy names from both, so either source is covered.
				const registry = game.documentTypes as unknown as
					| Record<string, unknown>
					| undefined;
				if (registry) {
					registry.Actor = withoutLegacyCharacterTypes(registry.Actor);
				}
				const system = game.system as unknown as {
					documentTypes?: Record<string, unknown>;
				};
				if (system.documentTypes) {
					system.documentTypes.Actor = withoutLegacyCharacterTypes(
						system.documentTypes.Actor,
					);
				}
			});
	});
}

/** Register every ready-time warmer and the legacy-type migration. */
export function registerContentWarmers(): void {
	warmOriginTraits();
	warmOrigins();
	warmHeirlooms();
	warmWarrant();
	warmMadness();
	warmSkillCatalog();
	migrateLegacyTypes();
}

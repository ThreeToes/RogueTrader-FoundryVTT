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
import type { SkillSourceLike } from "../rules/default-skills";
import {
	type HeirloomEntry,
	type HeirloomGrantKind,
	type OriginEntry,
	type OriginMechanics,
	type OriginRow,
	type OriginVariant,
	setHeirloomEntries,
	setOriginEntries,
} from "../origins";
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
				const s = doc.system as unknown as Record<string, unknown>;
				return {
					name: doc.name ?? "",
					originKey: String(s.originKey ?? ""),
					traitKey: String(s.traitKey ?? ""),
					kind: String(s.kind ?? "note") as OriginTraitDef["kind"],
					testKey: String(s.testKey ?? ""),
					value: Number(s.value ?? 0),
					grantKind: String(s.grantKind ?? ""),
					text: String(s.description ?? s.shortDescription ?? ""),
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
			setOriginEntries(
				docs.map((doc) => {
					const s = doc.system as unknown as Record<string, unknown>;
					return {
						key: String(s.key ?? ""),
						row: String(s.row ?? "home-world") as OriginRow,
						col: Number(s.col ?? 0),
						name: doc.name ?? "",
						description: String(s.description ?? ""),
						effect: s.effect ? String(s.effect) : undefined,
						mechanics: (s.mechanics ?? {}) as OriginMechanics,
						variants: Array.isArray(s.variants)
							? (s.variants as OriginVariant[])
							: undefined,
					} as OriginEntry;
				}),
			);
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
					const s = doc.system as unknown as Record<string, unknown>;
					const range = (s.range ?? {}) as { low?: number; high?: number };
					const grant = (s.grant ?? {}) as Record<string, unknown>;
					return {
						key: String(s.key ?? ""),
						name: doc.name ?? "",
						range: [Number(range.low ?? 0), Number(range.high ?? 0)],
						table: s.table ? String(s.table) : undefined,
						grant: {
							kind: String(grant.kind ?? "pack-item") as HeirloomGrantKind,
							pack: grant.pack ? String(grant.pack) : undefined,
							item: grant.item ? String(grant.item) : undefined,
							craftsmanship: grant.craftsmanship
								? String(grant.craftsmanship)
								: undefined,
							rename: grant.rename ? String(grant.rename) : undefined,
							noteText: grant.noteText ? String(grant.noteText) : undefined,
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
						const s = doc.system as unknown as Record<string, unknown>;
						const mechanics = (s.mechanics ?? {}) as {
							shipPoints?: unknown;
							profitFactor?: unknown;
							notes?: unknown[];
						};
						return {
							key: String(s.key ?? ""),
							row: String(s.row ?? "") as WarrantRow,
							col: Number(s.col ?? 0),
							name: doc.name ?? "",
							description: String(s.description ?? ""),
							mechanics: {
								shipPoints: Number(mechanics.shipPoints ?? 0),
								profitFactor: Number(mechanics.profitFactor ?? 0),
								notes: (mechanics.notes ?? []).map(String),
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
				const s = doc.system as unknown as Record<string, unknown>;
				return {
					kind: String(s.kind ?? ""),
					rollMin: Number(s.rollMin ?? 0),
					rollMax: Number(s.rollMax ?? 999),
					degree: String(s.degree ?? ""),
					modifier: Number(s.modifier ?? 0),
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

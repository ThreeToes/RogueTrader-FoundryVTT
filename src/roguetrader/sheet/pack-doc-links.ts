/**
 * The pack-doc link library — re-export seam (bead foundryvtt-rogue-trader-rflq).
 *
 * The library itself (epic 61pk, bead n2b2) lives in the application layer,
 * `src/ffg/application/pack-doc-links.ts` — Foundry-free and depended on by
 * the rules layer (rules -> application), so it may not sit in presentation
 * (the old rules -> presentation import inverted the layering). Everything
 * this module re-exports is the application module verbatim: the sheet-layer
 * importers (advancement view model + dialog, the creator, the presentation
 * chat/ship link surfaces) keep their "../pack-doc-links" specifiers
 * unchanged, and `sheet/pack-resolve.ts` still pairs the pure resolvers with
 * the Foundry-coupled open path as the one all-affordance import point.
 *
 * This shim must stay a pure re-export — no definitions, no Foundry.
 */
export {
	type DocLinkRowLike,
	docLinkUuid,
	OPEN_PACK_DOC_ACTION,
	type PackDocAnchor,
	type PackDocLike,
	packDocAnchor,
	resolveSkillDoc,
	resolveTalentDoc,
} from "../../ffg/application/pack-doc-links";
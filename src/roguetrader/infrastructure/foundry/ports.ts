/**
 * Compatibility shim (bead 8ycd): the Foundry ports implementation hoisted to
 * src/ffg/infrastructure/foundry/ports.ts, system-neutral. This module keeps
 * every existing `infrastructure/foundry/ports` import working and — by
 * registering the Rogue Trader config overrides — is where the system-specific
 * config now lives: the homebrew provider, the origin-trait cache provider and
 * the RT RollTables pack id.
 */

import { setConfigOverrides } from "../../../ffg/infrastructure/foundry/ports";
import { ROLLTABLES_PACK } from "../../application/packs";

setConfigOverrides({
	// Homebrew seam (bead 9if): the GM-configured house-rule profile, provided
	// at init (bootstrap/config.ts attaches getProfile to the namespace).
	homebrew() {
		if (typeof CONFIG === "undefined") return null;
		const provider = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { homebrew?: { getProfile?: () => unknown } };
			}
		).ROGUE_TRADER?.homebrew?.getProfile;
		return provider?.() ?? null;
	},
	// Origin-trait definitions cached at init (bootstrap/warmers.ts).
	originTraits() {
		if (typeof CONFIG === "undefined") return [];
		const provider = (
			CONFIG as unknown as {
				ROGUE_TRADER?: { originTraits?: { getDefs?: () => unknown[] } };
			}
		).ROGUE_TRADER?.originTraits?.getDefs;
		return provider?.() ?? [];
	},
	// The critical-hit and Psychic Phenomena RollTables pack (application/packs).
	packIds() {
		return { rolltables: ROLLTABLES_PACK };
	},
});

export * from "../../../ffg/infrastructure/foundry/ports";
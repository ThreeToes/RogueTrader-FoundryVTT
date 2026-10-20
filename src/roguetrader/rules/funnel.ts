/**
 * Compatibility shim (bead 8ycd): the funnel machinery itself hoisted to
 * src/ffg/application/funnel.ts, where it is system-neutral and Foundry-free.
 * This module keeps every existing `rules/funnel` import working: it calls
 * `registerRtFunnelContributors()` — the explicit, idempotent registration
 * module (bead i4b0) — so the shim's callers still guarantee the RT
 * contributors regardless of import order. Importing either this
 * shim or `ffg/application/funnel` alone is safe; only the RT
 * contributors' presence differs until something registers them.
 */

import { registerRtFunnelContributors } from "./funnel-registration";

registerRtFunnelContributors();

export * from "../../ffg/application/funnel";

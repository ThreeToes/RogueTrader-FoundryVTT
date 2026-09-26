/**
 * Compatibility shim (bead 8ycd): the funnel machinery itself hoisted to
 * src/ffg/application/funnel.ts, where it is system-neutral and Foundry-free.
 * This module keeps every existing `rules/funnel` import working and — by
 * importing the RT modules below — registers the system-specific contributors
 * (origin traits, fire-mode homebrew) that used to be hard-coded in the
 * funnel. Importing either this shim or `ffg/application/funnel` alone is
 * safe; only the RT contributors' presence differs.
 */

import "./homebrew";
import "./origin-traits";

export * from "../../ffg/application/funnel";
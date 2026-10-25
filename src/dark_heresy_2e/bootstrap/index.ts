/**
 * The Dark Heresy 2nd Edition composition root (bead w9sa.4).
 *
 * RT's composition root (`src/roguetrader/bootstrap/index.ts`) is a large,
 * RT-specific graph: its document types, its sheets, its conditions, its
 * character creator, its roll API. Almost none of that is DH2's yet, and
 * copying any of it across would be the fork epic hr6r exists to prevent. So
 * this root registers exactly the three SHARED seams a system must claim, and
 * nothing else:
 *
 *   1. `registerRuleKnobRegistry(DARK_HERESY_RULE_KNOB_REGISTRY)` — the
 *      parameterised knob machinery (bead w9sa.2). DH2's registry replaces
 *      RT's everywhere for THIS process: the settings seam, the rules app and
 *      the merge all read the ACTIVE registry.
 *   2. `registerCharacteristicRegistry(DARK_HERESY_CHARACTERISTIC_REGISTRY)` —
 *      the characteristic vocabulary (bead w9sa.10). The Character schema, the
 *      short label map and the skill/power `characteristicChoices` all read the
 *      ACTIVE registry, so DH2's ten characteristics (Influence last) are in
 *      force without a shared file naming this system.
 *   3. `setConfigOverrides({profile, packIds})` — the widened config port
 *      (bead w9sa.8). The kernel resolvers, the funnel, the roll pipeline and
 *      the chat-flag machinery all read the ACTIVE profile through it, so they
 *      resolve DH2's data without one of them learning this system's name.
 *
 * All three are the SAME calls RT's own infrastructure makes; only the data
 * differs. RT's bootstrap is untouched and RT's defaults remain in force for RT.
 *
 * WHAT IS DELIBERATELY NOT HERE, each a deliverable of the DH2 content and
 * presentation work (epic eg4g), and none of it RT's files moved across:
 *   - document types and sheets (DH2 has no Actor/Item DataModels yet, so the
 *     manifest declares no `documentTypes` rather than inheriting RT's);
 *   - status conditions (RT's `rules/conditions.ts` is RT rules data);
 *   - the roll API namespace (RT exposes `game.rogueTrader`; DH2's name is a
 *     presentation decision);
 *   - `homebrew` / `originTraits` providers: the shared port already returns
 *     "no house rules, no content" (null / []), which is the truth today, and
 *     the settings-driven seam needs DH2's own settings + rules app first;
 *   - lang files, stylesheets, templates and compendium packs (the build logs
 *     this; see utils/systems.ts).
 *
 * NOTHING HERE READS `game.system`: the module load happens before Foundry's
 * init hook, and the profile/branding paths are composed from the system id at
 * module scope (the documented limitation in src/ffg/domain/template-root.ts,
 * bead w9sa.9).
 */

import type { ConfigPort } from "../../ffg/application/ports";
import { registerCharacteristicRegistry } from "../../ffg/domain/model/characteristic-registry";
import { registerRuleKnobRegistry } from "../../ffg/domain/rule-knobs";
import {
	DARK_HERESY_RULE_KNOB_REGISTRY,
	DH2_SYSTEM_ID,
} from "../../ffg/domain/rule-knobs-dark-heresy";
import { setConfigOverrides } from "../../ffg/infrastructure/foundry/ports";
import {
	DARK_HERESY_CHARACTERISTIC_REGISTRY,
	DARK_HERESY_PROFILE,
	DARK_HERESY_ROLLTABLES_PACK,
} from "../profile";

/** The system id this composition root boots, as its own declaration. */
export const DARK_HERESY_SYSTEM_ID = DH2_SYSTEM_ID;

/**
 * The config overrides a DH2 boot installs through the shared seam (bead
 * 8ycd/w9sa.8): the sibling's profile and its pack ids. `homebrew` and
 * `originTraits` are NOT overridden — the shared defaults (core rules, no
 * content) are the truth for DH2 today, see the file header.
 *
 * A function rather than a constant so the boot test can read what a boot
 * WOULD install without touching process-wide state.
 */
export function darkHeresyConfigOverrides(): Partial<ConfigPort> {
	return {
		profile: () => DARK_HERESY_PROFILE,
		packIds: () => ({ rolltables: DARK_HERESY_ROLLTABLES_PACK }),
	};
}

/** Point the shared config port at DH2's profile and pack ids. */
export function registerDarkHeresyConfig(): void {
	setConfigOverrides(darkHeresyConfigOverrides());
}

/** Point the knob machinery at DH2's registry (last write wins, one call). */
export function registerDarkHeresyRules(): void {
	registerRuleKnobRegistry(DARK_HERESY_RULE_KNOB_REGISTRY);
}

/**
 * Point the characteristic registry at DH2's vocabulary (last write wins, one
 * call): ten keys, Influence last. A sibling system's schema therefore gains
 * its own characteristics through the seam instead of a shared hand-list.
 */
export function registerDarkHeresyCharacteristics(): void {
	registerCharacteristicRegistry(DARK_HERESY_CHARACTERISTIC_REGISTRY);
}

/**
 * Wire the DH2 system into Foundry. Called once from entry-point.ts.
 *
 * One hook, exactly like RT's: everything is registered on `init`, before the
 * first DataModel schema is built, so a later DH2 document type can read the
 * active profile the same way RT's do.
 */
export function darkHeresyInit(): void {
	Hooks.once("init", () => {
		registerDarkHeresyRules();
		registerDarkHeresyCharacteristics();
		registerDarkHeresyConfig();
	});
}

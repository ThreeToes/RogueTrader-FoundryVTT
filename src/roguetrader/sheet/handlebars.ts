import { EntryRegistry } from "../registry";
import { RogueTraderConfig } from "./config";

/**
 * Handlebars `config` helper: resolves a registry or config entry by key.
 *
 * - `{{config "bodyLocations"}}` resolves registry-backed choices (live; modules
 *   can extend them after init)
 * - `{{config "craftsmanship"}}` resolves a static config entry
 */
export function registerConfigHelper() {
	Handlebars.registerHelper("config", (key: string) => {
		const rtConfig = CONFIG as unknown as {
			ROGUE_TRADER?: Record<string, unknown>;
		};
		const registry = rtConfig.ROGUE_TRADER?.[key];
		if (registry instanceof EntryRegistry) {
			return registry.choices;
		}
		return RogueTraderConfig[key as keyof typeof RogueTraderConfig];
	});

	// `concat` helper: joins path fragments for localize keys
	// ("{{localize (concat "SHIP_COMBAT." key)}}"). The verify:templates
	// stub list always assumed this system-custom helper existed (bead
	// xfta follow-up): templates using it would throw "Missing helper:
	// concat" in world without this registration.
	Handlebars.registerHelper("concat", (...args: unknown[]) =>
		args
			.slice(0, -1) // drop the handlebars options object
			.filter((part) => part !== undefined && part !== null)
			.join(""),
	);
}

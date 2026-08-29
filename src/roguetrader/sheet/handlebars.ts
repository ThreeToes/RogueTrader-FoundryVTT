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
}

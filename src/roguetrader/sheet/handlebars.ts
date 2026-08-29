import { RogueTraderConfig } from "./config";

export function registerConfigHelper() {
	Handlebars.registerHelper("config", (key: string) => {
		return RogueTraderConfig[key as keyof RogueTraderConfig];
	});
}

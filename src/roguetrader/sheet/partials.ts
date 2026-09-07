/**
 * Shared Handlebars partials (consolidation pass 2026-09-06, beads bef7 /
 * 9v7c / 7c1y / 201f): the editor block, header portrait, paired value/max
 * composite and item-row skeleton that sheets kept re-implementing inline.
 *
 * Registered at init under the `rt/` namespace; template files reference
 * them as {{> "rt/rich-text" ...}} etc. The verify:templates script mirrors
 * this registration from the raw files so compilation stays loud.
 */

/** Partials shipped by this system: template path (without prefix) -> name. */
export const SHARED_PARTIALS = [
	"shared/parts/rich-text.hbs",
	"shared/parts/header-portrait.hbs",
	"shared/parts/compact-header.hbs",
	"shared/parts/paired-value.hbs",
	"shared/parts/inv-row.hbs",
	"shared/parts/weapon-row.hbs",
	"shared/parts/combat-weapon-row.hbs",
] as const;

const PREFIX = "systems/rogue-trader/template/";

export function registerSharedPartials(): void {
	for (const rel of SHARED_PARTIALS) {
		const path = `${PREFIX}${rel}`;
		const name = `rt/${rel.split("/").pop()?.replace(/\.hbs$/, "") ?? rel}`;
		// getTemplate is Foundry's load+compile cache; partials accept a
		// compiled template function directly.
		foundry.applications.handlebars.getTemplate(path).then((compiled) => {
			Handlebars.registerPartial(name, compiled as never);
		});
	}
}
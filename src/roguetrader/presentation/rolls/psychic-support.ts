/**
 * Psychic support for the roll pipeline (epic kof0, phase 4): Psychic
 * Phenomena, power damage, corruption-on-manifest, and the focus-test key
 * mapping. Extracted from rules/roll-system.ts so that file stays the
 * orchestrator, and re-homed here in phase 6 (bead xkad) because it posts
 * cards — it is presentation, like the handler that calls it.
 *
 * Every side effect goes through a port: dice, chat, content and actor writes.
 */

import { systemOf } from "../../data/accessors";
import type { EffectData } from "../../domain/model/effect";
import { corruptionExpressions } from "../../domain/model/effect";
import { ROLLTABLES_PACK } from "../../application/packs";
import { getPorts } from "../../infrastructure/foundry/ports";
import { phenomenaRollModifier, phenomenaTableName } from "../../rules/psychic";

/**
 * Roll on the Psychic Phenomena table (or Perils of the Warp on 75+,
 * Table 6-2 book p160). Modifiers: +5 per push level, +10 per sustained
 * power (book p157). The chart result is the RAW roll + modifier; the
 * phenomena tables tile 1-100 with explicit ranges.
 */
export async function rollPhenomena(
	actor: Actor,
	source: {
		pushLevels?: number;
		sustainedCount?: number;
		/** Sorcerer Corruption total (EA p86); added before the other modifiers. */
		corruption?: number;
	},
): Promise<void> {
	const ports = getPorts();
	const modifier = phenomenaRollModifier(source);
	const raw = (await ports.dice.roll("1d100")).total;
	const total = Math.min(100, raw + modifier);
	const tableName = phenomenaTableName(total);

	// Content-optional: the roll and its total are ALWAYS posted; the table text
	// is looked up when the compendium is installed, otherwise the card says to
	// apply the result manually. A missing pack never posts nothing.
	//
	// Bead xkad: this read used to call foundryContent directly, bypassing the
	// ContentPort — so a swapped-in fake (or NO_CONTENT_PORT) had no effect on
	// phenomena and the content-optional path was untestable here.
	const table = await ports.content.find(ROLLTABLES_PACK, tableName);
	const results = table?.results ? Array.from(table.results) : [];
	const result = results.find(
		(r) => total >= (r.range?.[0] ?? 0) && total <= (r.range?.[1] ?? 0),
	);
	const text = result?.text ?? ports.i18n.t("PSYCHIC_POWER.TABLE_MISS");
	const label = ports.i18n.t("PSYCHIC_POWER.PHENOMENA_ROLL");
	await ports.chat.postHtml(
		actor,
		`<div class="rogue-trader phenomena-roll"><h3>${label}: ${total}</h3><p>${text}</p></div>`,
	);
}

/**
 * Damage-carrying subtypes (bolt/barrage/storm/zone) roll the power's
 * damage expression on success. Manual target application for now
 * (mirrors the weapon damage card's manual-resolution note).
 */
export async function postPowerDamage(
	actor: Actor,
	powerName: string,
	damage: string,
): Promise<void> {
	const ports = getPorts();
	const total = (await ports.dice.roll(damage)).total;
	const label = ports.i18n.t("PSYCHIC_POWER.DAMAGE_ROLL", { power: powerName });
	await ports.chat.postHtml(
		actor,
		`<div class="rogue-trader power-damage"><h3>${label}</h3><p>${damage}: <strong>${total}</strong></p></div>`,
	);
}

/**
 * Apply a power's "corruption" effects after a successful Focus Power Test
 * (epic 0hap): Summon Daemon grants 1d10+4 Corruption Points (EA p83). The
 * actor's Corruption total is added to its Phenomena rolls (EA p86) via the
 * casting resolver.
 */
export async function applyPowerCorruption(
	actor: Actor,
	item: { name?: string; system?: unknown },
): Promise<void> {
	const ports = getPorts();
	const effects = (item.system as { effects?: EffectData[] } | undefined)?.effects;
	const expressions = corruptionExpressions(effects);
	if (expressions.length === 0) return;
	let gained = 0;
	for (const expression of expressions) {
		gained += (await ports.dice.roll(expression)).total;
	}
	if (gained === 0) return;
	const system = systemOf(actor) as unknown as { corruption?: number };
	await ports.actors.update(actor, {
		"system.corruption": Math.max(0, (system.corruption ?? 0) + gained),
	});
	const label = ports.i18n.t("PSYCHIC_POWER.CORRUPTION_GAIN", {
		power: item.name ?? "",
	});
	await ports.chat.postHtml(
		actor,
		`<div class="rogue-trader power-corruption"><p>${label}: <strong>${gained}</strong></p></div>`,
	);
}

/**
 * Map the power's focusTest free-text ("Willpower", "Psyniscience") to a
 * Characteristic key. V1: Willpower -> wp, everything else falls back to wp
 * with a console note — routing Psyniscience (a Skill test) needs the skill
 * lookup flow and is deferred (UNVERIFIED IN WORLD).
 */
export function focusTestKey(focusTest: string | undefined): string {
	if (focusTest && /willpower/i.test(focusTest)) return "wp";
	if (focusTest && /fellowship/i.test(focusTest)) return "fel";
	if (focusTest && /perception/i.test(focusTest)) return "per";
	console.warn(
		`rogue-trader | focusTest "${focusTest ?? ""}" is not a known characteristic; defaulting to Willpower`,
	);
	return "wp";
}

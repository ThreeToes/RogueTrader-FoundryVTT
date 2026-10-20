/**
 * Ship-action roll handler (epic necp bead oumh, Core Rulebook Ch. VIII
 * pp213-218): the Table 8-10 Manoeuvre Actions and Table 8-11 Extended
 * Actions, entered through the shared roll pipeline — no forked funnel (the
 * ship-weapon/ship-repair precedent, bead xfta).
 *
 * The book's COMBINED TEST (p212) is the core of every manoeuvre-like action:
 * "add the ship's ability, such as Manoeuvrability, to the character's Skill,
 * such as Pilot (Space Craft)". The kernel fold lives in rules-engine
 * (combinedTarget); the ship half also rides the funnel as a VISIBLE
 * contributor row (`id: "ship:<ability>"`) — a silent modifier is a bug.
 *
 * Helmsman resolution (owner decision 1): the request carries the optional
 * performer character. When absent, the ship's crew-quality skill (Table 8-9,
 * rules/ship-crew.ts) substitutes for the whole character side.
 *
 * Specialisation resolution (owner decision 10, Core Rulebook p75): an owned
 * "Pilot (Space Craft)" item wins; when only the bare "Pilot" is trained, it
 * stands in with the untrained-specialisation −10 as a visible row. Neither
 * item owned → the performer is UNRESOLVABLE and the handler refuses loudly.
 */

import type { TestKind } from "../../../ffg/domain/model/test";
import type { Modifier } from "../../../rules-engine/index";
import { combinedTarget } from "../../../rules-engine/index";
import { postCard } from "../../rules/chat-flags";
import {
	actionDifficulty,
	ACTION_ROLL_TEMPLATE,
} from "../../rules/actions";
import type {
	PackDocAnchor,
} from "../../sheet/pack-doc-links";
import { OPEN_PACK_DOC_ACTION } from "../../sheet/pack-doc-links";
import type {
	RollHandler,
	ShipActionRollRequest,
} from "../../rules/roll-contract";
import { crewQualityEffects } from "../../rules/ship-crew";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { outcomeLabel } from "../../../ffg/presentation/rolls/pipeline";
import { skillHandler } from "./characteristic-skill";
import {
	resolveSpecialisedSkillItem,
	type SpecialisedSkillResolution,
} from "./skill-lookup";

// ------------------------------------------------- the printed test vocabulary

/** The printed test vocabulary → the character-side skill items (owner
 * decisions 9/10). Unmapped keys fail LOUDLY (the ports convention); the pack
 * guard test (S4) pins this table, so extending it is a deliberate choice. */
export const SHIP_ACTION_SKILL_ROUTES: Readonly<
	Record<string, { skill: string; bare?: string }>
> = {
	// Pilot (Space Craft): the manoeuvre-side character skill; trained Pilot
	// without the specialisation stands in at −10 (Core Rulebook p75).
	"pilot-space-craft": { skill: "Pilot (Space Craft)", bare: "Pilot" },
	// Tech-Use: the extended actions that test the Explorer directly (book
	// p216-218; the crew-side Emergency Repairs precedent is ship-repair's).
	"tech-use": { skill: "Tech-Use" },
	// Scrutiny: the Active Augury half of "Scrutiny + Detection" (p216-218).
	scrutiny: { skill: "Scrutiny" },
	// The Table 8-11 skill rows the starship-actions pack (bead ca3x) authors:
	// each maps to its trained skill item through the kernel's own
	// resolvePerformerSide delegation, no new plumbing.
	// - Prepare to Repel Boarders! (printed p217-218: "Command").
	command: { skill: "Command" },
	// - Triage (printed p218: "Difficult (–10) Medicae Test").
	medicae: { skill: "Medicae" },
	// - Disinformation (printed p216): the print is "Deceive or Blather" — the
	//   key carries the first named skill; the pack guard test pins the
	//   choice, the handler may prompt for the alternative.
	deceive: { skill: "Deceive" },
	// - Put Your Backs Into It! (printed p218): print "Intimidate or Charm",
	//   same either-skill shape as Disinformation.
	intimidate: { skill: "Intimidate" },
};

/** The ship-side ability vocabulary — a `+`-composed suffix read off the
 * STARSHIP system data; each entry carries its own static i18n key. */
export const SHIP_ACTION_SHIP_STATS: Readonly<
	Record<string, { label: string }>
> = {
	manoeuvrability: { label: "SHIP_COMBAT.STAT_MANOEUVRABILITY" },
	detection: { label: "SHIP_COMBAT.STAT_DETECTION" },
};

/**
 * Parse a printed test key: the character-side part first, the ship-side
 * ability second. Returns null on ANY unmapped part, and on a key that
 * carries more than one of either side — the combined test joins exactly ONE
 * character skill and at most ONE ship ability (Core Rulebook p212), and the
 * combined machinery has no book definition for more.
 */
export function parseShipActionTestKey(
	test: string,
):
	| {
			skillRoute: { skill: string; bare?: string };
			routeKey: string;
			shipStat?: string;
	  }
	| null {
	const routeKeys: string[] = [];
	const shipStats: string[] = [];
	for (const part of test.split("+")) {
		const key = part.trim();
		if (key in SHIP_ACTION_SKILL_ROUTES) routeKeys.push(key);
		else if (key in SHIP_ACTION_SHIP_STATS) shipStats.push(key);
		else return null;
	}
	if (routeKeys.length !== 1 || shipStats.length > 1) return null;
	return {
		skillRoute: SHIP_ACTION_SKILL_ROUTES[routeKeys[0]],
		routeKey: routeKeys[0],
		shipStat: shipStats[0],
	};
}

/** The ship-side ability as a VISIBLE contributor row (id `ship:<ability>`). */
export function shipAbilityRow(ability: string, value: number): Modifier {
	const stat: unknown = SHIP_ACTION_SHIP_STATS[ability];
	const label = (stat as { label: string } | undefined)?.label ?? ability;
	return {
		id: `ship:${ability}`,
		source: { type: "item", label: "SHIP_COMBAT.SHIP_ABILITY" },
		label,
		value,
	};
}

// ------------------------------------------------- the performer (character side)

/** The resolved character side of the combined test. */
interface PerformerSide {
	/** baseTarget for the character-side skill. */
	baseTarget: number;
	/** Funnel test kind (the trained skill path or the crew surrogate). */
	testKind: TestKind;
	/** Funnel test key. */
	testKey: string;
	/** skillName context (trained path only). */
	skillName?: string;
	/** The p75 untrained-specialisation penalty when the BARE parent stood in. */
	specPenalty?: number;
}

/**
 * The character side: the helmsman's trained skill when given, the crew
 * quality otherwise (owner decision 1). Null = the performer is unresolvable
 * (owns neither the specialisation nor the bare parent) — refused LOUDLY, the
 * same class the ownership gate treats as a bug-shaped silence.
 */
async function resolvePerformerSide(
	request: ShipActionRollRequest,
	route: { skill: string; bare?: string },
	routeKey: string,
): Promise<PerformerSide | null> {
	const ports = getPorts();
	const performer = request.performer as
		| (Actor & { name?: string })
		| undefined;
	if (!performer) {
		// Crew fallback (Core Rulebook p214 Table 8-9): the ship's crew-quality
		// skill substitutes for the whole character side. No skill item, no
		// skillName context — the funnel key is the machine route key.
		const ship = systemOf(request.actor) as unknown as {
			crewQuality?: string;
		};
		const crew = crewQualityEffects(ship.crewQuality ?? "competent");
		return {
			baseTarget: crew.skill,
			testKind: "characteristic",
			testKey: routeKey,
		};
	}
	const resolved: SpecialisedSkillResolution | undefined =
		resolveSpecialisedSkillItem(
			performer,
			route.skill,
			route.bare ?? route.skill,
		);
	if (!resolved) {
		ports.notify.warn("SHIP_ACTION.PERFORMER_UNRESOLVED", {
			actor: performer.name ?? "?",
			skill: route.skill,
		});
		return null;
	}
	// DELEGATE the trained test to the skill handler (the action-handler
	// precedent): it resolves the characteristic, the ladder and the
	// skillName context off the performer's own item — the combined test adds
	// the ship ability on TOP of that as a visible row.
	const prepared = await skillHandler.prepare({
		kind: "skill",
		actor: performer,
		itemId: resolved.itemId,
	});
	if (!prepared) return null;
	return {
		baseTarget: prepared.baseTarget,
		testKind: prepared.testKind,
		testKey: prepared.testKey,
		skillName: prepared.context.skillName,
		specPenalty:
			resolved.kind === "bare" ? resolved.specPenalty : undefined,
	};
}

// ------------------------------------------------------------- the handler

/** Ship-action roll (rollShipAction, epic necp bead oumh, pp213-218). */
export const shipActionHandler: RollHandler<"ship-action"> = {
	async prepare(request) {
		const ports = getPorts();
		const ship = request.actor;
		const item = ship.items.get(request.itemId);
		if (!item || (item.type as string) !== "ship-action") {
			ports.notify.warn("ROLL.UNKNOWN_ITEM");
			return null;
		}
		const data = item.system as unknown as {
			actionCost?: string;
			shortDescription?: string;
			roll?: { test?: string; difficulty?: string };
		};
		const parsed = parseShipActionTestKey(data.roll?.test ?? "");
		if (!parsed) {
			ports.notify.warn("SHIP_ACTION.UNKNOWN_TEST", {
				test: data.roll?.test || "—",
				action: item.name ?? "",
			});
			return null;
		}
		const side = await resolvePerformerSide(
			request,
			parsed.skillRoute,
			parsed.routeKey,
		);
		if (!side) return null;

		// Ship-side ability (p212): read off the starship and folded in as a
		// VISIBLE contributor row — the pipeline clamps/sums, this handler only
		// derives. A starship schema always carries the field (initial 0); an
		// unset one contributes a 0-valued row, still visible.
		const modifiers: Modifier[] = [];
		let shipMod = 0;
		if (parsed.shipStat) {
			const starship = systemOf(ship) as unknown as Record<
				string,
				number | undefined
			>;
			shipMod = starship[parsed.shipStat] ?? 0;
			modifiers.push(shipAbilityRow(parsed.shipStat, shipMod));
		}

		// The bare-Pilot fallback (Core Rulebook p75): the trained bare parent
		// stands in at the untrained-specialisation penalty — a VISIBLE row,
		// never a silent −10.
		if (side.specPenalty) {
			modifiers.push({
				id: "ship:untrained-specialisation",
				source: { type: "skill", label: "SOURCE.FROM_SKILL" },
				label: ports.i18n.t("SHIP_ACTION.UNTRAINED_SPEC", {
					skill: parsed.skillRoute.skill,
				}),
				value: side.specPenalty,
			});
		}

		// Difficulty token (the printed data): numeric → a visible row whose
		// label is the verbatim printed token ("Hard (-20)"); opposed → no
		// modifier, the manual note rides the card (the combat-action owner
		// ruling). An UNMAPPED label is a broken pack row: refuse loudly rather
		// than crash at click time.
		let difficultyKind: "none" | "opposed" | "numeric" = "none";
		try {
			const difficulty = actionDifficulty(data.roll?.difficulty ?? "");
			difficultyKind = difficulty.kind;
			if (difficulty.kind === "numeric") {
				modifiers.push({
					id: "ship-action:difficulty",
					source: { type: "item", label: "SHIP_COMBAT.DIFFICULTY" },
					label: data.roll?.difficulty ?? "",
					value: difficulty.value,
				});
			}
		} catch (error) {
			ports.notify.warn("SHIP_ACTION.UNKNOWN_DIFFICULTY", {
				difficulty: data.roll?.difficulty || "—",
				action: item.name ?? "",
			});
			console.warn(error);
			return null;
		}

		modifiers.push(...(request.modifiers ?? []));

		return {
			title: `${ship.name} — ${item.name}`,
			baseTarget: side.baseTarget,
			testKind: side.testKind,
			testKey: side.testKey,
			initialModifiers: modifiers,
			weapon: null,
			context: { skillName: side.skillName },
			kindData: {
				itemId: request.itemId,
				uuid: item.uuid ?? "",
				name: item.name ?? "",
				actionCost: data.actionCost ?? "",
				description: data.shortDescription ?? "",
				testKey: data.roll?.test ?? "",
				difficulty: data.roll?.difficulty ?? "",
				difficultyKind,
				crewFallback: !request.performer,
				shipMod,
				// Core Rulebook p212: the COMBINED target = the character's skill
				// test value + the ship's ability. The row above carries the same
				// delta, so the pipeline's clamped target agrees with it whenever
				// no other rows ride; this is the card's one-number display.
				combinedTarget: combinedTarget(side.baseTarget, shipMod),
			},
		};
	},

	async after(request, prepared, outcome, _messageId, info) {
		// prepare() always sets kindData for a ship-action; the guard types it
		// (the fear-handler precedent, bead ezys).
		const data = prepared.kindData;
		if (!data) return;
		const ports = getPorts();
		// The SAME interpolated key the shared pipeline renders (bead obbp).
		const outcomeText = outcomeLabel(outcome.success, outcome.degrees);
		const link: PackDocAnchor | null = data.uuid
			? {
					action: OPEN_PACK_DOC_ACTION,
					uuid: data.uuid,
					name: data.name,
				}
			: null;
		await postCard(
			request.actor,
			ACTION_ROLL_TEMPLATE,
			{
				// The h1: "Ship — Action", the action name as the pack-doc link
				// (the lookup-card anatomy; the full prose is one click away).
				title: prepared.title,
				titleDoc: {
					prefix: `${request.actor.name ?? ""} — `,
					name: data.name,
					suffix: "",
					link,
				},
				costLabel: ports.i18n.t("ACTION.COST"),
				cost: data.actionCost,
				descriptionLabel: ports.i18n.t("ACTION.DESCRIPTION"),
				description: data.description,
				combinedLabel: ports.i18n.t("SHIP_ACTION.COMBINED"),
				combinedTarget: data.combinedTarget,
				shipMod: data.shipMod,
				crewNote: data.crewFallback
					? ports.i18n.t("SHIP_ACTION.CREW_FALLBACK")
					: "",
				opposedNote:
					data.difficultyKind === "opposed"
						? ports.i18n.t("ACTION.OPPOSED_MANUAL")
						: "",
				result: {
					target: info?.target ?? prepared.baseTarget,
					roll: outcome.roll,
					outcomeLabel: outcomeText,
					outcomeClass: outcome.success ? "success" : "failure",
				},
			},
		);
	},
};
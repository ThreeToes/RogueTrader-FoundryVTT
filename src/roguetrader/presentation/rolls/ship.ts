/**
 * Ship combat roll handlers (epic kof0, phase 4): the ship weapon salvo and
 * Emergency Repairs extended action, extracted from rules/roll-system.ts.
 *
 * Uses the ports for dice, i18n, notify, targets and actor writes, and the
 * kernel for all the maths.
 */

import type { Actor } from "fvtt-types/documents";
import {
	applyVoidShields,
	crewLossFromHullDamage,
	crippledEffects,
	criticalFromCrippledDamage,
	emergencyRepairsCanFix,
	emergencyRepairsOutcome,
	hitsScored,
	isCritical,
	type Modifier,
	rangeModifier,
	resolveSalvoDamage,
	shipCritical,
} from "../../../rules-engine/src/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import type {
	PreparedRoll,
	RollHandler,
	ShipWeaponRollRequest,
} from "../../rules/roll-contract";
import { crewQualityEffects } from "../../rules/ship-crew";
import { promptShieldAbsorption, promptTargetComponent } from "../roll-prompts";

/** Ship weapon salvo (rollWeaponSalvo, bead xfta, Core Rulebook pp220-222). */
export const shipWeaponHandler: RollHandler<"ship-weapon"> = {
	async prepare(request) {
		const ports = getPorts();
		const ship = request.actor;
		const item = ship.items.get(request.itemId);
		if (!item || (item.type as string) !== "ship-weapon-component") {
			ports.notify.warn("ROLL.UNKNOWN_SKILL");
			return null;
		}
		const weapon = item.system as unknown as {
			strength?: number;
			strengthRoll?: string;
			damage?: string;
			critRating?: number;
			range?: number;
			slot?: string;
			special?: string;
			state?: string;
		};
		if (weapon.state && weapon.state !== "intact") {
			// Damaged/destroyed components are non-functional (book p223).
			ports.notify.warn("SHIP_COMBAT.COMPONENT_NONFUNCTIONAL", {
				weapon: item.name ?? "",
			});
			return null;
		}
		const system = systemOf(ship) as unknown as {
			crewQuality?: string;
			armour?: number;
			voidShields?: number;
		};
		// Gunner BS: the ship's crew skill (Core Rulebook p193 crew quality;
		// p220 example, gunner BS 48).
		const crew = crewQualityEffects(system.crewQuality ?? "competent");
		const kind = /lance/i.test(`${item.name ?? ""} ${weapon.special ?? ""}`)
			? ("lance" as const)
			: ("macrobattery" as const);
		// Variable Strength (ork Dorsal Gunz, book p209): roll 1d5 before
		// firing each turn — the roll happens at prepare so the dialog shows
		// the rolled strength like any other contributor.
		let strength = Math.max(0, weapon.strength ?? 0);
		let strengthNote = "";
		if (weapon.strengthRoll) {
			strength = Math.max(1, (await ports.dice.roll(weapon.strengthRoll)).total);
			strengthNote = ports.i18n.t("SHIP_COMBAT.STRENGTH_ROLLED", {
				dice: weapon.strengthRoll,
				strength,
			});
		}
		return {
			title: `${ship.name} — ${item.name} (${ports.i18n.t(`SHIP_COMBAT.${kind.toUpperCase()}`)})`,
			baseTarget: crew.skill,
			testKind: "characteristic",
			testKey: "bs",
			initialModifiers: [],
			weapon: null,
			context: {},
			templateVars: {
				weaponName: item.name,
				weaponKind: kind,
				strength,
				strengthNote,
				critRating: weapon.critRating ?? 0,
			},
			// xfta: kind + stats carried to after() for the salvo resolution.
			kindData: {
				weaponKind: kind,
				strength,
				damage: weapon.damage ?? "1d5",
				critRating: weapon.critRating ?? 0,
				range: weapon.range ?? 0,
				rangeBand: request.rangeBand ?? "normal",
				weaponUuid: item.uuid,
			},
		};
	},
	postDialogModifiers(request, _prepared, _dialog) {
		// Range band vs the target (book p220): half range +10, beyond range
		// -10 — contributed as a visible row like any other modifier.
		const band = request.rangeBand ?? "normal";
		if (band === "normal") return [];
		// Map the band through the kernel: half = (range 2, distance 1),
		// long = (range 1, distance 2).
		const { modifier } = rangeModifier(
			band === "half" ? 2 : 1,
			band === "half" ? 1 : 2,
		);
		const ports = getPorts();
		return [
			{
				id: "ship:range",
				source: { type: "dialog", label: "SHIP_COMBAT.RANGE" },
				label:
					band === "half"
						? ports.i18n.t("SHIP_COMBAT.RANGE_HALF")
						: ports.i18n.t("SHIP_COMBAT.RANGE_LONG"),
				value: modifier,
			},
		];
	},
	async after(request, prepared, outcome, _messageId) {
		const ports = getPorts();
		const data = prepared.kindData ?? {};
		const kind = data.weaponKind as "macrobattery" | "lance";
		const strength = data.strength as number;
		if (!outcome.success) {
			// Miss: no hits, no damage (the card already shows the failure).
			return;
		}
		const target = ports.targets.actor() as
			| (Actor & { system?: Record<string, unknown> })
			| undefined;
		if (!target) {
			ports.notify.warn("SHIP_COMBAT.NO_TARGET");
			return;
		}
		const targetSystem = target.system as unknown as {
			hullIntegrity?: { value: number; max: number };
			armour?: number;
			voidShields?: number;
			crewPopulation?: number;
			crewMorale?: number;
			crewQuality?: string;
		};
		// Hits (book p220): macrobattery 1 + 1/degree, lance 1 + 1 per 3
		// degrees, both capped by Strength.
		const hits = hitsScored(kind, outcome.degrees, strength);
		// Void shields (book p220-221): shields cancel hits, then overload.
		const shields = Math.max(0, targetSystem.voidShields ?? 0);
		let absorbed = 0;
		if (kind === "macrobattery" && shields > 0 && hits > 0) {
			// The void-shield absorption prompt: the attacker confirms how
			// many hits the target's shields absorb (up to the remaining
			// shield strength; restored before the next attacker, p220-221).
			absorbed =
				(await promptShieldAbsorption(hits, shields, target)) ??
				applyVoidShields(hits, shields).absorbed;
		} else {
			absorbed = applyVoidShields(
				hits,
				kind === "macrobattery" ? shields : 0,
			).absorbed;
		}
		const through = Math.max(0, hits - absorbed);
		// Damage (book p220-221): roll once per hit, total combined; lance
		// hits ignore Armour entirely.
		let damageTotal = 0;
		if (through > 0) {
			damageTotal = (await ports.dice.roll(`${through}${data.damage ?? ""}`))
				.total;
		}
		const salvo = resolveSalvoDamage({
			damageTotal,
			armour: Math.max(0, targetSystem.armour ?? 0),
			lance: kind === "lance",
		});
		// Hull Integrity + Crew Population/Morale losses (book p221).
		const crewLoss = crewLossFromHullDamage(salvo.hullDamage);
		const currentHI = Math.max(0, targetSystem.hullIntegrity?.value ?? 0);
		const nextHI = Math.max(0, currentHI - salvo.hullDamage);
		const currentPop = Math.max(0, targetSystem.crewPopulation ?? 100);
		const currentMorale = Math.max(0, targetSystem.crewMorale ?? 100);
		await ports.actors.update(target, {
			system: {
				hullIntegrity: { value: nextHI },
				crewPopulation: Math.max(0, currentPop - crewLoss.population),
				crewMorale: Math.max(0, currentMorale - crewLoss.morale),
			},
		});
		// Critical hit (book p220-221): degrees >= Crit Rating; roll 1d5 on
		// the chart. A critical that deals no Hull damage still does 1
		// automatic point (p220).
		let criticalEntry = null;
		if (isCritical(outcome.degrees, data.critRating as number)) {
			criticalEntry = shipCritical((await ports.dice.roll("1d5")).total || 1);
			if (salvo.hullDamage === 0) {
				const hi = Math.max(0, targetSystem.hullIntegrity?.value ?? 0);
				await ports.actors.update(target, {
					system: { hullIntegrity: { value: Math.max(0, hi - 1) } },
				});
			}
		}
		// Crippled-ship criticals (book p221): damage past armour on a 0-HI
		// ship reads as the chart value directly.
		if (
			nextHI === 0 &&
			salvo.hullDamage > 0 &&
			kind === "macrobattery" &&
			salvo.armourAbsorbed >= 0 &&
			damageTotal > (targetSystem.armour ?? 0)
		) {
			const exceeded = damageTotal - (targetSystem.armour ?? 0);
			criticalEntry = criticalFromCrippledDamage(exceeded) ?? criticalEntry;
		}
		await postShipSalvoCard(request, prepared, {
			hits,
			absorbed,
			through,
			damageTotal,
			salvo,
			crewLoss,
			critical: criticalEntry,
			targetName: target.name ?? "",
			crippled: crippledEffects(nextHI).crippled,
		});
		// Critical component selection (book p221-222): the attacker picks
		// among components he "knows of" (v1: all installed components are
		// known — Active Augury scanning is a manual/UNVERIFIED IN WORLD step).
		if (criticalEntry) {
			const component = await promptTargetComponent(target);
			if (component) {
				await ports.actors.update(component, {
					system: { state: "damaged" },
				});
			}
		}
	},
};

/** Post the salvo-resolution card (xfta): hits, shields, damage, critical. */
async function postShipSalvoCard(
	request: ShipWeaponRollRequest,
	prepared: PreparedRoll,
	result: {
		hits: number;
		absorbed: number;
		through: number;
		damageTotal: number;
		salvo: { hullDamage: number; armourAbsorbed: number };
		crewLoss: { population: number; morale: number };
		critical: { name: string } | null;
		targetName: string;
		crippled: boolean;
	},
): Promise<void> {
	await postCard(
		request.actor,
		"systems/rogue-trader/template/chat/ship-salvo.hbs",
		{
			title: prepared.title,
			targetName: result.targetName,
			hits: result.hits,
			absorbed: result.absorbed,
			through: result.through,
			damageTotal: result.damageTotal,
			armourAbsorbed: result.salvo.armourAbsorbed,
			hullDamage: result.salvo.hullDamage,
			crewPopulationLoss: result.crewLoss.population,
			crewMoraleLoss: result.crewLoss.morale,
			criticalName: result.critical?.name ?? "",
			crippled: result.crippled,
		},
	);
}

/**
 * Emergency Repairs extended action (rollShipRepair, bead xfta, book
 * p216-218): Difficult (-10) Tech-Use on the crew skill; success repairs
 * one unpowered/damaged/depressurised component (never destroyed), 1d5
 * turns -1 per degree, minimum one.
 */
export const shipRepairHandler: RollHandler<"ship-repair"> = {
	async prepare(request) {
		const ports = getPorts();
		const ship = request.actor;
		const item = ship.items.get(request.itemId);
		if (!item) {
			ports.notify.warn("ROLL.UNKNOWN_SKILL");
			return null;
		}
		const sys = item.system as unknown as {
			state?: string;
			depressurised?: boolean;
		};
		const state = sys.state ?? "intact";
		if (!emergencyRepairsCanFix(state, sys.depressurised === true)) {
			// Book p218: cannot fix destroyed Components (p224: replace at a
			// forge world or stardock); intact needs no repair.
			ports.notify.warn("SHIP_COMBAT.REPAIR_INELIGIBLE", {
				component: item.name ?? "",
			});
			return null;
		}
		const system = systemOf(ship) as unknown as {
			crewQuality?: string;
		};
		const crew = crewQualityEffects(system.crewQuality ?? "competent");
		const difficultModifier: Modifier = {
			id: "repair:difficult",
			source: { type: "item", label: "SHIP_COMBAT.REPAIR" },
			label: ports.i18n.t("SHIP_COMBAT.REPAIR_DIFFICULT"),
			value: -10,
		};
		return {
			title: `${ship.name} — ${ports.i18n.t("SHIP_COMBAT.REPAIR_TITLE", {
				component: item.name ?? "",
			})}`,
			baseTarget: crew.skill,
			testKind: "characteristic",
			testKey: "tech-use",
			initialModifiers: [difficultModifier],
			weapon: null,
			context: {},
			kindData: { itemId: request.itemId, componentId: item.id },
		};
	},
	async after(request, prepared, outcome, _messageId) {
		if (!outcome.success) return;
		const ports = getPorts();
		const component = request.actor.items.get(
			(prepared.kindData?.componentId as string) ?? "",
		);
		if (!component) return;
		const { turns } = emergencyRepairsOutcome(outcome.degrees);
		await ports.actors.update(component, {
			system: { state: "intact", depressurised: false },
		});
		await postCard(
			request.actor,
			"systems/rogue-trader/template/chat/ship-repair.hbs",
			{
				title: prepared.title,
				component: component.name ?? "",
				turns,
			},
		);
	},
};

/**
 * Ship combat roll handlers (epic kof0, phase 4): the ship weapon salvo and
 * Emergency Repairs extended action, extracted from rules/roll-system.ts.
 *
 * Uses the ports for dice, i18n, notify, targets and actor writes, and the
 * kernel for all the maths.
 */

import {
	applyVoidShields,
	activeTurnFlag,
	composeSalvoDamageFormula,
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
	salvoWeaponKind,
	shipCritical,
	salvoTurnFlagRows,
	shipLockGate,
	type ShipBoardingState,
	type ShipTurnFlag,
	type ShipComponentState,
} from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import {
	normalizeShipWeaponRange,
	type ShipWeaponRange,
} from "../../data/item/ship-weapon-range";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import type {
	PreparedRoll,
	RollHandler,
	ShipWeaponRollRequest,
} from "../../rules/roll-contract";
import { crewQualityEffects } from "../../rules/ship-crew";
import { promptShieldAbsorption, promptTargetComponent } from "../roll-prompts";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

/** Ship weapon salvo (rollWeaponSalvo, bead xfta, Core Rulebook pp220-222). */
export const shipWeaponHandler: RollHandler<"ship-weapon"> = {
	async prepare(request) {
		const ports = getPorts();
		const ship = request.actor;
		// Lock gate (Core Rulebook p215): a boarded ship takes no Shooting
		// Actions — the salvo is refused loudly before any dialog or dice.
		// Extended actions (Emergency Repairs) stay allowed; the manoeuvre-side
		// gate for the S1 ship-action handlers is the same pure helper.
		const lockGate = shipLockGate(
			(systemOf(ship) as unknown as { boardedWith?: ShipBoardingState })
				.boardedWith,
			"shooting",
		);
		if (!lockGate.allowed) {
			ports.notify.warn("SHIP_COMBAT.BOARDED_NO_SHOOTING");
			return null;
		}
		// Hard 2x range cap (Core Rulebook pp219-220): beyond twice the
		// weapon's range the shot cannot be made at all — refuse before any
		// dice are rolled instead of firing at -10 against unlimited range
		// (bead 3ba1).
		if (request.rangeBand === "out-of-range") {
			ports.notify.warn("SHIP_COMBAT.OUT_OF_RANGE");
			return null;
		}
		const item = ship.items.get(request.itemId);
		if (!item || (item.type as string) !== "ship-weapon-component") {
			ports.notify.warn("ROLL.UNKNOWN_ITEM");
			return null;
		}
		const weapon = item.system as unknown as {
			strength?: number;
			strengthRoll?: string;
			damage?: string;
			critRating?: number;
			range?: ShipWeaponRange | number; // legacy single-number docs
			slot?: string;
			special?: string;
			state?: string;
			componentType?: string;
		};
		if (weapon.state && weapon.state !== "intact") {
			// Damaged/destroyed components are non-functional (book p223).
			ports.notify.warn("SHIP_COMBAT.COMPONENT_NONFUNCTIONAL", {
				weapon: item.name ?? "",
			});
			return null;
		}
		// Salvo gate (bead kxbz): only macrobatteries and lances resolve through
		// the salvo path — torpedo tubes / nova cannon / landing bays are
		// Extended Actions and BFK-ordnance territory (bead a413/S9 owns their
		// mechanics), and their damage cells (the book's "—") cannot compose a
		// salvo formula at all. Refusing HERE — before the roll — is what keeps
		// the after() side effects (the silent-running reveal, the target
		// write) from ever partially applying: no prepare, no roll, no after().
		const kind = salvoWeaponKind(
			weapon.componentType ?? "",
			`${item.name ?? ""} ${weapon.special ?? ""}`,
		);
		if (!kind) {
			ports.notify.warn("SHIP_COMBAT.NOT_A_SALVO_WEAPON", {
				weapon: item.name ?? "",
			});
			return null;
		}
		const system = systemOf(ship) as unknown as {
			crewQuality?: string;
			armour?: number;
			voidShields?: number;
			turnFlags?: ShipTurnFlag[];
		};
		// Gunner BS: the ship's crew skill (Core Rulebook p193 crew quality;
		// p220 example, gunner BS 48).
		const crew = crewQualityEffects(system.crewQuality ?? "competent");
		// Variable Strength (ork Dorsal Gunz, book p209): roll 1d5 before
		// firing each turn — the roll happens at prepare so the dialog shows
		// the rolled strength like any other contributor.
		let strength = Math.max(0, weapon.strength ?? 0);
		let strengthNote = "";
		if (weapon.strengthRoll) {
			strength = Math.max(
				1,
				(await ports.dice.roll(weapon.strengthRoll)).total,
			);
			strengthNote = ports.i18n.t("SHIP_COMBAT.STRENGTH_ROLLED", {
				dice: weapon.strengthRoll,
				strength,
			});
		}
		// Turn-flag rows (bead vph0, decision 3, Core Rulebook pp214-217):
		// BOTH sides read as visible modifier rows — the firing ship's own
		// Evasive Manoeuvres (-10 to its OWN fire, p215), the Come to New
		// Heading BS penalty (p214) and Lock on Target's +5 when the flag
		// names THE weapon component being fired (p217) — plus the target
		// ship's Evasive Manoeuvres against the incoming fire (p215). The
		// values come from the flags themselves (house rules stay data-driven).
		const targetAtPrepare = ports.targets.actor() as
			| (Actor & { system?: Record<string, unknown> })
			| undefined;
		const turnFlagRows: Modifier[] = salvoTurnFlagRows({
			firingFlags: system.turnFlags ?? [],
			targetFlags:
				((targetAtPrepare?.system as { turnFlags?: ShipTurnFlag[] })
					?.turnFlags) ?? [],
			weaponId: item.id ?? "",
		}).map((row) => ({
			id: `ship:flag:${row.side}:${row.key}`,
			source: { type: "item" as const, label: "SHIP_COMBAT.TURN_FLAGS" },
			label:
				row.side === "firing"
					? ports.i18n.t(
						`SHIP_COMBAT.TURN_FLAG_${row.key.replaceAll("-", "_").toUpperCase()}_OWN`,
					)
					: ports.i18n.t(
						`SHIP_COMBAT.TURN_FLAG_${row.key.replaceAll("-", "_").toUpperCase()}_TARGET`,
					),
			value: row.value,
		}));
		return {
			title: `${ship.name} — ${item.name} (${ports.i18n.t(`SHIP_COMBAT.${kind.toUpperCase()}`)})`,
			baseTarget: crew.skill,
			testKind: "characteristic",
			testKey: "bs",
			initialModifiers: turnFlagRows,
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
				range: normalizeShipWeaponRange(weapon.range),
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
		// long = (range 1, distance 2). The out-of-range band is refused in
		// prepare() before the dialog, so it never contributes a row here.
		if (band === "out-of-range") return [];
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
		// Silent Running broken by firing (bead vph0, Core Rulebook p218):
		// firing immediately reveals the ship — the flag clears on the FIRING
		// ship (a different document from the single target payload below, so
		// the bead 6l68 one-write fold is untouched) and the shooter is warned
		// they betrayed their position. A miss betrays it just the same.
		const firingSystem = ((request.actor as { system?: unknown }).system ??
			{}) as { silentRunning?: boolean };
		if (firingSystem.silentRunning) {
			await ports.actors.update(request.actor, {
				system: { silentRunning: false },
			});
			ports.notify.warn("SHIP_COMBAT.SILENT_RUNNING_REVEALED");
		}
		const data = prepared.kindData;
		// Miss: no hits, no damage (the card already shows the failure).
		// prepare() always sets kindData for a salvo; the guard types it (bead ezys).
		if (!outcome.success || !data) return;
		const { weaponKind: kind, strength, critRating, damage } = data;
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
		// Bead wvkd: every die the salvo resolution rolls is carried to the
		// card so Dice So Nice! animates it.
		const damageRolls: unknown[] = [];
		let damageTotal = 0;
		if (through > 0) {
			// Bead rhij: damage is rolled once per hit and COMBINED (book p220),
			// so the per-hit formula's dice and flat parts scale separately:
			// 3 hits of "1d10+2" compose "3d10+6", NOT "31d10+2" (which Foundry
			// parses as 31 d10 + 2 — ~10x over-deal per hit). Lance and
			// macrobattery share this hits path; only the armour soak differs in
			// resolveSalvoDamage.
			const damageRoll = await ports.dice.roll(
				composeSalvoDamageFormula(through, damage),
			);
			damageTotal = damageRoll.total;
			damageRolls.push(...(damageRoll.rolls ?? []));
		}
		const salvo = resolveSalvoDamage({
			damageTotal,
			armour: Math.max(0, targetSystem.armour ?? 0),
			lance: kind === "lance",
		});
		// Hull Integrity + Crew Population/Morale losses (book p221).
		const crewLoss = crewLossFromHullDamage(salvo.hullDamage);
		const currentHI = Math.max(0, targetSystem.hullIntegrity?.value ?? 0);
		// Critical hit (book p220-221): degrees >= Crit Rating; roll 1d5 on
		// the chart. A critical that deals no Hull damage still does 1
		// automatic point (p220) — folded into the SAME actor write as the
		// salvo HI/crew losses (bead 6l68: one payload, not a second update
		// recomputed off the same stale pre-write targetSystem snapshot).
		let criticalEntry = null;
		if (isCritical(outcome.degrees, critRating)) {
			const criticalRoll = await ports.dice.roll("1d5");
			criticalEntry = shipCritical(criticalRoll.total || 1);
			damageRolls.push(...(criticalRoll.rolls ?? []));
		}
		const nextHI = Math.max(
			0,
			currentHI - salvo.hullDamage - (criticalEntry && salvo.hullDamage === 0 ? 1 : 0),
		);
		const currentPop = Math.max(0, targetSystem.crewPopulation ?? 100);
		const currentMorale = Math.max(0, targetSystem.crewMorale ?? 100);
		await ports.actors.update(target, {
			system: {
				hullIntegrity: { value: nextHI },
				crewPopulation: Math.max(0, currentPop - crewLoss.population),
				crewMorale: Math.max(0, currentMorale - crewLoss.morale),
			},
		});
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
			// Bead wvkd: the damage dice (plus the critical chart die).
			rolls: damageRolls,
		});
		// Critical component selection (book p221-222): the attacker picks among
		// components he "knows of" — DECISION 11 (bead z697, Core Rulebook
		// p217): the pick reads the TARGET's system.revealedComponents set
		// (Focused Augury fills it, ship-extended.ts) and refuses un-revealed
		// components loudly; the all-known stand-in is gone.
		if (criticalEntry) {
			const component = await promptTargetComponent(target, {
				revealGated: true,
			});
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
		critical: { key: string; name: string } | null;
		targetName: string;
		crippled: boolean;
		/** Evaluated salvo dice to attach to the card (bead wvkd). */
		rolls: unknown[];
	},
): Promise<void> {
	await postCard(
		request.actor,
		`${TEMPLATE_ROOT}chat/ship-salvo.hbs`,
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
			criticalKey: result.critical?.key ?? "",
			crippled: result.crippled,
		},
		undefined,
		// Bead wvkd: Dice So Nice! animates the salvo dice.
		result.rolls,
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
			ports.notify.warn("ROLL.UNKNOWN_ITEM");
			return null;
		}
		const sys = item.system as unknown as {
			state?: ShipComponentState;
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
			turnFlags?: ShipTurnFlag[];
		};
		const crew = crewQualityEffects(system.crewQuality ?? "competent");
		const difficultModifier: Modifier = {
			id: "repair:difficult",
			source: { type: "item", label: "SHIP_COMBAT.REPAIR" },
			label: ports.i18n.t("SHIP_COMBAT.REPAIR_DIFFICULT"),
			value: -10,
		};
		// Put Your Backs Into It! (bead 6ddz, printed p218): the "Emergency
		// Repairs" aid flag reads HERE as a VISIBLE row — the +5 rides the
		// chosen action's own roll (the BS path reads the same flag through the
		// salvo pipeline's turn-flag rows).
		const initialModifiers: Modifier[] = [difficultModifier];
		const backs = activeTurnFlag(
			system.turnFlags ?? [],
			"backs-into-it",
			"emergency-repairs",
		);
		if (backs && backs.value !== 0) {
			initialModifiers.push({
				id: "ship:backs-into-it:emergency-repairs",
				source: { type: "item", label: "SHIP_COMBAT.TURN_FLAGS" },
				label: ports.i18n.t("SHIP_COMBAT.TURN_FLAG_BACKS_INTO_IT_OWN"),
				value: backs.value,
			});
		}
		return {
			title: `${ship.name} — ${ports.i18n.t("SHIP_COMBAT.REPAIR_TITLE", {
				component: item.name ?? "",
			})}`,
			baseTarget: crew.skill,
			testKind: "characteristic",
			testKey: "tech-use",
			initialModifiers,
			weapon: null,
			context: {},
			kindData: { itemId: request.itemId, componentId: item.id ?? undefined },
		};
	},
	async after(request, prepared, outcome, _messageId) {
		if (!outcome.success) return;
		const ports = getPorts();
		const component = request.actor.items.get(
			prepared.kindData?.componentId ?? "",
		);
		if (!component) return;
		// Bead wvkd: the repair-time die rides the card so it animates.
		const d5 = await ports.dice.roll("1d5");
		const { turns } = emergencyRepairsOutcome(outcome.degrees, d5.total);
		await ports.actors.update(component, {
			system: { state: "intact", depressurised: false },
		});
		await postCard(
			request.actor,
			`${TEMPLATE_ROOT}chat/ship-repair.hbs`,
			{
				title: prepared.title,
				component: component.name ?? "",
				turns,
			},
			undefined,
			d5.rolls,
		);
	},
};

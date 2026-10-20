/**
 * Ship ORDNANCE machinery row handlers (epic necp bead a413, Battlefleet
 * Koronus ch. I "The Weapons of War" printed pp6-16): the torpedo/attack-
 * craft flow enters through the SHARED `ship-action` roll kind (owner
 * decision 2, the ship-boarding.ts machinery-row precedent) — the sheet's
 * Fire buttons for torpedo tubes stay REFUSED for salvo combat (bead kxbz);
 * these rows own the ordnance mechanics instead.
 *
 * All maths lives in rules-engine/ship-ordnance.ts (Table 1-1 torpedoes
 * printed p8, the guidance Torpedo Ratings p9, Table 1-3 craft ratings p14,
 * the turret shoot-down printed p13 + Core Rulebook printed p220). Void
 * shields are IGNORED throughout (printed p7: "Torpedoes are not stopped or
 * hindered by void shields"; printed p13: turrets exist because shields are
 * "useless against slower-moving attacks") — no row prompts for shield
 * absorption.
 *
 * S2 consumption (bead vph0 kernel): each launch writes ONE
 * `torpedo-run` turn flag (id = the salvo id, expiresAtTurn = the printed
 * Range/Speed countdown) beside its ShipTorpedoSalvo record — S2's
 * expireTurnFlags turnover clears the flag when the run lapses.
 *
 * Ordnance quantity bookkeeping ALWAYS goes through rules/ordnance.ts's
 * decrementQuantity helper (the single-decrement precedent): ships hold
 * their stores as `ship-ordnance` torpedo items with a quantity; a launch
 * refuses loudly on empty stores.
 *
 * MANUAL narrative parts (NOT fake machinery, the bead's mandate): fighter
 * patrol movement (Interception/CVP movement + the 4/6-turn sortie clocks),
 * squadron-loss bookkeeping (the Upkeep-Test tables, printed pp16-11),
 * Escort's -10 turret-penalty rows and the Follow My Lead! piloting duel —
 * cards carry the notes; only the printed TEST maths is machined.
 */

import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { outcomeLabel } from "../../../ffg/presentation/rolls/pipeline";
import type { Modifier } from "../../../rules-engine/index";
import {
	type ShipTorpedoSalvo,
	TORPEDO_PROFILES,
	TORPEDO_GUIDANCES,
	assaultBoatLandings,
	bomberRunCritical,
	bomberRunHits,
	BOMBER_HIT_DIE,
	crewLossFromHullDamage,
	parseDamageFormula,
	resolveSalvoDamage,
	resolveTest,
	type ShipTurnFlag,
	shipCritical,
	shipLockGate,
	squadronBonus,
	terminalPenetrationRerolls,
	torpedoHitDamage,
	torpedoRating,
	torpedoRunFlag,
	torpedoRunSpent,
	torpedoRunTravelled,
	torpedoSalvoHits,
	torpedoSpeedRange,
	turretShootDownHits,
	turretTestBonus,
	upsertTurnFlag,
} from "../../../rules-engine/index";
import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { actionDifficulty } from "../../rules/actions";
import { postCard } from "../../rules/chat-flags";
import { decrementQuantity } from "../../rules/ordnance";
import { crewQualityEffects } from "../../rules/ship-crew";
import type {
	PreparedRoll,
	ShipActionRollRequest,
} from "../../rules/roll-contract";
import type { PackDocAnchor } from "../../sheet/pack-doc-links";
import { OPEN_PACK_DOC_ACTION } from "../../sheet/pack-doc-links";
import { escapeDocumentData } from "../roll-prompts";
import { characteristicHandler } from "./characteristic-skill";
import { type ShipRow } from "./ship-boarding";
import { parseShipActionTestKey, resolvePerformerSide } from "./ship-action";
import type { RollHandler } from "../../rules/roll-contract";

// ------------------------------------------------------------- shapes + gates

/** Minimal shapes the rows read (test fixtures and real documents alike). */
type OrdnanceSystem = {
	kind?: string;
	ordKey?: string;
	componentType?: string;
	state?: string;
	strength?: number;
	quantity?: number;
	speed?: number;
	damage?: string;
	critRating?: number;
	range?: number;
	terminalPenetration?: number;
	torpedoRating?: number;
	craftRating?: number;
	shortDescription?: string;
	actionCost?: string;
	roll?: { test?: string; difficulty?: string };
	special?: string;
};

interface OrdnanceItemLike {
	id?: string | null;
	name?: string | null;
	uuid?: string | null;
	type?: string | null;
	system?: OrdnanceSystem;
}

interface StarshipSystem {
	armour?: number;
	hullIntegrity?: { value?: number; max?: number };
	crewPopulation?: number;
	crewMorale?: number;
	crewQuality?: string;
	turretRating?: number;
	turnFlags?: ShipTurnFlag[];
	torpedoSalvos?: ShipTorpedoSalvo[];
	boardedWith?: { uuid?: string };
	silentRunning?: boolean;
}

const readShipSystem = (ship: unknown): StarshipSystem =>
	systemOf(ship as { system: unknown }) as StarshipSystem;

/** The ship's items of one type (structural: fixtures and documents alike). */
function itemsOfType(ship: unknown, type: string): OrdnanceItemLike[] {
	const items = ship as
		| { items?: { filter(fn: (item: unknown) => boolean): unknown[] } }
		| undefined;
	return (items?.items?.filter(
		(item) => (item as OrdnanceItemLike).type === type,
	) ?? []) as OrdnanceItemLike[];
}

/** Torpedo tubes installed on the ship, intact (the launch gate's inputs). */
function torpedoTubesOf(ship: unknown): OrdnanceItemLike[] {
	return itemsOfType(ship, "ship-weapon-component").filter(
		(item) =>
			(item.system?.componentType ?? "") === "torpedo-tube" &&
			(item.system?.state ?? "intact") === "intact",
	);
}

/**
 * The ship's owned torpedo-store items (`ship-ordnance`, kind "torpedo"):
 * Battlefleet Koronus printed p7 — a tube stores no more than its Component
 * capacity; the owned items ARE the stores, so one decrement helper books
 * every launch. Quantity is the inherited Gear stack count (the 1sxq
 * owner decision).
 */
function torpedoStoresOf(
	ship: unknown,
): Array<OrdnanceItemLike & { quantity: number }> {
	return itemsOfType(ship, "ship-ordnance")
		.filter((item) => (item.system?.kind ?? "") === "torpedo")
		.map((item) => ({
			...item,
			quantity: Math.max(0, Math.floor(Number(item.system?.quantity ?? 0))),
		}));
}

/** Owned attack-craft entries (kind "attack-craft") — Craft Rating sources. */
function attackCraftOf(ship: unknown): OrdnanceItemLike[] {
	return itemsOfType(ship, "ship-ordnance").filter(
		(item) => (item.system?.kind ?? "") === "attack-craft",
	);
}

/**
 * The boarding-lock gate (Core Rulebook printed p215): a torpedo launch
 * rides the ship's Shooting Action, so a locked ship refuses — the same
 * class the salvo path refuses.
 */
function launchGate(ship: unknown): boolean {
	if (shipLockGate(readShipSystem(ship).boardedWith, "shooting").allowed) {
		return true;
	}
	getPorts().notify.warn("SHIP_ORDNANCE.BOARDED_NO_LAUNCH");
	return false;
}

/** The card's doc anchor (the lookup-card anatomy ship-boarding uses). */
function docAnchor(kindData: PreparedRoll["kindData"]): PackDocAnchor | null {
	const data = kindData as { uuid?: string; name?: string } | undefined;
	return data?.uuid
		? {
				action: OPEN_PACK_DOC_ACTION,
				uuid: data.uuid,
				name: data.name ?? "",
			}
		: null;
}

/** The ship-action kindData anatomy (the shared contract fields). */
interface OrdnanceKindData {
	itemId: string;
	uuid: string;
	name: string;
	actionCost: string;
	description: string;
	testKey: string;
	difficulty: string;
	difficultyKind: "none" | "opposed" | "numeric";
	crewFallback: boolean;
	shipMod: number;
	combinedTarget: number;
	/** Extra machinery payload (the strike kind, the launch turn). */
	extra?: Record<string, unknown>;
}

function ordnanceKindData(
	request: ShipActionRollRequest,
	itemRaw: unknown,
	overrides?: { testKey?: string; extra?: Record<string, unknown> },
): OrdnanceKindData {
	const item = itemRaw as OrdnanceItemLike;
	return {
		itemId: request.itemId,
		uuid: (item.uuid as string | null) ?? "",
		name: item.name ?? "",
		actionCost: item.system?.actionCost ?? "",
		description: item.system?.shortDescription ?? "",
		testKey: item.system?.roll?.test ?? "",
		difficulty: item.system?.roll?.difficulty ?? "",
		difficultyKind: "none",
		crewFallback: !request.performer,
		shipMod: 0,
		combinedTarget: 0,
		...overrides,
	};
}

/** HI + Crew/Morale losses in one write payload per ship (the 6l68 rule). */
function crewTrackWrite(
	system: StarshipSystem,
	hullDamage: number,
): {
	hullIntegrity: { value: number };
	crewPopulation: number;
	crewMorale: number;
} {
	const loss = crewLossFromHullDamage(hullDamage);
	return {
		hullIntegrity: {
			value: Math.max(0, (system.hullIntegrity?.value ?? 0) - hullDamage),
		},
		crewPopulation: Math.max(
			0,
			Math.max(0, system.crewPopulation ?? 100) - loss.population,
		),
		crewMorale: Math.max(
			0,
			Math.max(0, system.crewMorale ?? 100) - loss.morale,
		),
	};
}

/** A d100 test against `target` through the SAME kernel resolveTest. */
async function rollTest(
	target: number,
): Promise<{
	success: boolean;
	degrees: number;
	roll: number;
	rolls: unknown[];
}> {
	const ports = getPorts();
	const outcome = await ports.dice.roll("1d100");
	const resolved = resolveTest({
		target,
		roll: outcome.total,
		profile: ports.config.profile(),
	});
	return {
		roll: outcome.total,
		success: resolved.success,
		degrees: resolved.degrees,
		rolls: outcome.rolls ? [...outcome.rolls] : [],
	};
}

/** The printed per-hit damage terms: "2d10+14" → {dice:2, faces:10, bonus:14}. */
function damageTermsOf(damage: string): {
	dice: number;
	faces: number;
	bonus: number;
} {
	const body = parseDamageFormula(damage ?? "").formula;
	const match =
		/^(?:(?<count>\d+)\s*)?d(?<faces>\d+)(?:\s*(?<sign>[+-])\s*(?<bonus>\d+))?$/.exec(
			body.trim(),
		);
	if (!match?.groups) return { dice: 2, faces: 10, bonus: 0 };
	return {
		dice: Number(match.groups.count ?? 2),
		faces: Number(match.groups.faces ?? 10),
		bonus:
			(match.groups.sign === "-" ? -1 : 1) * Number(match.groups.bonus ?? 0),
	};
}

/** Ship-name title for the card (the machinery-row shape). */
function rowTitle(ship: unknown, itemRaw: unknown): string {
	const item = itemRaw as OrdnanceItemLike;
	const name = (ship as { name?: string } | undefined)?.name ?? "";
	return `${name} — ${item.name ?? ""}`;
}

// -------------------------------------------------------- Launch Torpedoes

/**
 * LAUNCH TORPEDOES (Battlefleet Koronus printed pp6-7): no attack roll at
 * launch — the launcher's whole Strength goes out as a Salvo; the BS test
 * comes when the run reaches its target (the Torpedo Run row). The row
 * books the salvo record + the "torpedo-run" turn flag (S2 expiry
 * countdown), decrements the ship's torpedo stores through the ONE
 * decrement helper, and reveals a Silent-Running ship (decision 8).
 */
const launchTorpedoesRow: ShipRow = {
	async prepare(request, rawItem) {
		const item = rawItem as OrdnanceItemLike;
		const ports = getPorts();
		const ship = request.actor;
		if (!launchGate(ship)) return null;
		if (torpedoTubesOf(ship).length === 0) {
			ports.notify.warn("SHIP_ORDNANCE.NO_TUBES");
			return null;
		}
		const stores = torpedoStoresOf(ship);
		if (stores.length === 0 || stores.every((store) => store.quantity <= 0)) {
			ports.notify.warn("SHIP_ORDNANCE.NO_STORES");
			return null;
		}
		return {
			title: rowTitle(ship, item),
			baseTarget: 0,
			testKind: "characteristic",
			testKey: "torpedo-launch",
			initialModifiers: [],
			weapon: null,
			context: {},
			// No test at launch (printed p7): the after-hook owns the prompts,
			// the bookkeeping and the card (the rout-row precedent).
			prepareOnly: true,
			kindData: ordnanceKindData(request, item, {
				testKey: "torpedo-launch",
				extra: { ordnanceStep: "launch", launchTurn: ports.clock.round() },
			}),
		};
	},
	async after(request, prepared, _outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		const kindData = prepared.kindData as OrdnanceKindData | undefined;
		if (!kindData) return;
		const shipSystem = readShipSystem(ship);
		const tubes = torpedoTubesOf(ship);

		// -- tube pick (a Strength-2 cruiser often carries several) ----------
		const tube =
			tubes.length === 1 ? tubes[0] : await promptPick(ports, tubes, "tube");
		if (!tube) return;

		// -- the torpedo choice comes from the ship's OWN stores -------------
		const loaded = torpedoStoresOf(ship).filter((store) => store.quantity > 0);
		const store =
			loaded.length === 1
				? loaded[0]
				: await promptPick(ports, loaded, "torpedo");
		if (!store) return;

		// -- salvo size (≤ the tube's Strength and the stores) ---------------
		// The tube's printed Strength (BFK Table 1-9: Starship Weapons,
		// printed p35); a blank/zero Strength defaults the PROMPT to 2 — the
		// user sees and can correct it, nothing is silently forced.
		const printedStrength = Math.floor(Number(tube.system?.strength ?? 2));
		const tubeStrength =
			Number.isFinite(printedStrength) && printedStrength > 0
				? printedStrength
				: 2;
		const maxSalvo = Math.min(tubeStrength, store.system?.quantity ?? 0);
		const sizeInput = (await foundry.applications.api.DialogV2.input({
			window: { title: ports.i18n.t("SHIP_ORDNANCE.SALVO_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_ORDNANCE.SALVO_PROMPT", {
				tube: escapeDocumentData(tube.name ?? ""),
				maximum: String(maxSalvo),
			})}</p><div class="form-group"><input type="number" name="size" value="${maxSalvo}" min="1" step="1"></div>`,
			ok: { label: ports.i18n.t("SHIP_ORDNANCE.SALVO_CONFIRM") },
		})) as { size?: string } | null;
		if (sizeInput === null) return;
		const salvoSize = Math.max(
			1,
			Math.min(maxSalvo, Math.floor(Number(sizeInput.size) || 1)),
		);

		// -- a wide salvo spreads the salvo (printed p7) ----------------------
		let wide = false;
		if (salvoSize >= 2) {
			const wideChoice = (await foundry.applications.api.DialogV2.wait({
				window: { title: ports.i18n.t("SHIP_ORDNANCE.WIDE_TITLE") },
				content: `<p>${ports.i18n.t("SHIP_ORDNANCE.WIDE_PROMPT")}</p>`,
				buttons: [
					{
						action: "narrow",
						label: ports.i18n.t("SHIP_ORDNANCE.WIDE_NARROW"),
						callback: () => "narrow",
					},
					{
						action: "wide",
						label: ports.i18n.t("SHIP_ORDNANCE.WIDE_WIDE"),
						callback: () => "wide",
					},
				],
			})) as string | null;
			if (wideChoice === null) return;
			wide = wideChoice === "wide";
		}

		// -- the guidance system (printed p9; Boarding is ALWAYS Guided) ------
		const warheadKey = (store.system?.ordKey ?? "").trim().toLowerCase();
		let guidanceKey = "standard";
		if (warheadKey === "boarding") {
			guidanceKey = "guided";
		} else {
			const guidanceChoice = (await foundry.applications.api.DialogV2.wait({
				window: { title: ports.i18n.t("SHIP_ORDNANCE.GUIDANCE_TITLE") },
				content: `<p>${ports.i18n.t("SHIP_ORDNANCE.GUIDANCE_PROMPT")}</p>`,
				buttons: Object.values(TORPEDO_GUIDANCES).map((entry) => ({
					action: entry.name,
					label: ports.i18n.t(
						`SHIP_ORDNANCE.GUIDANCE_${entry.name
							.toUpperCase()
							.replaceAll("-", "_")}`,
						{ rating: entry.torRating },
					),
					callback: () => entry.name,
				})),
			})) as string | null;
			if (guidanceChoice === null) return;
			guidanceKey = guidanceChoice;
		}

		// -- the store decrement (the ONE helper; refuse-when-empty) ----------
		const remainingStores = await decrementQuantity(store, {
			onEmpty: "refuse",
			shots: salvoSize,
			weaponName: tube.name ?? "",
		});
		if (remainingStores === null) return;

		// -- the salvo record + the S2 turn flag (same id) --------------------
		const profile = TORPEDO_PROFILES[warheadKey];
		const speedRange = torpedoSpeedRange(
			profile ?? {
				name: warheadKey,
				speed: 10,
				damage: "",
				critRating: 0,
				range: 60,
				terminalPenetration: 0,
			},
			guidanceKey,
		);
		const launchTurn =
			Number(
				(kindData.extra as { launchTurn?: number } | undefined)?.launchTurn ??
					0,
			) || 0;
		const salvo: ShipTorpedoSalvo = {
			id: `torpedo-${Date.now().toString(36)}-${Math.floor(
				Math.random() * 1_000_00,
			).toString(36)}`,
			warhead: warheadKey,
			name: store.name ?? "",
			guidance: guidanceKey,
			damage: store.system?.damage || profile?.damage || "",
			critRating: Math.max(
				0,
				Math.floor(
					Number(store.system?.critRating ?? profile?.critRating ?? 0),
				),
			),
			terminalPenetration: Math.max(
				0,
				Math.floor(
					Number(
						store.system?.terminalPenetration ??
							profile?.terminalPenetration ??
							0,
					),
				),
			),
			// The Torpedo Rating (printed p9): the guidance choice governs, except
			// where the STORE carries its own guidance-already-bought rating
			// (a pack Seeking/Short-Burn copy keeps its printed value).
			torRating: (() => {
				const stored = Math.max(
					0,
					Math.floor(Number(store.system?.torpedoRating ?? 0)),
				);
				return stored > 0 && stored !== 20
					? stored
					: torpedoRating(warheadKey, guidanceKey);
			})(),
			speed:
				Number(store.system?.speed) > 0
					? Number(store.system?.speed)
					: speedRange.speed,
			range:
				Number(store.system?.range) > 0
					? Number(store.system?.range)
					: speedRange.range,
			remaining: salvoSize,
			travelled: 0,
			launchTurn,
			wide,
			tubeId: tube.id ?? "",
		};
		const turnFlags = upsertTurnFlag(
			shipSystem.turnFlags ?? [],
			torpedoRunFlag(salvo),
		);
		await ports.actors.update(ship, {
			system: {
				torpedoSalvos: [...(shipSystem.torpedoSalvos ?? []), salvo],
				turnFlags,
				// Firing reveals a Silent-Running ship (decision 8, book p218).
				silentRunning: false,
			},
		});
		await postCard(ship, `${TEMPLATE_ROOT}chat/ship-ordnance.hbs`, {
			title: prepared.title,
			titleDoc: {
				prefix: "",
				suffix: "",
				name: (prepared.kindData as OrdnanceKindData).name,
				link: docAnchor(prepared.kindData),
			},
			mode: "launch",
			tubeName: tube.name ?? "",
			torpedoName: salvo.name,
			salvoSize,
			wide: salvo.wide,
			torRating: salvo.torRating,
			speed: salvo.speed,
			range: salvo.range,
			storesNote: ports.i18n.t("SHIP_ORDNANCE.STORES_SPENT", {
				name: salvo.name,
				quantity: remainingStores,
			}),
			runNote: ports.i18n.t("SHIP_ORDNANCE.LAUNCH_NOTE"),
		});
	},
};

// ------------------------------------------------------------- Torpedo Run

/**
 * TORPEDO RUN (Battlefleet Koronus printed pp6-9): resolve ONE Strategic
 * Turn's salvo travel and, when it closes within 1 VU of a vessel (2 for a
 * wide salvo), the attack: the defender's TURRET shoot-down first (the
 * crew's Skill Rating + 5 per Turret Rating, 1 hit + 1 per TWO degrees —
 * each shooting down ONE torpedo, printed p13 + Core Rulebook printed
 * p220), then the launcher's Ballistic Skill + Torpedo Rating test
 * (Challenging +0; the wide salvo's BS test is Hard −20): 1 torpedo + 1 per
 * degree, capped by the salvo. Damage rolls PER TORPEDO with Terminal
 * Penetration re-rolls; torpedoes IGNORE void shields (printed p7).
 */
const torpedoRunRow: ShipRow = {
	async prepare(request, _item) {
		const ports = getPorts();
		const shipSystem = readShipSystem(request.actor);
		const live = (shipSystem.torpedoSalvos ?? []).filter(
			(salvo) => !torpedoRunSpent(salvo),
		);
		if (live.length === 0) {
			ports.notify.warn("SHIP_ORDNANCE.NO_ACTIVE_RUNS");
			return null;
		}
		return {
			title: rowTitle(request.actor, _item),
			baseTarget: 0,
			testKind: "characteristic",
			testKey: "torpedo-run",
			initialModifiers: [],
			weapon: null,
			context: {},
			// The run resolves through prompts + ports dice (the rout-row
			// precedent): the shared pass/fail test step is skipped.
			prepareOnly: true,
			kindData: ordnanceKindData(request, _item, { testKey: "torpedo-run" }),
		};
	},
	async after(request, prepared, _outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		const kindData = prepared.kindData as OrdnanceKindData | undefined;
		if (!kindData) return;
		const shipSystem = readShipSystem(ship);
		const live = (shipSystem.torpedoSalvos ?? []).filter(
			(salvo) => !torpedoRunSpent(salvo),
		);
		// -- which salvo moves this resolution -------------------------------
		const salvo = live.length === 1 ? live[0] : await promptSalvo(ports, live);
		if (!salvo) return;
		// The target names the closing prompt; the ATTACK requirement is
		// re-checked at the attack branch (a movement-only resolution books
		// the travel with no target needed).
		const target = ports.targets.actor() as Actor | undefined;

		// -- movement: one Strategic Turn's travel (printed p7) ---------------
		// The input is capped by BOTH the remaining range and the kernel's
		// travelled clock (Speed VU per subsequent Strategic Turn, printed p7 —
		// capped by the current turn; torpedoRunTravelled): a prompt above that
		// ceiling can only over-travel the salvo, never catch it up.
		const nowTurn = Math.max(0, Math.floor(Number(ports.clock.round()) || 0));
		const travelCeiling = Math.max(
			0,
			Math.min(
				Math.max(0, salvo.range - salvo.travelled),
				torpedoRunTravelled(
					salvo.launchTurn,
					nowTurn,
					salvo.speed,
					salvo.range,
				) - salvo.travelled,
			),
		);
		const travelInput = (await foundry.applications.api.DialogV2.input({
			window: { title: ports.i18n.t("SHIP_ORDNANCE.TRAVEL_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_ORDNANCE.TRAVEL_PROMPT", {
				salvo: escapeDocumentData(salvo.name),
				speed: String(salvo.speed),
				remaining: String(Math.max(0, salvo.range - salvo.travelled)),
			})}</p><div class="form-group"><input type="number" name="distance" value="${Math.min(
				salvo.speed,
				travelCeiling,
			)}" min="0" step="1"></div><p>${ports.i18n.t(
				"SHIP_ORDNANCE.TRAVEL_COVER",
				{
					cover: salvo.wide ? "2" : "1",
				},
			)}</p>`,
			ok: { label: ports.i18n.t("SHIP_ORDNANCE.TRAVEL_CONFIRM") },
		})) as { distance?: string } | null;
		if (travelInput === null) return;
		const travelled =
			salvo.travelled +
			Math.max(
				0,
				Math.min(travelCeiling, Math.floor(Number(travelInput.distance) || 0)),
			);
		// -- an attack happens only when the salvo closed within its cover —
		const distanceInput = (await foundry.applications.api.DialogV2.input({
			window: { title: ports.i18n.t("SHIP_ORDNANCE.DISTANCE_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_ORDNANCE.DISTANCE_PROMPT", {
				target: escapeDocumentData(
					((target ?? null) as { name?: string } | null | undefined)?.name ??
						"",
				),
			})}</p><div class="form-group"><input type="number" name="distance" value="0" min="0" step="1"></div>`,
			ok: { label: ports.i18n.t("SHIP_ORDNANCE.DISTANCE_CONFIRM") },
		})) as { distance?: string } | null;
		if (distanceInput === null) return;
		const closing = Math.max(
			0,
			Math.floor(Number(distanceInput.distance) || 0),
		);
		const cover = salvo.wide ? 2 : 1;

		const rolls: unknown[] = [];
		const rows: Array<{ id: string; label: string; display: string }> = [];
		let remaining = salvo.remaining;
		let hullDamage = 0;
		let critText = "";
		/** Melta warheads: hits that dealt damage carry the AUTOMATIC Fire!
		 * critical (Battlefleet Koronus printed p9), stacking with the chart
		 * roll's own critical where that fired too. */
		let meltaFireHits = 0;
		let hits = 0;
		let turretText = "";
		/** The per-hit Hull damage, ACCUMULATED (the values are in scope) —
		 * never re-parsed off the display strings (nit 14). */
		let sunkHullDamage = 0;
		const attempted = closing <= cover && remaining > 0;

		if (attempted) {
			if (!target) {
				ports.notify.warn("SHIP_COMBAT.NO_TARGET");
				return;
			}
			const targetSystem = readShipSystem(target);
			// -- turret shoot-down FIRST (printed p13 + Core Rulebook p220) ----
			const bonus = turretTestBonus(targetSystem.turretRating ?? 0);
			if (bonus > 0) {
				const crew = crewQualityEffects(
					targetSystem.crewQuality ?? "competent",
				);
				const turretTarget = Math.min(100, crew.skill + bonus);
				const turret = await rollTest(turretTarget);
				rolls.push(...turret.rolls);
				const down = Math.min(remaining, turretShootDownHits(turret.degrees));
				remaining -= down;
				turretText = ports.i18n.t("SHIP_ORDNANCE.TURRET_DOWN", { count: down });
			}
			// -- the launcher's BS + Torpedo Rating test (printed p7) ----------
			if (remaining > 0) {
				const bsSide = await ballisticSide(request);
				const widePenalty = salvo.wide ? -20 : 0;
				const attackTarget = Math.max(
					1,
					Math.min(100, bsSide + salvo.torRating + widePenalty),
				);
				const attack = await rollTest(attackTarget);
				rolls.push(...attack.rolls);
				rows.push({
					id: "ord:attack",
					label: ports.i18n.t("SHIP_ORDNANCE.ATTACK_TEST"),
					display: `${attack.roll} vs ${attackTarget} ${outcomeLabel(
						attack.success,
						attack.degrees,
					)}`,
				});
				if (widePenalty) {
					rows.push({
						id: "ord:wide",
						label: ports.i18n.t("SHIP_ORDNANCE.WIDE_PENALTY"),
						display: "-20",
					});
				}
				// A FAILED attack scores NOTHING (printed p7: "On a successful test,
				// one torpedo strikes ..."): torpedoSalvoHits(0, …) still returns 1,
				// so the failure guard rides HERE, in the handler.
				hits = attack.success
					? torpedoSalvoHits(attack.degrees, remaining, salvo.wide)
					: 0;
				// -- damage per torpedo (printed pp7-9) ------------------------
				const terms = damageTermsOf(salvo.damage);
				const armour = Math.max(0, targetSystem.armour ?? 0);
				for (let hit = 0; hit < hits; hit++) {
					const damageRoll = await ports.dice.roll(
						`${terms.dice}d${terms.faces}`,
					);
					rolls.push(...(damageRoll.rolls ? [...damageRoll.rolls] : []));
					const dice = damageRoll.dice.map((die) => Math.floor(die.result));
					// Terminal Penetration (X): one re-roll per low die
					// (printed pp8-9); "the results of the re-roll stand".
					for (const index of terminalPenetrationRerolls(
						dice,
						salvo.terminalPenetration,
					)) {
						const reRoll = await ports.dice.roll(`1d${terms.faces}`);
						rolls.push(...(reRoll.rolls ? [...reRoll.rolls] : []));
						const rerolled = reRoll.dice.map((die) => Math.floor(die.result));
						dice[index] = rerolled[0] ?? dice[index];
					}
					const hitDamage = torpedoHitDamage(
						dice,
						terms.bonus,
						// Vortex warheads IGNORE Armour (printed pp8-9).
						salvo.warhead === "vortex" ? 0 : armour,
						salvo.critRating,
					);
					rows.push({
						id: `ord:hit-${hit}`,
						label: ports.i18n.t("SHIP_ORDNANCE.HIT_ROW", { n: hit + 1 }),
						display: `${hitDamage.raw} → ${hitDamage.hullDamage}`,
					});
					sunkHullDamage += hitDamage.hullDamage;
					if (hitDamage.critical) {
						const critRoll = await ports.dice.roll("1d5");
						rolls.push(...(critRoll.rolls ? [...critRoll.rolls] : []));
						const critical = shipCritical(critRoll.total);
						critText = ports.i18n.t("SHIP_ORDNANCE.CRIT", {
							name: critical?.name ?? "",
						});
					}
					// Warhead specials (printed pp8-9, per successful hit).
					if (salvo.warhead === "vortex") {
						const morale = await ports.dice.roll("1d5");
						rolls.push(...(morale.rolls ? [...morale.rolls] : []));
						targetSystem.crewMorale = Math.max(
							0,
							Math.max(0, targetSystem.crewMorale ?? 100) - morale.total,
						);
						rows.push({
							id: "ord:vortex",
							label: ports.i18n.t("SHIP_ORDNANCE.VORTEX_ROW"),
							display: `-${morale.total}`,
						});
					}
					if (salvo.warhead === "virus" && hitDamage.raw > armour) {
						const population = await ports.dice.roll("3d10");
						const morale = await ports.dice.roll("2d10");
						rolls.push(
							...(population.rolls ? [...population.rolls] : []),
							...(morale.rolls ? [...morale.rolls] : []),
						);
						targetSystem.crewPopulation = Math.max(
							0,
							Math.max(0, targetSystem.crewPopulation ?? 100) -
								population.total,
						);
						targetSystem.crewMorale = Math.max(
							0,
							Math.max(0, targetSystem.crewMorale ?? 100) - morale.total,
						);
						rows.push({
							id: "ord:virus",
							label: ports.i18n.t("SHIP_ORDNANCE.VIRUS_ROW"),
							display: `${population.total} / ${morale.total}`,
						});
					}
					if (salvo.warhead === "boarding" && hitDamage.raw > armour) {
						// A boarding torpedo that wounds the target lands a Hit-and-
						// Run attack (printed p8) — the Hit-and-Run machinery (Core
						// Rulebook printed p218) stays the surface; the card notes.
						critText = critText || ports.i18n.t("SHIP_ORDNANCE.BOARDING_HIT");
					}
					if (salvo.warhead === "melta" && hitDamage.hullDamage > 0) {
						// A Melta torpedo hit that DEALS DAMAGE automatically causes
						// a Fire! Critical result, IN ADDITION to any other Crits —
						// the chart roll above still runs and both names ride the
						// card (Battlefleet Koronus printed p9). The gate is Hull
						// damage, not raw-vs-armour: a criticaling hit the Armour
						// absorbed still deals the kernel's floor of 1 point
						// (torpedoHitDamage, BFK printed p8) — that hit damages the
						// Hull, so it stacks the Fire! too.
						meltaFireHits += 1;
						rows.push({
							id: "ord:melta-fire",
							label: ports.i18n.t("SHIP_ORDNANCE.MELTA_FIRE"),
							display: ports.i18n.t("SHIP_CRITICALS.fire"),
						});
					}
				}
				// Boarding torpedoes never wound the hull (printed p8); the rest of
				// the Hull + crew writes book the ACCUMULATED per-hit totals (the
				// applied HI damage is the SUM — no re-parsing of display strings) and
				// the Crew/Morale drag follows the Core Rulebook p221 rule through
				// crewLossFromHullDamage.
				hullDamage = salvo.warhead === "boarding" ? 0 : sunkHullDamage;
				if (hullDamage > 0) {
					await ports.actors.update(target, {
						system: crewTrackWrite(targetSystem, hullDamage),
					});
				}
			}
		}

		// -- book the run: remaining + travelled, or retire the salvo --------
		const nextRemaining = Math.max(0, remaining - hits);
		const nextSalvos = (shipSystem.torpedoSalvos ?? [])
			.map((entry) =>
				entry.id === salvo.id
					? { ...entry, remaining: nextRemaining, travelled }
					: entry,
			)
			.filter((entry) => !torpedoRunSpent(entry as ShipTorpedoSalvo));
		const flags = (shipSystem.turnFlags ?? []).filter((flag) => {
			if (flag.key !== "torpedo-run") return true;
			return nextSalvos.some((entry) => entry.id === flag.id);
		});
		for (const entry of nextSalvos) {
			if (entry.id === salvo.id) {
				salvoTurnFlagRefresh(flags, entry as ShipTorpedoSalvo);
			}
		}
		await ports.actors.update(ship, {
			system: { torpedoSalvos: nextSalvos, turnFlags: flags },
		});
		await postCard(
			ship,
			`${TEMPLATE_ROOT}chat/ship-ordnance.hbs`,
			{
				title: prepared.title,
				titleDoc: {
					prefix: "",
					suffix: "",
					name: kindData.name,
					link: docAnchor(prepared.kindData),
				},
				mode: "run",
				targetName:
					(target as { name?: string } | null | undefined)?.name ?? "",
				salvoName: salvo.name,
				travelled,
				range: salvo.range,
				wide: salvo.wide,
				shieldsNote: ports.i18n.t("SHIP_ORDNANCE.SHIELDS_IGNORED"),
				attackRows: rows,
				attempted,
				hits,
				hullDamage,
				// Melta Fire! criticals stack with the chart roll's (BFK printed
				// p9): both names ride the card's crit note.
				critNote:
					meltaFireHits > 0
						? critText
							? `${critText} + ${ports.i18n.t("SHIP_CRITICALS.fire")}`
							: ports.i18n.t("SHIP_CRITICALS.fire")
						: critText,
				turretNote: turretText,
				boardingNote:
					salvo.warhead === "boarding"
						? ports.i18n.t("SHIP_ORDNANCE.BOARDING_NOTE")
						: "",
				remainingNote: ports.i18n.t("SHIP_ORDNANCE.REMAINING", {
					count: nextRemaining,
				}),
				spent: nextRemaining <= 0 || travelled >= salvo.range,
			},
			undefined,
			rolls,
		);
	},
};

/** Refresh the run flag's value after hits reduce the salvo. */
function salvoTurnFlagRefresh(
	flags: ShipTurnFlag[],
	salvo: ShipTorpedoSalvo,
): void {
	const flag = flags.find(
		(entry) => entry.key === "torpedo-run" && entry.id === salvo.id,
	);
	if (flag) flag.value = Math.max(0, salvo.remaining);
}

/**
 * The Ballistic Skill side of a torpedo run (Battlefleet Koronus printed
 * p7): the CHARACTER who launched the torpedoes rolls his Ballistic Skill;
 * the crew fallback is the ship's Skill Rating (the p214 Table 8-9
 * precedent).
 */
async function ballisticSide(request: ShipActionRollRequest): Promise<number> {
	const performer = request.performer as unknown as
		| Parameters<typeof characteristicHandler.prepare>[0]["actor"]
		| undefined;
	if (performer) {
		const prepared = await characteristicHandler.prepare({
			kind: "characteristic",
			actor: performer,
			key: "bs",
		});
		if (prepared) return prepared.baseTarget;
	}
	return crewQualityEffects(
		readShipSystem(request.actor).crewQuality ?? "competent",
	).skill;
}

// ------------------------------------------------------------ prompt helpers

/** A document pick from an ordered list (tube / torpedo / salvo prompts). */
async function promptPick(
	ports: ReturnType<typeof getPorts>,
	items: OrdnanceItemLike[],
	what: "tube" | "torpedo",
): Promise<OrdnanceItemLike | null> {
	const pick = (await foundry.applications.api.DialogV2.wait({
		window: {
			title: ports.i18n.t(`SHIP_ORDNANCE.PICK_${what.toUpperCase()}`),
		},
		content: `<p>${ports.i18n.t(
			`SHIP_ORDNANCE.PICK_${what.toUpperCase()}_PROMPT`,
		)}</p>`,
		buttons: items.map((item) => ({
			action: String(item.id ?? item.name ?? ""),
			label: `${item.name ?? "?"}${
				item.system?.quantity != null ? ` ×${item.system.quantity}` : ""
			}`,
			callback: () => String(item.id ?? item.name ?? ""),
		})),
	})) as string | null;
	if (pick === null) return null;
	return (
		items.find((item) => String(item.id ?? item.name ?? "") === pick) ?? null
	);
}

/** The active salvo pick (id + remaining). */
async function promptSalvo(
	ports: ReturnType<typeof getPorts>,
	salvos: ShipTorpedoSalvo[],
): Promise<ShipTorpedoSalvo | null> {
	const pick = (await foundry.applications.api.DialogV2.wait({
		window: { title: ports.i18n.t("SHIP_ORDNANCE.PICK_SALVO") },
		content: `<p>${ports.i18n.t("SHIP_ORDNANCE.PICK_SALVO_PROMPT")}</p>`,
		buttons: salvos.map((salvo) => ({
			action: salvo.id,
			label: `${salvo.name} ×${salvo.remaining}`,
			callback: () => salvo.id,
		})),
	})) as string | null;
	if (pick === null) return null;
	return salvos.find((salvo) => salvo.id === pick) ?? null;
}

// ---------------------------------------------------- Reload Torpedo Tubes

/**
 * RELOAD TORPEDO TUBES (Battlefleet Koronus printed p7): a full Strategic
 * Turn normally; the fast route is an Extended Action — a Difficult (−10)
 * Command or Tech-Use test, on success the empty tubes load and may fire
 * THE SAME Strategic Turn. The prompt chooses the skill; v1 keeps the tube
 * readiness as the card's note (no fabricated tube-load state).
 */
const reloadRow: ShipRow = {
	async prepare(request, rawItem) {
		const item = rawItem as OrdnanceItemLike;
		const ports = getPorts();
		const ship = request.actor;
		const skill = (await foundry.applications.api.DialogV2.wait({
			window: { title: ports.i18n.t("SHIP_ORDNANCE.RELOAD_SKILL_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_ORDNANCE.RELOAD_SKILL_PROMPT")}</p>`,
			buttons: [
				{
					action: "command",
					label: ports.i18n.t("SHIP_ORDNANCE.RELOAD_SKILL_COMMAND"),
					callback: () => "command",
				},
				{
					action: "tech-use",
					label: ports.i18n.t("SHIP_ORDNANCE.RELOAD_SKILL_TECH"),
					callback: () => "tech-use",
				},
			],
		})) as string | null;
		if (skill === null) return null;
		const parsed = parseShipActionTestKey(skill);
		if (!parsed) {
			ports.notify.warn("SHIP_ACTION.UNKNOWN_TEST", { test: skill });
			return null;
		}
		const side = await resolvePerformerSide(
			request,
			parsed.skillRoute,
			parsed.routeKey,
		);
		if (!side) return null;
		const difficulty = actionDifficulty("Difficult (-10)");
		const modifiers: Modifier[] = [];
		if (difficulty.kind === "numeric") {
			modifiers.push({
				id: "ship-action:difficulty",
				source: { type: "item", label: "SHIP_COMBAT.DIFFICULTY" },
				label: "Difficult (-10)",
				value: difficulty.value,
			});
		}
		modifiers.push(...(request.modifiers ?? []));
		return {
			title: rowTitle(ship, item),
			baseTarget: side.baseTarget,
			testKind: side.testKind,
			testKey: side.testKey,
			initialModifiers: modifiers,
			weapon: null,
			context: { skillName: side.skillName },
			kindData: {
				...ordnanceKindData(request, item, { testKey: skill }),
				difficulty: "Difficult (-10)",
				difficultyKind: "numeric",
				combinedTarget: side.baseTarget - 10,
			},
		};
	},
	async after(request, prepared, outcome, _messageId) {
		// The reload's outcome is the machinery card (the ordnance template's
		// "reload" mode); the tube readiness stays the card's note, not a
		// fabricated tube-load state.
		const ports = getPorts();
		const data = prepared.kindData as OrdnanceKindData & { name?: string };
		if (!data) return;
		const link: PackDocAnchor | null = data.uuid
			? {
					action: OPEN_PACK_DOC_ACTION,
					uuid: data.uuid,
					name: data.name,
				}
			: null;
		await postCard(request.actor, `${TEMPLATE_ROOT}chat/ship-ordnance.hbs`, {
			title: prepared.title,
			titleDoc: {
				prefix: "",
				suffix: "",
				name: data.name,
				link,
			},
			mode: "reload",
			roll: outcome.roll,
			outcomeLabel: outcomeLabel(outcome.success, outcome.degrees),
			success: outcome.success,
			note: ports.i18n.t("SHIP_ORDNANCE.RELOAD_NOTE"),
		});
	},
};

// ------------------------------------------------------ attack-craft strikes

/**
 * The shared Command + Craft Rating strike machinery of the two attack-craft
 * rows (printed p13): BOMBING RUN's hits (cap 3 + 1 per extra squadron; each
 * hit 1d10+4, summed, minus the LOWEST armour; ≥ 4 degrees = 1d5 on Table
 * 8-12, Core Rulebook printed p222) and the ASSAULT BOAT RUN's landings
 * (1 + degrees, capped by the surviving squadrons; each landed squadron
 * starts a Hit and Run ignoring the Pilot test, +10 per landed squadron).
 */
function strikeRunRow(kind: "bombing-run" | "assault-boat-run"): ShipRow {
	return {
		async prepare(request, rawItem) {
			const item = rawItem as OrdnanceItemLike;
			const ports = getPorts();
			const ship = request.actor;
			// The Command route (printed p13) + the Craft Rating bonus (p15) as
			// a VISIBLE row.
			const parsed = parseShipActionTestKey("command");
			if (!parsed) return null;
			const side = await resolvePerformerSide(
				request,
				parsed.skillRoute,
				parsed.routeKey,
			);
			if (!side) return null;
			// The craft: the ship's owned attack-craft entries seed the prompt;
			// Craft Rating is an abstract per-type value (printed p15), so the
			// number stays editable either way.
			const craft = attackCraftOf(ship);
			const craftInput = (await foundry.applications.api.DialogV2.input({
				window: { title: ports.i18n.t("SHIP_ORDNANCE.CRAFT_TITLE") },
				content: `<p>${ports.i18n.t("SHIP_ORDNANCE.CRAFT_PROMPT", {
					craft: escapeDocumentData(craft[0]?.name ?? ""),
				})}</p><div class="form-group"><input type="number" name="rating" value="${Number(
					craft[0]?.system?.craftRating ?? 0,
				)}" min="0" max="60" step="1"></div>`,
				ok: { label: ports.i18n.t("SHIP_ORDNANCE.CRAFT_CONFIRM") },
			})) as { rating?: string } | null;
			if (craftInput === null) return null;
			const craftRating = Math.max(
				0,
				Math.floor(Number(craftInput.rating) || 0),
			);
			// Squadrons: +5 per squadron beyond the first (printed pp13/11).
			const squadronInput = (await foundry.applications.api.DialogV2.input({
				window: { title: ports.i18n.t("SHIP_ORDNANCE.SQUADRONS_TITLE") },
				content: `<p>${ports.i18n.t("SHIP_ORDNANCE.SQUADRONS_PROMPT")}</p><div class="form-group"><input type="number" name="squadrons" value="1" min="1" step="1"></div>`,
				ok: { label: ports.i18n.t("SHIP_ORDNANCE.SQUADRONS_CONFIRM") },
			})) as { squadrons?: string } | null;
			if (squadronInput === null) return null;
			const squadrons = Math.max(
				1,
				Math.floor(Number(squadronInput.squadrons) || 1),
			);
			const modifiers: Modifier[] = [
				{
					id: "ship-ordnance:craft-rating",
					source: { type: "item", label: "SHIP_COMBAT.SHIP_ABILITY" },
					label: ports.i18n.t("SHIP_ORDNANCE.CRAFT_RATING_ROW"),
					value: craftRating,
				},
			];
			const bonus = squadronBonus(squadrons);
			if (bonus > 0) {
				modifiers.push({
					id: "ship-ordnance:squadron-bonus",
					source: { type: "item", label: "SHIP_COMBAT.SHIP_ABILITY" },
					label: ports.i18n.t("SHIP_ORDNANCE.SQUADRON_BONUS_ROW", {
						bonus,
					}),
					value: bonus,
				});
			}
			modifiers.push(...(request.modifiers ?? []));
			return {
				title: rowTitle(ship, item),
				baseTarget: side.baseTarget,
				testKind: side.testKind,
				testKey: side.testKey,
				initialModifiers: modifiers,
				weapon: null,
				context: { skillName: side.skillName },
				kindData: {
					...ordnanceKindData(request, item, {
						testKey: item.system?.roll?.test ?? "command",
					}),
					difficulty: item.system?.roll?.difficulty ?? "Challenging (+0)",
					difficultyKind: "numeric",
					combinedTarget: side.baseTarget + craftRating + bonus,
					// The strike payload the after-hook branches on.
					extra: { strikeKind: kind, squadrons },
				} as unknown as OrdnanceKindData,
			};
		},
		async after(request, prepared, outcome, _messageId) {
			const ports = getPorts();
			const data = prepared.kindData as
				| (OrdnanceKindData & {
						extra?: { strikeKind?: string; squadrons?: number };
				  })
				| undefined;
			if (!data) return;
			const strikeKind = data.extra?.strikeKind ?? "bombing-run";
			const squadrons = Math.max(
				1,
				Math.floor(Number(data.extra?.squadrons ?? 1)),
			);
			const link: PackDocAnchor | null = data.uuid
				? {
						action: OPEN_PACK_DOC_ACTION,
						uuid: data.uuid,
						name: data.name,
					}
				: null;
			const target = ports.targets.actor() as
				| (Actor & { name?: string })
				| undefined;
			if (outcome.success && !target) {
				ports.notify.warn("SHIP_COMBAT.NO_TARGET");
				return;
			}
			const mode =
				strikeKind === "assault-boat-run" ? "assault-boats" : "bombers";
			if (!outcome.success) {
				await postCard(
					request.actor,
					`${TEMPLATE_ROOT}chat/ship-ordnance.hbs`,
					{
						title: prepared.title,
						titleDoc: { prefix: "", suffix: "", name: data.name, link },
						mode,
						failed: true,
						targetName: (target as { name?: string } | undefined)?.name ?? "",
						outcomeLabel: outcomeLabel(false, outcome.degrees),
						strikeNote: ports.i18n.t("SHIP_ORDNANCE.STRIKE_WITHDRAW"),
					},
				);
				return;
			}
			const targetSystem = readShipSystem(target);
			const rolls: unknown[] = [];
			if (strikeKind === "assault-boat-run") {
				// The surviving squadrons gate the landings (printed p13).
				const survivorsInput = (await foundry.applications.api.DialogV2.input({
					window: { title: ports.i18n.t("SHIP_ORDNANCE.SURVIVORS_TITLE") },
					content: `<p>${ports.i18n.t("SHIP_ORDNANCE.SURVIVORS_PROMPT")}</p><div class="form-group"><input type="number" name="survivors" value="${squadrons}" min="0" step="1"></div>`,
					ok: { label: ports.i18n.t("SHIP_ORDNANCE.SURVIVORS_CONFIRM") },
				})) as { survivors?: string } | null;
				if (survivorsInput === null) return;
				const survivors = Math.max(
					0,
					Math.floor(Number(survivorsInput.survivors) || 0),
				);
				const landings = assaultBoatLandings(outcome.degrees, survivors);
				await postCard(
					request.actor,
					`${TEMPLATE_ROOT}chat/ship-ordnance.hbs`,
					{
						title: prepared.title,
						titleDoc: { prefix: "", suffix: "", name: data.name, link },
						mode,
						failed: false,
						targetName: (target as { name?: string }).name ?? "",
						outcomeLabel: outcomeLabel(true, outcome.degrees),
						landingNote: ports.i18n.t("SHIP_ORDNANCE.LANDING_NOTE", {
							count: landings,
							bonus: landings * 10,
						}),
						strikeNote: ports.i18n.t("SHIP_ORDNANCE.HIT_AND_RUN_NOTE"),
					},
				);
				return;
			}
			// Bombing run: hits, cap 3 + 1 per additional squadron (printed p13).
			const hits = bomberRunHits(outcome.degrees, squadrons);
			let sum = 0;
			for (let hit = 0; hit < hits; hit++) {
				const damageRoll = await ports.dice.roll(BOMBER_HIT_DIE);
				rolls.push(...(damageRoll.rolls ? [...damageRoll.rolls] : []));
				sum += damageRoll.total;
			}
			// The target's LOWEST armour value (printed p13; the starship
			// schema's single Armour statline is the v1 stand-in — the epic's
			// ramming prow-armour precedent, decision 5).
			const armour = Math.max(0, targetSystem.armour ?? 0);
			const salvo = resolveSalvoDamage({
				damageTotal: sum,
				armour,
				lance: false,
			});
			const loss = crewLossFromHullDamage(salvo.hullDamage);
			let critNote = "";
			if (bomberRunCritical(outcome.degrees)) {
				const critRoll = await ports.dice.roll("1d5");
				rolls.push(...(critRoll.rolls ? [...critRoll.rolls] : []));
				const critical = shipCritical(critRoll.total);
				critNote = ports.i18n.t("SHIP_ORDNANCE.CRIT", {
					name: critical?.name ?? "",
				});
			}
			await ports.actors.update(target, {
				system: crewTrackWrite(targetSystem, salvo.hullDamage),
			});
			await postCard(
				request.actor,
				`${TEMPLATE_ROOT}chat/ship-ordnance.hbs`,
				{
					title: prepared.title,
					titleDoc: { prefix: "", suffix: "", name: data.name, link },
					mode,
					failed: false,
					targetName: (target as { name?: string }).name ?? "",
					outcomeLabel: outcomeLabel(true, outcome.degrees),
					hits,
					damageTotal: sum,
					armour,
					hullDamage: salvo.hullDamage,
					populationLoss: loss.population,
					moraleLoss: loss.morale,
					critNote,
					shieldsNote: ports.i18n.t("SHIP_ORDNANCE.SHIELDS_IGNORED"),
					strikeNote: ports.i18n.t("SHIP_ORDNANCE.STRIKE_WITHDRAW"),
				},
				undefined,
				rolls,
			);
		},
	};
}

// ---------------------------------------------------- Attack with Fighters

/**
 * ATTACK WITH FIGHTERS (Battlefleet Koronus printed p12): an OPPOSED
 * Challenging (+0) Command + Craft Rating test — the epic's opposed tests
 * stay MANUAL (the owner ruling), so this row resolves like the rout row:
 * prompt which side won and by how many degrees; ONE opposing squadron or
 * torpedo is eliminated per degree. Enemy torpedo salvos are machine state —
 * the losing ship's runs are reduced directly (and their flags retired
 * with them); fighter/bomber SQUADRONS stay a manual note (no fabricated
 * squadron-strength machinery, the bead's mandate).
 */
const fighterAttackRow: ShipRow = {
	async prepare(request, _item) {
		return {
			title: rowTitle(request.actor, _item),
			baseTarget: 0,
			testKind: "characteristic",
			testKey: "fighter-attack",
			initialModifiers: [],
			weapon: null,
			context: {},
			prepareOnly: true,
			kindData: ordnanceKindData(request, _item, {
				testKey: "fighter-attack",
			}),
		};
	},
	async after(request, prepared, _outcome, _messageId) {
		const ports = getPorts();
		const ship = request.actor;
		const kindData = prepared.kindData as OrdnanceKindData | undefined;
		if (!kindData) return;
		const target = ports.targets.actor() as
			| (Actor & { name?: string })
			| undefined;
		if (!target) {
			ports.notify.warn("SHIP_COMBAT.NO_TARGET");
			return;
		}
		// -- which side won the manual opposed Command + Craft Rating --------
		const winner = (await foundry.applications.api.DialogV2.wait({
			window: { title: ports.i18n.t("SHIP_ORDNANCE.FIGHTERS_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_ORDNANCE.FIGHTERS_PROMPT", {
				ship: escapeDocumentData((ship as { name?: string }).name ?? ""),
				target: escapeDocumentData(target.name ?? ""),
			})}</p>`,
			buttons: [
				{
					action: "ship",
					label: ports.i18n.t("SHIP_ORDNANCE.FIGHTERS_WINNER_SHIP", {
						ship: (ship as { name?: string }).name ?? "",
					}),
					callback: () => "ship",
				},
				{
					action: "target",
					label: ports.i18n.t("SHIP_ORDNANCE.FIGHTERS_WINNER_TARGET", {
						target: target.name ?? "",
					}),
					callback: () => "target",
				},
			],
		})) as string | null;
		if (winner === null) return;
		const degreeInput = (await foundry.applications.api.DialogV2.input({
			window: { title: ports.i18n.t("SHIP_BOARDING.DEGREES_TITLE") },
			content: `<p>${ports.i18n.t("SHIP_BOARDING.DEGREES_PROMPT", {
				winner: escapeDocumentData(
					winner === "ship"
						? ((ship as { name?: string }).name ?? "")
						: (target.name ?? ""),
				),
			})}</p><div class="form-group"><input type="number" name="degrees" value="1" min="1" max="20" step="1"></div>`,
			ok: { label: ports.i18n.t("SHIP_BOARDING.DEGREES_CONFIRM") },
		})) as { degrees?: string } | null;
		if (degreeInput === null) return;
		const degrees = Math.max(
			0,
			Math.min(20, Math.floor(Number(degreeInput.degrees) || 0)),
		);
		const loserName =
			winner === "ship"
				? (target.name ?? "")
				: ((ship as { name?: string }).name ?? "");
		// The LOSER's torpedo runs take the eliminations (machine state); the
		// loser's fighter/bomber squadrons are a manual note only.
		const loser = winner === "ship" ? target : ship;
		const loserSystem = readShipSystem(loser);
		const runs = loserSystem.torpedoSalvos ?? [];
		const salvoRows: Array<{ name: string; display: string }> = [];
		if (runs.length > 0) {
			const nextRuns = runs
				.map((salvo) => {
					const down = Math.min(salvo.remaining, degrees);
					if (down > 0)
						salvoRows.push({ name: salvo.name, display: `-${down}` });
					return {
						...salvo,
						remaining: Math.max(0, salvo.remaining - degrees),
					};
				})
				.filter((salvo) => !torpedoRunSpent(salvo as ShipTorpedoSalvo));
			const flags = (loserSystem.turnFlags ?? [])
				.filter(
					(flag) =>
						flag.key !== "torpedo-run" ||
						nextRuns.some((salvo) => salvo.id === flag.id),
				)
				.map((flag) => {
					const run = nextRuns.find((salvo) => salvo.id === flag.id);
					return run ? { ...flag, value: Math.max(0, run.remaining) } : flag;
				});
			await ports.actors.update(loser, {
				system: { torpedoSalvos: nextRuns, turnFlags: flags },
			});
		}
		await postCard(ship, `${TEMPLATE_ROOT}chat/ship-ordnance.hbs`, {
			title: prepared.title,
			titleDoc: {
				prefix: "",
				suffix: "",
				name: kindData.name,
				link: docAnchor(prepared.kindData),
			},
			mode: "fighters",
			winnerName:
				winner === "ship"
					? ((ship as { name?: string }).name ?? "")
					: (target.name ?? ""),
			loserName,
			degrees,
			salvoRows,
			squadronNote: ports.i18n.t("SHIP_ORDNANCE.SQUADRON_MANUAL_NOTE"),
		});
	},
};

// ------------------------------------------------------------------- export

// The two shared strike rows (the strikeRunRow factory builds both from one
// body, the ship-boarding.ts row-object precedent).
const bombingRunRow = strikeRunRow("bombing-run");
const assaultBoatRunRow = strikeRunRow("assault-boat-run");

/**
 * The ordnance machinery row map (bead a413): the ship-action dispatch's
 * lookup; canonical row names normalise through boardingRowKey — the same
 * machine-key rule the boarding rows follow.
 */
export const ordnanceRowHandlers: Readonly<Record<string, ShipRow>> = {
	"launch-torpedoes": launchTorpedoesRow,
	"torpedo-run": torpedoRunRow,
	"reload-torpedo-tubes": reloadRow,
	"bombing-run": bombingRunRow,
	"assault-boat-run": assaultBoatRunRow,
	"attack-with-fighters": fighterAttackRow,
};

/**
 * The PREPARE-ONLY ordnance rows (Launch / Run / the manual opposed fighter
 * attack): these rows' own prompts roll the dice, so the combat-tab chips for
 * them skip the shared TestDialog (the Break Free / Rout machinery precedent);
 * the standard-path rows (Reload, the two strike runs) keep the dialog.
 */
export const ORDNANCE_PROMPT_ONLY_ROWS: ReadonlySet<string> = new Set([
	"launch-torpedoes",
	"torpedo-run",
	"attack-with-fighters",
]);

/** Type anchor: the rows satisfy the ship-action after-hook contract. */
export type OrdnanceRowAfter = RollHandler<"ship-action">["after"];

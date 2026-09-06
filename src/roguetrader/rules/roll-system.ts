/**
 * Roll system (bead mvu2): discriminated-union roll requests + a typed
 * handler registry, orchestrated by performRoll. Replaces the hand-rolled
 * dialog -> funnel -> kernel -> card sequences that used to live in
 * rules/adapter.ts.
 *
 * Structure mirrors the codebase's registry conventions (funnel
 * testContributors, talentEffectHandlers): one handler per RollKind, the
 * handler map typed { [K in RollKind]: RollHandler<K> } so adding a kind
 * forces implementing its handler and the orchestrator is never edited
 * (foundation for xfta ship-weapon BS tests: new kind + handler only).
 *
 * Behaviour is preserved 1:1 from the pre-refactor adapter sequences:
 * dialog visibility, contributor merging, post-dialog rows, card contents
 * and chat flags are all carried over verbatim.
 */

import type { Actor } from "fvtt-types/documents";
import {
	type Modifier,
	resolveTest,
	rtCore,
	sumModifiers,
	type TestOutcome,
} from "../../rules-engine/src/index";
import { systemOf } from "../data/accessors";
import {
	effectivePsyRating,
	focusPowerAutoFailFloor,
	phenomenaRollModifier,
	phenomenaTableName,
	shouldRollPhenomena,
	psyRatingBonus,
	type StrengthLevel,
} from "./psychic";
import { resolvePower } from "./power-resolution";
import { collectTestModifiers, mergeModifiers, type TestKind } from "./funnel";
import { isWeaponType, equipStateOf } from "../data/accessors";
import { postCard, type RtMessageFlags } from "./chat-flags";
import { TestDialog } from "./test-dialog";

// ---------------------------------------------------------------------------
// Requests (discriminated union)
// ---------------------------------------------------------------------------

export type RollKind =
	| "characteristic"
	| "skill"
	| "weapon"
	| "psychic"
	| "navigator";

/** Shared request data. The title is derived per kind in the handler. */
interface RollBase {
	actor: Actor;
	/** Bypass the modify dialog (fast-forward). */
	skipDialog?: boolean;
}

export interface CharacteristicRollRequest extends RollBase {
	kind: "characteristic";
	/** Characteristic key ("ws", "bs", ...). */
	key: string;
	/** Caller-provided modifiers, merged with the funnel collection. */
	modifiers?: Modifier[];
}

export interface SkillRollRequest extends RollBase {
	kind: "skill";
	/** Trained attempt: the skill item id. */
	itemId?: string;
	/** Untrained attempt: raw characteristic + display label (no item). */
	characteristicKey?: string;
	label?: string;
	modifiers?: Modifier[];
}

export interface WeaponRollRequest extends RollBase {
	kind: "weapon";
	/** The weapon item id (equip gate + attack dialog + damage flags). */
	itemId: string;
	modifiers?: Modifier[];
}

export interface PsychicRollRequest extends RollBase {
	kind: "psychic";
	itemId: string;
}

export interface NavigatorRollRequest extends RollBase {
	kind: "navigator";
	itemId: string;
}

export type RollRequest =
	| CharacteristicRollRequest
	| SkillRollRequest
	| WeaponRollRequest
	| PsychicRollRequest
	| NavigatorRollRequest;

// ---------------------------------------------------------------------------
// Handler contract
// ---------------------------------------------------------------------------

/** Funnel context passed through to collectTestModifiers (bead hyv/r1k). */
export interface RollContext {
	aimed?: boolean;
	fireMode?: "single" | "burst" | "full";
	flags?: Record<string, boolean>;
	/** Skill-item test name (bead r1k) for "skill:<name>" effect keys. */
	skillName?: string;
}

/** Everything the shared pipeline needs once the handler has prepared. */
export interface PreparedRoll {
	/** Human card/dialog title (actor-qualified). */
	title: string;
	/** Unmodified target (characteristic / skill value). */
	baseTarget: number;
	/** Funnel test kind ("characteristic" | "skill" | "attack" | "focus-power"). */
	testKind: TestKind;
	/** Funnel test key (characteristic key or title surrogate). */
	testKey: string;
	/** Pre-dialog modifier rows (psy bonus, mastery, untrained, caller). */
	initialModifiers: Modifier[];
	/** Weapon shape for funnel effect collection (weapon kind only). */
	weapon: { type: string; special?: string[] } | null;
	/** Pre-dialog funnel context (skill name). */
	context: RollContext;
	/** Extra roll-card template vars (e.g. showDamageButton). */
	templateVars?: Record<string, unknown>;
	/** Flags set on the roll card at creation time. */
	flags?: RtMessageFlags;
	/** Profile override (bead sa6: Focus Power 91+ auto-fail). */
	autoFailRoll?: number | null;
	/** Kind-specific data carried from prepare to after (e.g. psychic strength). */
	kindData?: Record<string, unknown>;
}

/**
 * Per-kind handler. Every hook is optional except prepare (validation +
 * derived data); performRoll runs prepare -> dialog -> post-dialog rows ->
 * shared test pipeline -> after. Handlers that need Foundry UI do it inside
 * their hooks so the orchestrator stays Foundry-shape-free.
 */
export interface RollHandler<K extends RollKind> {
	/** Validate + resolve the request. Null = bail (warnings already shown). */
	prepare(request: Extract<RollRequest, { kind: K }>): Promise<PreparedRoll | null>;
	/** Extra TestDialog config (weapon: attack-context selectors). */
	dialogConfig?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
	): object;
	/** Post-dialog modifier rows (weapon: Aim / Inaccurate cancellation). */
	postDialogModifiers?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		dialog: TestDialogResultLike,
	): Modifier[];
	/** Funnel context that depends on the dialog result (weapon: fire mode). */
	testContext?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		dialog: TestDialogResultLike | null,
	): RollContext;
	/** Post-card follow-up (damage flag, evasion, phenomena, power damage). */
	after?(
		request: Extract<RollRequest, { kind: K }>,
		prepared: PreparedRoll,
		outcome: TestOutcome,
		messageId: string | null,
	): Promise<void>;
}

/** Minimal shape of the TestDialog result the hooks consume. */
export interface TestDialogResultLike {
	modifiers: Modifier[];
	attack?: {
		fireMode?: "single" | "burst" | "full";
		aimed?: boolean;
		aimFull?: boolean;
		flags?: Record<string, boolean>;
	};
}

// ---------------------------------------------------------------------------
// Shared pipeline pieces
// ---------------------------------------------------------------------------

/**
 * Dialog contributors = caller modifiers + a funnel collection for the test
 * context, so talent/gear/item effects are visible (and editable-previewed)
 * in the dialog, not only on the chat card. Attack-context-dependent
 * contributors (fire-mode, condition flags) are chosen inside the dialog and
 * stay post-dialog only - the card shows the full breakdown. Ids survive the
 * dialog round-trip, so the test step's funnel merge dedupes instead of
 * doubling.
 */
export function dialogContributors(
	actor: Actor,
	kind: TestKind,
	key: string,
	modifiers: Modifier[],
	weapon: { type: string; special?: string[] } | null = null,
	skillName?: string,
): Modifier[] {
	return mergeModifiers(
		modifiers,
		collectTestModifiers(actor, { kind, key, weapon, skillName }),
	);
}

/**
 * Shared test step: funnel collection -> clamped target -> 1d100 -> kernel
 * resolveTest -> roll card. Used by every kind.
 */
export async function runTest(
	actor: Actor,
	prepared: PreparedRoll,
	modifiers: Modifier[],
	context: RollContext,
): Promise<{ outcome: TestOutcome; messageId: string | null }> {
	const collected = collectTestModifiers(
		actor,
		{
			kind: prepared.testKind,
			key: prepared.testKey,
			weapon: prepared.weapon,
			...context,
		},
		modifiers,
	);
	const totalModifier = sumModifiers(collected);
	const target = Math.min(100, Math.max(1, prepared.baseTarget + totalModifier));

	const roll = new foundry.dice.Roll("1d100");
	await roll.evaluate();
	const rollResult = roll.total ?? 0;

	const outcome = resolveTest({
		target,
		roll: rollResult,
		profile:
			prepared.autoFailRoll !== undefined
				? { ...rtCore, autoFailRoll: prepared.autoFailRoll }
				: rtCore,
	});
	const outcomeLabel = outcome.success
		? `${game.i18n.localize("ROLL.SUCCESS")} (+${outcome.degrees} ${game.i18n.localize("ROLL.DEGREES")})`
		: game.i18n.localize("ROLL.FAILURE");

	const message = await postCard(
		actor,
		"systems/rogue-trader/template/chat/roll.hbs",
		{
			title: prepared.title,
			target,
			totalModifier,
			analysis: collected,
			roll: rollResult,
			outcomeLabel,
			outcomeClass: outcome.success ? "success" : "failure",
			critical: outcome.critical,
			isDouble: outcome.isDouble,
			...prepared.templateVars,
		},
		prepared.flags,
	);
	return { outcome, messageId: message?.id ?? null };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Characteristic test (rollTest). */
export const characteristicHandler: RollHandler<"characteristic"> = {
	async prepare(request) {
		const system = systemOf(request.actor);
		const characteristic = system.characteristics[request.key];
		if (!characteristic) {
			ui.notifications?.warn(
				game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key: request.key }),
			);
			return null;
		}
		return {
			title: `${request.actor.name} — ${game.i18n.localize(`CHARACTERISTIC.${request.key.toUpperCase()}`)}`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: request.key,
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: null,
			context: {},
		};
	},
};

/** Skill test: trained (skill item) or untrained (raw characteristic -10). */
export const skillHandler: RollHandler<"skill"> = {
	async prepare(request) {
		if (request.itemId !== undefined) return prepareTrainedSkill(request);
		return prepareUntrainedSkill(request);
	},
};

async function prepareTrainedSkill(
	request: Extract<RollRequest, { kind: "skill" }>,
): Promise<PreparedRoll | null> {
	const actor = request.actor;
	const item = actor.items.get(request.itemId ?? "");
	if (!item || item.type !== "skill") {
		ui.notifications?.warn(game.i18n.format("ROLL.UNKNOWN_SKILL"));
		return null;
	}
	const system = systemOf(actor);
	const skill = item.system as unknown as {
		characteristic: string;
		ladder: number;
	};
	const characteristic = system.characteristics[skill.characteristic];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", {
				key: skill.characteristic,
			}),
		);
		return null;
	}
	// Bead r1k: skill tests carry the skill item's name so item effects
	// keyed "skill:<name>" (Medikit → Medicae etc.) apply to the right
	// tests only.
	const skillName = (item.name ?? "").toLowerCase();
	return {
		title: `${actor.name} — ${item.name}`,
		baseTarget: characteristic.value + (skill.ladder - 1) * 10,
		testKind: "skill",
		testKey: skill.characteristic,
		initialModifiers: [...(request.modifiers ?? [])],
		weapon: null,
		context: { skillName },
	};
}

async function prepareUntrainedSkill(
	request: Extract<RollRequest, { kind: "skill" }>,
): Promise<PreparedRoll | null> {
	const actor = request.actor;
	const characteristicKey = request.characteristicKey ?? "";
	const system = systemOf(actor);
	const characteristic = system.characteristics[characteristicKey];
	if (!characteristic) {
		ui.notifications?.warn(
			game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", {
				key: characteristicKey,
			}),
		);
		return null;
	}
	// Untrained attempt of a basic skill: characteristic value with the RAW
	// -10 penalty expressed as a funnel modifier (breakdown shows it
	// explicitly). Advanced skills cannot be attempted untrained (enforced
	// by callers).
	const untrainedModifier: Modifier = {
		id: "untrained",
		source: { type: "skill", label: "Skill" },
		label: game.i18n.localize("ROLL.UNTRAINED"),
		value: -10,
	};
	return {
		title: `${actor.name} — ${request.label ?? ""}`,
		baseTarget: characteristic.value,
		testKind: "skill",
		testKey: characteristicKey,
		initialModifiers: [untrainedModifier],
		weapon: null,
		context: {},
	};
}

/** Weapon attack to-hit test (rollWeaponAttack). */
export const weaponHandler: RollHandler<"weapon"> = {
	async prepare(request) {
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		const type = item?.type as string | undefined;
		if (!item || !isWeaponType(type)) {
			ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
			return null;
		}
		// Equip-state gate: attacks require the weapon to be carried (the
		// ready state for weapons; armour is worn and cannot attack).
		if (equipStateOf(item) !== "carried") {
			ui.notifications?.warn(
				game.i18n.format("ROLL.NOT_CARRIED", { weapon: item.name }),
			);
			return null;
		}
		const system = systemOf(actor);
		const key = type === "melee-weapon" ? "ws" : "bs";
		const characteristic = system.characteristics[key];
		if (!characteristic) return null;
		const special = (
			(item.system as unknown as { special?: string[] }).special ?? []
		).map(String);
		return {
			title: `${actor.name} — ${item.name}`,
			baseTarget: characteristic.value,
			testKind: "attack",
			testKey: key,
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: { type: String(type), special },
			context: {},
			// Damage flow (b02/1h2, owner redesign): the to-hit card carries a
			// "Roll Damage" button; damage rolls on click, not automatically.
			templateVars: { showDamageButton: true },
		};
	},
	dialogConfig(request, prepared) {
		// Bead hyv: attack-context selectors (fire mode, aim, charge).
		return {
			attackContext: {
				ranged: prepared.weapon?.type === "ranged-weapon",
				melee: prepared.weapon?.type === "melee-weapon",
			},
		};
	},
	postDialogModifiers(_request, prepared, dialog) {
		// Aim (+10 half / +20 full, p237): a verified book modifier
		// contributed by the dialog, shown in the breakdown like any other
		// row. Inaccurate (VERIFIED book p116, PDF p117): "No bonus is gained
		// from the use of the Aim Action" — the aim bonus never applies; an
		// aimed shot with an Inaccurate weapon shows an explicit 0-value row
		// so the cancellation is visible, not silent.
		if (!dialog.attack?.aimed) return [];
		const special = prepared.weapon?.special ?? [];
		if (special.includes("inaccurate")) {
			return [
				{
					id: "attack:aim-inaccurate",
					source: { type: "dialog", label: "WEAPON.SPECIAL" },
					label: "Inaccurate (no Aim bonus)",
					value: 0,
				},
			];
		}
		return [
			{
				id: "attack:aim",
				source: { type: "dialog", label: "ROLL.AIM" },
				label: dialog.attack.aimFull ? "Aim (Full)" : "Aim (Half)",
				value: dialog.attack.aimFull ? 20 : 10,
			},
		];
	},
	testContext(_request, _prepared, dialog) {
		if (!dialog?.attack) return {};
		return {
			aimed: dialog.attack.aimed,
			fireMode: dialog.attack.fireMode,
			flags: dialog.attack.flags,
		};
	},
	async after(request, _prepared, outcome, messageId) {
		// Attach the damage-button flag now that the to-hit outcome exists
		// (data-only kernel: the displayed roll feeds the damage location).
		const target = (
			game as unknown as {
				user?: { targets?: Set<{ actor?: Actor }> };
			}
		).user?.targets
			?.values()
			?.next()?.value?.actor;
		if (outcome.success && messageId) {
			const chatMessage = foundry.documents.ChatMessage.get(messageId) as
				| { update?: (u: object) => Promise<void> }
				| undefined;
			const item = request.actor.items.get(request.itemId);
			await chatMessage?.update?.({
				flags: {
					"rogue-trader": {
						damageRoll: {
							attackerUuid: request.actor.uuid,
							weaponUuid: item?.uuid,
							targetUuid: target?.uuid ?? null,
							hitRoll: outcome.roll,
							// Bead fjw: critical hits (success + double, per the
							// profile's critOnDouble) gate critical-damage talents.
							critical: outcome.critical,
							rolled: false,
						},
					},
				},
			});
		}
		// Evasion (bead 97a): decision DIALOG again, but informational only
		// - it posts the defender's reaction test card and does NOT feed
		// the damage calculation (resolution stays manual for now).
		if (outcome.success && target && target !== request.actor) {
			try {
				await resolveEvasion(target, request);
			} catch (error) {
				console.error("rogue-trader: evasion roll failed", error);
			}
		}
	},
};

/** Psychic power activation (rollPsychicPower). */
export const psychicHandler: RollHandler<"psychic"> = {
	async prepare(request) {
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		if (!item || (item.type as string) !== "psychicpower") {
			ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
			return null;
		}
		const system = systemOf(actor);
		const power = item.system as unknown as {
			powerClass?: string;
			subtype?: string;
			focusTest?: string;
			damage?: string;
			name?: string;
		};
		const psyRating = system.psyRating ?? 0;
		if (psyRating < 1 && system.psyker !== true) {
			ui.notifications?.warn(game.i18n.localize("PSYCHIC_POWER.NOT_PSYKER"));
			return null;
		}

		// Strength selection (Table 6-1): Fettered (half PR, no phenomena),
		// Unfettered (full PR, doubles trigger phenomena), Push (+1..+3 PR,
		// automatic phenomena at +5/+1). Push cap is +3/+4 per the book; the
		// sanctioned flag is not tracked on the actor yet — +3 is used and
		// the cap is homebrew-profile material later (UNVERIFIED IN WORLD:
		// renegade sorcerers need the +4 cap).
		const strength = request.skipDialog
			? "unfettered"
			: await promptStrength();
		if (!strength) return null;
		// Push level is encoded in the prompt choice ("push:2"); default +1.
		const [strengthLevel, pushLevelsRaw] = strength.split(":");
		const pushLevels =
			strengthLevel === "push" ? Number(pushLevelsRaw ?? "1") || 1 : 0;

		const sustainedCount = system.sustainedPowers?.length ?? 0;
		const effPr = effectivePsyRating({
			psyRating,
			strength: strengthLevel as "fettered" | "unfettered" | "push",
			pushLevels,
			sustainedCount,
		});
		const psyBonus = psyRatingBonus(effPr);

		// Focus Power Test characteristic: the power's focusTest field names
		// it (usually Willpower, sometimes Psyniscience as a skill); default
		// wp.
		const testKey = focusTestKey(power.focusTest);
		const characteristic = system.characteristics[testKey];
		if (!characteristic) {
			ui.notifications?.warn(
				game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key: testKey }),
			);
			return null;
		}

		const psyBonusModifier: Modifier = {
			id: "psy-rating",
			source: { type: "item", label: "SOURCE.FROM_POWERS" },
			label: game.i18n.localize("PSYCHIC_POWER.PSY_RATING_BONUS"),
			value: psyBonus,
		};
		const strengthLabel = game.i18n.localize(
			`PSYCHIC_POWER.STRENGTH_${strengthLevel.toUpperCase()}`,
		);
		return {
			title: `${actor.name} — ${item.name} (${strengthLabel})`,
			baseTarget: characteristic.value,
			testKind: "focus-power",
			testKey,
			initialModifiers: [psyBonusModifier],
			weapon: null,
			context: {},
			// Bead sa6: Focus Power Tests auto-fail on rolls of 91+ (book
			// p157). Profile data, not an if/else.
			autoFailRoll: focusPowerAutoFailFloor(),
			// after() needs the rolled strength for the phenomena trigger and
			// the push modifier (book p157).
			kindData: { strength: strengthLevel, pushLevels, sustainedCount },
		};
	},
	async after(request, prepared, outcome, _messageId) {
		const item = request.actor.items.get(request.itemId);
		const power = item?.system as unknown as
			| { subtype?: string; damage?: string; name?: string }
			| undefined;
		const strength = prepared.kindData?.strength as StrengthLevel;
		// Psychic Phenomena (Table 6-1 triggers, book p157).
		if (shouldRollPhenomena(strength, outcome)) {
			await rollPhenomena(request.actor, {
				pushLevels: (prepared.kindData?.pushLevels as number) ?? 0,
				sustainedCount: (prepared.kindData?.sustainedCount as number) ?? 0,
			});
		}
		// Success handling via the resolution registry (design mso6 addendum).
		if (outcome.success && power) {
			const resolution = resolvePower(power.subtype);
			if (resolution.damage && power.damage) {
				await postPowerDamage(request.actor, power.name ?? "", power.damage);
			}
		}
	},
};

/** Navigator power activation (rollNavigatorPower). */
export const navigatorHandler: RollHandler<"navigator"> = {
	async prepare(request) {
		const actor = request.actor;
		const item = actor.items.get(request.itemId);
		if (!item || (item.type as string) !== "navigatorpower") {
			ui.notifications?.warn(game.i18n.localize("ROLL.UNKNOWN_SKILL"));
			return null;
		}
		const system = systemOf(actor);
		const power = item.system as unknown as {
			characteristic?: string;
			mastery?: string;
		};
		const key = power.characteristic ?? "per";
		const characteristic = system.characteristics[key];
		if (!characteristic) {
			ui.notifications?.warn(
				game.i18n.format("ROLL.UNKNOWN_CHARACTERISTIC", { key }),
			);
			return null;
		}

		// Navigator power activation (bead sa6, Core Rulebook Ch. VII book
		// p178): a plain Characteristic Test with the mastery bonus
		// (+0/+10/+20 Novice/Adept/Master) as a funnel-visible modifier. NO
		// Focus Power Test, NO Psy Rating, NEVER Psychic Phenomena/Perils
		// (book p178).
		const mastery = power.mastery ?? "novice";
		const bonus = (
			item.system as unknown as { masteryBonusValue?: number }
		).masteryBonusValue ?? 0;
		const masteryLabel = game.i18n.localize(
			`NAVIGATOR_POWER.${mastery.toUpperCase()}`,
		);
		const masteryModifier: Modifier = {
			id: "navigator-mastery",
			source: { type: "item", label: "SOURCE.FROM_POWERS" },
			label: masteryLabel,
			value: bonus,
		};
		return {
			title: `${actor.name} — ${item.name} (${masteryLabel})`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: key,
			initialModifiers: [masteryModifier],
			weapon: null,
			context: {},
		};
	},
};

/**
 * The handler registry: exhaustive over RollKind. Adding a kind requires a
 * handler here (compile error otherwise) and performRoll needs no edit.
 */
export const rollHandlers: {
	[K in RollKind]: RollHandler<K>;
} = {
	characteristic: characteristicHandler,
	skill: skillHandler,
	weapon: weaponHandler,
	psychic: psychicHandler,
	navigator: navigatorHandler,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Single roll pipeline: prepare -> dialog -> post-dialog rows -> shared test
 * (funnel -> kernel -> card) -> after. Every roll kind goes through here;
 * handlers supply the per-kind deltas.
 */
export async function performRoll(request: RollRequest): Promise<void> {
	const handler = rollHandlers[request.kind];
	const prepared = await handler.prepare(request);
	if (!prepared) return;

	let dialog: TestDialogResultLike | null = null;
	let modifiers = prepared.initialModifiers;
	if (!request.skipDialog) {
		const result = await TestDialog.show({
			title: prepared.title,
			baseTarget: prepared.baseTarget,
			contributors: dialogContributors(
				request.actor,
				prepared.testKind,
				prepared.testKey,
				modifiers,
				prepared.weapon,
				prepared.context.skillName,
			),
			...handler.dialogConfig?.(request, prepared),
		});
		if (result === null) return;
		dialog = result;
		modifiers = result.modifiers;
	}

	modifiers = [
		...modifiers,
		...(handler.postDialogModifiers?.(request, prepared, dialog ?? {
			modifiers: [],
		}) ?? []),
	];

	const context = handler.testContext?.(request, prepared, dialog) ??
		prepared.context;

	const { outcome, messageId } = await runTest(
		request.actor,
		prepared,
		modifiers,
		context,
	);
	await handler.after?.(request, prepared, outcome, messageId);
}

// ---------------------------------------------------------------------------
// Compatibility wrappers (game.rogueTrader.* API + sheet entry points)
// ---------------------------------------------------------------------------

/** Legacy options shape shared by the exported roll functions. */
export interface RollTestOptions {
	/** Dialog-provided or programmatic modifiers. */
	modifiers?: Modifier[];
	/** Bypass the modify dialog (fast-forward). */
	skipDialog?: boolean;
}

/** Roll a characteristic test: dialog -> funnel -> kernel -> chat card. */
export async function rollTest(
	actor: Actor,
	key: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "characteristic",
		actor,
		key,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/**
 * Untrained attempt of a basic skill: characteristic value with the RAW -10
 * penalty expressed as a funnel modifier (breakdown shows it explicitly).
 * Advanced skills cannot be attempted untrained (enforced by callers).
 */
export async function rollSkillUntrained(
	actor: Actor,
	label: string,
	characteristicKey: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "skill",
		actor,
		characteristicKey,
		label,
		skipDialog: options.skipDialog,
	});
}

/** Roll a skill item test: target = characteristic value + ladder bonus. */
export async function rollSkill(
	actor: Actor,
	skillItemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "skill",
		actor,
		itemId: skillItemId,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/** Roll a weapon attack's to-hit test. */
export async function rollWeaponAttack(
	actor: Actor,
	weaponId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({
		kind: "weapon",
		actor,
		itemId: weaponId,
		modifiers: options.modifiers,
		skipDialog: options.skipDialog,
	});
}

/** Psychic power activation (Core Rulebook Ch. VI). */
export async function rollPsychicPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({ kind: "psychic", actor, itemId, skipDialog: options.skipDialog });
}

/** Navigator power activation (Core Rulebook Ch. VII book p178). */
export async function rollNavigatorPower(
	actor: Actor,
	itemId: string,
	options: RollTestOptions = {},
): Promise<void> {
	await performRoll({ kind: "navigator", actor, itemId, skipDialog: options.skipDialog });
}

// ---------------------------------------------------------------------------
// Psychic support (strength prompt, phenomena, power damage)
// ---------------------------------------------------------------------------

/**
 * Strength prompt (Table 6-1, book p157): Fettered / Unfettered / Push
 * +1..+3. Push levels are separate buttons; each callback encodes the level
 * in the returned value ("push:2").
 */
export async function promptStrength(): Promise<string | null> {
	return (await foundry.applications.api.DialogV2.wait({
		window: {
			title: game.i18n.localize("PSYCHIC_POWER.STRENGTH_TITLE"),
		},
		content: `<p>${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PROMPT")}</p>`,
		buttons: [
			{
				action: "fettered",
				label: game.i18n.localize("PSYCHIC_POWER.STRENGTH_FETTERED"),
				callback: () => "fettered",
			},
			{
				action: "unfettered",
				label: game.i18n.localize("PSYCHIC_POWER.STRENGTH_UNFETTERED"),
				callback: () => "unfettered",
			},
			{
				action: "push1",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +1`,
				callback: () => "push:1",
			},
			{
				action: "push2",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +2`,
				callback: () => "push:2",
			},
			{
				action: "push3",
				label: `${game.i18n.localize("PSYCHIC_POWER.STRENGTH_PUSH")} +3`,
				callback: () => "push:3",
			},
		],
	})) as string | null;
}

/**
 * Roll on the Psychic Phenomena table (or Perils of the Warp on 75+,
 * Table 6-2 book p160). Modifiers: +5 per push level, +10 per sustained
 * power (book p157). The chart result is the RAW roll + modifier; the
 * phenomena tables tile 1-100 with explicit ranges.
 */
export async function rollPhenomena(
	actor: Actor,
	source: { pushLevels?: number; sustainedCount?: number },
): Promise<void> {
	const modifier = phenomenaRollModifier(source);
	const die = new foundry.dice.Roll("1d100");
	await die.evaluate();
	const raw = die.total ?? 0;
	const total = Math.min(100, raw + modifier);
	const tableName = phenomenaTableName(total);

	const pack = game.packs?.get("rogue-trader.psychicphenomena");
	if (!pack) {
		console.warn("rogue-trader | psychicphenomena pack missing");
		ui.notifications?.warn(game.i18n.localize("PSYCHIC_POWER.NO_TABLE"));
		return;
	}
	const tables = (await pack.getDocuments()) as unknown as Array<{
		name?: string;
		results?: Array<{ text?: string; range?: [number, number] }>;
	}>;
	const table = tables.find((t) => t.name === tableName);
	const result = table?.results?.find(
		(r) => total >= (r.range?.[0] ?? 0) && total <= (r.range?.[1] ?? 0),
	);
	const text = result?.text ?? game.i18n.localize("PSYCHIC_POWER.TABLE_MISS");
	const label = game.i18n.localize("PSYCHIC_POWER.PHENOMENA_ROLL");
	const content = `<div class="rogue-trader phenomena-roll"><h3>${label}: ${total}</h3><p>${text}</p></div>`;
	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
	});
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
	const roll = new foundry.dice.Roll(damage);
	await roll.evaluate();
	const label = game.i18n.format("PSYCHIC_POWER.DAMAGE_ROLL", {
		power: powerName,
	});
	const content = `<div class="rogue-trader power-damage"><h3>${label}</h3><p>${damage}: <strong>${roll.total}</strong></p></div>`;
	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content,
	});
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

// ---------------------------------------------------------------------------
// Evasion (weapon after-hook)
// ---------------------------------------------------------------------------

/**
 * Evasion dialog + reaction roll (bead 97a, owner-requested restore).
 * INFORMATIONAL ONLY: posts the defender's reaction test card; it does
 * not modify or cancel the damage flow (manual resolution for now).
 * Rules flags VERIFY: reaction-per-round accounting is not tracked;
 * untrained fallback is characteristic-only at -10.
 */
export async function resolveEvasion(
	defender: Actor,
	attack: { kind: "weapon"; itemId: string; actor: Actor } & RollBase,
): Promise<void> {
	const attackType = attack.actor.items.get(attack.itemId)?.type as string;
	const system = systemOf(defender);
	if (!system?.wounds) return;

	const isMelee = attackType === "melee-weapon";
	const skillName = isMelee ? "Parry" : "Dodge";
	const owned = defender.items.find(
		(i) =>
			(i.type as string) === "skill" &&
			(i as { name?: string }).name === skillName,
	);

	const evasionLabel = game.i18n.localize("DIALOG.EVASION");
	const skillLabel = owned
		? ((owned as { name?: string }).name ?? skillName)
		: `${skillName} (${game.i18n.localize("ROLL.UNTRAINED")})`;
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${defender.name} — ${evasionLabel}` },
		content: `<p>${evasionLabel}: ${skillLabel}</p>`,
		buttons: [
			{
				action: "nothing",
				label: game.i18n.localize("EVASION.DO_NOTHING"),
				callback: () => "nothing",
			},
			{
				action: "react",
				label: skillLabel,
				callback: () => "react",
			},
		],
	});
	if (choice !== "react") return;

	// Roll the chosen reaction (the card records the attempt; the result is
	// NOT fed into the damage calculation - manual resolution).
	await performRoll({
		kind: "skill",
		actor: defender,
		...(owned
			? { itemId: owned.id ?? "" }
			: {
					characteristicKey: skillName === "Parry" ? "ws" : "ag",
					label: skillName,
				}),
	});
}
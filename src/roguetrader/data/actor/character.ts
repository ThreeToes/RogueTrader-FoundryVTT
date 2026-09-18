/**
 * Unified actor data model shared by the pc/npc Actor subtypes.
 *
 * Structure-first: raw data capture only. Derived formulas (wounds
 * calculation, movement multipliers, carrying capacity) are intentionally
 * absent and belong to the rules layer later. The only derived values exposed
 * here are characteristic bonuses, which are definitional (bonus = value/10,
 * effective bonus = bonus x unnatural multiplier).
 */

import { effectsAreLive } from "../item/effects";
import { sourceField } from "../item/source";
import { careers, sorceryRanks } from "../../registry";
import { MAX_CRITICAL_SEVERITY } from "../../../rules-engine/src/index";

export const CHARACTERISTIC_KEYS = [
	"ws",
	"bs",
	"s",
	"t",
	"ag",
	"int",
	"per",
	"wp",
	"fel",
] as const;

export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

export class Character extends foundry.abstract.TypeDataModel<
	foundry.data.fields.DataSchema,
	foundry.documents.Actor
> {
	static LOCALIZATION_PREFIXES = ["CHARACTER"];

	declare characteristics: Record<string, { value: number; unnatural: number }>;
	declare wounds: { value: number; max: number };
	/**
	 * Critical Damage per body location, accumulated (bead ks3k). The core book
	 * tracks it per location and caps it at 10 (the critical tables print ten
	 * severities); 0 means the location has taken no critical damage.
	 */
	declare criticals: Record<string, number>;
	/**
	 * Critical effects this character is currently suffering — one entry per
	 * crit rolled, whether from a core Critical Hit table or the Tau battlesuit
	 * table (Tau Guide p31). Effects stay until cleared (e.g. by a battlesuit
	 * repair test), which is why they are stored rather than derived.
	 */
	declare criticalEffects: Array<{
		id: string;
		location: string;
		severity: number;
		table: string;
		roll: number;
		source: string;
		text: string;
	}>;
	/**
	 * Combat round in which a worn battlesuit already used its 1d10 Critical
	 * Damage override (Tau Guide p31: "the first time ... each Turn"). 0 = not
	 * used yet; compared against the current round at apply time.
	 */
	declare criticalOverrideRound: number;
	declare fatigue: number;
	declare fate: { value: number; max: number };
	declare insanity: number;
	declare corruption: number;
	/** Psyker marker (bead m4me): Navigators count (Core Rulebook p182) even at rating 0. */
	declare psyker: boolean;
	declare psyRating: number;
	/**
	 * Sorcery rank (epic 0hap, Edge of the Abyss pp85-86): "sorcerer" or
	 * "master-sorcerer" when the character holds a Sorcery Talent; blank
	 * otherwise. The Sorcerer talents derive this once extracted — the field
	 * stays hand-editable for GM/homebrew sorcerers.
	 */
	declare sorceryRank: string;
	/** Table 6-1 row: sanctioned psykers push +3, renegades/sorcerers push +4. */
	declare sanctioned: boolean;
	declare sustainedPowers: Array<{ itemUuid: string; name: string }>;
	declare threatLevel: string;
	/** NPC-only identity fields (bead lib6, k4z0 GAP 1): declared so the
	 * template.json npc block stops silently dropping them (d7js lesson).
	 * Optional with "" initial — PCs never need them and neither the PC
	 * sheet nor the creator binds them. */
	declare faction: string;
	declare subfaction: string;
	declare npcType: string;
	declare size: string;
	declare shortDescription: string;
	declare notes: string;
	declare origins: {
		homeWorld: string;
		birthright: string;
		lure: string;
		trials: string;
		motivation: string;
		claims?: Record<string, boolean>;
	};
	/** Stage 4 free-text (bead ay0, Core Rulebook p31-34). */
	declare life: { motivation: string };
	/**
	 * Extracted-entry provenance (bead cl5k): the book slug + PRINTED page an
	 * NPC statblock came from, the same shape items carry. Blank for hand-made
	 * PCs/actors; set on compendium NPCs so content audits and "where does this
	 * statblock come from" questions have a machine-readable origin instead of
	 * a free-text comment.
	 */
	declare source: { book: string; page: number };
	/** Linked dynasty actor (owner redesign: characters ATTACH to the group's dynasty, one per group by default). */
	declare dynastyUuid: string;
	declare careerKey: string;
	declare rank: number;
	declare xp: { spent: number; total: number };
	declare description: string;
	declare advances: Array<{
		type: "skill" | "talent" | "characteristic";
		key: string;
		name: string;
		characteristic?: string;
		cost: number;
		rank: number;
		tier?: string;
		source?: string;
		elite?: boolean;
	}>;

	static override defineSchema() {
		const characteristic = () =>
			new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					max: 100,
					integer: true,
					initial: 25,
					required: true,
				}),
				/** Unnatural characteristic multiplier (1 = natural). */
				unnatural: new foundry.data.fields.NumberField({
					min: 1,
					integer: true,
					initial: 1,
					required: true,
				}),
			});

		return {
			characteristics: new foundry.data.fields.SchemaField({
				ws: characteristic(),
				bs: characteristic(),
				s: characteristic(),
				t: characteristic(),
				ag: characteristic(),
				int: characteristic(),
				per: characteristic(),
				wp: characteristic(),
				fel: characteristic(),
			}),
			wounds: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				max: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			/** Critical Damage per location, capped at 10 (bead ks3k). */
			criticals: new foundry.data.fields.TypedObjectField(
				new foundry.data.fields.NumberField({
					min: 0,
					max: MAX_CRITICAL_SEVERITY,
					integer: true,
					initial: 0,
				}),
			),
			/** Suffered critical effects, kept until something removes them. */
			criticalEffects: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					id: new foundry.data.fields.StringField({ initial: "" }),
					location: new foundry.data.fields.StringField({ initial: "body" }),
					severity: new foundry.data.fields.NumberField({
						min: 1,
						max: MAX_CRITICAL_SEVERITY,
						integer: true,
						initial: 1,
					}),
					table: new foundry.data.fields.StringField({ initial: "" }),
					roll: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					/** "core" for a Critical Hit table, "battlesuit" for Table 1-5. */
					source: new foundry.data.fields.StringField({ initial: "core" }),
					text: new foundry.data.fields.StringField({ initial: "" }),
				}),
				{ initial: () => [] },
			),
			/** Round a battlesuit last used its 1d10 override; 0 = never. */
			criticalOverrideRound: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			fatigue: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),			fate: new foundry.data.fields.SchemaField({
				value: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				max: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			insanity: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			corruption: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/**
			 * Psyker status (bead m4me): Navigators are "considered a psyker
			 * for all game purposes" (Core Rulebook p182) without a standard Psy
			 * Rating; Astropaths carry rating 2 from their starting talents.
			 * Manually editable — homebrew/GM-granted psykers stay possible.
			 */
			psyker: new foundry.data.fields.BooleanField({ initial: false }),
			psyRating: new foundry.data.fields.NumberField({
				min: 0,
				integer: true,
				initial: 0,
			}),
			/**
			 * Sorcery rank (epic 0hap, Edge of the Abyss pp85-86): a character with
			 * the Sorcerer/Master Sorcerer talent casts sorcerous powers with a Psy
			 * Rating from their Intelligence Bonus. Blank = not a sorcerer. The
			 * Sorcery talents set this once extracted; manual/GM editing stays
			 * possible like the psyker flag.
			 */
			sorceryRank: new foundry.data.fields.StringField({
				choices: sorceryRanks.choices,
				initial: "",
				// Blank = not a sorcerer. Without this, `choices` flips the
				// StringField `blank` default to false and the empty initial
				// fails validation, bricking every character (same rule as
				// careerKey above).
				blank: true,
			}),
			/**
			 * Table 6-1 row (epic 0hap, Core Rulebook p157): sanctioned psykers
			 * may Push +3, renegade psykers and sorcerers +4. Default sanctioned;
			 * sorcerers are non-sanctioned by casting mode regardless.
			 */
			sanctioned: new foundry.data.fields.BooleanField({ initial: true }),
			/**
			 * Powers currently sustained (bead sa6, Core Rulebook p157): -1 effective
			 * Psy Rating per sustained power and +10 to all Phenomena rolls
			 * while any are up. {itemUuid, name} — uuid so the toggle survives
			 * renames; name so the UI renders without pack lookups.
			 */
			sustainedPowers: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					itemUuid: new foundry.data.fields.StringField({ initial: "" }),
					name: new foundry.data.fields.StringField({ initial: "" }),
				}),
				{ initial: () => [] },
			),
			/**
			 * Origin Path picks (bead ay0): written by the character creator,
			 * displayed on the consolidated Background tab. Keys into the
			 * origin chart in rules/origins data (rules/origins.ts).
			 */
			origins: new foundry.data.fields.SchemaField({
				homeWorld: new foundry.data.fields.StringField({ initial: "" }),
				birthright: new foundry.data.fields.StringField({ initial: "" }),
				lure: new foundry.data.fields.StringField({ initial: "" }),
				trials: new foundry.data.fields.StringField({ initial: "" }),
				motivation: new foundry.data.fields.StringField({ initial: "" }),
				/** Claimed pending grants (bead tgq9): traitDefKey -> true. */
				claims: new foundry.data.fields.TypedObjectField(
					new foundry.data.fields.BooleanField({ initial: false }),
					{ initial: () => ({}) },
				),
			}),
			/**
			 * Stage 4 "Giving Characters Life" (bead ay0, Core Rulebook p31-34):
			 * personal motivation as rich text on the Notes tab (owner cull:
			 * appearance removed — the description field covers it).
			 */
			life: new foundry.data.fields.SchemaField({
				motivation: new foundry.data.fields.HTMLField({ initial: "" }),
			}),
			/**
			 * Linked dynasty actor uuid (owner redesign): characters attach
			 * to the group's dynasty record; the PF/SP live there, not here.
			 */
			dynastyUuid: new foundry.data.fields.StringField({ initial: "" }),
			/**
			 * XP purchase ledger (bead g7k): every advance bought, the audit
			 * trail behind xp.spent (total = 4,500 creation baseline + ledger
			 * sum, see rules/advancement). GM refunds/undo remove entries.
			 * rank 0 marks creation-baseline/elite advances.
			 */
			advances: new foundry.data.fields.ArrayField(
				new foundry.data.fields.SchemaField({
					type: new foundry.data.fields.StringField({
						choices: { skill: "ADVANCE.TYPE_SKILL", talent: "ADVANCE.TYPE_TALENT", characteristic: "ADVANCE.TYPE_CHARACTERISTIC" },
						initial: "skill",
						required: true,
						nullable: false,
					}),
					key: new foundry.data.fields.StringField({ initial: "" }),
					name: new foundry.data.fields.StringField({ initial: "" }),
					characteristic: new foundry.data.fields.StringField({ initial: "" }),
					cost: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 0,
					}),
					rank: new foundry.data.fields.NumberField({
						min: 0,
						integer: true,
						initial: 1,
					}),
					tier: new foundry.data.fields.StringField({ initial: "" }),
					source: new foundry.data.fields.StringField({ initial: "" }),
					elite: new foundry.data.fields.BooleanField({ initial: false }),
				}),
				{ initial: () => [] },
			),
			/** NPC threat level (e.g. "Trivial", or a descriptive rating). */
			threatLevel: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * NPC-only identity fields (bead lib6, k4z0 GAP 1): the
			 * template.json npc block carried faction/subfaction/type/size but
			 * the schema never declared them, so they were silently dropped at
			 * init. Blank-initial so PCs and the creator never need them. npcType
			 * renames the template's dead "type" key (system.type read like the
			 * actor type); size is a string — the book labels statblocks with
			 * words, and the old numeric 4 was never schema-backed.
			 */
			faction: new foundry.data.fields.StringField({ initial: "" }),
			subfaction: new foundry.data.fields.StringField({ initial: "" }),
			npcType: new foundry.data.fields.StringField({ initial: "" }),
			size: new foundry.data.fields.StringField({ initial: "" }),
			/** NPC short description (GM sheet header, bead mqdy). */
			shortDescription: new foundry.data.fields.StringField({
				initial: "",
			}),
			/**
			 * Long-form notes (NPC sheet Notes tab; template.json npc block
			 * carries notes but the schema never declared it — bead d7js
			 * follow-up found the field was silently dropped on save).
			 */
			notes: new foundry.data.fields.HTMLField({ initial: "" }),
			/**
			 * Statblock provenance (bead cl5k): book slug + printed page, shared
			 * shape with item entries (data/item/source.ts). Blank-initial so the
			 * character creator and hand-made actors never need it.
			 */
			source: sourceField(),
			/**
			 * Career reference: registry key into CONFIG.ROGUE_TRADER.careers
			 * (bead 0ib). Homebrew careers registered at init are pickable too;
			 * the label resolves via the registry, not stored text.
			 */
			careerKey: new foundry.data.fields.StringField({
				choices: careers.choices,
				initial: "",
				// No career selected yet (new PC / pre-creator) is valid.
				blank: true,
			}),
			/**
			 * Current rank within the career (1-8 in core; splat books may add
			 * more). XP-derived rank suggestion is display-only until an
			 * advancement engine exists — multiple eligible ranks are a choice.
			 */
			rank: new foundry.data.fields.NumberField({
				min: 1,
				integer: true,
				initial: 1,
			}),
			/** Experience points: spent and total, header display as spent/total. */
			xp: new foundry.data.fields.SchemaField({
				spent: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
				total: new foundry.data.fields.NumberField({
					min: 0,
					integer: true,
					initial: 0,
				}),
			}),
			description: new foundry.data.fields.HTMLField(),
		};
	}

	/**
	 * Effective characteristic value: the stored (base) value plus every live
	 * `characteristic-modifier` owned-item delta (bead xu83). Afflictions are
	 * permanent, so the effective value is what the sheet shows and what
	 * derived values (bonuses, movement, initiative, soak, carry capacity)
	 * read. TESTS still start from the base value and add the same deltas via
	 * the modifier funnel, so the breakdown stays visible and nothing is
	 * double-counted.
	 */
	effectiveCharacteristicValue(key: string): number {
		const base = this.characteristics[key]?.value ?? 0;
		const items = (
			this.parent as unknown as {
				items?: Iterable<{
					type?: string;
					system?: {
						equipState?: string;
						effects?: Array<{ kind?: string; testKey?: string; value?: number }>;
					};
				}>;
			} | null
		)?.items;
		if (!items) return base;
		let delta = 0;
		for (const item of items) {
			if (!effectsAreLive(item.type ?? "", item.system?.equipState)) continue;
			for (const effect of item.system?.effects ?? []) {
				if (effect.kind !== "characteristic-modifier") continue;
				if (effect.testKey !== key) continue;
				const value = Number(effect.value ?? 0);
				if (Number.isFinite(value)) delta += value;
			}
		}
		return base + delta;
	}

	/**
	 * Characteristic bonus from the EFFECTIVE value: floor(effective / 10),
	 * ignoring the unnatural multiplier.
	 */
	characteristicBonus(key: string): number {
		return Math.floor(this.effectiveCharacteristicValue(key) / 10);
	}

	/** Effective characteristic bonus, including the unnatural multiplier. */
	effectiveCharacteristicBonus(key: string): number {
		return (
			this.characteristicBonus(key) *
			(this.characteristics[key]?.unnatural ?? 1)
		);
	}

	/**
	 * Agility Bonus shorthand used by movement + initiative (from the effective
	 * Agility value, so a mutation's Agility change flows into movement).
	 */
	agilityBonus(): number {
		return this.characteristicBonus("ag");
	}

	/**
	 * Derived movement in AB-units: half = max(1, AB-1), full = AB,
	 * charge = AB×2, run = AB×3. (Multiplier rules best-remembered RT core,
	 * VERIFY against the book - display unit decided by the UI layer.)
	 */
	movement(): { half: number; full: number; charge: number; run: number } {
		const ab = this.agilityBonus();
		return {
			half: Math.max(1, ab - 1),
			full: ab,
			charge: ab * 2,
			run: ab * 3,
		};
	}

	/** Derived initiative bonus: the Agility Bonus (talent modifiers join via the funnel). */
	initiativeBonus(): number {
		return this.agilityBonus();
	}
}

import { Gear } from "./gear";

/**
 * Origin trait definitions (bead h64a/tgq9): data-driven rules attached to
 * Origin Path picks, resolved at runtime from `Character.system.origins`.
 * Kind "modifier" feeds the funnel (testKey/value); "grant" renders as a
 * pending-grant chip on the Background tab; "note" is narrative/no-context
 * (never silently dropped — the text is the contract). Splat books and
 * homebrew register additional entries via the origintraits compendium or
 * the registry fallback.
 */
export class OriginTrait extends Gear {
	static LOCALIZATION_PREFIXES = ["ORIGIN_TRAIT"];

	declare originKey: string;
	declare traitKey: string;
	declare kind: string;
	declare testKey: string;
	declare value: number;
	declare grantKind: string;

	static override defineSchema() {
		return {
			...super.defineSchema(),
			/** Owning origin chart entry key (e.g. "death-world"). */
			originKey: new foundry.data.fields.StringField({ initial: "" }),
			/** Trait slug within the origin (e.g. "paranoid"). */
			traitKey: new foundry.data.fields.StringField({ initial: "" }),
			/** modifier | grant | note. */
			kind: new foundry.data.fields.StringField({
				choices: { modifier: "ORIGIN_TRAIT.KIND_MODIFIER", grant: "ORIGIN_TRAIT.KIND_GRANT", note: "ORIGIN_TRAIT.KIND_NOTE" },
				initial: "note",
				required: true,
				nullable: false,
			}),
			/** Test key the modifier applies to ("" = all tests; "fel" = Fel-keyed). */
			testKey: new foundry.data.fields.StringField({ initial: "" }),
			/** Signed modifier value (kind "modifier"). */
			value: new foundry.data.fields.NumberField({
				min: -100,
				integer: true,
				initial: 0,
			}),
			/** Grant kind (kind "grant"): free-skill | extra-common-lore | bionic | heirloom. */
			grantKind: new foundry.data.fields.StringField({ initial: "" }),
		};
	}
}
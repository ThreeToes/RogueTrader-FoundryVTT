import { getPorts } from "../../infrastructure/foundry/ports";
import { sheetContext } from "../context";
import { getCharacterOptionDocs, resolvePackDocument } from "../pack-resolve";
import { OwnedItemPicker } from "./owned-picker";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";
import { clonePackDocPayload } from "./creator-apply";

/**
 * Psychic power compendium picker (bead m4me): lists the character-options
 * pack documents and grants them as owned psychicpower items. The pack does
 * not exist yet (extraction bead 5u5) — the picker degrades to a hint until
 * it lands. Mirrors SkillPicker/TalentPicker.
 */
export class PsychicPicker extends OwnedItemPicker {
	static DEFAULT_OPTIONS = OwnedItemPicker.pickerOptions({
		id: "rogue-trader-psychic-picker",
		slug: "psychic-picker",
		titleKey: "PSYCHIC_POWER.PICKER_TITLE",
		width: 420,
		height: 500,
		actions: {
			addPower: PsychicPicker.#addPower,
		},
	});

	static PARTS = {
		form: {
			template: `${TEMPLATE_ROOT}sheet/actor/parts/psychic-picker.hbs`,
		},
	};

	async _prepareContext(_options: object = {}) {
		const context = sheetContext(
			await super._prepareContext(_options as never),
		);
		const documents = (await getCharacterOptionDocs(
			"psychicpower",
		)) as unknown as Array<{
			uuid?: string;
			name?: string;
			system: { powerClass?: string; subtype?: string; restricted?: boolean };
		}>;
		const powers: Array<{
			uuid: string;
			name: string;
			powerClass: string;
			subtype: string;
			subtypeLabel: string;
			owned: boolean;
			/** Epic 0hap: Psykana Malifica powers are elite-advance/GM use. */
			restricted: boolean;
		}> = [];
		if (documents.length > 0) {
			const owned = this.ownedItemNames("psychicpower");
			for (const doc of documents) {
				if (!doc.name) continue;
				const subtype = doc.system.subtype ?? "focus";
				powers.push({
					uuid: doc.uuid ?? "",
					name: doc.name,
					powerClass: doc.system.powerClass ?? "bound",
					subtype,
					subtypeLabel: `PSYCHIC_POWER.${subtype.toUpperCase()}`,
					owned: owned.has(doc.name),
					restricted: doc.system.restricted === true,
				});
			}
			powers.sort((a, b) => a.name.localeCompare(b.name));
		}
		context.powers = powers;
		// The pack-existence hint degrades to "pack has documents": an installed
		// but empty pack renders the same hint as a missing one.
		context.hasPack = documents.length > 0;
		return context;
	}

	static async #addPower(
		this: InstanceType<typeof PsychicPicker>,
		_event: unknown,
		target: HTMLElement,
	): Promise<void> {
		const uuid = target.dataset.uuid;
		if (!uuid || !this.actor) return;
		// Bead qynu: this used to call foundry.utils.fromUuid directly, which
		// silently resolved to null in-world for this system's LevelDB packs
		// (bead wwuc's root cause) — the click did NOTHING with no diagnostics.
		// Resolve through the shared pack resolver instead and fail loudly.
		let doc: { toObject?: () => object } | null = null;
		try {
			doc = (await resolvePackDocument(uuid)) as {
				toObject?: () => object;
			} | null;
		} catch (error) {
			console.error(
				`rogue-trader | psychic picker: resolving "${uuid}" failed:`,
				error,
			);
		}
		if (!doc?.toObject) {
			console.warn(
				`rogue-trader | psychic picker: "${uuid}" did not resolve; grant skipped`,
			);
			getPorts().notify.error("PSYCHIC_POWER.ADD_FAIL", { uuid });
			return;
		}
		// The clone must not carry the pack doc's _id (two Items cannot share
		// an _id; shared strip via clonePackDocPayload, bead xynx).
		await this.actor.createEmbeddedDocuments("Item", [
			clonePackDocPayload(doc.toObject()),
		] as never);
		this.render({ force: true } as never);
	}
}

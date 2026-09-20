/**
 * Roll prompts (epic kof0, phase 4/6): the DialogV2 prompts the roll pipeline
 * raises. Extracted from the composition-root-adjacent roll-system module so
 * the pipeline stays orchestration and the dialogs live in presentation.
 *
 * These are Foundry-facing by design (DialogV2), but localisation goes
 * through the I18n port like the rest of the roll pipeline (bead lfjw), so
 * there is one answer to "how does presentation speak to the user".
 */

import { getPorts } from "../infrastructure/foundry/ports";

/**
 * Strength prompt (Table 6-1, book p157): Fettered / Unfettered / Push
 * +1..+cap. Push levels are separate buttons; each callback encodes the level
 * in the returned value ("push:2").
 */
export async function promptStrength(
	pushCapLimit = 3,
): Promise<string | null> {
	const ports = getPorts();
	const cap = Math.max(1, Math.floor(pushCapLimit));
	const pushButtons = Array.from({ length: cap }, (_, index) => {
		const level = index + 1;
		return {
			action: `push${level}`,
			label: `${ports.i18n.t("PSYCHIC_POWER.STRENGTH_PUSH")} +${level}`,
			callback: () => `push:${level}`,
		};
	});
	return (await foundry.applications.api.DialogV2.wait({
		window: {
			title: ports.i18n.t("PSYCHIC_POWER.STRENGTH_TITLE"),
		},
		content: `<p>${ports.i18n.t("PSYCHIC_POWER.STRENGTH_PROMPT")}</p>`,
		buttons: [
			{
				action: "fettered",
				label: ports.i18n.t("PSYCHIC_POWER.STRENGTH_FETTERED"),
				callback: () => "fettered",
			},
			{
				action: "unfettered",
				label: ports.i18n.t("PSYCHIC_POWER.STRENGTH_UNFETTERED"),
				callback: () => "unfettered",
			},
			...pushButtons,
		],
	})) as string | null;
}

/**
 * Void-shield absorption prompt (book p220-221): the attacker chooses how
 * many hits the target's shields absorb (up to the remaining strength).
 * Cancel = the kernel default (shield strength, p220).
 */
export async function promptShieldAbsorption(
	hits: number,
	shields: number,
	target: { name?: string },
): Promise<number | null> {
	const ports = getPorts();
	const cap = Math.min(hits, shields);
	const choice = (await foundry.applications.api.DialogV2.wait({
		window: {
			title: ports.i18n.t("SHIP_COMBAT.VOID_SHIELD_TITLE"),
		},
		content: `<p>${ports.i18n.t("SHIP_COMBAT.VOID_SHIELD_PROMPT", {
			hits,
			shields,
			target: target.name ?? "",
		})}</p>`,
		buttons: [
			{
				action: "all",
				label: ports.i18n.t("SHIP_COMBAT.VOID_SHIELD_ALL", { count: cap }),
				callback: () => String(cap),
			},
			{
				action: "none",
				label: ports.i18n.t("SHIP_COMBAT.VOID_SHIELD_NONE"),
				callback: () => "0",
			},
		],
	})) as string | null;
	if (choice === null) return null;
	const value = Number(choice);
	return Number.isFinite(value) ? Math.max(0, Math.min(cap, value)) : null;
}

/**
 * Critical component selection among the target's installed components
 * (book p221-222; "known" components — v1 lists all installed).
 */
export async function promptTargetComponent(
	target: unknown,
): Promise<unknown | null> {
	const ports = getPorts();
	const items = (
		(target as { items?: { filter: (fn: unknown) => unknown[] } }).items?.filter(
			(i: { type?: string }) => {
				return i.type === "ship-component" || i.type === "ship-weapon-component";
			},
		) ?? []
	) as Array<{ id?: string; name?: string; system?: { state?: string } }>;
	const fixable = items.filter(
		(i) => (i.system?.state ?? "intact") !== "destroyed",
	);
	if (fixable.length === 0) return null;
	const content = `<p>${ports.i18n.t("SHIP_COMBAT.CRITICAL_SELECT")}</p>${fixable
		.map(
			(i) =>
				`<div class="form-group"><label><input type="radio" name="component" value="${i.id}" > ${i.name}</label></div>`,
		)
		.join("")}<div class="form-group"><input type="radio" name="component" value="" checked> — ${ports.i18n.t(
			"SHIP_COMBAT.CRITICAL_SKIP",
		)} —</div>`;
	const result = (await foundry.applications.api.DialogV2.input({
		window: {
			title: ports.i18n.t("SHIP_COMBAT.CRITICAL_TITLE"),
		},
		content,
		ok: { label: ports.i18n.t("SHIP_COMBAT.CRITICAL_APPLY") },
	})) as { component?: string } | null;
	const id = result?.component?.trim();
	if (!id) return null;
	return (
		target as { items?: { get: (id: string) => unknown } }
	).items?.get(id) ?? null;
}

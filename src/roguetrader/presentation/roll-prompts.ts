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
 * Escape document data (user/pack-authored names) before it is interpolated
 * into hand-built dialog HTML (bead 3z02): `Handlebars.escapeExpression` is
 * the Foundry stdlib for this. Everything else in the roll surface escapes
 * through Handlebars templates; these DialogV2 prompts are hand-built.
 *
 * Exported (bead oeal) so the other hand-interpolated chat HTML — the
 * evasion ownership-gate note — shares the same escape.
 */
export function escapeDocumentData(value: unknown): string {
	// The Foundry runtime always provides the global Handlebars; test fakes may
	// not, so fall back to the identical entity substitution instead of
	// throwing a ReferenceError mid-prompt.
	if (typeof globalThis.Handlebars?.escapeExpression === "function") {
		return globalThis.Handlebars.escapeExpression(String(value ?? ""));
	}
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;")
		.replace(/`/g, "&#x60;")
		.replace(/=/g, "&#x3D;");
}

/**
 * Strength prompt (Table 6-1, book p157): Fettered / Unfettered / Push
 * +1..+cap. Push levels are separate buttons; each callback encodes the level
 * in the returned value ("push:2").
 */
export async function promptStrength(pushCapLimit = 3): Promise<string | null> {
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
			target: target.name ? escapeDocumentData(target.name) : "",
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
 * (book p221-222; the attacker picks among components he "knows of").
 *
 * DECISION 11 (bead z697, Core Rulebook printed p217): `revealGated` prompts
 * read the TARGET's `system.revealedComponents` set (filled by Focused
 * Augury; bead vph0's schema field) and REFUSE un-revealed picks — the
 * all-known stand-in is gone for the enemy-critical path. With nothing
 * revealed yet the prompt offers nothing and warns loudly (the critical
 * still lands; only the component pick is gated). Own-ship prompts (the
 * Flank Speed hard-fail) and the ABOARD-THE-TARGET Hit and Run pick
 * (bead z697) pass no gate — the crew knows its own hull, and raiders
 * picking a component know it at first hand.
 */
export async function promptTargetComponent(
	target: unknown,
	opts?: {
		revealGated?: boolean;
		/** Chart results that name a component FAMILY (Core Rulebook p222,
		 * e.g. 6 — Engines Crippled → plasma drives): only those installed
		 * components are offered. Unset = every fixable component. */
		componentTypes?: readonly string[];
	},
): Promise<unknown | null> {
	const ports = getPorts();
	let items = ((
		target as { items?: { filter: (fn: unknown) => unknown[] } }
	).items?.filter((i: { type?: string }) => {
		return i.type === "ship-component" || i.type === "ship-weapon-component";
	}) ?? []) as Array<{
		id?: string;
		name?: string;
		system?: { state?: string; componentType?: string };
	}>;
	if (opts?.componentTypes) {
		const wanted = new Set(opts.componentTypes);
		items = items.filter((i) => wanted.has(i.system?.componentType ?? ""));
	}
	if (opts?.revealGated) {
		const revealed = new Set(
			(
				((target as { system?: { revealedComponents?: string[] } }).system
					?.revealedComponents ?? []) as unknown[]
			).map(String),
		);
		items = items.filter((i) => i.id !== undefined && revealed.has(i.id));
		if (items.length === 0) {
			ports.notify.warn("SHIP_COMBAT.COMPONENTS_NOT_REVEALED", {
				target: (target as { name?: string }).name ?? "?",
			});
			return null;
		}
	}
	const fixable = items.filter(
		(i) => (i.system?.state ?? "intact") !== "destroyed",
	);
	if (fixable.length === 0) return null;
	const content = `<p>${ports.i18n.t("SHIP_COMBAT.CRITICAL_SELECT")}</p>${fixable
		.map(
			(i) =>
				`<div class="form-group"><label><input type="radio" name="component" value="${escapeDocumentData(
					i.id,
				)}" > ${escapeDocumentData(i.name)}</label></div>`,
		)
		.join(
			"",
		)}<div class="form-group"><input type="radio" name="component" value="" checked> — ${ports.i18n.t(
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
		(target as { items?: { get: (id: string) => unknown } }).items?.get(id) ??
		null
	);
}

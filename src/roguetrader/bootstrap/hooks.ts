/**
 * Runtime hooks (epic kof0, phase 5): the actor lifecycle hooks, the chat-card
 * button delegation and the creator context menus.
 *
 * Split out of the sheet/init.ts composition root.
 */

import { applyDamageFromCard, rollDamageButton } from "../presentation/chat-actions";
import { registerCreatorMenus } from "../presentation/creator-menus";
import { missingSkillGrants } from "../rules/default-skills";
import { vehicleTokenFootprint } from "../rules/vehicle-tokens";
import { trackDefaultGrants } from "../sheet/default-grants";
import { getCommonSkillCatalog } from "./warmers";

/**
 * Apply-damage button on attack damage cards (bead ncc): an adapter-layer
 * action that consumes the displayed outcome - the flag carries the computed
 * wounds; nothing is recomputed here. Delegated listener (registered once) so
 * it works regardless of which chat render hook fires.
 */
function registerChatActions(): void {
	Hooks.once("ready", () => {
		document.body.addEventListener("click", (event) => {
			const target = event.target as HTMLElement | null;
			const applyButton = target?.closest<HTMLButtonElement>(
				"button.apply-damage",
			);
			if (applyButton) {
				if (!applyButton.disabled) {
					applyDamageFromCard(applyButton).catch((error) =>
						console.error("rogue-trader: apply-damage failed", error),
					);
				}
				return;
			}
			// Manual damage roll from the to-hit card (owner redesign).
			const damageButton = target?.closest<HTMLButtonElement>(
				"button.rt-roll-damage",
			);
			if (!damageButton || damageButton.disabled) return;
			rollDamageButton(damageButton).catch((error) =>
				console.error("rogue-trader: damage roll failed", error),
			);
		});
	});
}

/**
 * Vehicle token footprints (bead yyd1): keep prototypeToken.width/height in
 * step with the size category (rules/vehicle-tokens). The packer bakes the
 * same mapping into compendium actors; these hooks cover blank/manually-created
 * vehicles and later edits to the Size field.
 */
function registerVehicleTokenHooks(): void {
	Hooks.on("preCreateActor", (actor) => {
		if (actor.type !== "vehicle") return;
		const { width, height } = vehicleTokenFootprint(
			(actor.system as { size?: string } | undefined)?.size,
		);
		actor.updateSource({ prototypeToken: { width, height } });
	});
	Hooks.on("preUpdateActor", (actor, changed) => {
		if (actor.type !== "vehicle") return;
		const nextSize = (changed.system as { size?: string } | undefined)?.size;
		if (nextSize === undefined) return;
		const { width, height } = vehicleTokenFootprint(nextSize);
		const token = actor.prototypeToken as { width?: number; height?: number };
		if (token.width === width && token.height === height) return;
		foundry.utils.mergeObject(
			changed,
			{ prototypeToken: { width, height } },
			{ inplace: true },
		);
	});
}

/** Grant the common skills a brand-new character/npc actor is missing. */
function registerSkillGrantHook(): void {
	Hooks.on("createActor", async (actor, _options, userId) => {
		// Only the creating user embeds the grants (avoids double-fire).
		if (userId !== (game as { userId?: string }).userId) return;
		if (actor.type !== "explorer" && actor.type !== "npc") return;
		// Only brand-new blank actors: NPC statblocks and compendium imports
		// come with items and must not receive defaults.
		if (actor.items.size > 0) return;
		const catalog = getCommonSkillCatalog();
		if (catalog.length === 0) return;
		// Race-safe vs the sheet backfill: skip skills the actor already has
		// (TOCTOU on items.size when both paths run near-simultaneously).
		const grants = missingSkillGrants(
			catalog,
			actor.items.map((i) => i.name ?? ""),
		);
		if (grants.length === 0) return;
		const grantPromise = actor.createEmbeddedDocuments("Item", grants);
		// Creator flow waits for the defaults before its own merge (bead
		// t093: Actor.create resolves before async hook handlers finish).
		trackDefaultGrants(actor.uuid ?? "", grantPromise);
		await grantPromise;
	});
}

/** Actor lifecycle hooks, chat actions and the creator context menus. */
export function registerRuntimeHooks(): void {
	registerChatActions();
	registerVehicleTokenHooks();
	registerSkillGrantHook();
	// Character/ship/planet/warrant creators (epic kof0, phase 5): the
	// directory context-menu entries live in presentation/creator-menus.ts.
	registerCreatorMenus();
}

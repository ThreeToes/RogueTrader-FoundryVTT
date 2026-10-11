/**
 * "Snap out of it" handler (bead n0tp, Core Rulebook p296) — extracted from
 * rollSnapOut's hand-rolled TestDialog+runTest sequence in perform.ts, which
 * skipped the ownership gate in performRoll.
 *
 * A Willpower Test at the beginning of the character's Turn; success ends the
 * snap-out-capable condition. Failure keeps it (the player may test again
 * next Turn) and posts the fear-family card. The context flag "snapOut" lets
 * authored guarded effects apply to snap-out tests only.
 */

import { systemOf } from "../../data/accessors";
import { getPorts } from "../../infrastructure/foundry/ports";
import { postCard } from "../../rules/chat-flags";
import { carriedConditions, snapOutReady } from "../../rules/conditions";
import type { RollHandler } from "../../rules/roll-contract";
import { TEMPLATE_ROOT } from "../../../ffg/domain/template-root";

/** "Snap out of it" (bead n0tp, Core Rulebook p296). */
export const snapOutHandler: RollHandler<"snap-out"> = {
	async prepare(request) {
		const ports = getPorts();
		const actor = request.actor;
		if (!snapOutReady(actor)) {
			ports.notify.warn("FEAR.SNAP_OUT_NONE");
			return null;
		}
		const characteristic = systemOf(actor).characteristics.wp;
		if (!characteristic) {
			ports.notify.warn("ROLL.UNKNOWN_CHARACTERISTIC", { key: "wp" });
			return null;
		}
		return {
			title: `${actor.name} — ${ports.i18n.t("FEAR.SNAP_OUT")}`,
			baseTarget: characteristic.value,
			testKind: "characteristic",
			testKey: "wp",
			initialModifiers: [...(request.modifiers ?? [])],
			weapon: null,
			context: { flags: { snapOut: true } },
		};
	},
	async after(request, prepared, outcome) {
		const ports = getPorts();
		if (!outcome.success) {
			await postCard(request.actor, `${TEMPLATE_ROOT}chat/fear-shock.hbs`, {
				title: prepared.title,
				shockText: ports.i18n.t("FEAR.SNAP_OUT_FAIL"),
			});
			return;
		}
		const carried = carriedConditions(request.actor).filter((c) => c.snapOut);
		const ids = carried.map((c) => c.id).filter((id) => id !== "");
		if (ids.length > 0) {
			await ports.actors.deleteEffects(request.actor, ids);
		}
		await postCard(request.actor, `${TEMPLATE_ROOT}chat/fear-shock.hbs`, {
			title: prepared.title,
			shockText: ports.i18n.t("FEAR.SNAP_OUT_SUCCESS"),
		});
	},
};

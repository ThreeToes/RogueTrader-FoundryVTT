/**
 * Build an ActorView from loose structural input (epic kof0, phase 1/2).
 *
 * This is the ONE mapping from document-ish shape to the read model. The
 * Foundry builder (`infrastructure/foundry/actor-view.ts`) is a thin wrapper
 * around it, and tests build fixtures with it directly — so there is a single
 * definition of how an item/effect becomes a view.
 */

import { attackProfileOf } from "./attack";
import type {
	ActorSystemView,
	ActorView,
	CharacteristicView,
	EffectView,
	ItemView,
} from "./actor";
import type { EffectData } from "./effect";
import { equipStateOf } from "./taxonomy";

export interface LooseItem {
	id?: string;
	name?: string;
	type?: string;
	system?: unknown;
}

export interface LooseEffect {
	id?: string;
	name?: string;
	statuses?: unknown;
	changes?: unknown;
	flags?: { "rogue-trader"?: { snapOut?: boolean } };
	snapOut?: boolean;
}

export interface LooseActor {
	id?: string;
	uuid?: string;
	name?: string;
	type?: string;
	system?: unknown;
	items?: unknown;
	effects?: unknown;
	appliedEffects?: unknown;
}

/** Turn any array/collection/undefined into a plain array. */
function toArray<T>(collection: unknown): T[] {
	if (!collection || typeof collection === "string") return [];
	if (Array.isArray(collection)) return collection as T[];
	if (typeof (collection as Iterable<T>)[Symbol.iterator] === "function") {
		return Array.from(collection as Iterable<T>);
	}
	return [];
}

export function itemView(item: LooseItem): ItemView {
	const system = (item.system ?? {}) as Record<string, unknown>;
	const type = String(item.type ?? "");
	const raw = { id: item.id ?? "", name: item.name ?? "", type, system };
	return {
		id: item.id ?? "",
		name: item.name ?? "",
		type,
		equipState: equipStateOf(raw),
		effects: toArray<EffectData>(system.effects),
		special: toArray<string>(system.special),
		attack: attackProfileOf(raw),
		system,
	};
}

export function effectView(effect: LooseEffect): EffectView {
	return {
		id: effect.id ?? "",
		name: effect.name ?? "",
		statuses: toArray<string>(effect.statuses),
		changes: toArray<{ key?: unknown; value?: unknown }>(effect.changes).map(
			(change) => ({ key: String(change.key ?? ""), value: change.value }),
		),
		snapOut:
			effect.snapOut === true ||
			effect.flags?.["rogue-trader"]?.snapOut === true,
	};
}

/** Snapshot loose document-shaped input into the typed read model. */
export function buildActorView(input: LooseActor): ActorView {
	const system = (input.system ?? {}) as ActorSystemView;
	return {
		id: input.id ?? "",
		uuid: input.uuid ?? "",
		name: input.name ?? "",
		type: String(input.type ?? ""),
		system,
		characteristics: (system.characteristics ??
			{}) as Readonly<Record<string, CharacteristicView>>,
		items: toArray<LooseItem>(input.items).map(itemView),
		effects: toArray<LooseEffect>(input.effects).map(effectView),
		appliedEffects: toArray<LooseEffect>(
			input.appliedEffects ?? input.effects,
		).map(effectView),
	};
}

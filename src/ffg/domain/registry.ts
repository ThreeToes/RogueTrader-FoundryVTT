/**
 * The one registry primitive (epic kof0, phase 5).
 *
 * The codebase had four hand-rolled registry idioms: `EntryRegistry`
 * (key -> i18n label), `testContributors` (key -> fn[]), `talentEffectHandlers`
 * (key -> fn[]) and the ad-hoc affliction-procedure map. They all differ only
 * in trivial ways, so they share these two bases now.
 *
 * - `Registry<V>`: one value per key (content classifiers, effect specs).
 * - `HandlerRegistry<K, V>`: many handlers per key (contributors, effect-kind
 *   handlers) with `on` / `for` / `all` / `keys`.
 *
 * Both are Foundry-free (the boundary test enforces it).
 */

/** One value per key. */
export class Registry<V> {
	readonly #entries: Map<string, V>;

	constructor(initial: Record<string, V> = {}) {
		this.#entries = new Map(Object.entries(initial));
	}

	/** Register (or replace) an entry. Chainable. */
	register(key: string, value: V): this {
		this.#entries.set(key, value);
		return this;
	}

	has(key: string): boolean {
		return this.#entries.has(key);
	}

	get(key: string): V | undefined {
		return this.#entries.get(key);
	}

	keys(): string[] {
		return [...this.#entries.keys()];
	}

	values(): V[] {
		return [...this.#entries.values()];
	}

	entries(): Array<[string, V]> {
		return [...this.#entries.entries()];
	}

	get size(): number {
		return this.#entries.size;
	}
}

/**
 * Many handlers per key, run in registration order. `on` de-duplicates by
 * reference (bead 00z5): the SAME handler appended twice is a no-op, so an
 * idempotent registrar can never double-contribute through a repeat call,
 * and `off`/`clear` give tests a teardown affordance — a registration made
 * in one suite cannot leak into the next suite in the same process.
 */
export class HandlerRegistry<K extends string, V> {
	readonly #handlers = new Map<K, V[]>();

	/** Add a handler under a key; a reference-identical repeat is a no-op. Chainable. */
	on(key: K, handler: V): this {
		const list = this.#handlers.get(key) ?? [];
		if (!list.includes(handler)) {
			list.push(handler);
			this.#handlers.set(key, list);
		}
		return this;
	}

	/** Remove one handler from a key. True when it was registered there. */
	off(key: K, handler: V): boolean {
		const list = this.#handlers.get(key);
		if (!list) return false;
		const index = list.indexOf(handler);
		if (index === -1) return false;
		if (list.length === 1) this.#handlers.delete(key);
		else list.splice(index, 1);
		return true;
	}

	/** Drop every handler under one key, or across all keys when omitted. */
	clear(key?: K): void {
		if (key === undefined) this.#handlers.clear();
		else this.#handlers.delete(key);
	}

	/** Handlers registered under one key. */
	for(key: K): readonly V[] {
		return this.#handlers.get(key) ?? [];
	}

	/** Every handler, in key-registration then registration order. */
	all(): V[] {
		return [...this.#handlers.values()].flat();
	}

	keys(): K[] {
		return [...this.#handlers.keys()];
	}
}

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

/** Many handlers per key, run in registration order. */
export class HandlerRegistry<K extends string, V> {
	readonly #handlers = new Map<K, V[]>();

	/** Add a handler under a key. Chainable. */
	on(key: K, handler: V): this {
		const list = this.#handlers.get(key) ?? [];
		list.push(handler);
		this.#handlers.set(key, list);
		return this;
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

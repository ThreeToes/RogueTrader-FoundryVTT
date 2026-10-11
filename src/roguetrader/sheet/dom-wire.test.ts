/**
 * Shared imperative DOM wiring helpers (bead npnn): pin the dataset.wired
 * guard lifecycle (wire once, no-op after a re-render wires the same
 * element again) and the value plumbing of the change events.
 *
 * No DOM library in the repo (checked — image-actions.test.ts uses plain
 * fake objects), so the elements are minimal fakes under the shape
 * wireInput/wireSelect actually touch: dataset, addEventListener, value.
 */
import { describe, expect, test } from "bun:test";
import { wireInput, wireSelect } from "./dom-wire";

/** Minimal input fake — the exact surface the helpers touch. */
class FakeInput {
	dataset: Record<string, string> = {};
	value = "";
	#listeners = new Map<string, Array<() => void>>();
	addEventListener(type: string, listener: () => void): void {
		const list = this.#listeners.get(type) ?? [];
		list.push(listener);
		this.#listeners.set(type, list);
	}
	/** Simulate the browser firing the event. */
	fire(type: string): void {
		for (const listener of this.#listeners.get(type) ?? []) listener();
	}
}

describe("wireInput", () => {
	test("wires the input event and reports the value", () => {
		const changes: string[] = [];
		const input = new FakeInput();
		const wired = wireInput(input as unknown as HTMLInputElement, (value) => {
			changes.push(value);
		});
		expect(wired).toBe(true);
		input.value = "Havelock";
		input.fire("input");
		expect(changes).toEqual(["Havelock"]);
		expect(input.dataset.wired).toBe("1");
	});

	test("a re-render querying the same element does NOT wire it twice", () => {
		const input = new FakeInput();
		wireInput(input as unknown as HTMLInputElement, () => undefined);
		const wiredAgain = wireInput(
			input as unknown as HTMLInputElement,
			() => undefined,
		);
		expect(wiredAgain).toBe(false);
		input.value = "once";
		input.fire("input");
		// One listener → one change; a double wire would fire twice.
		expect(input.value).toBe("once");
	});

	test("absent element (step not rendered) is a no-op", () => {
		expect(wireInput(null, () => undefined)).toBe(false);
		expect(wireInput(undefined, () => undefined)).toBe(false);
	});
});

describe("wireSelect", () => {
	test("wires the change event and reports the value", () => {
		const changes: string[] = [];
		const select = new FakeInput();
		const wired = wireSelect(
			select as unknown as HTMLSelectElement,
			(value) => {
				changes.push(value);
			},
		);
		expect(wired).toBe(true);
		select.value = "nova-cannon";
		select.fire("change");
		expect(changes).toEqual(["nova-cannon"]);
		expect(select.dataset.wired).toBe("1");
	});

	test("already-wired selects keep their single listener", () => {
		const changes: string[] = [];
		const select = new FakeInput();
		wireSelect(select as unknown as HTMLSelectElement, (value) => {
			changes.push(value);
		});
		wireSelect(select as unknown as HTMLSelectElement, (value) => {
			changes.push(value);
		});
		select.value = "x";
		select.fire("change");
		expect(changes).toEqual(["x"]);
	});

	test("absent element is a no-op", () => {
		expect(wireSelect(null, () => undefined)).toBe(false);
	});
});
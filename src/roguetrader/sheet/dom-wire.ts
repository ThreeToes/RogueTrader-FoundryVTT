/**
 * Shared imperative DOM wiring helpers (bead npnn).
 *
 * The creator wizards and dialogs wire free-text inputs and selects
 * imperatively per AGENT-GUIDE §3 — only change/input events reach
 * data-action — and each had hand-rolled the same guard: query the element,
 * check `dataset.wired`, add the listener, set the flag so a re-render never
 * wires the same element twice. This is that pattern once.
 *
 * Pure wiring only: the callbacks decide what a change means (update state,
 * re-render, refocus). The `dataset.wired` guard is the convention — element
 * identity survives a re-render, listener identity does not.
 */

/**
 * Wire an input's `input` event. No-op when the element is absent (the
 * step it belongs to is not rendered) or already wired.
 *
 * @param element The input to wire (unchecked query results fine).
 * @param onChange Called with the new value on every input event.
 * @returns True when the listener was attached this call.
 */
export function wireInput(
	element: HTMLInputElement | null | undefined,
	onChange: (value: string) => void,
): boolean {
	if (!element || element.dataset.wired) return false;
	element.dataset.wired = "1";
	element.addEventListener("input", () => {
		onChange(element.value);
	});
	return true;
}

/**
 * Wire a select's `change` event. Selects fire change (not click), so
 * dropdowns wire imperatively like the text inputs. Same no-op contract as
 * wireInput.
 *
 * @param element The select to wire (unchecked query results fine).
 * @param onChange Called with the new value on every change event.
 * @returns True when the listener was attached this call.
 */
export function wireSelect(
	element: HTMLSelectElement | null | undefined,
	onChange: (value: string) => void,
): boolean {
	if (!element || element.dataset.wired) return false;
	element.dataset.wired = "1";
	element.addEventListener("change", () => {
		onChange(element.value);
	});
	return true;
}
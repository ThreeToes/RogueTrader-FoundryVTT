// Bead o25w: the TestDialog modifier-collection seam (the visible-modifier
// invariant) was untested — every caller stubs TestDialog.show, so the
// Foundry-side class never ran in any suite. The private seams under test are
// exactly the ones the bead lists:
//
//   • #currentDifficulty   — chip state, DOM `button[data-difficulty].checked`
//     fallback, difficulty 0 vs null
//   • #totalModifier / #collectModifiers — the difficulty pushed as a labelled
//     `source.type === "dialog"` row; `custom:N` rows parsed from
//     `.modifier-row.custom` (label-with-0 emitted, 0/"" dropped)
//   • #fixedContributors   — the collectForConditions re-collect when a guard
//     toggles
//   • #conditionFlags      — the checked [data-condition] boxes
//   • #updatePreview       — the Math.min(100, Math.max(1, ...)) clamp
//
// The class is driven through REAL entry points, not a stub: `show()` (with a
// capturing `render` so the test can reach the dialog), the static action
// handlers (chip clicks, roll, cancel, update), `_prepareContext` and
// `_onRender`, against a minimal hand-rolled DOM. The repo stubs Foundry
// instead of pulling jsdom/happy-dom (roll-pipeline.test.ts, ports.test.ts);
// this suite adds no new tooling.
//
// test-dialog touches foundry.applications at module load, so the globals are
// stubbed BEFORE the dynamic import (same pattern as roll-pipeline.test.ts).

const originalGlobals: Record<string, unknown> = {};
for (const key of ["game", "ui", "foundry"]) {
	originalGlobals[key] = (globalThis as Record<string, unknown>)[key];
}
(globalThis as Record<string, unknown>).game = {
	i18n: {
		localize: (key: string) => key,
		format: (key: string) => key,
	},
	system: { id: "rogue-trader" },
};
(globalThis as Record<string, unknown>).ui = {
	notifications: {
		warn: () => undefined,
		error: () => undefined,
		info: () => undefined,
	},
};

// A bare ApplicationV2 stand-in: whatever the base class turns out to extend
// (see the prototype patch below), `render`/`close` need SOMETHING to resolve
// to — #promise() calls render, #finish calls super.close. The methods are
// actually installed by the beforeAll below, on the base prototype itself.
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		api: {
			HandlebarsApplicationMixin: (base: unknown) => base,
			ApplicationV2: class {},
		},
	},
};

const { TestDialogBase } = await import("./test-dialog");

// The stubs must not leak into other test files in the same bun process.
afterAll(() => {
	for (const [key, value] of Object.entries(originalGlobals)) {
		if (value === undefined)
			delete (globalThis as Record<string, unknown>)[key];
		else (globalThis as Record<string, unknown>)[key] = value;
	}
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Modifier } from "../../../rules-engine/index";
import type {
	TestDialogBase as TestDialogBaseType,
	TestDialogRequest,
	TestDialogResult,
} from "./test-dialog";

// --- The base-class prototype patch (gotcha #p53) -------------------------
//
// bun runs every suite in ONE process, so `TestDialogBase` extends whichever
// ApplicationV2 stub was global when the module FIRST loaded — this suite's or
// an earlier suite's. The four instance methods the dialog machinery relies on
// (render/close/_prepareContext/_onRender) are therefore patched onto that
// base prototype here rather than assumed, following the pattern
// roguetrader/rules/test-dialog.test.ts uses for _prepareContext.

const dialogProto = TestDialogBase.prototype as unknown as Record<
	string,
	unknown
>;
const appProto = Object.getPrototypeOf(dialogProto) as Record<
	string,
	unknown
> | null;

/** The dialog the patched `render` handed back out of `show()`. */
let rendered: unknown;

const BASE_METHODS = ["render", "close", "_prepareContext", "_onRender"];
const prototypeSaves = new Map<string, PropertyDescriptor>();
const prototypeAdds: string[] = [];

beforeAll(() => {
	if (!appProto || appProto === Object.prototype) {
		throw new Error(
			"TestDialogBase has no usable base-class prototype to patch",
		);
	}
	for (const name of BASE_METHODS) {
		const descriptor = Object.getOwnPropertyDescriptor(appProto, name);
		if (descriptor) prototypeSaves.set(name, descriptor);
		else prototypeAdds.push(name);
	}
	appProto.render = async function render(this: unknown, _options?: unknown) {
		rendered = this;
		return this;
	};
	appProto.close = async function close(this: unknown, _options?: unknown) {
		return this;
	};
	appProto._prepareContext = async function _prepareContext(): Promise<
		Record<string, unknown>
	> {
		return {};
	};
	appProto._onRender = async function _onRender(
			this: unknown,
			_context?: unknown,
			_options?: unknown,
		): Promise<void> {
			// Nothing: the stub base has no render pipeline to extend.
		};
});

afterAll(() => {
	for (const [name, descriptor] of prototypeSaves) {
		Object.defineProperty(appProto, name, descriptor);
	}
	for (const name of prototypeAdds) delete appProto[name];
});

// --- Hand-rolled DOM harness ----------------------------------------------

interface FakeNode {
	tag: string;
	classes: string[];
	dataset: Record<string, string>;
	children: FakeNode[];
	parent: FakeNode | null;
	textContent: string;
	value: string;
	checked: boolean;
	listeners: Map<string, Array<(ev?: unknown) => void>>;
	classList: {
		toggle(token: string, force?: boolean): void;
		contains(token: string): boolean;
	};
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, listener: (ev?: unknown) => void): void;
	dispatch(type: string): void;
	querySelector(selector: string): FakeNode | null;
	querySelectorAll(selector: string): FakeNode[];
	closest(selector: string): FakeNode | null;
}

/** `data-some-key` → dataset key `someKey`, as the real DOM dataset works. */
function camelizeAttr(attr: string): string {
	return attr.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * One compound selector (tag + any order of `.class` and `[attr]`) against
 * one node. Every constraint the compound states must hold — the selectors
 * the dialog queries are all flat compounds except the two descendant forms
 * handled by selectAll.
 */
function matchesCompound(node: FakeNode, compound: string): boolean {
	const tagMatch = /^[a-zA-Z][\w-]*/.exec(compound);
	const tag = tagMatch?.[0];
	const tail = tag ? compound.slice(tag.length) : compound;
	if (tag && node.tag.toLowerCase() !== tag.toLowerCase()) return false;
	for (const cls of tail.match(/\.([\w-]+)/g) ?? []) {
		if (!node.classes.includes(cls.slice(1))) return false;
	}
	for (const attr of tail.match(/\[([^\]]+)\]/g) ?? []) {
		const key = camelizeAttr(attr.slice(1, attr.length - 1));
		if (!(key in node.dataset)) return false;
	}
	return true;
}

/** Descendant-combinator selector (space-separated compound selectors). */
function selectAll(root: FakeNode, selector: string): FakeNode[] {
	const compounds = selector.trim().split(/\s+/);
	const last = compounds[compounds.length - 1];
	const ancestorsMatch = (node: FakeNode, chain: string[]): boolean => {
		if (chain.length === 0) return true;
		let current: FakeNode | null = node.parent;
		while (current) {
			if (
				matchesCompound(current, chain[chain.length - 1]) &&
				ancestorsMatch(current, chain.slice(0, -1))
			)
				return true;
			current = current.parent;
		}
		return false;
	};
	const out: FakeNode[] = [];
	const walk = (node: FakeNode): void => {
		for (const child of node.children) {
			const chain = compounds.slice(0, -1);
			if (
				matchesCompound(child, last) &&
				(chain.length === 0 || ancestorsMatch(child, chain))
			)
				out.push(child);
			walk(child);
		}
	};
	walk(root);
	return out;
}

function fakeNode(
	tag: string,
	props: {
		classes?: string[];
		dataset?: Record<string, string>;
		checked?: boolean;
		value?: string;
	} = {},
): FakeNode {
	const classes = [...(props.classes ?? [])];
	const node = {} as FakeNode;
	node.tag = tag;
	node.classes = classes;
	node.dataset = { ...(props.dataset ?? {}) };
	node.children = [];
	node.parent = null;
	node.textContent = "";
	node.value = props.value ?? "";
	node.checked = props.checked ?? false;
	node.listeners = new Map();
	node.classList = {
		toggle(token, force) {
			const on = force ?? !classes.includes(token);
			const at = classes.indexOf(token);
			if (on && at === -1) classes.push(token);
			if (!on && at !== -1) classes.splice(at, 1);
		},
		contains: (token) => classes.includes(token),
	};
	node.setAttribute = (name, value) => {
		node.dataset[name.replace(/^data-/, "")] = value;
	};
	node.addEventListener = (type, listener) => {
		const list = node.listeners.get(type) ?? [];
		list.push(listener);
		node.listeners.set(type, list);
	};
	node.dispatch = (type) => {
		for (const listener of [...(node.listeners.get(type) ?? [])]) listener({});
	};
	node.querySelector = (selector) => selectAll(node, selector)[0] ?? null;
	node.querySelectorAll = (selector) => selectAll(node, selector);
	node.closest = (selector) => {
		let current: FakeNode | null = node;
		while (current) {
			if (matchesCompound(current, selector)) return current;
			current = current.parent;
		}
		return null;
	};
	return node;
}

function append(parent: FakeNode, child: FakeNode): FakeNode {
	child.parent = parent;
	parent.children.push(child);
	return child;
}

interface BodyOptions {
	/** Difficulty chips as `[data-value]` strings ("" = the "none" chip). */
	chips?: Array<{ value: string; checked?: boolean }>;
	/** Guard toggles as `[data-condition]` inputs. */
	conditions?: Array<{ key: string; checked?: boolean }>;
}

/**
 * The minimum DOM the dialog's private seams read: the difficulty chip group,
 * the guard-toggle inputs, a `#collectModifiers`-visible custom-row slot the
 * test fills with addRow(), the three preview spans, and the modifiers
 * expander.
 */
function buildBody(options: BodyOptions = {}): FakeNode {
	const root = fakeNode("div");
	const ladder = append(
		root,
		fakeNode("div", { classes: ["difficulty-ladder"] }),
	);
	for (const chip of options.chips ?? []) {
		append(
			ladder,
			fakeNode("button", {
				classes: ["difficulty-chip", ...(chip.checked ? ["checked"] : [])],
				dataset: { difficulty: "", value: chip.value },
			}),
		);
	}
	for (const condition of options.conditions ?? []) {
		append(
			root,
			fakeNode("input", {
				dataset: { condition: condition.key },
				checked: condition.checked ?? false,
			}),
		);
	}
	append(root, fakeNode("span", { dataset: { base: "" } }));
	append(root, fakeNode("span", { dataset: { total: "" } }));
	append(root, fakeNode("span", { dataset: { preview: "" } }));
	append(root, fakeNode("details", { dataset: { modifiers: "" } }));
	return root;
}

/** Add one `.modifier-row.custom` row (label/value inputs) to the body. */
function addRow(
	element: FakeNode,
	label: string,
	value: string,
): FakeNode {
	const div = append(element, fakeNode("div", { classes: ["modifier-row", "custom"] }));
	append(div, fakeNode("input", { classes: ["modifier-label"], value: label }));
	append(div, fakeNode("input", { classes: ["modifier-value"], value }));
	return div;
}

// --- Opening the real dialog ---------------------------------------------

const LADDER = [
	{ key: "TRIVIAL", value: 60 },
	{ key: "HARD", value: -20 },
];
const PREFIX = "ROLL.DIFFICULTY_";

const actions = (
	TestDialogBase as unknown as {
		DEFAULT_OPTIONS: {
			actions: Record<
				string,
				(this: unknown, event?: unknown, target?: FakeNode) => unknown
			>;
		};
	}
).DEFAULT_OPTIONS.actions;

type DialogWithElement = TestDialogBaseType & {
	element: FakeNode;
};

/**
 * Open the REAL dialog through `show()`. The capturing render (patched above)
 * hands back the instance synchronously; the test then attaches its DOM. The
 * promise is #promise's own — it settles on roll/cancel exactly as in world.
 */
function open(
	request: Partial<TestDialogRequest> & TestDialogRequest,
	body: BodyOptions = {},
): {
	promise: Promise<TestDialogResult | null>;
	dialog: DialogWithElement;
	element: FakeNode;
} {
	const promise = TestDialogBase.show(request);
	const dialog = rendered as unknown as DialogWithElement;
	expect(dialog).toBeInstanceOf(TestDialogBase);
	const element = buildBody(body);
	dialog.element = element;
	return { promise, dialog, element };
}

const dialogSource = { type: "dialog" as const, label: "ROLL.DIALOG" };

const modifier = (id: string, label: string, value: number): Modifier => ({
	id,
	source: dialogSource,
	label,
	value,
});

const difficultyRow = (label: string, value: number): Modifier => ({
	id: "difficulty",
	source: dialogSource,
	label,
	value,
});

function chipAt(element: FakeNode, index: number): FakeNode {
	return element.querySelectorAll("button[data-difficulty]")[index];
}

async function prepareContext(
	dialog: DialogWithElement,
): Promise<Record<string, unknown>> {
	const prepare = (
		dialog as unknown as {
			_prepareContext: (options: unknown) => Promise<Record<string, unknown>>;
		}
	)._prepareContext;
	return await prepare.call(dialog, { isFirstRender: false });
}

// --- Difficulty ------------------------------------------------------------

describe("TestDialogBase difficulty collection", () => {
	test("a clicked ladder chip is collected as a labelled dialog-source row", async () => {
		const { promise, dialog, element } = open(
			{
				title: "Ballistic Skill",
				baseTarget: 40,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "60" }, { value: "-20" }] },
		);
		const trivial = chipAt(element, 0);
		expect(trivial).not.toBeUndefined();
		actions.updateDifficulty.call(dialog, null, trivial);
		// The chip group's visual state is synced on the DOM — the `checked`
		// class is exactly what the DOM fallback reads.
		expect(trivial.classList.contains("checked")).toBe(true);
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [difficultyRow("ROLL.DIFFICULTY_TRIVIAL", 60)],
		});
	});

	test("an off-ladder value localizes through the CUSTOM key", async () => {
		const { promise, dialog, element } = open(
			{
				title: "Ballistic Skill",
				baseTarget: 40,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "60" }, { value: "-20" }] },
		);
		const chipped = chipAt(element, 0);
		actions.updateDifficulty.call(dialog, null, chipped);
		// Overwrite the chip's value to one the ladder does not carry.
		chipped.dataset.value = "45";
		actions.updateDifficulty.call(dialog, null, chipped);
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [difficultyRow("ROLL.DIFFICULTY_CUSTOM", 45)],
		});
	});

	test("the DOM fallback reads a pre-checked chip without any state click", async () => {
		// The HARD chip ships pre-checked in the DOM: state stays null, so only
		// #currentDifficulty's DOM fallback can find it.
		const { promise, dialog } = open(
			{
				title: "Ballistic Skill",
				baseTarget: 40,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "60" }, { value: "-20", checked: true }] },
		);
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [difficultyRow("ROLL.DIFFICULTY_HARD", -20)],
		});
	});

	test("no difficulty selection collects no difficulty row at all", async () => {
		const { promise, dialog } = open({
			title: "Initiative",
			baseTarget: 40,
		});
		actions.roll.call(dialog);
		expect(await promise).toEqual({ modifiers: [] });
	});
});

describe("TestDialogBase difficulty: 0 is a selection, null is none", () => {
	test("a data-value=\"0\" chip emits a value-0 difficulty row (no-ladder path)", async () => {
		// The initiative path: NO ladder, NO prefix — a bare chip group whose
		// chip reads "0". Number("0") is 0, NOT the null the none-chip gives.
		const { promise, dialog, element } = open(
			{ title: "Initiative", baseTarget: 40 },
			{ chips: [{ value: "0" }] },
		);
		const zero = element.querySelector("button[data-difficulty]");
		actions.updateDifficulty.call(dialog, null, zero);
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [difficultyRow("CUSTOM", 0)],
		});
	});

	test("the \"none\" chip (data-value=\"\") collects no difficulty row", async () => {
		const { promise, dialog, element } = open(
			{ title: "Initiative", baseTarget: 40 },
			{ chips: [{ value: "" }] },
		);
		const noneChip = element.querySelector("button[data-difficulty]");
		actions.updateDifficulty.call(dialog, null, noneChip);
		actions.roll.call(dialog);
		expect(await promise).toEqual({ modifiers: [] });
	});

	test("selected 0 survives a rerender (whose DOM carries no checked chip)", async () => {
		const { promise, dialog } = open(
			{ title: "Initiative", baseTarget: 40 },
			{ chips: [{ value: "0" }] },
		);
		actions.updateDifficulty.call(dialog, null, chipAt(dialog.element, 0));
		// A rerender (add/remove custom row) recreates the DOM: attach a fresh
		// body with NO checked chip, so #currentDifficulty must fall back to
		// the state — which is 0, NOT the null a missing chip would read as.
		dialog.element = buildBody({});
		actions.updateModifier.call(dialog);
		expect(dialog.element.querySelector("[data-preview]").textContent).toBe("40");
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [difficultyRow("CUSTOM", 0)],
		});
	});
});

// --- Custom rows -----------------------------------------------------------

describe("TestDialogBase custom modifier rows", () => {
	test("a label with a 0 value is still emitted (label OR value)", async () => {
		const { promise, dialog, element } = open({
			title: "Weapon Skill",
			baseTarget: 50,
			contributors: [modifier("aim", "Aim", 10)],
		});
		addRow(element, "Flanking", "0");
		actions.roll.call(dialog);
		expect(await promise).toEqual({
			modifiers: [
				modifier("aim", "Aim", 10),
				{
					id: "custom:1",
					source: dialogSource,
					label: "Flanking",
					value: 0,
				},
			],
		});
	});

	test("a 0/empty row and a junk value (NaN → 0) are dropped", async () => {
		const { promise, dialog, element } = open({
			title: "Weapon Skill",
			baseTarget: 50,
		});
		addRow(element, "", "0");
		addRow(element, "", "not a number");
		actions.roll.call(dialog);
		expect(await promise).toEqual({ modifiers: [] });
	});

	test("an empty label renders the \"—\" placeholder; ids follow emit order", async () => {
		const { promise, dialog, element } = open(
			{
				title: "Weapon Skill",
				baseTarget: 50,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "60" }, { value: "-20" }] },
		);
		actions.updateDifficulty.call(dialog, null, chipAt(element, 0));
		addRow(element, "", "10");
		addRow(element, "Cover", "-10");
		actions.roll.call(dialog);
		// The difficulty row is emitted FIRST, so the custom ids continue from
		// its position in the payload.
		expect(await promise).toEqual({
			modifiers: [
				difficultyRow("ROLL.DIFFICULTY_TRIVIAL", 60),
				{ id: "custom:1", source: dialogSource, label: "—", value: 10 },
				{ id: "custom:2", source: dialogSource, label: "Cover", value: -10 },
			],
		});
	});
});

// --- Preview clamp ---------------------------------------------------------

describe("TestDialogBase #updatePreview: the clamp", () => {
	test("the live total and preview reflect difficulty + custom rows", async () => {
		const { dialog, element } = open(
			{
				title: "Weapon Skill",
				baseTarget: 30,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "60" }, { value: "-20" }] },
		);
		actions.updateDifficulty.call(dialog, null, chipAt(element, 0));
		addRow(element, "", "-10");
		actions.updateModifier.call(dialog);
		// 60 + (-10): the positive total renders with its + sign.
		expect(element.querySelector("[data-total]").textContent).toBe("+50");
		expect(element.querySelector("[data-preview]").textContent).toBe("80");
		expect(element.querySelector("[data-base]").textContent).toBe("30");
	});

	test("the preview clamps at 100", async () => {
		const { dialog, element } = open({
			title: "Weapon Skill",
			baseTarget: 50,
			contributors: [modifier("aim", "Aim", 200)],
		});
		actions.updateModifier.call(dialog);
		expect(element.querySelector("[data-preview]").textContent).toBe("100");
		const context = await prepareContext(dialog);
		expect(context.previewTarget).toBe(100);
	});

	test("the preview clamps at 1", async () => {
		const { dialog, element } = open({
			title: "Weapon Skill",
			baseTarget: 20,
			contributors: [modifier("wounds", "Wounded", -200)],
		});
		actions.updateModifier.call(dialog);
		expect(element.querySelector("[data-preview]").textContent).toBe("1");
		const context = await prepareContext(dialog);
		expect(context.previewTarget).toBe(1);
	});

	test("unclamped edges stay exact (and a zero total loses the + sign)", async () => {
		const { dialog, element } = open({
			title: "Weapon Skill",
			baseTarget: 1,
		});
		actions.updateModifier.call(dialog);
		expect(element.querySelector("[data-total]").textContent).toBe("0");
		expect(element.querySelector("[data-preview]").textContent).toBe("1");

		const { dialog: high, element: highElement } = open({
			title: "Weapon Skill",
			baseTarget: 100,
		});
		actions.updateModifier.call(high);
		expect(highElement.querySelector("[data-preview]").textContent).toBe("100");
	});
});

// — Guards ------------------------------------------------------------------

describe("TestDialogBase #fixedContributors: the guard re-collect", () => {
	test("an unchecked toggle leaves the request's contributors and no flags", async () => {
		const collects: Array<Record<string, boolean>> = [];
		const { promise, dialog, element } = open(
			{
				title: "Awareness",
				baseTarget: 40,
				contributors: [modifier("aim", "Aim", 10)],
				conditions: ["poison"],
				collectForConditions: (flags) => {
					collects.push({ ...flags });
					return [modifier("aim", "Aim", 10), modifier("poison", "Poison", -20)];
				},
			},
			{ conditions: [{ key: "poison", checked: false }] },
		);
		expect(element.querySelectorAll("[data-condition]")).toHaveLength(1);
		actions.roll.call(dialog);
		const result = await promise;
		// #fixedContributors only re-collects when a toggle is ENABLED.
		expect(collects).toEqual([]);
		expect(result).toEqual({ modifiers: [modifier("aim", "Aim", 10)] });
	});

	test("a checked toggle re-collects through collectForConditions and pipes the flags", async () => {
		const collects: Array<Record<string, boolean>> = [];
		const { promise, dialog, element } = open(
			{
				title: "Awareness",
				baseTarget: 40,
				conditions: ["poison", "brightlight"],
				collectForConditions: (flags) => {
					collects.push({ ...flags });
					return flags.poison
						? [modifier("aim", "Aim", 10), modifier("poison", "Poison", -20)]
						: [modifier("aim", "Aim", 10)];
				},
			},
			{ conditions: [{ key: "poison" }, { key: "brightlight" }] },
		);
		element.querySelectorAll("[data-condition]")[0].checked = true;
		actions.roll.call(dialog);
		const result = await promise;
		expect(collects).toEqual([{ poison: true }]);
		expect(result).toEqual({
			modifiers: [modifier("aim", "Aim", 10), modifier("poison", "Poison", -20)],
			flags: { poison: true },
		});
	});

	test("a toggled guard updates the live preview through the _onRender listener", async () => {
		const { dialog, element } = open(
			{
				title: "Awareness",
				baseTarget: 40,
				conditions: ["poison"],
				collectForConditions: (flags) =>
					flags.poison ? [modifier("poison", "Poison", -20)] : [],
			},
			{ conditions: [{ key: "poison" }] },
		);
		// _onRender wires a native change listener on every [data-condition]
		// box and refreshes the preview — the same path a real click takes.
		await dialog._onRender({}, {});
		// Unchecked: no re-collect, preview is the bare base target.
		expect(element.querySelector("[data-preview]").textContent).toBe("40");
		const poisonBox = element.querySelectorAll("[data-condition]")[0];
		poisonBox.checked = true;
		poisonBox.dispatch("change");
		expect(element.querySelector("[data-preview]").textContent).toBe("20");
	});
});

// — Context -----------------------------------------------------------------

describe("TestDialogBase _prepareContext: labelled, localized rows", () => {
	test("contributors localize KEY-shaped labels; ladder, conditions and none-flag resolve", async () => {
		const { dialog } = open(
			{
				title: "Psyniscience",
				baseTarget: 30,
				contributors: [modifier("aim", "ROLL.AIM", 10)],
				conditions: ["poison"],
				conditionLabel: (key) => `CONDITION.${key.toUpperCase()}`,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ conditions: [{ key: "poison" }] },
		);
		const context = await prepareContext(dialog);
		expect(context.contributors).toEqual([
			{ label: "ROLL.AIM", value: 10, sourceLabel: "ROLL.DIALOG" },
		]);
		expect(context.conditions).toEqual([
			{ key: "poison", label: "CONDITION.POISON", checked: false },
		]);
		expect(context.difficulty).toEqual([
			{ key: "TRIVIAL", value: 60, label: "ROLL.DIFFICULTY_TRIVIAL" },
			{ key: "HARD", value: -20, label: "ROLL.DIFFICULTY_HARD" },
		]);
		// No selection: the "none" chip is checked.
		expect(context.difficultyNone).toBe(true);
		// Base 30 + the aim contributor's 10 — fixed rows count toward the
		// preview exactly as they count toward the roll.
		expect(context.previewTarget).toBe(40);
	});

	test("a selected difficulty of 0 is a real selection, not difficultyNone", async () => {
		const { dialog, element } = open(
			{
				title: "Awareness",
				baseTarget: 30,
				difficultyLadder: LADDER,
				difficultyLabelPrefix: PREFIX,
			},
			{ chips: [{ value: "0" }] },
		);
		actions.updateDifficulty.call(dialog, null, chipAt(element, 0));
		const context = await prepareContext(dialog);
		expect(context.difficultyNone).toBe(false);
	});
});

// — Close paths -------------------------------------------------------------

describe("TestDialogBase close paths", () => {
	test("cancel resolves null", async () => {
		const { promise, dialog } = open({
			title: "Ballistic Skill",
			baseTarget: 40,
		});
		actions.cancel.call(dialog);
		expect(await promise).toBeNull();
	});

	test("close() while pending resolves null", async () => {
		const { promise, dialog } = open({
			title: "Ballistic Skill",
			baseTarget: 40,
		});
		await dialog.close();
		expect(await promise).toBeNull();
	});
});
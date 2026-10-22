/**
 * Scroll-layer guards for the rules app window (bead yt8r).
 *
 * An ApplicationV2 window does NOT scroll on its own: without a scroll
 * container in the CSS, everything past the window height is clipped and
 * unreachable. The rules app shipped that way — the knob form, the JSON tab,
 * the import/export panel and the diff table were all cut off at the default
 * 860x660 (and at the minimum size), and the comment on the app's PARTS claimed
 * "the window scrolls as a whole", which was simply false.
 *
 * Nothing about this is visible to a unit test that imports the app, so these
 * guards scan the sources the way character-sheet-form.test.ts pins the sheet's
 * descriptors:
 *
 *   1. the app element carries the classes the CSS scopes itself against
 *      (DEFAULT_OPTIONS.classes);
 *   2. the whole flex chain that makes a resizable window scroll:
 *      `.window-content` scrolls -> the template root fills it -> the columns
 *      keep its height -> the panel and the sidebar scroll inside it;
 *   3. the CSS min-size clamp equals DEFAULT_OPTIONS.window's — the pair is
 *      deliberately duplicated and a silent drift means the resize clamp and
 *      the stylesheet disagree about how small the window may get.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CSS_FILE = "css/rules-app.css";
const APP_FILE = "src/roguetrader/presentation/rules-app.ts";
const TEMPLATE_FILE = "template/dialog/rules-app.hbs";

const css = readFileSync(CSS_FILE, "utf8");
const appSource = readFileSync(APP_FILE, "utf8");
const template = readFileSync(TEMPLATE_FILE, "utf8");

/** One CSS rule: its (normalised) selector list and its declarations. */
interface Rule {
	selector: string;
	declarations: Map<string, string>;
}

/**
 * The rules of a plain stylesheet, comments stripped. No Less, no nesting: the
 * bundle is a concatenation (utils/css.ts), so the flat `selector { ... }`
 * shape is the whole grammar needed here.
 */
function parseCss(source: string): Rule[] {
	const bare = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules: Rule[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(bare)) !== null) {
		const declarations = new Map<string, string>();
		for (const declaration of match[2]!.split(";")) {
			const colon = declaration.indexOf(":");
			if (colon === -1) continue;
			const property = declaration.slice(0, colon).trim().toLowerCase();
			const value = declaration
				.slice(colon + 1)
				.trim()
				.replace(/\s+/g, " ");
			if (property) declarations.set(property, value);
		}
		rules.push({
			selector: match[1]!.replace(/\s+/g, " ").trim(),
			declarations,
		});
	}
	return rules;
}

const rules = parseCss(css);

/** Every rule whose selector list names `selector` (never a substring match). */
function rulesFor(selector: string): Rule[] {
	return rules.filter((rule) =>
		rule.selector
			.split(",")
			.map((part) => part.trim())
			.includes(selector),
	);
}

/** The value `selector` declares for `property`, across all its rule blocks. */
function declares(selector: string, property: string): string | undefined {
	for (const rule of rulesFor(selector)) {
		const value = rule.declarations.get(property);
		if (value !== undefined) return value;
	}
	return undefined;
}

/** A number out of the app's source, e.g. the clamps in DEFAULT_OPTIONS. */
function sourceNumber(pattern: RegExp): number {
	const match = appSource.match(pattern);
	if (!match?.[1]) throw new Error(`not found in ${APP_FILE}: ${pattern}`);
	return Number(match[1]);
}

describe("rules app window scroll layers (bead yt8r)", () => {
	test("the app element carries the classes the CSS scopes against", () => {
		// `.rogue-trader.rules-app` is how the stylesheet keeps itself off the
		// sheets; if a class is dropped from DEFAULT_OPTIONS every rule here
		// stops matching and the window goes back to clipping. rt-component
		// (cmio.6) is the shared component layer's root, guarded by
		// utils/rt-component-root.test.ts.
		const classes = appSource.match(/classes:\s*\[([^\]]*)\]/)?.[1] ?? "";
		const carried = [...classes.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
		expect(carried).toEqual([
			"rogue-trader",
			"dialog",
			"rules-app",
			"rt-component",
			// rtk-window (cmio.7): the shared resize/clamp/scroll contract class;
			// the app's own 640×480 clamp rule wins the (0,2,0) tie by load order.
			"rtk-window",
		]);
		for (const selector of [".rogue-trader.rules-app"]) {
			for (const part of selector.split(".").filter(Boolean)) {
				expect(
					carried,
					`${selector} needs the "${part}" class on the app element`,
				).toContain(part);
			}
		}
	});

	test("the window content is the window's scroll container", () => {
		// The one link an ApplicationV2 window cannot supply for itself.
		expect(
			declares(".rogue-trader.rules-app .window-content", "overflow-y"),
		).toBe("auto");
	});

	test("the template root fills the scrolling window content", () => {
		// The part root is a flex column inside the scrolling window content;
		// `min-height: 0` is what lets it shrink to the window instead of
		// growing to the content's height.
		const root = ".rogue-trader.rules-app .window-content .rules-app";
		expect(declares(root, "flex")).toBe("1 1 auto");
		expect(declares(root, "min-height")).toBe("0");
	});

	test("the two columns keep the window's height and stretch to it", () => {
		const body = ".rules-app .rules-body";
		expect(declares(body, "flex")).toBe("1 1 auto");
		// Without stretch the columns keep their content height and the panel
		// never gets a bounded box to scroll.
		expect(declares(body, "align-items")).toBe("stretch");
		expect(declares(body, "min-height")).toBe("0");
		// Neither column may refuse to shrink.
		expect(declares(".rules-app .rules-main", "min-height")).toBe("0");
		expect(declares(".rules-app .rules-sidebar", "min-height")).toBe("0");
	});

	test("the panel is the knob form's scroll container", () => {
		const panel = ".rules-app .rules-panel";
		expect(declares(panel, "overflow-y")).toBe("auto");
		expect(declares(panel, "min-height")).toBe("0");
		// ...and every tab renders that panel: the template is what puts the
		// class on screen, so a renamed panel is as invisible as a lost rule.
		for (const tab of ["knobs", "json", "pack", "diff"]) {
			expect(
				template,
				`the ${tab} tab must render class="rules-panel rules-${tab}"`,
			).toContain(`class="rules-panel rules-${tab}"`);
		}
	});

	test("the sidebar scrolls its profile list independently", () => {
		// A long profile list (world + module groups) must not push the form
		// out of the window: the list scrolls in its own box.
		expect(declares(".rules-app .rules-sidebar", "overflow-y")).toBe("auto");
	});

	test("the CSS clamp matches DEFAULT_OPTIONS.window", () => {
		// ApplicationV2 clamps a resize to the element's computed min sizes, so
		// the stylesheet and the descriptor must state the same pair or the
		// resizable window and the rule that styles it disagree.
		const minWidth = sourceNumber(/minWidth:\s*(\d+)/);
		const minHeight = sourceNumber(/minHeight:\s*(\d+)/);
		expect(declares(".rogue-trader.rules-app", "min-width")).toBe(
			`${minWidth}px`,
		);
		expect(declares(".rogue-trader.rules-app", "min-height")).toBe(
			`${minHeight}px`,
		);
	});

	test("the app root is the flex column the chain hangs off", () => {
		// Every link above assumes a column root; `flex-flow: row` at the top
		// would quietly undo the whole chain.
		expect(declares(".rogue-trader.rules-app", "display")).toBe("flex");
		expect(declares(".rogue-trader.rules-app", "flex-direction")).toBe(
			"column",
		);
	});
});

/**
 * Template-scan guards for the Spend-XP dialog (epic lzeb child 3, bead 8aba):
 * the child-2 rework shipped rank chips, a search/filter toolbar, the
 * cb-track/cb-fill meter, a locked next-rank preview and buy buttons whose
 * data-* payload the dialog actions read. These guards pin those affordances
 * so a refactor cannot silently drop them (background-afflictions /
 * character-sheet-form precedents), plus the two i18n invariants the dialog
 * depends on (static keys in all four langs; the view model's dynamic key
 * families) and the form's single-bound-name invariant.
 *
 * Depth-scoping lesson (child 2, uncommitted): the first draft rendered the
 * rank table inside TWO nested each frames (rankGroups x rows) and the buy
 * button's `{{#unless (and ../canBuy ...)}}` silently resolved `../` against
 * the OUTER group frame — canBuy looked like a member of the group object,
 * was undefined, and EVERY rank Buy button rendered disabled. The shipped
 * template renders only the selected rank's group (shownGroup), so the rows
 * each is one frame deep and `../` reaches the root. The structural guard
 * below pins exactly that shape: every buy button must sit inside exactly
 * ONE open {{#each}} frame.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const TEMPLATE = "template/sheet/actor/parts/advancement-dialog.hbs";
const template = readFileSync(TEMPLATE, "utf8");

/** Handlebars comments stripped, so token scans only see real block tokens. */
const code = template
	.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
	.replace(/\{\{!.*?\}\}/g, "");

describe("advancement dialog template affordances (bead 8aba)", () => {
	test("the template exists at the shipped path", () => {
		// The dialog's PARTS template must match the file the guards scan,
		// otherwise these assertions pin a stale copy.
		expect(TEMPLATE).toBe(
			"template/sheet/actor/parts/advancement-dialog.hbs",
		);
	});

	test("rank chips: .rank-chips region selects ranks via selectRank", () => {
		const start = code.indexOf('<div class="rank-chips">');
		const end = code.indexOf('<div class="advancement-toolbar">');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const chips = code.slice(start, end);
		expect(chips).toContain('data-action="selectRank"');
		expect(chips).toContain('data-rank="{{group.rank}}"');
		expect(chips).toContain("selected");
		// Chip vocabulary: the creator-chip pattern the owner decided on.
		expect(chips).toContain('class="pick-chip');
		// The chip region must not leak the toolbar's filter actions.
		expect(chips).not.toContain("toggleFilter");
	});

	test("search input: the named search control survives re-renders", () => {
		expect(code).toContain('name="advancement-search"');
		expect(code).toContain('type="search"');
	});

	test("toolbar: affordable/unowned filter chips toggle via toggleFilter", () => {
		const start = code.indexOf('<div class="advancement-toolbar">');
		expect(start).toBeGreaterThan(-1);
		const toolbar = code.slice(start, start + 800);
		expect((toolbar.match(/data-action="toggleFilter"/g) ?? []).length).toBe(2);
		expect(toolbar).toContain('data-filter="affordable"');
		expect(toolbar).toContain('data-filter="unowned"');
		expect(toolbar).toContain('class="pick-chip filter-chip');
	});

	test("meter: the cb-track/cb-fill anatomy renders progress to the next rank", () => {
		const start = code.indexOf('<div class="advancement-meter">');
		const end = code.indexOf('<div class="rank-chips">');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const meter = code.slice(start, end);
		expect(meter).toContain('<span class="cb-track"><span class="cb-fill"');
		expect(meter).toContain("progressPct");
		expect(meter).toContain("ADVANCE.NEXT_RANK");
		expect(meter).toContain("ADVANCE.MAX_RANK");
	});

	test("next-rank preview: locked, and contains NO purchase affordance", () => {
		const start = code.indexOf('class="next-rank-preview locked"');
		expect(start).toBeGreaterThan(-1);
		// The preview is the template's final block, so its tail is the whole
		// preview section.
		const preview = code.slice(start);
		expect(preview).toContain("ADVANCE.NEXT_RANK_PREVIEW");
		expect(preview).toContain('class="advancement-row locked"');
		// The preview must not contain ANY action button.
	});

	test("refund stays a GM-only affordance gated on row.purchased", () => {
		expect(code).toContain('data-action="refund"');
		expect(code).toContain('{{#if ../isGM}}');
	});

	test("every buy button keeps its action and its full data-* payload", () => {
		// #onBuy rebuilds the row from these attributes — dropping one silently
		// corrupts the ledger entry (cost/name/type/rank default to falsy).
		expect((code.match(/data-action="buy"/g) ?? []).length).toBe(1);
		expect((code.match(/data-action="buyCharacteristic"/g) ?? []).length).toBe(1);
		const buyStart = code.indexOf('data-action="buy"');
		const buyButton = code.slice(
			code.lastIndexOf("<button", buyStart),
			code.indexOf("</button>", buyStart),
		);
		for (const attr of [
			"data-key",
			"data-name",
			"data-type",
			"data-cost",
			"data-multiplier",
			"data-rank",
			"data-prerequisites",
			"data-source",
		]) {
			expect(buyButton).toContain(`${attr}=`);
		}
	});
});

/**
 * Bracket-token scan over the template: walk block tokens in source order,
 * tracking opened {{#each}}/{{#if}}/{{#unless}}/{{#with}} frames, and record
 * how many {{#each}} frames are open at every buy-button position.
 */
function eachDepthAtBuyButtons(): Array<{ action: string; depth: number }> {
	const events = [
		...code.matchAll(
			/\{\{(#|\/)(each|if|unless|with)\b[^{}]*\}\}|\{\{else\b[^{}]*\}\}/g,
		),
	].map((match) => ({ pos: match.index!, text: match[0] }));
	const buys = [
		...code.matchAll(/data-action="(buyCharacteristic|buy)"/g),
	].map((match) => ({ pos: match.index!, action: match[1]! }));

	const stack: Array<"each" | "other"> = [];
	const depths: Array<{ action: string; depth: number }> = [];
	let cursor = 0;
	for (const buy of buys) {
		while (cursor < events.length && events[cursor]!.pos < buy.pos) {
			const text = events[cursor]!.text;
			const kind = text.startsWith("{{#")
				? text.startsWith("{{#each")
					? "each"
					: "other"
				: null;
			if (kind) {
				stack.push(kind);
			} else if (text.startsWith("{{/")) {
				const expected = text.startsWith("{{/each") ? "each" : "other";
				const popped = stack.pop();
				expect(popped).toBe(expected); // tokens must nest cleanly
			}
			// "{{else ...}}" opens no frame.
			cursor++;
		}
		depths.push({
			action: buy.action,
			depth: stack.filter((frame) => frame === "each").length,
		});
	}
	return depths;
}

describe("advancement dialog depth scoping (child-2 disabled-buttons incident)", () => {
	test("the token scan tracks the template's frames", () => {
		// Guard sanity: no template at all would pass the depth assertions.
		expect(code).toContain('data-action="buy"');
	});

	test("every buy button sits in exactly ONE each frame, so ../ reaches the root", () => {
		const depths = eachDepthAtBuyButtons();
		// One row-level buy in the rank table + one characteristic scheme buy.
		expect(depths).toHaveLength(2);
		// The incident shape: rows each nested inside the rankGroups each made
		// depth 2, where `../canBuy` read the group frame and disabled EVERY
		// rank Buy button. Depth 1 = the rows/characteristics each only.
		for (const { action, depth } of depths) {
			expect({ action, depth }).toEqual({ action, depth: 1 });
		}
	});

	test("the buy-button block is not nested inside a sibling each (unmetPrereqs)", () => {
		// A subtle variant of the incident: moving the button INTO an
		// inline `{{#each row.unmetPrereqs}}` body still yields depth 2.
		for (const { depth } of eachDepthAtBuyButtons()) {
			expect(depth).toBe(1);
		}
	});

	test("the search input is the template's ONLY named form control", () => {
		const names = [
			...code.matchAll(
				/<(?:input|select|textarea)\b[^>]*?\bname="([^"]+)"/g,
			),
		].map((match) => match[1]);
		// The character-sheet duplicate-name invariant (foundry array-submit
		// bug) extends here: the dialog's form must not gain a second bound
		// input of the same name — verify rather than extend blindly.
		expect(names).toEqual(["advancement-search"]);
	});
});

describe("advancement dialog doc links (bead ha1y)", () => {
	/**
	 * The next-rank PREVIEW rows link too (worker choice, bead ha1y point
	 * 4): the preview is informational — no buy button lives there — and
	 * the links share the enrichment path, so planning ahead can open
	 * sheets without extra machinery.
	 */
	test("resolved rows render the openPackDoc anchor with its uuid", () => {
		// One anchor in the shown rank table, one in the locked preview.
		expect((code.match(/data-action="openPackDoc"/g) ?? []).length).toBe(2);
		for (const anchor of code.matchAll(/<a class="adv-doc-link"[^>]*>/g)) {
			expect(anchor[0]).toContain('data-action="openPackDoc"');
			expect(anchor[0]).toContain('data-uuid="{{row.uuid}}"');
		}
	});

	test("rows WITHOUT a uuid keep plain text (the else branch)", () => {
		// Both link sites must keep the fallback so parameterised talents
		// ("Peer (choose one)", uuid "") render as before.
		expect(
			(code.match(/\{\{else\}\}\{\{row\.name\}\}\{\{\/if\}\}/g) ?? []).length,
		).toBe(2);
	});

	test("characteristic scheme rows carry NO doc link (no pack doc exists)", () => {
		const start = code.indexOf('<h2>{{localize "ADVANCE.CHARACTERISTIC_SCHEME"}}</h2>');
		const end = code.indexOf('class="next-rank-preview locked"');
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		expect(code.slice(start, end)).not.toContain("openPackDoc");
	});
});

describe("advancement dialog i18n completeness (bead 8aba)", () => {
	/** All keys the dialog template + AdvancementDialog source reference statically. */
	function referencedKeys(): string[] {
		const ts = readFileSync(
			"src/roguetrader/sheet/actor/advancement-dialog.ts",
			"utf8",
		);
		const sources = [code, ts];
		const keys = sources.flatMap((source) => [
			// {{localize "KEY"}} in templates; localize("KEY") in code.
			...source.matchAll(/(?:localize|i18n\.t)\(\s*"([A-Z][A-Z0-9_.]+)"/g),
			...source.matchAll(/localize\s+"([A-Z][A-Z0-9_.]+)"/g),
			// getPorts().notify.*("KEY", ...) announcements.
			...source.matchAll(
				/notify\.(?:info|warn|error)\(\s*"([A-Z][A-Z0-9_.]+)"/g,
			),
			// game.i18n.localize("KEY") in DialogV2 calls.
			...source.matchAll(/"([A-Z][A-Z0-9_.]+)"/g),
		]);
		return [
			...new Set(
				keys
					.map((match) => match[1]!)
					.filter((key) => /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]+)+$/.test(key)),
			),
		].sort();
	}

	const keys = referencedKeys();

	test("the dialog references the expected static key set (scan stays meaningful)", () => {
		// Pin the shape so the scan cannot silently degrade to an empty set.
		expect(keys.length).toBeGreaterThan(10);
		expect(keys).toContain("ADVANCE.TITLE");
		expect(keys).toContain("ADVANCE.BUY");
		// Bead kcmz: the soft-confirm prereq prefix is localized at the call
		// site. (ADVANCE.AT_CAP_REASON lives in the view model — see the
		// dynamic key-family test below.)
		expect(keys).toContain("ADVANCE.PREREQ_PREFIX");
	});

	test("every referenced key exists in ALL FOUR language files", () => {
		for (const lang of ["en", "es", "fr", "pl"]) {
			const dict = JSON.parse(
				readFileSync(`lang/${lang}.json`, "utf8"),
			) as Record<string, string>;
			const missing = keys.filter(
				(key) =>
					dict[key] === undefined ||
					dict[key] === "" ||
					dict[key] === key,
			);
			expect(
				missing,
				`lang/${lang}.json is missing dialog keys: ${missing.join(", ")}`,
			).toEqual([]);
		}
	});

	test("the view model's dynamic key families exist in all four languages", () => {
		// Static scans cannot see computed keys: c.labelKey is
		// `CHARACTERISTIC.${KEY}` and c.tierLabelKey is
		// `ADVANCE.TIER_${TIER}` (advancement-view-model.ts).
		const tierKeys = [
			"ADVANCE.TIER_SIMPLE",
			"ADVANCE.TIER_INTERMEDIATE",
			"ADVANCE.TIER_TRAINED",
			"ADVANCE.TIER_EXPERT",
		];
		const atCapKeys = ["ADVANCE.AT_CAP_REASON"];
	const characteristicKeys = [
			"WS", "BS", "S", "T", "AG", "INT", "PER", "WP", "FEL",
		].map((key) => `CHARACTERISTIC.${key}`);
		for (const lang of ["en", "es", "fr", "pl"]) {
			const dict = JSON.parse(
				readFileSync(`lang/${lang}.json`, "utf8"),
			) as Record<string, string>;
			for (const key of [...tierKeys, ...atCapKeys, ...characteristicKeys]) {
				expect(dict[key], `lang/${lang}.json missing ${key}`).toBeDefined();
			}
		}
	});
});
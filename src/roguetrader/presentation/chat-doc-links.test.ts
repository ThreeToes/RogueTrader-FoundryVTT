/**
 * Template-scan guards for the chat-card doc links (epic 61pk, bead qg4z).
 * The four linking cards (weapon attack, damage, psychic, navigator — the
 * first three through roll.hbs, the damage card through damage.hbs) must
 * keep BOTH halves of the affordance:
 *
 * 1. THE LINK: an anchor carrying the library's data-action + data-uuid in
 *    the card's title (rendered via packDocAnchor's {action, uuid, name});
 * 2. NON-HIJACK: EVERY existing card button (Roll Damage, Apply Damage,
 *    Toxic test, ordnance spend) must still be present — the anchor is an
 *    <a> in the title, never a re-templated button. Clicking the name must
 *    not cost the card its actions.
 *
 * Following advancement-dialog-guard.test.ts conventions (read-file token
 * scans, Handlebars comments stripped), plus the module's own behaviour
 * under the SAME pack caching the compendium surfaces use: resolution
 * through the pack caches (fake game.packs), unresolvable → null link →
 * plain text, never an error.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	chatCardTitleDoc,
	type ChatCardTitleDoc,
	toPackDocCatalog,
} from "./chat-doc-links";

/** Handlebars comments stripped so token scans only see real tokens. */
function templateCode(path: string): string {
	return readFileSync(path, "utf8")
		.replace(/\{\{!--[\s\S]*?--\}\}/g, "")
		.replace(/\{\{!.*?\}\}/g, "");
}

/** The title branch both linking templates are expected to carry. */
function titleDocAnchor(code: string, label: string): void {
	const start = code.indexOf("<h1>");
	const end = code.indexOf("</h1>");
	expect(start, `${label}: the card keeps its <h1> title`).toBeGreaterThan(-1);
	expect(end, `${label}: the <h1> closes`).toBeGreaterThan(start);
	const h1 = code.slice(start, end);
	// The title branch renders the decomposed title, anchor or plain text.
	expect(h1, `${label}: renders titleDoc when present`).toContain(
		"{{#if titleDoc}}",
	);
	const anchor = h1.match(/<a class="adv-doc-link"[^>]*>/);
	expect(anchor, `${label}: the resolved name anchor exists`).not.toBeNull();
	expect(
		anchor![0],
		`${label}: the anchor carries the library's data-action convention`,
	).toContain('data-action="{{titleDoc.link.action}}"');
	expect(
		anchor![0],
		`${label}: the anchor carries the uuid stamp the open path reads`,
	).toContain('data-uuid="{{titleDoc.link.uuid}}"');
	// The degrade branch: unresolvable names stay plain text, never an error.
	expect(h1, `${label}: missing pack doc degrades to plain text`).toContain(
		"{{else}}{{titleDoc.name}}{{/if}}",
	);
}

/**
 * NON-HIJACK guard, strengthened (bead oo5b F2): the anchor must not sit
 * inside a <button>. The old regex /<button[^>]*adv-doc-link/g only caught a
 * doc-link in a button's OPENING tag — an anchor nested in a button BODY
 * passed. Instead: between the anchor and the card's first <button there must
 * be no </button> close tag — a nested-in-button-body layout leaves that
 * close tag in the slice, and fails here (for both roll.hbs and damage.hbs).
 */
function anchorNotInButton(code: string, label: string): void {
	const anchorStart = code.search(/<a class="adv-doc-link"/);
	expect(anchorStart, `${label}: the doc-link anchor exists`).toBeGreaterThan(
		-1,
	);
	const firstButton = code.indexOf("<button", anchorStart);
	expect(
		firstButton,
		`${label}: a card button follows the anchor (the region is real)`,
	).toBeGreaterThan(-1);
	expect(
		code.slice(anchorStart, firstButton),
		`${label}: the anchor is not nested inside a button body`,
	).not.toContain("</button>");
}

describe("chat card doc links — template guards (bead qg4z)", () => {
	test("roll.hbs: the to-hit/psychic/navigator title links its name", () => {
		const code = templateCode("template/chat/roll.hbs");
		titleDocAnchor(code, "roll.hbs");
	});

	test("roll.hbs: the Roll Damage button survives untouched (non-hijack)", () => {
		const code = templateCode("template/chat/roll.hbs");
		expect((code.match(/<button class="rt-roll-damage">/g) ?? []).length).toBe(
			1,
		);
		expect(code).toContain(
			'{{#if (and showDamageButton (eq outcomeClass "success"))}}',
		);
		anchorNotInButton(code, "roll.hbs");
	});

	test("damage.hbs: the damage title links the weapon name", () => {
		const code = templateCode("template/chat/damage.hbs");
		titleDocAnchor(code, "damage.hbs");
	});

	test("damage.hbs: every existing card button survives (bead ncc/d8bc/4obp)", () => {
		const code = templateCode("template/chat/damage.hbs");
		expect((code.match(/<button class="apply-damage"/g) ?? []).length).toBe(
			1,
		);
		expect((code.match(/<button class="rt-toxic-test"/g) ?? []).length).toBe(
			1,
		);
		expect(
			(code.match(/<button class="rt-ammo-decrement"/g) ?? []).length,
		).toBe(1);
		// The anchor lives in the title, NOT inside any button (no hijack).
		expect(code.match(/<button[^>]*adv-doc-link/g)).toBeNull();
		anchorNotInButton(code, "damage.hbs");
	});

	test("the open action is dispatched through the chat click delegation (hooks.ts)", () => {
		// Chat is not an ApplicationV2: the anchor's click reaches
		// openPackDocFromCard through the SAME delegated listener the card
		// buttons use (registerChatActions) — not a data-action table.
		const hooks = readFileSync("src/roguetrader/bootstrap/hooks.ts", "utf8");
		expect(hooks).toContain("openPackDocFromCard");
		expect(hooks).toContain("OPEN_PACK_DOC_ACTION");
		// CHAT-SCOPED (bead oo5b F1): the doc-link branch only fires when the
		// anchor sits inside a chat .message — the advancement dialog stamps
		// the same data-action on its anchors and dispatches them through its
		// own actions table, so an unscoped branch double-fired (two renders;
		// two failure toasts with different keys). This pins the scoping.
		expect(hooks).toMatch(/docLinkAnchor[\s\S]*?\.closest\("\.message"\)/);
		const actions = readFileSync(
			"src/roguetrader/presentation/chat-actions.ts",
			"utf8",
		);
		expect(actions).toContain("openPackDocFromCard");
		// Loud-fail (bead oo5b F4): the chat surface passes its own failure key
		// into the shared openPackDocUuid helper (which lives in pack-resolve).
		expect(actions).toContain('"CHAT.OPEN_DOC_FAIL"');
		const resolve = readFileSync(
			"src/roguetrader/sheet/pack-resolve.ts",
			"utf8",
		);
		expect(resolve).toContain("openPackDocUuid");
		// All three surfaces delegate the BODY (no per-surface copies):
		expect(
			readFileSync(
				"src/roguetrader/sheet/actor/advancement-dialog.ts",
				"utf8",
			),
		).toContain("openPackDocUuid");
		expect(
			readFileSync("src/roguetrader/sheet/actor/character-creator.ts", "utf8"),
		).toContain("openPackDocUuid");
	});
});

// ---------------------------------------------------------------------------
// The degrade behaviour (pure part, no world needed)
// ---------------------------------------------------------------------------

describe("chatCardTitleDoc — the plain-text degradation (bead qg4z)", () => {
	test("an empty name resolves no link WITHOUT touching the pack caches", async () => {
		// No globals faked on purpose: this must work world-free (bun test).
		const titleDoc = await chatCardTitleDoc({
			prefix: "Tester — ",
			name: "",
			kind: "weapon",
		});
		expect(titleDoc.link).toBeNull();
		expect(titleDoc.name).toBe("");
		expect(titleDoc.prefix).toBe("Tester — ");
		expect(titleDoc.suffix).toBe("");
	});

	test("the titleDoc shape keeps the title segments the cards render", async () => {
		// A whitespace-ish name still skips the catalog fetch (empty trim).
		const titleDoc = await chatCardTitleDoc({
			prefix: "Atk → Target — ",
			name: "   ",
			kind: "psychicpower",
			suffix: " (Fettered)",
		});
		expect<ChatCardTitleDoc>(titleDoc).toEqual({
			prefix: "Atk → Target — ",
			name: "   ",
			suffix: " (Fettered)",
			link: null,
		});
	});

	test("the catalog mapping drops docs without a name or uuid (unresolvable rows)", () => {
		expect(
			toPackDocCatalog([
				{
					name: "Smite",
					type: "psychicpower",
					uuid: "Compendium.rogue-trader.character-options.Item.smiteId",
					system: { key: "smite" },
				},
				{ name: "No uuid in this pack doc" },
				{ uuid: "Compendium.rogue-trader.x.Item.y" },
			]).length,
		).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Resolution through the SAME pack caching (fake game.packs)
// ---------------------------------------------------------------------------

const originalGame = (globalThis as Record<string, unknown>).game;

function withFakePacks(packs: unknown): void {
	(globalThis as Record<string, unknown>).game = { packs };
}

afterAll(() => {
	(globalThis as Record<string, unknown>).game = originalGame;
});

describe("chatCardTitleDoc — catalog resolution through the pack caches (bead qg4z)", () => {
	test("a name matching a pack doc resolves the anchor {action, uuid, name}", async () => {
		withFakePacks({
			get: (id: string) =>
				id === "rogue-trader.character-options"
					? {
							getDocuments: async () => [
								{
									name: "Smite",
									type: "psychicpower",
									uuid:
										"Compendium.rogue-trader.character-options.Item.smiteId",
									system: { key: "smite" },
								},
							],
						}
					: undefined,
		});
		const titleDoc = await chatCardTitleDoc({
			prefix: "Tester — ",
			name: "Smite",
			kind: "psychicpower",
			suffix: " (Fettered)",
		});
		expect(titleDoc).toEqual({
			prefix: "Tester — ",
			name: "Smite",
			suffix: " (Fettered)",
			link: {
				action: "openPackDoc",
				uuid: "Compendium.rogue-trader.character-options.Item.smiteId",
				name: "Smite",
			},
		});
	});

	test("a name NOT in the pack degrades to a null link (plain text)", async () => {
		// The equipment pack is MISSING — the fetch degrades (loudly warned)
		// to an empty catalog, so a hand-made weapon never errors.
		withFakePacks({ get: () => undefined });
		const savedWarn = console.warn;
		console.warn = () => {
			// Intentionally silenced: the expected missing-pack warning is the
			// assert of the neighbours, not the noise of this test.
		};
		const titleDoc = await chatCardTitleDoc({
			prefix: "Tester — ",
			name: "Hand-Made Pipe",
			kind: "weapon",
		});
		console.warn = savedWarn;
		expect(titleDoc.link).toBeNull();
		expect(titleDoc.name).toBe("Hand-Made Pipe");
	});
});
/**
 * documentTypes guard (bead pwpu).
 *
 * `documentTypes` in the SHIPPED manifest tells Foundry which fields are HTML.
 * It had drifted badly in both directions:
 *   - 7 registered Item types were missing entirely (career, heirloom,
 *     madnessentry, mutation, navigatorpower, origin, origintrait), so their
 *     prose was not declared as HTML;
 *   - Actor was missing 4 of 7 (explorer, dynasty, starship, pc) — note
 *     `explorer` is THE character type;
 *   - `npc` declared "description" only, while the Character model's HTML
 *     fields are life.motivation/notes/description;
 *   - `talent` and `trait` declared no htmlFields at all despite having an
 *     HTML description;
 *   - `ship-component`/`ship-weapon-component` declared "special", which is
 *     NOT an HTMLField.
 * Root cause: bead 4nr5 wrote its declarations into the stale root
 * system.json; the shipped manifests were edited separately and diverged.
 *
 * So the assertions below are deliberately derived from the MODELS, not from
 * any manifest: the manifest has to agree with what is actually registered.
 * Reading system-manifests/dev.json (not the root duplicate) is the point —
 * that is the file utils/build.ts ships.
 *
 * Actor model specs live in ../test-helpers/registered-models.ts.
 */
import { describe, expect, test } from "bun:test";
import {
	ACTOR_MODELS,
	htmlFieldPaths,
	ITEM_MODELS,
	loadSchema,
} from "../../test-helpers/registered-models";

const MANIFESTS = [
	"system-manifests/dev.json",
	"system-manifests/rogue-trader-release.json",
	"system-manifests/rogue-trader-public.json",
];

const readManifest = async (
	relative: string,
): Promise<{ documentTypes: Record<string, Record<string, { htmlFields?: string[] }>> }> =>
	JSON.parse(
		await Bun.file(new URL(`../../../${relative}`, import.meta.url)).text(),
	);

const shipped = await readManifest("system-manifests/dev.json");

/** Declared htmlFields for a type, normalised (absent key === no HTML fields). */
function declared(
	section: Record<string, { htmlFields?: string[] }>,
	type: string,
): string[] {
	return [...(section[type]?.htmlFields ?? [])].sort();
}

describe("shipped documentTypes (bead pwpu)", () => {
	test("declares every registered Item type", () => {
		const missing = Object.keys(ITEM_MODELS).filter(
			(type) => !(type in shipped.documentTypes.Item),
		);
		expect(missing).toEqual([]);
	});

	test("declares every registered Actor type", () => {
		const missing = Object.keys(ACTOR_MODELS).filter(
			(type) => !(type in shipped.documentTypes.Actor),
		);
		expect(missing).toEqual([]);
	});

	test("declares nothing that is not registered", () => {
		const extraItems = Object.keys(shipped.documentTypes.Item).filter(
			(type) => !(type in ITEM_MODELS),
		);
		const extraActors = Object.keys(shipped.documentTypes.Actor).filter(
			(type) => !(type in ACTOR_MODELS),
		);
		expect(extraItems).toEqual([]);
		expect(extraActors).toEqual([]);
	});

	test("Item htmlFields match the models exactly", async () => {
		const mismatches: string[] = [];
		for (const [type, entry] of Object.entries(ITEM_MODELS)) {
			const expected = htmlFieldPaths(await loadSchema(entry)).sort();
			const actual = declared(shipped.documentTypes.Item, type);
			if (JSON.stringify(expected) !== JSON.stringify(actual)) {
				mismatches.push(
					`${type}: manifest=${JSON.stringify(actual)} model=${JSON.stringify(expected)}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});

	test("Actor htmlFields match the models exactly", async () => {
		const mismatches: string[] = [];
		for (const [type, entry] of Object.entries(ACTOR_MODELS)) {
			const expected = htmlFieldPaths(await loadSchema(entry)).sort();
			const actual = declared(shipped.documentTypes.Actor, type);
			if (JSON.stringify(expected) !== JSON.stringify(actual)) {
				mismatches.push(
					`${type}: manifest=${JSON.stringify(actual)} model=${JSON.stringify(expected)}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});

	test("the character HTML fields are the nested life.motivation path", () => {
		// Regression guard: the stale root manifest declared a bare
		// "motivation", which is not where the Character model stores it
		// (system.life.motivation), so the field was never treated as HTML.
		expect(declared(shipped.documentTypes.Actor, "explorer")).toContain(
			"life.motivation",
		);
		expect(declared(shipped.documentTypes.Actor, "explorer")).not.toContain(
			"motivation",
		);
	});

	test("the three manifests declare the same documentTypes", async () => {
		// They diverged once already (4nr5 edited one, other beads another).
		const blocks = await Promise.all(
			MANIFESTS.map(async (relative) =>
				JSON.stringify((await readManifest(relative)).documentTypes),
			),
		);
		for (let i = 1; i < blocks.length; i++) {
			expect(blocks[i], `${MANIFESTS[i]} matches ${MANIFESTS[0]}`).toBe(
				blocks[0],
			);
		}
	});
});

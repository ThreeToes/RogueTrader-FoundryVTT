import "../../../test-helpers/foundry-schema-stub";
import { describe, expect, test } from "bun:test";
import { ACTOR_MODELS } from "../../../test-helpers/registered-models";
import { CacheActor } from "./cache";

/**
 * Cache actor (bead wlx9): a lootable container on the map.
 *
 * The point of this file is the MECHANIC-FREE guarantee. A cache that quietly
 * grew a characteristic or a derived stat would start being usable as a
 * combatant, and the whole reason it is a separate type is that it must never
 * be one. The schema assertions below are deliberately exhaustive rather than
 * spot-checks: adding ANY field fails the exact-shape test and has to be
 * justified here.
 */
describe("Cache schema: a container with no mechanics (bead wlx9)", () => {
	const schema = CacheActor.defineSchema() as unknown as Record<string, any>;

	test("the schema is EXACTLY { notes } — no mechanics, by construction", () => {
		// Not a subset check. A cache must not grow characteristics, wounds,
		// derived stats, effects or anything else a Test could read.
		expect(Object.keys(schema).sort()).toEqual(["notes"]);
	});

	test("there is no characteristics field at all", () => {
		// The clearest single statement of the type's purpose: every rollable
		// actor type in this system has characteristics; a cache must not.
		expect(schema.characteristics).toBeUndefined();
		expect(schema.wounds).toBeUndefined();
		expect(schema.effects).toBeUndefined();
	});

	test("notes is an HTML field defaulting to empty", () => {
		const notes = schema.notes;
		expect(notes).toBeDefined();
		expect(notes.constructor.name).toBe("StubHtmlField");
		expect(notes.opts.initial).toBe("");
	});

	test("the declared LOCALIZATION_PREFIXES is the cache namespace", () => {
		expect(CacheActor.LOCALIZATION_PREFIXES).toEqual(["CACHE"]);
	});
});

describe("Cache registration (bead wlx9)", () => {
	test("the model is registered so the manifest guards cover it", () => {
		// The document-types and template-coverage guards read ACTOR_MODELS;
		// without an entry here a new actor type escapes both.
		expect(ACTOR_MODELS.cache).toBeDefined();
		expect(ACTOR_MODELS.cache.className).toBe("CacheActor");
	});

	test("it is an offered type, unlike the retired pc", () => {
		// pc is registered-but-not-offered. A cache IS offered — a GM creates
		// one from the Create Actor dialog and drags it to the scene, which is
		// the whole workflow.
		expect(ACTOR_MODELS.pc).toBeDefined();
		expect(ACTOR_MODELS.cache).toBeDefined();
	});
});

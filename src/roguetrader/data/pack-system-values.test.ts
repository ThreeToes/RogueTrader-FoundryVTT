/**
 * Pack-vs-schema VALIDATION guard (bead uugg, third bead of the pack-validation
 * set) — the permanent version of the headless sweep harness built during the
 * pack-wide sweep (bead 1e7h, its report documents the full findings list).
 *
 * WHY THIS GUARD EXISTS: every choice-constrained schema field (skill
 * characteristic, damage type, career tables, actor registries...) is enforced
 * by the data model ONLY at load time with an in-world console error. A pack
 * value outside the choice set — like 23 navigator powers storing
 * `characteristic: willpower` instead of `wp` (bead bmg5) — builds fine, passes
 * tests, and then spams validation errors the moment a player opens the
 * compendium in a live world. This test runs the same validation headless, so
 * the whole bug class fails `bun test` instead.
 *
 * WHAT IT VALIDATES: every pack folder in the private src/packs working copy
 * (the documented CI contract: the test SKIPS when src/packs is absent — same
 * as pack-schema.test.ts); each doc's type resolved the way the packer resolves
 * it (resolveEntryType / FOLDER_TYPE_DEFAULTS via sourceKey, actor packs via
 * toActorSourceDocument and the item source index); every AUTHORED system value
 * against the corresponding DataModel's declared schema via the
 * foundry-schema-stub field metadata.
 *
 * WHAT IT CATCHES: values outside a StringField's `choices` (which folds the
 * navigator-power characteristic guard from bead bmg5 into this one surface —
 * a long registry name is just a choice miss), blank values where blank is not
 * allowed, non-integer / below-min / above-max NumberField values
 * (`skill.ladder` max 3 is enforced here), type mismatches (number in a string
 * field, array in a single-value field...), nulls on non-nullable fields.
 *
 * The KNOWN_GAPS allowlist below is a WORK LIST, not an amnesty: the sweep's
 * ESCALATED violations are deliberately still in the data awaiting owner
 * decisions (they cannot be mechanically mapped without guessing at book
 * content). Each entry names the owner decision it awaits and cites the sweep
 * bead. The allowlist asserts its own size and per-key match counts, so both
 * fixing a gap (stale line) and introducing a NEW violation (unmatched
 * offender, or a different count behind an existing key) fail loudly.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { parseAllDocuments } from "yaml";
import {
	ACTOR_MODELS,
	ITEM_MODELS,
	loadSchema,
	type Schema,
} from "../../test-helpers/registered-models";
import {
	StubArrayField,
	StubHtmlField,
	StubSchemaField,
	StubTypedObjectField,
} from "../../test-helpers/foundry-schema-stub";

const PACK_ROOT = "src/packs/rogue_trader";
const HAS_PACKS = existsSync(PACK_ROOT);

interface Violation {
	/** The pack source file, `<pack>/<file>`, even for embedded items. */
	file: string;
	/** Display pack — as file, plus a `(embedded)` suffix on actor-embedded items. */
	pack: string;
	/** Resolved actor/item type (the way the packer resolves it). */
	type: string;
	/** Doc name (actor entries with embedded items: `actor — item`). */
	name: string;
	/** Field path relative to `system`. */
	field: string;
	value: unknown;
	problem: string;
	/** The field's valid choices, when it constrains them. */
	choices?: string;
}

/**
 * Known ESCALATED gaps (sweep bead 1e7h): data that violates the schema today
 * and is DELIBERATELY untouched pending an owner decision. Key
 * `<pack>/<file>::<type>::<field>`; `matches` is how many violations the gap
 * currently covers — a count check, so a NEW violation behind an existing key
 * fails too. Fixing an entry means fixing the data AND deleting its line here
 * (the guard then enforces it); a stale line fails the allowlist-rot test.
 */
const KNOWN_GAPS: Readonly<
	Record<string, { matches: number; reason: string }>
> = {
	// Core Rulebook Table 5-6 (printed p127) prints "—" for the missile class
	// (launcher ordnance, cannot be thrown); RangedWeapon.class is required
	// with choices basic|pistol|heavy|thrown and no blank. Needs a "—"
	// (or nullable) choice.
	"equipment/weapons.yaml::ranged-weapon::class": {
		matches: 2,
		reason: 'class "—" on Frag/Krak Missile — the book prints an em-dash there; awaiting owner decision on the ranged class field (sweep bead 1e7h, escalated item 2)',
	},
	// "Deceive (+30)" prints ladder 4 on the statblock, but ladder is
	// min 1 max 3 (Known/+10/+20). Downgrading the data is silent wrong data;
	// allowing 4 is a schema change.
	"npcs/npcs.yaml::skill::ladder": {
		matches: 1,
		reason: "Stryxis Merchant Deceive (+30) ladder 4 beyond max 3 — allow 4 vs data downgrade; awaiting owner decision (sweep bead 1e7h, escalated item 3)",
	},
};

const EXPECTED_KNOWN_GAPS = 2;

function packDirs(): string[] {
	return readdirSync(PACK_ROOT)
		.filter((d) => statSync(`${PACK_ROOT}/${d}`).isDirectory())
		.sort();
}

/** Every pack YAML file, as `<dir>/<file>` (flat, like the packer). */
function packFiles(): string[] {
	const out: string[] = [];
	for (const dir of packDirs()) {
		for (const file of readdirSync(`${PACK_ROOT}/${dir}`)) {
			if (file.endsWith(".yaml")) out.push(`${dir}/${file}`);
		}
	}
	return out.sort();
}

/**
 * Parse a pack YAML file. Multi-document files are real (aptitudes.yaml), so
 * this mirrors the packer's parseAllDocuments. Parse errors are returned
 * LOUDLY — a silently-skipped file would make the walk lie.
 */
function readEntries(
	file: string,
): { entries: Array<Record<string, unknown>>; errors: string[] } {
	const contents = readFileSync(`${PACK_ROOT}/${file}`, "utf8");
	const entries: Array<Record<string, unknown>> = [];
	const errors: string[] = [];
	for (const doc of parseAllDocuments(contents)) {
		if (doc.errors.length > 0) {
			errors.push(
				`${file}: ${doc.errors.map((e) => e.message.split("\n")[0]).join(" | ")}`,
			);
			continue;
		}
		const value = doc.toJSON();
		if (value == null) continue;
		entries.push(...(Array.isArray(value) ? value : [value]));
	}
	return { entries, errors };
}

function choiceSet(field: unknown): Set<string> | undefined {
	const opts = (field as { opts?: { choices?: unknown } }).opts ?? {};
	const raw = opts.choices;
	if (raw === undefined) return undefined;
	if (Array.isArray(raw)) return new Set(raw.map(String));
	return new Set(Object.keys(raw as Record<string, unknown>));
}

function validChoices(field: unknown): string | undefined {
	const opts = (field as { opts?: { choices?: unknown } }).opts ?? {};
	const raw = opts.choices;
	if (raw === undefined) return undefined;
	if (Array.isArray(raw)) return raw.map(String).join(" | ");
	return Object.keys(raw as Record<string, unknown>).join(" | ");
}

/**
 * Validate one authored value against one schema field, recursing the stub's
 * structural metadata (SchemaField subfields, ArrayField/TypedObjectField
 * `.of`, primitive opts). The rules mirror the harness the sweep ran (bead
 * 1e7h), which mirrors what Foundry's TypeDataModel.clean actually enforces.
 */
function checkField(
	field: unknown,
	value: unknown,
	path: string,
	violations: Violation[],
	probe: Pick<Violation, "file" | "pack" | "type" | "name">,
): void {
	// SchemaField: recurse into declared subfields (undeclared keys are the
	// OTHER guard's job — pack-schema.test.ts owns undeclared system keys).
	if (field instanceof StubSchemaField) {
		if (value == null || typeof value !== "object" || Array.isArray(value)) {
			violations.push({ ...probe, field: path, value, problem: "schema field expects an object" });
			return;
		}
		const declared = field.fields ?? {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (k in declared) {
				checkField(declared[k], v, path ? `${path}.${k}` : k, violations, probe);
			}
		}
		return;
	}
	// TypedObjectField (record of `.of`) — extends StubArrayField, check first.
	if (field instanceof StubTypedObjectField) {
		if (value === undefined) return;
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			violations.push({ ...probe, field: path, value, problem: "typed-object field expects a record" });
			return;
		}
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			checkField(field.of, v, path ? `${path}.${k}` : k, violations, probe);
		}
		return;
	}
	// ArrayField: validate each member against `.of`.
	if (field instanceof StubArrayField) {
		if (value === undefined) return;
		if (!Array.isArray(value)) {
			violations.push({ ...probe, field: path, value, problem: "array field expects an array" });
			return;
		}
		for (const [i, v] of value.entries()) {
			checkField(field.of, v, path ? `${path}.${i}` : String(i), violations, probe);
		}
		return;
	}
	// Primitive field (String/Number/Boolean/HTML) — only opts distinguish.
	const opts = ((field as { opts?: Record<string, unknown> }).opts ?? {}) as Record<string, unknown>;
	if (value === undefined || value === null) {
		if (value === null && opts.nullable === false) {
			violations.push({ ...probe, field: path, value, problem: "null but nullable: false" });
		}
		return;
	}
	const set = choiceSet(field);
	if (set) {
		const asStr = typeof value === "string" ? value : undefined;
		if (asStr === undefined) {
			violations.push({
				...probe, field: path, value, choices: validChoices(field),
				problem: "non-string value in a choices field",
			});
		} else if (asStr === "" && opts.blank !== true) {
			violations.push({
				...probe, field: path, value, choices: validChoices(field),
				problem: "blank value, choices set, blank not allowed",
			});
		} else if (asStr !== "" && !set.has(asStr)) {
			violations.push({
				...probe, field: path, value, choices: validChoices(field),
				problem: "value outside choices",
			});
		}
		return;
	}
	const numeric =
		opts.integer !== undefined ||
		opts.min !== undefined ||
		opts.max !== undefined ||
		typeof opts.initial === "number";
	if (numeric) {
		if (typeof value === "number") {
			if (opts.integer === true && !Number.isInteger(value)) {
				violations.push({ ...probe, field: path, value, problem: "non-integer in integer field" });
			}
			if (typeof opts.min === "number" && value < opts.min) {
				violations.push({ ...probe, field: path, value, problem: `below min ${String(opts.min)}` });
			}
			if (typeof opts.max === "number" && value > opts.max) {
				violations.push({ ...probe, field: path, value, problem: `above max ${String(opts.max)}` });
			}
			return;
		}
		// Foundry casts numeric strings (and "" -> 0) at clean.
		if (typeof value === "string" && (value === "" || Number.isFinite(Number(value)))) return;
		violations.push({ ...probe, field: path, value, problem: "non-numeric value in number field" });
		return;
	}
	if (typeof opts.initial === "boolean") {
		if (typeof value !== "boolean") {
			// Foundry casts boolean-shaped strings at clean.
			if (value === "true" || value === "false") return;
			violations.push({ ...probe, field: path, value, problem: "non-boolean value in boolean field" });
		}
		return;
	}
	// String / HTML field: must be a string.
	if (typeof value !== "string") {
		violations.push({
			...probe, field: path, value,
			problem: field instanceof StubHtmlField
				? "non-string value in HTML field"
				: "non-string value in string field",
		});
	}
}

describe.skipIf(!HAS_PACKS)("pack system values match their data model schema", () => {
	test("every choice-constrained (and numeric/typed) field value is valid", async () => {
		const {
			ACTOR_PACKS,
			JOURNAL_PACKS,
			TABLE_PACKS,
			buildItemSourceIndex,
			resolveEntryType,
			sourceKey,
			toActorSourceDocument,
		} = await import("../../../utils/compendia");

		// type -> declared schema, for every registered model.
		const schemas = new Map<string, Schema>();
		for (const [type, entry] of Object.entries({
			...ITEM_MODELS,
			...ACTOR_MODELS,
		})) {
			schemas.set(type, await loadSchema(entry));
		}

		const violations: Violation[] = [];
		const parseErrors: string[] = [];
		const noModelTypes = new Map<string, number>();
		let checkedDocs = 0;

		const walk = (
			system: Record<string, unknown>,
			type: string,
			file: string,
			name: string,
			displayPack: string,
		): void => {
			const pack = displayPack;
			const schema = schemas.get(type);
			if (!schema) {
				// Negative space must stay honest: every type the walk reaches has
				// to be a registered model (rolltables/journal packs are skipped
				// wholesale; anything else means a new pack folder needs a model or
				// an explicit decision — see FOLDER_TYPE_DEFAULTS).
				noModelTypes.set(type, (noModelTypes.get(type) ?? 0) + 1);
				return;
			}
			for (const [k, v] of Object.entries(system)) {
				const field = schema[k];
				if (field) {
					checkField(field, v, k, violations, { file, pack, type, name });
				}
			}
		};

		// Item source index: actor packs resolve embedded items through it.
		const dirs = packDirs().map((name) => ({ name }));
		const itemIndex = await buildItemSourceIndex(dirs);

		for (const rel of packFiles()) {
			const dir = rel.split("/")[0];
			// Foundry core doc types (RollTable, JournalEntry) — no RT model.
			if (TABLE_PACKS.has(dir) || JOURNAL_PACKS.has(dir)) continue;
			const { entries, errors } = readEntries(rel);
			parseErrors.push(...errors);
			if (ACTOR_PACKS.has(dir)) {
				for (const entry of entries) {
					checkedDocs++;
					const name = String(entry.name ?? "unnamed");
					const actorType =
						typeof entry.type === "string" && entry.type ? entry.type : "npc";
					try {
						const { actor, embedded } = toActorSourceDocument(entry, itemIndex, null);
						walk(actor.system as Record<string, unknown>, actorType, rel, name, rel);
						for (const item of embedded) {
							const itemType = String(item.type ?? "gear");
							walk(
								item.system as Record<string, unknown>,
								itemType,
								rel,
								`${name} — ${String(item.name ?? "")}`,
								`${rel} (embedded)`,
							);
						}
					} catch (error) {
						violations.push({
							file: rel, pack: rel, type: actorType, name, field: "(packer)", value: null,
							problem: `toActorSourceDocument threw: ${(error as Error).message.split("\n")[0]}`,
						});
					}
				}
				continue;
			}
			// Item packs: resolve the type exactly as toSourceDocument does.
			const stem = rel.split("/").at(-1)?.replace(/\.yaml$/, "") ?? "";
			for (const entry of entries) {
				checkedDocs++;
				const name = String(entry.name ?? "unnamed");
				const type = resolveEntryType(entry, sourceKey(stem));
				const system: Record<string, unknown> = {
					...((entry.system ?? {}) as Record<string, unknown>),
				};
				// Authoring sugar mirrored from toSourceDocument: the sheet reads
				// system.description, so a top-level description is nested there.
				if (!system.description && typeof entry.description === "string" && entry.description) {
					system.description = entry.description;
				}
				walk(system, type, rel, name, rel);
			}
		}

		// A collapse to near zero means the walk stopped finding entries — never
		// let the guard pass by accident.
		expect(checkedDocs).toBeGreaterThan(2000);
		expect(parseErrors).toEqual([]);

		// Fold in the bead-bmg5 navigator-power characteristic guard: a long
		// characteristic name is a choice miss, enforced here like any other.
		//
		// Allowlist handling: every gap key must match EXACTLY its declared
		// count, every violation must be covered, and the allowlist size is
		// asserted below. Removing a gap from the data (stale line) or adding a
		// new violation (in the wild, or behind an existing key) both fail.
		for (const [key, gap] of Object.entries(KNOWN_GAPS)) {
			const [rel, type, field] = key.split("::");
			const actual = violations.filter(
				(v) => v.file === rel && v.type === type && v.field === field,
			);
			expect(actual.length).toBe(gap.matches);
		}
		const uncovered = violations.filter((v) => !KNOWN_GAPS[`${v.file}::${v.type}::${v.field}`]);
		expect(Object.keys(KNOWN_GAPS).length).toBe(EXPECTED_KNOWN_GAPS);

		// Loud per-violation output for anything NOT allowlisted: pack, doc name,
		// field, value, valid choices. Only uncovered violations fail here — the
		// allowlisted ones fail their own per-key count check above.
		expect(
			uncovered.map(
				(v) =>
					`${v.pack} [${v.type}] ${v.name}: system.${v.field} = ${JSON.stringify(v.value)} — ${v.problem}${v.choices ? ` (valid: ${v.choices})` : ""}`,
			),
		).toEqual([]);

		expect(noModelTypes).toEqual(new Map());
	});

	test("the gaps allowlist only references real files, models and fields", () => {
		// A typo'd key would silently allow nothing while looking like cover.
		const files = new Set(packFiles());
		const bogus: string[] = [];
		for (const key of Object.keys(KNOWN_GAPS)) {
			const [rel, type] = key.split("::");
			if (!files.has(rel)) bogus.push(key);
			else if (!ITEM_MODELS[type] && !ACTOR_MODELS[type]) bogus.push(key);
		}
		expect(bogus).toEqual([]);
	});

	test("the gaps allowlist is the documented size", () => {
		// Removing a gap line (owner decision landed, data fixed) must come with
		// updating this count — so the allowlist cannot quietly shrink.
		expect(Object.keys(KNOWN_GAPS).length).toBe(EXPECTED_KNOWN_GAPS);
	});
});
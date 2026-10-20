/**
 * Shared minimal `foundry` global stub for bun tests that inspect pure
 * DataModel schemas. IMPORTANT: install exactly once and use structural
 * assertions in tests (never `instanceof`, since different test files import
 * different copies of this module).
 */
export class StubField {
	opts: Record<string, unknown>;
	constructor(opts: Record<string, unknown> = {}) {
		this.opts = opts;
	}
}
export class StubSchemaField extends StubField {
	readonly fields: Record<string, unknown>;
	constructor(
		fields: Record<string, unknown>,
	opts?: Record<string, unknown>,
	) {
		super(opts);
		this.fields = types(fields);
	}
}
/**
 * HTMLField marker. A distinct class so tests can tell an HTMLField from a
 * StringField (the stub otherwise collapses every primitive to StubField).
 * Subclasses StubField, so existing `toBeInstanceOf(StubField)` assertions
 * keep working.
 */
export class StubHtmlField extends StubField {}
export class StubArrayField extends StubField {
	readonly of: unknown;
	constructor(of: unknown, opts?: Record<string, unknown>) {
		super(opts);
		this.of = of;
	}
}
export class StubTypedObjectField extends StubArrayField {}

function types(fields: Record<string, unknown>): Record<string, unknown> {
	return fields;
}

const globalRef = globalThis as Record<string, unknown>;

/** The minimal schema-stub foundry global, exported so suites that REPLACE
 * the global during their own tests can restore THIS guaranteed-valid floor
 * instead of deleting foundry: a deleted global poisons every later suite in
 * the same process whose module-level stub import is already cached (the
 * packless-CI failure class, 2026-10-20). */
export const MINIMAL_FOUNDRY = {
	abstract: { TypeDataModel: class {} },
	data: {
		fields: {
			SchemaField: StubSchemaField,
			TypedObjectField: StubTypedObjectField,
			ArrayField: StubArrayField,
			NumberField: StubField,
			StringField: StubField,
			BooleanField: StubField,
			HTMLField: StubHtmlField,
		},
	},
	// The floor carries applications too: presentation modules (test-dialog.ts
	// and friends) read foundry.applications.api at MODULE SCOPE, and a suite
	// that imports them before a rich stub is installed needs at least a
	// non-crashing floor in the shared cache (the packless-CI class).
	applications: {
		api: {
			ApplicationV2: class {},
			HandlebarsApplicationMixin: (base: unknown) => base,
		},
		sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} },
	},
};

/** Install the minimal stub when (and only when) the global is absent —
 * re-callable, so a suite whose afterAll restored nothing (another suite
 * deleted the global) can still guarantee a valid foundry before imports. */
export function ensureFoundrySchemaStub(): void {
	globalRef.foundry ??= MINIMAL_FOUNDRY;
}

ensureFoundrySchemaStub();

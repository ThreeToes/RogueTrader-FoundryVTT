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
	constructor(fields: Record<string, unknown>) {
		super();
		this.fields = types(fields);
	}
}
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
globalRef.foundry ??= {
	abstract: { TypeDataModel: class {} },
	data: {
		fields: {
			SchemaField: StubSchemaField,
			TypedObjectField: StubTypedObjectField,
			ArrayField: StubArrayField,
			NumberField: StubField,
			StringField: StubField,
			BooleanField: StubField,
			HTMLField: StubField,
		},
	},
};

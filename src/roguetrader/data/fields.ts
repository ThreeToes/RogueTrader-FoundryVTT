/**
 * Shared DataModel field factories (bead nw3m).
 *
 * An empty-initial `foundry.data.fields.StringField` is the system's most
 * common field; naming it keeps schema declarations readable as field names
 * rather than field constructors.
 */

/** A string field defaulting to the empty string. */
export function textField(initial = "") {
	return new foundry.data.fields.StringField({ initial });
}
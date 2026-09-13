/**
 * Planet-generation draw helpers (owner ask, planet creator): pure and
 * testable — lives outside sheet/actor/planet-creator.ts so bun tests can
 * import it without loading a foundry-extended module (ship-crew idiom).
 *
 * The gametables pack's `game-table` rows carry book roll expressions as
 * authored strings. Those expressions come in several shapes, all seen in
 * the SOI tables:
 *   - simple ranges: "1", "2-3 (Rocky)", "8-9"
 *   - percentile ranges with leading zeros and 00=100: "01-20", "86-00"
 *   - open-ended bounds: "2 or lower", "9+", "45 or lower",
 *     "10 or higher", "91 or more"
 * Single-row reference tables (Number of Territories, Inhabitants) instead
 * carry their roll map in prose ("1 Eldar, 2-4 Humans, ...") — parsed by
 * parseRollMap so a die draw can resolve to a labelled sub-result.
 */

/**
 * Match a numeric die result against a row's roll expression. Handles the
 * open-ended bound forms the SOI tables print ("2 or lower", "9+",
 * "10 or higher", "45 or lower", "91 or more"), percentile ranges where the
 * upper bound "00" means 100 ("86-00"), and plain single/range values.
 * Rows whose roll is not a roll expression at all ("—", "Success", species
 * keys like "Eldar") never match a numeric draw.
 */
export function rollMatchesRange(roll: string, result: number): boolean {
	const text = roll.trim();
	let m = /^(\d+)\s*or\s+(?:lower|less)/i.exec(text);
	if (m) return result <= Number(m[1]);
	m = /^(?:[-+]?\d+\s*[-–]\s*)?(\d+)\s*or\s+(?:higher|more|above)/i.exec(text);
	if (m) return result >= Number(m[1]);
	m = /^(\d+)\s*\+/.exec(text);
	if (m) return result >= Number(m[1]);
	m = /^(\d+)\s*-\s*(\d+)/.exec(text);
	if (m) {
		const low = Number(m[1]);
		// Percentile convention: an upper bound of "00" is 100.
		const high = m[2] === "00" ? 100 : Number(m[2]);
		return result >= low && result <= high;
	}
	m = /^(\d+)/.exec(text);
	if (m) return result === Number(m[1]);
	return false;
}

/** One parsed entry of a prose roll map ("2-4 Humans"). */
export interface RollMapEntry {
	low: number;
	high: number;
	label: string;
}

/**
 * Parse a prose roll map — the comma-separated "range label" form the
 * single-row reference tables use ("1 Eldar, 2-4 Humans, 5 Kroot†,
 * 6-7 Orks†, 8 Rak'Gol, 9-10 Xenos (Other)"). Dagger/footnote marks are
 * stripped from labels; entries without a numeric range make the whole map
 * unparseable (null) — the caller falls back to attaching the row for the
 * GM to read.
 */
export function parseRollMap(
	text: string,
): Array<{ low: number; high: number; label: string }> | null {
	const entries: Array<{ low: number; high: number; label: string }> = [];
	for (const part of text.split(/[,;]\s*/)) {
		const entry = part.trim().replace(/\.\s*$/, "");
		if (!entry) continue;
		// Ellipsis-compressed prose ("1 Advanced Industry … 10 Voidfarers")
		// is not a resolvable roll map — bail loudly.
		if (entry.includes("…")) return null;
		const m = /^(\d+)\s*(?:-\s*(\d+))?\s+(.+)$/.exec(entry);
		if (!m) return null;
		const low = Number(m[1]);
		const high = m[2] ? (m[2] === "00" ? 100 : Number(m[2])) : low;
		const label = m[3]
			.replace(/[†*]/g, "")
			.trim();
		if (!label) return null;
		entries.push({ low, high, label });
	}
	return entries.length > 0 ? entries : null;
}

/** Resolve a parsed roll map to the label for a die result. */
export function matchRollMap(
	map: Array<{ low: number; high: number; label: string }> | null,
	result: number,
): string | null {
	if (!map) return null;
	const hit = map.find((e) => result >= e.low && result <= e.high);
	return hit ? hit.label : null;
}

/** Strip the "<Table> — " prefix from a pack row name for profile stamps. */
export function resultLabelFromRow(name: string): string {
	return name.includes("—") ? name.slice(name.indexOf("—") + 1).trim() : name;
}
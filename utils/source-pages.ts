/**
 * Source-page matching for the pack extraction tooling (bead 9d0l).
 *
 * The layout dumps render a book entry in one of two ways, and WHICH way
 * depends on the pack, not on the entry:
 *
 *   TABLE-DRIVEN packs (weapons, gear, armour, drugs, tools, cybernetics)
 *     the entry IS a stat row — "Autogun  100m  S/3/–  1d10+3  …". Its cite
 *     must be the page that row is printed on.
 *   PROSE-DRIVEN packs (talents, skills, careers, psychic powers, mutations,
 *     ships) the entry is a section whose heading carries its name, and the
 *     heading IS the correct cite.
 *
 * The matcher used to run a single pass order with the "standalone heading
 * line" pass FIRST, which is right for prose and wrong for tables: for a
 * weapon that has both a prose mention and a stat row, the heading's page won.
 * That is the bug behind bead nn96 — Autogun cited its heading page 120 when
 * its stat row is printed on 118. Bead 9d0l is about making the fix durable,
 * so the ordering below is explicit and pinned by tests rather than implied by
 * the sequence of loops in a script.
 *
 * Page indexing follows the dumps: `pages[filePage]` holds the lines of file
 * page `filePage`, and every book in this project is file = printed + 1
 * (verified from page footers). Callers pass a 1-based array; this module
 * returns a PRINTED page, i.e. `filePage - 1`.
 */

/** Which pass order to use — decided by the pack's shape, never per entry. */
export type PageMode = "table" | "prose";

/** The individual matching strategies. */
export type PagePass = "heading" | "row" | "clipped" | "cell";

/**
 * Pass order per mode. This table IS the fix for bead 9d0l, so it is data
 * rather than the sequence of loops it used to be.
 *
 * `prose` is the historical order, unchanged: for a prose entry the heading is
 * the cite, so it is tried first.
 *
 * `table` moves `heading` to LAST. The heading pass matches a line that is
 * exactly the name, which in a table-driven pack is either a stray prose
 * mention or a wrapped table cell — never the stat row the cite should point
 * at. The other three passes are table-row shapes and are tried first; their
 * relative order is unchanged.
 */
export const PASS_ORDER: Readonly<Record<PageMode, readonly PagePass[]>> = {
	table: ["row", "clipped", "cell", "heading"],
	prose: ["heading", "row", "clipped", "cell"],
};

/** Lines of one file page; index 0 of the pages array is unused. */
export type PageLines = readonly string[];

/**
 * Case/punctuation-insensitive comparison form, as the dumps render text.
 *
 * The apostrophe rule is a real dump quirk, not tidiness: the layout dumps
 * drop the apostrophe and leave the space behind, so the book's
 * "Officer's Cutlass" is dumped as "Officer s Cutlass". Mapping `'` to a
 * space on BOTH sides makes those agree while leaving every other match
 * unchanged (it is applied symmetrically, so "Belasco's" still matches
 * "Belasco's" — both normalise to "belasco s").
 */
export function normalise(s: string): string {
	return s
		.toLowerCase()
		.replace(/[\u2019’]/g, "'")
		.replace(/'/g, " ")
		.replace(/[†*]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Cell match: the name sits between column gaps (3+ spaces) or line
 * boundaries — how the armoury/drugs/critical tables render in the dump.
 */
export function isCellMatch(line: string, target: string): boolean {
	const t = normalise(line);
	const at = t.indexOf(target);
	if (at < 0) return false;
	const before = at === 0 ? " " : t[at - 1];
	const after = t[at + target.length] ?? " ";
	const afterOk =
		after === " " || after === undefined || !/[a-zà-ÿ0-9]/i.test(after);
	return (before === " " || at === 0) && afterOk;
}

/**
 * Wrapped-cell match: the name wraps across two dump lines inside a cell
 * ("Heavy Stubber" / "(Orthlack)"). Tests the line joined with the next.
 */
export function isWrappedCellMatch(
	lines: PageLines,
	i: number,
	target: string,
): boolean {
	if (i + 1 >= lines.length) return false;
	const joined = normalise(`${lines[i]} ${lines[i + 1]}`);
	const at = joined.indexOf(target);
	if (at < 0) return false;
	const before = at === 0 ? " " : joined[at - 1];
	const after = joined[at + target.length] ?? " ";
	const afterOk =
		after === " " || after === undefined || !/[a-zà-ÿ0-9]/i.test(after);
	return (before === " " || at === 0) && afterOk;
}

/**
 * Career advance tables list talents/skills as "<name>  <xp> Talent|Skill"
 * rows — never the entry's own page. Such a line must not satisfy the `row`
 * pass, or every talent cite would land on its career table.
 */
export function isAdvanceRow(t: string): boolean {
	return /\s\d+\s(talent|skill)\s*$/i.test(t) || /\s(talent|skill)\s*$/i.test(t);
}

export interface FindPageOptions {
	/** Section floor: the printed page the pack's section starts on. */
	minPage?: number;
	/** Pack shape; defaults to the historical (prose-first) behaviour. */
	mode?: PageMode;
}

/**
 * First printed page where `name` appears, using the pass order for `mode`.
 * Returns null when nothing matches — callers report that loudly rather than
 * falling back to a guess.
 */
export function findPage(
	pages: readonly PageLines[],
	name: string,
	opts: FindPageOptions = {},
): number | null {
	const target = normalise(name);
	if (target.length < 3) return null;
	const minPage = opts.minPage ?? 1;
	const order = PASS_ORDER[opts.mode ?? "prose"];

	// File page N == printed page N-1; only pages at or after the section
	// floor are considered.
	const rows: Array<{ idx: number; lines: PageLines }> = [];
	for (let idx = 1; idx < pages.length; idx++) {
		const lines = pages[idx] ?? [];
		if (lines.length === 0 || idx < minPage) continue;
		rows.push({ idx, lines });
	}

	for (const pass of order) {
		for (const { idx, lines } of rows) {
			switch (pass) {
				case "heading": {
					for (const line of lines) {
						if (normalise(line) === target) return idx - 1;
					}
					break;
				}
				case "row": {
					for (const line of lines) {
						const t = normalise(line);
						if (isAdvanceRow(t)) continue;
						if (
							t.length > target.length &&
							t.startsWith(target) &&
							t[target.length] === " "
						) {
							return idx - 1;
						}
						if (t.startsWith(`${target}:`)) return idx - 1;
					}
					break;
				}
				case "clipped": {
					// The dump truncated the name inside its cell
					// ("Furious Assa").
					for (const line of lines) {
						const t = normalise(line);
						if (
							t.length >= 8 &&
							target.length > t.length &&
							target.startsWith(t) &&
							t[t.length - 1] !== " "
						) {
							return idx - 1;
						}
					}
					break;
				}
				case "cell": {
					for (let i = 0; i < lines.length; i++) {
						if (isCellMatch(lines[i], target)) return idx - 1;
						if (isWrappedCellMatch(lines, i, target)) return idx - 1;
					}
					break;
				}
			}
		}
	}
	return null;
}

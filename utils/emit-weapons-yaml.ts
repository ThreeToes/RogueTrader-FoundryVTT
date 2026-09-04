#!/usr/bin/env bun
/**
 * Emit the weapons pack YAML from parse-table JSON output, in SCHEMA SHAPE for
 * the Weapon/RangedWeapon/MeleeWeapon data models:
 *
 *   - class: registry key (pistol/basic/heavy/thrown/melee)
 *   - range: string ("90", "SBx3", "—")          [Weapon.range StringField]
 *   - rateOfFire: { singleShot, burst, fullAuto } [from "S/3/10" book notation]
 *   - reload: book notation ("2 Full", "Half", "—") [RangedWeapon.reload string]
 *   - special: array of registry quality keys     [Weapon.special ArrayField]
 *     - book display names mapped via QUALITY_KEY_MAP; UNMAPPED VALUES THROW
 *     - parameterised Blast -> "blast-N" (allowed: element field has no
 *       `choices` constraint; blast radius parsing is future work)
 *   - clip: number; grenade rows omit clip/reload; melee rows omit all three
 *
 * Input is the parse-table JSON (machine-local, .extraction-src by default);
 * output is the committed pack authoring YAML.
 *
 * Usage:
 *   bun utils/emit-weapons-yaml.ts
 *   bun utils/emit-weapons-yaml.ts --in parsed.json --out ../packs/weapons/weapons.yaml
 */
import { readFileSync } from "node:fs";
import yaml from "yaml";

/** Book quality display name -> QUALITIES registry key. */
const QUALITY_KEY_MAP: Record<string, string> = {
	"Accurate": "accurate",
	"Balanced": "balanced",
	"Burning": "burning",
	"Defensive": "defensive",
	"Flexible": "flexible",
	"Flame": "flame",
	"Inaccurate": "inaccurate",
	"Overheat": "overheats",
	"Power Field": "powerField",
	"Primitive": "primitive",
	"Recharge": "recharge",
	"Reliable": "reliable",
	"Scatter": "scatter",
	"Shocking": "shocking",
	"Smoke": "smoke",
	"Snare": "snare",
	"Storm": "storm",
	"Tearing": "tearing",
	"Toxic": "toxic",
	"Unbalanced": "unbalanced",
	"Unreliable": "unreliable",
	"Unwieldy": "unwieldy",
};

/** Book notation "S/3/10" -> schema rateOfFire record. */
export function parseRateOfFire(rof: string): {
	singleShot: boolean;
	burst: number;
	fullAuto: number;
} {
	const [single, burst, fullAuto] = rof.split("/");
	return {
		singleShot: single.trim() === "S",
		burst: /^\d+$/.test((burst ?? "").trim()) ? Number(burst) : 0,
		fullAuto: /^\d+$/.test((fullAuto ?? "").trim()) ? Number(fullAuto) : 0,
	};
}

/** "Accurate, Blast (3), Toxic††" -> ["accurate", "blast-3", "toxic"]. */
export function parseQualities(special: string): string[] {
	if (!special || special === "—") return [];
	const out: string[] = [];
	for (const raw of special.split(/,\s*/)) {
		const name = raw.replace(/†+$/, "").trim();
		if (!name || name === "—" || name.startsWith("Varies with ammunition")) continue;
		const blast = name.match(/^Blast \((\d+)\)$/);
		if (blast) {
			out.push(`blast-${blast[1]}`);
			continue;
		}
		const key = QUALITY_KEY_MAP[name];
		if (!key) {
			throw new Error(`unmapped weapon quality "${name}" (add it to QUALITY_KEY_MAP or the registry)`);
		}
		out.push(key);
	}
	return out;
}

const LAUNCHER_NOTE =
	"Damage and special qualities vary with the grenade or missile loaded (see Table 5-6).";

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	const inArg = argv.includes("--in")
		? argv[argv.indexOf("--in") + 1]
		: "src/packs/.extraction-src/weapons2-parsed.json";
	const outArg = argv.includes("--out")
		? argv[argv.indexOf("--out") + 1]
		: "src/packs/weapons/weapons.yaml";

	const parsed = JSON.parse(readFileSync(inArg, "utf8")) as Array<
		Record<string, string>
	>;

	const docs = parsed.map((r) => {
		const special = parseQualities(r.special);
		const isLauncher = r.special.startsWith("Varies with ammunition");
		const system: Record<string, unknown> = {
			class: r.class,
			range: r.range,
			damage: r.damage,
			damageType: r.damageType,
			penetration: Number(r.pen || 0),
			weight: r.kg,
			availability: r.avail,
			special,
		};
		if (r.kind === "ranged") {
			system.rateOfFire = parseRateOfFire(r.rof);
			if (r.clip && r.clip !== "0") system.clip = Number(r.clip);
			system.reload = r.rld || "—";
		} else if (r.kind === "grenade") {
			// Grenade table has RoF but no Clip/Rld columns.
			system.rateOfFire = parseRateOfFire(r.rof);
		}
		if (isLauncher) {
			return { name: r.name, type: "Item", description: LAUNCHER_NOTE, system };
		}
		return { name: r.name, type: "Item", system };
	});

	const out = yaml.stringify(docs).replace(/^-\s+name:/gm, "- name:");
	await Bun.write(outArg, out);
	console.log(`[emit] ${docs.length} weapons -> ${outArg}`);
}

if (import.meta.main) await main();
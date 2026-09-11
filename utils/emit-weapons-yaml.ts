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
import {
	DamageType,
	normaliseDamageType,
} from "../src/roguetrader/data/item/damage-types";

/** Book quality display name -> QUALITIES registry key. */
const QUALITY_KEY_MAP: Record<string, string> = {
	Accurate: "accurate",
	Balanced: "balanced",
	Burning: "burning",
	Defensive: "defensive",
	Flexible: "flexible",
	Flame: "flame",
	Inaccurate: "inaccurate",
	Overheat: "overheats",
	"Power Field": "powerField",
	Primitive: "primitive",
	Recharge: "recharge",
	Reliable: "reliable",
	Scatter: "scatter",
	Shocking: "shocking",
	Smoke: "smoke",
	Snare: "snare",
	Storm: "storm",
	Tearing: "tearing",
	Toxic: "toxic",
	Unbalanced: "unbalanced",
	Unreliable: "unreliable",
	Unwieldy: "unwieldy",
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
		if (!name || name === "—" || name.startsWith("Varies with ammunition"))
			continue;
		const blast = name.match(/^Blast \((\d+)\)$/);
		if (blast) {
			out.push(`blast-${blast[1]}`);
			continue;
		}
		const key = QUALITY_KEY_MAP[name];
		if (!key) {
			throw new Error(
				`unmapped weapon quality "${name}" (add it to QUALITY_KEY_MAP or the registry)`,
			);
		}
		out.push(key);
	}
	return out;
}

const LAUNCHER_NOTE =
	"Damage and special qualities vary with the grenade or missile loaded (see Table 5-6).";

/**
 * Weapon family per row (bead erzk): derived from the book's Table 5-3/5-4
 * family section headings (Las Weapons, Solid Projectile Weapons, ...) and
 * Table 5-6 (Grenades and Missiles). Exotic = the Exotic sections (p129).
 * Any row whose name is unmapped is a LOUD failure — add the name here
 * (and to the committed pack) rather than guessing.
 */
const WEAPON_FAMILY_MAP: Record<string, string> = {
	// Table 5-4 — Las Weapons
	"Archeotech Laspistol": "las",
	"Belasco Dueling Pistol": "las",
	"Hellpistol (Lucius)": "las",
	"Hellgun (Lucius)": "las",
	"Las Gauntlets": "las",
	"Lascarbine (Locke)": "las",
	Lasgun: "las",
	Laspistol: "las",
	"Long-las": "las",
	"Man Portable Lascannon": "las",
	// Table 5-4 — Solid Projectile Weapons
	Autogun: "sp",
	Autopistol: "sp",
	"Hand Cannon": "sp",
	"Heavy Stubber (Orthlack)": "sp",
	"Heavy Stubber (Ursid)": "sp",
	"Naval Pistol (Mars)": "sp",
	"Naval Shotcannon": "sp",
	"Pump-Action Shotgun": "sp",
	Shotgun: "sp",
	"Shotgun Pistol": "sp",
	"Stub Automatic": "sp",
	"Stub Revolver": "sp",
	// Table 5-4 — Bolt Weapons
	"Boltgun (Locke)": "bolt",
	"Bolt Pistol (Ceres)": "bolt",
	"Storm Bolter (Mars)": "bolt",
	"Heavy Bolter (Solar)": "bolt",
	// Table 5-4 — Melta Weapons
	"Inferno Pistol (Mars)": "melta",
	"Meltagun (Mars)": "melta",
	"Meltagun (Mezoa)": "melta",
	"Thermal Lance (Mars)": "melta",
	"Multi-Melta (Mars)": "melta",
	// Table 5-4 — Plasma Weapons
	"Plasma Pistol (Ryza)": "plasma",
	"Plasma Gun (Mezoa)": "plasma",
	"Plasma Cannon (Ryza)": "plasma",
	// Table 5-4 — Flame Weapons
	"Hand Flamer (Mezoa)": "flame",
	"Flamer (Mezoa)": "flame",
	"Heavy Flamer (Locke)": "flame",
	// Table 5-4 — Low-Tech (Primitive) Weapons + Primitive melee section
	Bolas: "primitive",
	Bow: "primitive",
	Crossbow: "primitive",
	"Hand Bow": "primitive",
	"Flintlock Pistol": "primitive",
	Musket: "primitive",
	Sling: "primitive",
	"Ork Choppa": "primitive",
	"Great Weapon": "primitive",
	Groxwhip: "primitive",
	Improvised: "primitive",
	Knife: "primitive",
	"Kraken Tooth Dagger": "primitive",
	"Shield†††": "primitive",
	Spear: "primitive",
	Staff: "primitive",
	Sword: "primitive",
	Truncheon: "primitive",
	Warhammer: "primitive",
	// Table 5-4 — Launchers
	"Grenade Launcher (Mezoa)": "launcher",
	"Grenade Launcher (Voss)": "launcher",
	"Missile Launcher (Locke)": "launcher",
	// Table 5-6 — Grenades and Missiles
	"Anti-Plant": "thrown",
	Blind: "thrown",
	Filament: "thrown",
	Frag: "thrown",
	"Frag Missile": "launcher",
	Geode: "thrown",
	Hallucinogen: "thrown",
	Krak: "thrown",
	"Krak Missile": "launcher",
	"Photon Flash": "thrown",
	Plasma: "thrown",
	Smoke: "thrown",
	Stun: "thrown",
	Virus: "thrown",
	// Exotic sections (ranged p129, melee p132)
	"Crux Beam Gun": "exotic",
	Dartcaster: "exotic",
	"Digi-laser": "exotic",
	"Digi-melta": "exotic",
	"Digi-needler": "exotic",
	"Digi-flame": "exotic",
	"Graviton Gun": "exotic",
	"Kroot Rifle": "exotic",
	"Kroot Rifle (Melee)": "exotic",
	"Needle Pistol": "exotic",
	"Needle Rifl": "exotic",
	"Ork Shoota": "exotic",
	"Ork Slugga": "exotic",
	"Shuriken Catapult": "exotic",
	"Shuriken Pistol": "exotic",
	"Chain Axe": "chain",
	"Chainsword (Hecate)": "chain",
	"Omnissian Axe (Sollex)": "power",
	"Power Axe (Mezoa)": "power",
	"Power Fist (Mezoa)": "power",
	"Power Maul (High)": "power",
	"Power Maul (Low)": "power",
	"Power Sword (Mordian)": "power",
	"Fractal Blade": "power",
	"Ghost Sword": "power",
	"Harlequin’s Kiss": "exotic",
	"Officer's Cutlass": "shock",
	"Shock Glove": "shock",
	"Shock-Staff": "shock",
};

/**
 * Prose block name -> weapon row names (book prose vs table row names don't
 * always line up: pattern names, family prose, section headers). Rows not
 * covered here get no description; prose blocks not mapped are skipped.
 */
const PROSE_ROW_MAP: Record<string, string[]> = {
	"Belasco Dueling Pistol": ["Belasco Dueling Pistol"],
	"(Lucius-pattern)": ["Hellpistol (Lucius)", "Hellgun (Lucius)"],
	"Hellpistol & Hellgun (Lucius-pattern)": [
		"Hellpistol (Lucius)",
		"Hellgun (Lucius)",
	],
	"Damage Lasgun": ["Lasgun"],
	"Lascarbine (Locke-pattern)": ["Lascarbine (Locke)"],
	"Las Gauntlets": ["Las Gauntlets"],
	"Long-las": ["Long-las"],
	"Man Portable Lascannon": ["Man Portable Lascannon"],
	Autogun: ["Autogun"],
	"Naval Pistol (Mars-pattern)": ["Naval Pistol (Mars)"],
	"Naval Shotcannon": ["Naval Shotcannon"],
	"Shotgun (Pump-Action)": ["Pump-Action Shotgun"],
	Shotgun: ["Shotgun"],
	"Shotgun Pistol": ["Shotgun Pistol"],
	"Boltgun (Locke-pattern)": ["Boltgun (Locke)"],
	"Storm Bolter (Mars-pattern)": ["Storm Bolter (Mars)"],
	"Heavy Bolter (Solar-pattern)": ["Heavy Bolter (Solar)"],
	Meltagun: ["Meltagun (Mars)", "Meltagun (Mezoa)"],
	"Multi-Melta (Mars-pattern)": ["Multi-Melta (Mars)"],
	"Thermal Lance (Mars-pattern)": ["Thermal Lance (Mars)"],
	"Plasma Pistol (Ryza-": ["Plasma Pistol (Ryza)"],
	"Plasma Gun (Mezoa-pattern)": ["Plasma Gun (Mezoa)"],
	"Plasma Cannon (Ryza-pattern)": ["Plasma Cannon (Ryza)"],
	"Hand Flamer (Mezoa-pattern)": ["Hand Flamer (Mezoa)"],
	"Flamer (Mezoa-Pattern)": ["Flamer (Mezoa)"],
	"Heavy Flamer": ["Heavy Flamer (Locke)"],
	Bolas: ["Bolas"],
	Bow: ["Bow"],
	Crossbow: ["Crossbow"],
	"Hand Bow": ["Hand Bow"],
	"Flintlock Pistol": ["Flintlock Pistol"],
	Musket: ["Musket"],
	Sling: ["Sling"],
	"Grenade Launcher": ["Grenade Launcher (Mezoa)", "Grenade Launcher (Voss)"],
	"Missile Launcher": ["Missile Launcher (Locke)", "Missile Launcher (Retobi)"],
	Plasma: ["Plasma"],
	Smoke: ["Smoke"],
	Stun: ["Stun"],
	Virus: ["Virus"],
	"Graviton Gun": ["Graviton Gun"],
	"Kroot Rifle": ["Kroot Rifle", "Kroot Rifle (Melee)"],
	"Ork Shoota": ["Ork Shoota"],
	"Shuriken Catapult": ["Shuriken Catapult", "Shuriken Pistol"],
	Chainsword: ["Chainsword (Hecate)"],
	Chainaxe: ["Chain Axe"],
	"Power Fist (Mezoa-pattern)": ["Power Fist (Mezoa)"],
	"Power Sword (Mordian-pattern)": ["Power Sword (Mordian)"],
	"Power Maul": ["Power Maul (High)", "Power Maul (Low)"],
	"Omnissian Axe (Sollex-": ["Omnissian Axe (Sollex)"],
	"Fractal Blade": ["Fractal Blade"],
	"Ghost Sword": ["Ghost Sword"],
	"Fractal Blade Ghost Sword Harlequin’s Kiss Ork Choppa": ["Harlequin’s Kiss"],
	Groxwhip: ["Groxwhip"],
	Improvised: ["Improvised"],
	"Officer’s Cutlass": ["Officer's Cutlass"],
	"Shock Glove": ["Shock Glove"],
	"Shock-Staff": ["Shock-Staff"],
	"Great Weapon": ["Great Weapon"],
	Knife: ["Knife"],
	"Laspistol (Archeotech)": ["Archeotech Laspistol"],
	Autopistol: ["Autopistol"],
	"Hand Cannon": ["Hand Cannon"],
	"Stub Automatic": ["Stub Automatic"],
	"Stub Revolver": ["Stub Revolver"],
	"Heavy Stubber": ["Heavy Stubber (Orthlack)", "Heavy Stubber (Ursid)"],
	"Bolt Pistol": ["Bolt Pistol (Ceres)"],
	"Inferno Pistol": ["Inferno Pistol (Mars)"],
	"Ork Slugga": ["Ork Slugga"],
	"Power Axe": ["Power Axe (Mezoa)"],
	Blind: ["Blind"],
	Frag: ["Frag", "Frag Missile"],
	Krak: ["Krak", "Krak Missile"],
	Geode: ["Geode"],
	"Photon Flash": ["Photon Flash"],
	"Anti-Plant": ["Anti-Plant"],
	"Xeno Filament": ["Filament"],
	"Basic Hand Weapons": [
		"Shield†††",
		"Spear",
		"Staff",
		"Sword",
		"Truncheon",
		"Warhammer",
	],
	"Crux Beam Gun": ["Crux Beam Gun"],
	Dartcaster: ["Dartcaster"],
	"Digital Weapons": ["Digi-laser", "Digi-melta", "Digi-needler", "Digi-flame"],
	Laspistol: ["Laspistol"],
	Hallucinogen: ["Hallucinogen"],
	"Ork Choppa": ["Ork Choppa"],
	"Kraken Tooth Dagger": ["Kraken Tooth Dagger"],
	"Needle Pistols": ["Needle Pistol", "Needle Rifl"],
};

/** First sentence of the prose — the derived short description. */
export function shortFromProse(text: string): string {
	const m = text.match(/^[^.!?]+[.!?]/);
	return (m ? m[0] : text).trim();
}

export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<void> {
	const inArg = argv.includes("--in")
		? argv[argv.indexOf("--in") + 1]
		: "src/packs/.extraction-src/weapons2-parsed.json";
	const outArg = argv.includes("--out")
		? argv[argv.indexOf("--out") + 1]
		: "src/packs/rogue_trader/weapons/weapons.yaml";
	const proseArg = argv.includes("--prose")
		? argv[argv.indexOf("--prose") + 1]
		: "src/packs/.extraction-src/weapons2-prose.json";

	const parsed = JSON.parse(readFileSync(inArg, "utf8")) as Array<
		Record<string, string>
	>;

	// Prose blocks (bead 7jn): keyed by weapon row name.
	let proseByRow: Record<string, string> = {};
	let proseMapped = 0;
	try {
		const prose = JSON.parse(readFileSync(proseArg, "utf8")) as Array<{
			name: string;
			text: string;
		}>;
		for (const block of prose) {
			const rows = PROSE_ROW_MAP[block.name];
			if (!rows) continue;
			proseMapped++;
			for (const row of rows) proseByRow[row] = block.text;
		}
	} catch {
		console.log("[emit] no prose file; weapons emit without descriptions");
	}

	const docs = parsed.map((r) => {
		const special = parseQualities(r.special);
		const isLauncher = r.special.startsWith("Varies with ammunition");
		const family = WEAPON_FAMILY_MAP[r.name];
		if (!family) {
			throw new Error(
				`unmapped weapon family for "${r.name}" (add it to WEAPON_FAMILY_MAP, bead erzk)`,
			);
		}
		const system: Record<string, unknown> = {
			class: r.class,
			weaponFamily: family,
			range: r.range,
			damage: r.damage,
			// Book letters (E/I/R/X) -> schema enum values via the shared
			// normaliser; empty (no-damage rows) falls back to Impact.
			damageType: normaliseDamageType(r.damageType) ?? DamageType.Impact,
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
			// description lives at system level (Gear.description HTMLField).
			return {
				name: r.name,
				type: "Item",
				system: { ...system, description: LAUNCHER_NOTE },
			};
		}
		const prose = proseByRow[r.name];
		if (prose) {
			return {
				name: r.name,
				type: "Item",
				system: {
					...system,
					shortDescription: shortFromProse(prose),
					description: prose,
				},
			};
		}
		return { name: r.name, type: "Item", system };
	});

	const out = yaml.stringify(docs).replace(/^-\s+name:/gm, "- name:");
	await Bun.write(outArg, out);
	console.log(
		`[emit] ${docs.length} weapons (${proseMapped} prose blocks mapped) -> ${outArg}`,
	);
}

if (import.meta.main) await main();

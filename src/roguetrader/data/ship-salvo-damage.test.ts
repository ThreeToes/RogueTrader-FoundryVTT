/**
 * Salvo damage guard (bead kxbz): every ship-weapon-component the packs ship
 * with a salvo componentType (macrobattery / lance) must carry a damage cell
 * the kernel can actually compose — composeSalvoDamageFormula throws loudly
 * on anything else, and a crash in after() leaves the pre-roll side effects
 * (the silent-running reveal) half-applied.
 *
 * Mirrors pack-schema.test.ts: the packs live in the private src/packs repo,
 * so the suite skips when that clone is absent — and the guard cannot quietly
 * pass on an empty walk (see the `checked` assertion).
 *
 * The ordnance componentTypes (torpedo-tube / nova-cannon / landing-bay) are
 * asserted to REFUSE: they are Extended Actions (Core Rulebook p218, bead
 * a413/S9), and their "—" damage cells must never reach the salvo kernel.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { parse } from "yaml";
import {
	composeSalvoDamageFormula,
	salvoWeaponKind,
} from "../../rules-engine/ship-combat";

const PACK_ROOT = "src/packs/rogue_trader";
const HAS_PACKS = existsSync(PACK_ROOT);

/** Every pack YAML file, as `<dir>/<file>`. */
function packFiles(): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(PACK_ROOT)) {
		const dir = `${PACK_ROOT}/${entry}`;
		if (!statSync(dir).isDirectory()) continue;
		for (const file of readdirSync(dir)) {
			if (file.endsWith(".yaml")) out.push(`${entry}/${file}`);
		}
	}
	return out.sort();
}

describe.skipIf(!HAS_PACKS)("ship pack salvo damage values (bead kxbz)", () => {
	test("every salvo weapon composes; every ordnance type refuses", () => {
		const offenders: string[] = [];
		let salvoChecked = 0;
		let ordnanceChecked = 0;
		for (const rel of packFiles()) {
			let docs: unknown;
			try {
				docs = parse(readFileSync(`${PACK_ROOT}/${rel}`, "utf8"));
			} catch {
				continue;
			}
			if (!Array.isArray(docs)) continue;
			for (const doc of docs as Array<Record<string, unknown>>) {
				if (doc?.type !== "ship-weapon-component") continue;
				const system = (doc.system ?? {}) as Record<string, unknown>;
				const name = String(doc.name ?? "");
				const label = `${rel}: ${name}`;
				const damage = String(system.damage ?? "");
				const kind = salvoWeaponKind(
					String(system.componentType ?? ""),
					`${name} ${String(system.special ?? "")}`,
				);
				if (kind) {
					salvoChecked++;
					// The guard: compose one hit — throws on unreadable cells.
					try {
						composeSalvoDamageFormula(1, damage);
					} catch (err) {
						offenders.push(
							`${label}: damage "${damage}" does not compose — ${String(err)}`,
						);
					}
				} else {
					ordnanceChecked++;
					// Ordnance entries must be un-composable BY GATE, so the
					// componentType is authoritative: a "torpedo-tube" carrying a
					// blank componentType would slip past the prepare() refusal.
					if (
						!["torpedo-tube", "nova-cannon", "landing-bay"].includes(
							String(system.componentType ?? ""),
						)
					) {
						offenders.push(
							`${label}: componentType "${String(system.componentType ?? "")}" refuses the salvo gate — expected an ordnance type (torpedo-tube / nova-cannon / landing-bay)`,
						);
					}
				}
			}
		}
		// Guard against the walk silently finding nothing.
		expect(salvoChecked).toBeGreaterThan(0);
		expect(ordnanceChecked).toBeGreaterThan(0);
		expect(offenders).toEqual([]);
	});
});

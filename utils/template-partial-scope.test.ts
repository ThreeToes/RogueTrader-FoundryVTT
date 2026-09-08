/**
 * Partial-block scope regression (live-world failure, 2026-09-07).
 *
 * `{{#> "rt/inv-row"}}` partial blocks RESET the Handlebars parent-context
 * chain: depth walks like `../../weaponSlots` or `../editable` inside the
 * block body resolve to undefined even though block params (`c`) survive.
 * `@root.*` is the only cross-boundary lookup that works (data.root is
 * inherited through partial invocation). Verified empirically against the
 * project's handlebars version.
 *
 * The old verify:templates pass could not catch this class: bodies inside
 * {{#each}} never execute against the empty context (bead 7tjo), and the
 * stubbed selectOptions guards `choices ?? {}` where Foundry's real helper
 * does Object.entries(choices) unguarded — so a broken depth walk silently
 * passed verification and crashed (or silently mis-rendered) in-world.
 *
 * These tests compile the real templates, register the real shared partials,
 * and render with a context that EXECUTES the each-loop bodies, asserting the
 * fixed paths actually resolve.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import Handlebars from "handlebars";

/** Stub helper set: only what these three templates + inv-row need. */
const stubs = {
	localize: (key: unknown) => String(key ?? ""),
	selectOptions: (choices: unknown, opts?: { hash?: { selected?: string } }) => {
		const selected = opts?.hash?.selected;
		const entries = Object.entries(choices ?? {});
		return new Handlebars.SafeString(
			entries
				.map(
					([value, label]) =>
						`<option value="${value}"${value === selected ? " selected" : ""}>${String(label)}</option>`,
				)
				.join(""),
		);
	},
	concat: (...parts: unknown[]) =>
		parts.slice(0, -1).map(String).join(""),
	ifThen: (cond: unknown, thenValue: unknown, elseValue: unknown) =>
		cond ? thenValue : elseValue,
	eq: (a: unknown, b: unknown) => a === b,
	ne: (a: unknown, b: unknown) => a !== b,
};

/** The shared partials the sheets register (init time). */
const INV_ROW = readFileSync("template/shared/parts/inv-row.hbs", "utf8");
const WEAPON_ROW = readFileSync(
	"template/shared/parts/weapon-row.hbs",
	"utf8",
);
const COMBAT_WEAPON_ROW = readFileSync(
	"template/shared/parts/combat-weapon-row.hbs",
	"utf8",
);

function compile(name: string): HandlebarsTemplateDelegate {
	const source = readFileSync(`template/sheet/actor/tabs/${name}`, "utf8");
	const handlebars = Handlebars.create();
	for (const [name, fn] of Object.entries(stubs)) {
		handlebars.registerHelper(name, fn as never);
	}
	handlebars.registerPartial("rt/inv-row", INV_ROW);
	handlebars.registerPartial("rt/weapon-row", WEAPON_ROW);
	handlebars.registerPartial("rt/combat-weapon-row", COMBAT_WEAPON_ROW);
	return handlebars.compile(source);
}

/** Compile a shared partial standalone (for direct partial tests). */
function compilePartial(partialPath: string): HandlebarsTemplateDelegate {
	const handlebars = Handlebars.create();
	for (const [name, fn] of Object.entries(stubs)) {
		handlebars.registerHelper(name, fn as never);
	}
	handlebars.registerPartial("rt/inv-row", INV_ROW);
	return handlebars.compile(readFileSync(partialPath, "utf8"));
}

describe("template partial-block scope (in-world ship-sheet crash)", () => {
	const weaponComponent: Record<string, unknown> = {
		id: "w1",
		name: "Sunseed Lance",
		type: "ship-weapon-component",
		power: 8,
		space: 6,
		sp: 0,
		slot: "dorsal",
	};
	const refitContext = {
		weaponSlots: { dorsal: "Dorsal", prow: "Prow" },
		hullOptions: [] as unknown[],
		weaponIssues: [] as unknown[],
		components: [weaponComponent],
		installedGroups: [
			{ key: "weapons", labelKey: "X", items: [weaponComponent] },
		],
	};

	it("ship-refit resolves weaponSlots via @root across the inv-row boundary", () => {
		const render = compile("ship-refit.hbs");
		const html = render(refitContext);
		// The select must render the ROOT weaponSlots vocabulary — with the
		// old ../../ path it rendered zero options (selectOptions undefined).
		expect(html).toContain('<option value="dorsal"');
		expect(html).toContain('<option value="prow"');
		expect(html).toContain('selected>Dorsal');
	});

	it("ship-combat resolves combat.componentStates via @root across the boundary", () => {
		const render = compile("ship-combat.hbs");
		const html = render({
			components: [{ id: "c1", name: "Lifta-Droppa", state: "damaged" }],
			combat: {
				componentStates: { intact: "Intact", damaged: "Damaged" },
				repairable: [{ id: "c1", name: "Lifta-Droppa" }],
			},
		});
		expect(html).toContain('<option value="intact"');
		expect(html).toContain('<option value="damaged"');
	});

	it("npc-main takes the editable branch via @root across the boundary", () => {
		const render = compile("npc-main.hbs");
		const html = render({
			editable: true,
			skills: [{ id: "s1", name: "Pilot (Spacecraft)", ladderOptions: { a: "A" } }],
		});
		// With the old ../editable the #if fell to the else branch always.
		expect(html).toContain("npc-ladder-select");
		expect(html).toContain('<option value="a"');
	});

	it("inventory weapon rows get real data-actions (equip + roll, bead txf2)", () => {
		const render = compile("inventory.hbs");
		const html = render({
			encumbrance: {
				state: "ok",
				capacity: 10,
				percent: 10,
				weight: 1,
				stateLabel: "INVENTORY.STATE_OK",
			},
			inventory: [
				{
					label: "Weapons",
					items: [
						{
							id: "w1",
							name: "Lasgun",
							isWeapon: true,
							weight: 3,
							equipped: true,
							equipStateLabel: "Carried",
						},
					],
				},
			],
		});
		// inventory.hbs passes NO rollAction/equipAction to rt/weapon-row —
		// before the fix both anchors rendered data-action="" (dead clicks).
		expect(html).toContain('data-action="rollWeapon"');
		expect(html).toContain('data-action="toggleEquip"');
	});

	it("combat tab weapon rows default to the PC action names (bead txf2)", () => {
		const render = compile("combat.hbs");
		const html = render({
			weapons: [
				{
					id: "w1",
					name: "Lasgun",
					classLabel: "WEAPON.CLASS_BASIC",
					damage: "1d10+3",
					penetration: 0,
					isRanged: true,
					rof: { singleShot: "S", burst: "-", fullAuto: "-" },
					clip: 30,
				},
			],
		});
		// combat.hbs passes no action names — the partial must default to the
		// PC actions; before the fix both anchors rendered data-action="".
		expect(html).toContain('data-action="rollWeapon"');
		expect(html).toContain('data-action="rollDamage"');
	});

	it("combat-weapon-row honours explicit caller action names (NPC override)", () => {
		const render = compilePartial("template/shared/parts/combat-weapon-row.hbs");
		const html = render({
			id: "w1",
			name: "Lasgun",
			classLabel: "WEAPON.CLASS_BASIC",
			damage: "1d10+3",
			penetration: 0,
			isRanged: false,
			rollAction: "rollNpcWeapon",
			damageAction: "rollNpcDamage",
		});
		expect(html).toContain('data-action="rollNpcWeapon"');
		expect(html).toContain('data-action="rollNpcDamage"');
	});
});
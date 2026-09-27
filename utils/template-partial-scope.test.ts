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
// Beads uc08 + 7dt0 added two shared partials the ship tabs render.
const SHIP_COMPONENT_ROW = readFileSync(
	"template/shared/parts/ship-component-row.hbs",
	"utf8",
);
const CAPACITY_BAR = readFileSync(
	"template/shared/parts/capacity-bar.hbs",
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
	handlebars.registerPartial("rt/ship-component-row", SHIP_COMPONENT_ROW);
	handlebars.registerPartial("rt/capacity-bar", CAPACITY_BAR);
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
		cost: "P8 S6 SP-",
		slot: "dorsal",
		// Per-weapon slot chips (owner round 7): validity computed in the
		// sheet context; the harness pins that the template renders them.
		slotChips: [
			{ key: "dorsal", label: "STARSHIP.SLOT_DORSAL", disabled: false, reason: "" },
			{ key: "prow", label: "STARSHIP.SLOT_PROW", disabled: true, reason: "STARSHIP.ISSUE_UNKNOWN_SLOT" },
		],
	};
	const refitContext = {
		weaponSlots: { dorsal: "Dorsal", prow: "Prow" },
		hullOptions: [] as unknown[],
		weaponIssues: [] as unknown[],
		components: [weaponComponent],
		installedGroups: [
			{ key: "weapons", labelKey: "X", items: [weaponComponent] },
		],
		// Budget strip (bead 7dt0): capacity-bar renders the meter values.
		meters: {
			power: { used: 8, total: 40, pct: 20, over: false },
			space: { used: 6, total: 40, pct: 15, over: false },
			sp: { used: 0, total: 60, pct: 0, over: false },
		},
	};

	it("ship-refit resolves weaponSlots via @root across the inv-row boundary", () => {
		const render = compile("ship-refit.hbs");
		const html = render(refitContext);
		// Round 5 + 7: the slot picker is BUTTON CHIPS in a centred second
		// row, driven by per-weapon chip data — invalid slots render DISABLED
		// with their reason.
		expect(html).toContain('data-slot="dorsal"');
		expect(html).toContain('data-slot="prow"');
		expect(html).toContain('class="slot-chip dorsal checked"');
		expect(html).toContain("disabled");
		expect(html).toContain('data-tooltip="STARSHIP.ISSUE_UNKNOWN_SLOT"');
		// and the unassign chip
		expect(html).toContain('data-slot=""');
	});

	it("ship-combat resolves combat.componentStates via @root across the boundary", () => {
		const render = compile("ship-combat.hbs");
		const html = render({
			// Bead uc08: the roster is ONE merged list; the state select lives
			// inside the rt/ship-component-row partial-block, so this still
			// guards the same @root-across-the-boundary regression.
			combat: {
				componentStates: { intact: "Intact", damaged: "Damaged" },
				weapons: [],
				roster: [
					{
						id: "c1",
						name: "Lifta-Droppa",
						type: "ship-component",
						state: "damaged",
						stateLabel: "Damaged",
						cost: "P3 S2 SP-",
						repairable: true,
					},
				],
				// Owner round 2: weapon components get their own section.
				weaponRoster: [
					{
						id: "w1",
						name: "Mars Pattern Macrocannons",
						type: "ship-weapon-component",
						state: "intact",
						stateLabel: "Intact",
						cost: "P4 S2 SP1",
						repairable: false,
					},
				],
			},
		});
		// owner round 2: the roster is split by type and the duplicate status
		// badge is OMITTED (the chips are the status display). The localize
		// stub emits raw keys.
		expect(html).toContain("SHIP_COMBAT.ROSTER_COMPONENTS");
		expect(html).toContain("SHIP_COMBAT.ROSTER_WEAPONS");
		expect(html).toContain('data-action="repairComponent"');
		expect(html).not.toContain('class="chip sc-state');
		expect(html).not.toContain("TYPES.Item.ship-component");
		// owner round 3: the state picker is BUTTON CHIPS (no dropdown) — one
		// chip per state of the p223 vocabulary resolved via @root across the
		// partial-block boundary, the current state lit.
		expect(html).toContain('class="state-chip damaged checked"');
		expect(html).toContain('data-state="damaged"');
		expect(html).toContain('data-action="setComponentState"');
		// intact chip is rendered unchecked on the damaged row
		expect(html).toContain('class="state-chip intact"');
		// and the weapon roster's intact row is lit
		expect(html).toContain('class="state-chip intact checked"');
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

	// rt/creator-nav is shared by the character, ship and planet creators. All
	// three register their back handler as "prev", but NO caller passed
	// backAction and it was missing from the partial's documented params — so
	// Handlebars resolved it to undefined and every back button rendered
	// data-action="" (a DEAD CLICK, same class as txf2).
	it("creator-nav back button defaults to a real action, not data-action=\"\"", () => {
		const render = compilePartial("template/shared/parts/creator-nav.hbs");
		const html = render({
			backLabel: "CREATOR.BACK",
			forwardAction: "next",
			forwardLabel: "CREATOR.NEXT",
		});
		expect(html).toContain('data-action="prev"');
		expect(html).not.toContain('data-action=""');
	});

	it("creator-nav honours explicit back/forward overrides", () => {
		const render = compilePartial("template/shared/parts/creator-nav.hbs");
		const html = render({
			backLabel: "Back",
			backAction: "stepBack",
			forwardAction: "create",
			forwardLabel: "Create",
		});
		expect(html).toContain('data-action="stepBack"');
		expect(html).toContain('data-action="create"');
	});

	it("creator-nav hides back on the first step but keeps a live forward", () => {
		const render = compilePartial("template/shared/parts/creator-nav.hbs");
		const html = render({ backHidden: true, backLabel: "Back", forwardLabel: "Next" });
		expect(html).not.toContain("rt-creator-nav-back");
		expect(html).toContain('data-action="next"');
	});

	it("npc-inventory renders equip toggles + grouped lists (bead 2dvj)", () => {
		const render = compile("npc-inventory.hbs");
		const html = render({
			armourTotals: [],
			armourItems: [{ id: "a1", name: "Flak Armour", worn: false }],
			itemGroups: [
				{
					labelKey: "TYPES.Item.ranged-weapon",
					items: [
						{
							id: "w1",
							name: "Lasgun",
							type: "ranged-weapon",
							equippable: true,
							ready: false,
						},
					],
				},
				{
					labelKey: "TYPES.Item.talent",
					items: [
						{ id: "t1", name: "Rapid Reload", type: "talent", equippable: false, ready: false },
					],
				},
			],
		});
		// The sheet action existed but NO template ever rendered it — both the
		// armour chip and weapon rows must carry the toggle action now.
		expect(html).toContain('data-action="toggleNpcEquip"');
		// grouped: ranged weapons get a stow/carry affordance...
		expect(html).toContain('data-tooltip="NPC.EQUIP"');
		// ...armour rows get the wear/stow toggle...
		expect(html).toContain('data-tooltip="NPC.WEAR"');
		// ...talents get neither (no equip affordance beyond the delete).
		const talentRow = html.split("Rapid Reload")[1]?.split("</li>")[0] ?? "";
		expect(talentRow).not.toContain("toggleNpcEquip");
		expect(talentRow).toContain("deleteNpcItem");
	});

	it("npc-inventory renders pack links only for items with a source (bead kwm9)", () => {
		const render = compile("npc-inventory.hbs");
		const html = render({
			armourTotals: [],
			armourItems: [
				{
					id: "a1",
					name: "Flak Armour",
					worn: true,
					uuid: "Compendium.rogue-trader.equipment.abc",
				},
			],
			itemGroups: [
				{
					labelKey: "TYPES.Item.gear",
					items: [
						{ id: "g1", name: "Rope", type: "gear", equippable: true, ready: true, source: "" },
					],
				},
			],
		});
		// armour row has a source stamp -> link renders
		expect(html).toContain('data-action="openPackItem"');
		expect(html).toContain('data-uuid="Compendium.rogue-trader.equipment.abc"');
		// gear row without a source renders NO link (no dead affordance)
		const gearRow = html.split("Rope")[1]?.split("</li>")[0] ?? "";
		expect(gearRow).not.toContain("openPackItem");
	});

	it("combat-weapon-row renders the pack link only when a uuid is passed (bead kwm9)", () => {
		const render = compilePartial("template/shared/parts/combat-weapon-row.hbs");
		const withUuid = render({
			id: "w1",
			name: "Lasgun",
			classLabel: "WEAPON.CLASS_BASIC",
			damage: "1d10+3",
			penetration: 0,
			isRanged: false,
			uuid: "Compendium.rogue-trader.equipment.abc",
			rollAction: "rollNpcWeapon",
			damageAction: "rollNpcDamage",
		});
		expect(withUuid).toContain('data-action="openPackItem"');
		const withoutUuid = render({
			id: "w2",
			name: "Sword",
			classLabel: "WEAPON.CLASS_BASIC",
			damage: "1d10",
			penetration: 0,
			isRanged: false,
		});
		expect(withoutUuid).not.toContain("openPackItem");
	});
});
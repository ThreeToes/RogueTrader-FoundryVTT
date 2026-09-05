import { describe, expect, test } from "bun:test";
import {
	pickOriginKey,
	resolveOriginTraits,
	traitDefKey,
	traitModifierId,
	type OriginTraitDef,
} from "./origin-traits";

const def = (
	originKey: string,
	traitKey: string,
	kind: OriginTraitDef["kind"],
	extra: Partial<OriginTraitDef> = {},
): OriginTraitDef => ({
	name: traitKey,
	originKey,
	traitKey,
	kind,
	testKey: "",
	value: 0,
	grantKind: "",
	text: "text",
	...extra,
});

const DEFS: OriginTraitDef[] = [
	def("death-world", "paranoid", "modifier", { testKey: "fel", value: -10 }),
	def("press-ganged", "unwilling-accomplice", "grant", { grantKind: "free-skill" }),
	def("press-ganged", "jealous-freedom", "note"),
	def("void-born", "charmed", "note"),
];

describe("pickOriginKey", () => {
	test("splits variant suffixes", () => {
		expect(pickOriginKey("criminal|hunted-by-a-crime-baron")).toBe("criminal");
		expect(pickOriginKey("death-world")).toBe("death-world");
		expect(pickOriginKey(undefined)).toBeNull();
	});
});

describe("resolveOriginTraits", () => {
	const origins = {
		homeWorld: "death-world",
		lure: "press-ganged",
	};

	test("resolves only traits of active picks", () => {
		const { modifiers, grants, notes } = resolveOriginTraits(origins, DEFS);
		expect(modifiers).toHaveLength(1);
		expect(modifiers[0].def.traitKey).toBe("paranoid");
		expect(grants).toHaveLength(1);
		expect(grants[0].def.traitKey).toBe("unwilling-accomplice");
		expect(notes).toHaveLength(1);
		expect(notes[0].def.traitKey).toBe("jealous-freedom");
	});

	test("inactive origins' traits are excluded", () => {
		const { notes } = resolveOriginTraits(origins, DEFS);
		expect(notes.find((n) => n.def.originKey === "void-born")).toBeUndefined();
	});

	test("grant claims read from system.origins.claims", () => {
		const key = "press-ganged.unwilling-accomplice";
		const { grants } = resolveOriginTraits(
			{ ...origins, claims: { [key]: true } },
			DEFS,
		);
		expect(grants[0].claimed).toBe(true);
	});

	test("undefined origins resolve to empty buckets", () => {
		const r = resolveOriginTraits(undefined, DEFS);
		expect(r.modifiers).toHaveLength(0);
	});

	test("variant-stored picks resolve by origin key", () => {
		const r = resolveOriginTraits({ lure: "criminal|hunted" }, [
			def("criminal", "judged", "grant", { grantKind: "bionic" }),
		]);
		expect(r.grants).toHaveLength(1);
	});
});

describe("trait keys and ids", () => {
	test("def key is originKey.traitKey", () => {
		expect(traitDefKey({ originKey: "a", traitKey: "b" })).toBe("a.b");
	});

	test("modifier ids are stable and trait-unique", () => {
		const d1 = def("death-world", "paranoid", "modifier", { testKey: "fel", value: -10 });
		const d2 = def("void-born", "paranoid", "modifier", { testKey: "fel", value: -5 });
		expect(traitModifierId(d1)).not.toBe(traitModifierId(d2));
		expect(traitModifierId(d1)).toBe(traitModifierId({ ...d1 }));
	});
});
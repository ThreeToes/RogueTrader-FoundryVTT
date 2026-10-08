import { afterAll, describe, expect, test } from "bun:test";
import { imageActions } from "./image-actions";

// --- Foundry stubs (before exercising the handler) --------------------------
// The handler reads the global `foundry.applications.apps.FilePicker`; stub
// it with a minimal FilePicker whose browse() fires the callback (same
// globals-swap pattern as combat-tracker.test.ts).

type PickerOpts = { type?: string; current?: string; callback?: (p: string) => void };
type UpdateCall = Record<string, unknown>;

let lastOpts: PickerOpts | null = null;
let pickPath = "";

const savedFoundry = (globalThis as Record<string, unknown>).foundry;
(globalThis as Record<string, unknown>).foundry = {
	applications: {
		apps: {
			FilePicker: {
				implementation: class {
					callback: ((p: string) => void) | undefined;
					constructor(opts: PickerOpts) {
						lastOpts = opts;
						this.callback = opts.callback;
					}
					async browse(): Promise<unknown> {
						this.callback?.(pickPath);
						return this;
					}
				},
			},
		},
	},
};

afterAll(() => {
	(globalThis as Record<string, unknown>).foundry = savedFoundry;
});

// --- Harness ----------------------------------------------------------------

const target = (field?: string, src = "icons/svg/mystery-man.svg") =>
	({
		dataset: { ...(field ? { field } : {}) },
		getAttribute: (name: string) => (name === "src" ? src : null),
	}) as unknown as HTMLElement;

describe("imageActions.editImage (persisted portrait pick)", () => {
	test("persists the picked path on Items (core only does updateSource)", async () => {
		pickPath = "icons/test.webp";
		const updates: UpdateCall[] = [];
		await imageActions.editImage.call(
			{ document: { documentName: "Item", update: (d) => { updates.push(d); return Promise.resolve(); } } },
			{},
			target(),
		);
		expect(lastOpts?.type).toBe("image");
		expect(lastOpts?.current).toBe("icons/svg/mystery-man.svg");
		expect(updates).toEqual([{ img: pickPath }]);
	});

	test("Actors keep the token texture in step (linked + re-placed tokens follow)", async () => {
		const updates: UpdateCall[] = [];
		pickPath = "worlds/test/portraits/new.webp";
		await imageActions.editImage.call(
			{ document: { documentName: "Actor", update: (d) => { updates.push(d); return Promise.resolve(); } } },
			{},
			target(),
		);
		expect(updates).toEqual([
			{
				img: "worlds/test/portraits/new.webp",
				prototypeToken: {
					texture: { src: "worlds/test/portraits/new.webp" },
				},
			},
		]);
	});

	test("an empty pick never writes anything", async () => {
		const updates: UpdateCall[] = [];
		pickPath = "";
		await imageActions.editImage.call(
			{ document: { documentName: "Actor", update: (d) => { updates.push(d); return Promise.resolve(); } } },
			{},
			target(),
		);
		expect(updates).toEqual([]);
	});

	test("a non-img data-field is persisted under that field", async () => {
		const updates: UpdateCall[] = [];
		pickPath = "art.webp";
		await imageActions.editImage.call(
			{ document: { documentName: "Item", update: (d) => { updates.push(d); return Promise.resolve(); } } },
			{},
			target("prototypeToken.texture.src"),
		);
		// Items never get the prototypeToken companion update.
		expect(updates).toEqual([{ "prototypeToken.texture.src": "art.webp" }]);
	});
});
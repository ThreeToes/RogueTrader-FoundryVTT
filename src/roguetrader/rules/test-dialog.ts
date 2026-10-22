/**
 * RT shim over the system-neutral test dialog (bead p7jv).
 *
 * The machinery (ApplicationV2 dialog, modifier rows, difficulty select,
 * condition toggles) lives in src/ffg/infrastructure/foundry/test-dialog.ts;
 * everything RT-branded is here as DATA: the RT template path + window
 * branding, and the RT difficulty ladder with its i18n key prefix. The base
 * class merges `defaults` into every request, so RT callers (presentation/
 * rolls) need no edits.
 *
 * Bead wxut.7 adds ONE more piece of RT data to the header: the active
 * house-rule profile. It is read and composed in
 * presentation/rolls/test-dialog.ts, because the rules layer may not touch a
 * Foundry global itself (architecture.test.ts) — this shim only injects the
 * result into the render context and routes the click-through.
 */
export { TestDialogBase } from "../../ffg/infrastructure/foundry/test-dialog";
import { TestDialogBase } from "../../ffg/infrastructure/foundry/test-dialog";
import type {
	DifficultyStep,
	TestDialogAttackContext,
	TestDialogAttackSelection,
	TestDialogBranding,
	TestDialogRequest,
	TestDialogResult,
} from "../../ffg/infrastructure/foundry/test-dialog";
import { TEMPLATE_ROOT } from "../../ffg/domain/template-root";
import {
	activeTestDialogProfileIndicator,
	openRulesApp,
} from "../presentation/rolls/test-dialog";

export type {
	DifficultyStep,
	TestDialogAttackContext,
	TestDialogAttackSelection,
	TestDialogBranding,
	TestDialogRequest,
	TestDialogResult,
};

/**
 * Standard RT difficulty ladder (bead wqt3). Values from the Core Rulebook
 * difficulty table — UNVERIFIED IN WORLD: ladder wording/values still need an
 * owner eyeball against the printed table before world use.
 */
export const DIFFICULTY_LADDER: DifficultyStep[] = [
	{ key: "TRIVIAL", value: 60 },
	{ key: "EASY", value: 40 },
	{ key: "ROUTINE", value: 20 },
	{ key: "ORDINARY", value: 10 },
	{ key: "CHALLENGING", value: 0 },
	{ key: "HARD", value: -10 },
	{ key: "VERY_HARD", value: -20 },
	{ key: "ARDUOUS", value: -30 },
	{ key: "HELLISH", value: -40 },
];

/** RT branding: template path + window id/classes for the RT test dialog. */
export const RT_TEST_DIALOG_BRANDING: TestDialogBranding = {
	template: `${TEMPLATE_ROOT}dialog/test-dialog.hbs`,
	windowId: "rt-test-dialog",
	windowClasses: ["rogue-trader", "dialog", "test-dialog-app", "rt-component"],
};

/**
 * The RT test dialog: the neutral machinery with the RT branding and the RT
 * difficulty ladder injected as request defaults.
 */
export class TestDialog extends TestDialogBase {
	static override branding = RT_TEST_DIALOG_BRANDING;
	static override defaults: Partial<TestDialogRequest> = {
		difficultyLadder: DIFFICULTY_LADDER,
		difficultyLabelPrefix: "ROLL.DIFFICULTY_",
	};

	/**
	 * The base actions, plus the house-rule indicator's click-through (bead
	 * wxut.7): the header names the active profile, and clicking it opens the
	 * rules app that edits it. The app takes no constructor arguments, so the
	 * handler is the opener itself.
	 */
	static override get DEFAULT_OPTIONS() {
		return {
			...super.DEFAULT_OPTIONS,
			actions: {
				...super.DEFAULT_OPTIONS.actions,
				openRules: openRulesApp,
			},
		};
	}

	/**
	 * Bead wxut.7: the active house-rule profile as header data (null = core
	 * rules, which renders no indicator at all).
	 */
	override async _prepareContext(
		options: Parameters<TestDialogBase["_prepareContext"]>[0],
	) {
		const context = (await super._prepareContext(options)) as Record<
			string,
			unknown
		>;
		context.profileIndicator = activeTestDialogProfileIndicator();
		return context;
	}
}

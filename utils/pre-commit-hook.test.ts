/**
 * Guard for the versioned pre-commit hook (bead foundryvtt-rogue-trader-qdmc).
 *
 * Asserts .githooks/pre-commit exists, keeps its executable bit, and still
 * mentions every check command the repo's CI (.forgejo/workflows/ci.yaml)
 * runs — so the hook cannot be silently emptied or left uninstallable
 * while the package script drifts away from the workflow's step names.
 */
import { accessSync, constants, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";

const HOOK_PATH = ".githooks/pre-commit";
const PACKAGE_JSON_PATH = "package.json";
const HOOK_INSTALL_CONFIG = "core.hooksPath .githooks";
// The verification steps the hook must mirror (the check-set minus CI's slow
// `bun run build` full build — see the header comment in the hook).
const CHECK_COMMANDS = [
	"bun run typecheck",
	"bun run lint",
	"bun test",
	"bun run verify:templates",
];

describe("pre-commit hook", () => {
	const hook = readFileSync(HOOK_PATH, "utf8");

	it("exists and is executable", () => {
		expect(() =>
			accessSync(HOOK_PATH, constants.F_OK | constants.X_OK),
		).not.toThrow();
	});

	it("has a shell shebang and set -eu failure discipline", () => {
		expect(hook.startsWith("#!/bin/sh")).toBe(true);
		expect(hook).toContain("set -eu");
	});

	it("mentions every check command", () => {
		for (const command of CHECK_COMMANDS) {
			expect(hook).toContain(command);
		}
	});

	it("packages a hooks:install script wired to core.hooksPath", () => {
		const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
		expect(pkg.scripts["hooks:install"]).toContain(HOOK_INSTALL_CONFIG);
	});
});
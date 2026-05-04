import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(args: string[]) {
	return Bun.spawnSync({
		cmd: [process.execPath, "run", "./src/cli.ts", ...args],
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});
}

describe("cli integration", () => {
	test("doctor --json emits machine-readable output", () => {
		const dir = mkdtempSync(join(tmpdir(), "resume-extract-cli-json-"));
		try {
			const result = runCli(["doctor", "--json", "--model", dir]);
			expect(result.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(result.stdout));
			expect(payload.modelReady).toBe(false);
			expect(payload.modelPath).toContain("resume-extract-cli-json-");
			expect(Array.isArray(payload.missingFiles)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("doctor help includes json and fix flags", () => {
		const result = runCli(["doctor", "--help"]);
		const output = new TextDecoder().decode(result.stdout);
		expect(result.exitCode).toBe(0);
		expect(output).toContain("--json");
		expect(output).toContain("--fix");
	});

	test("batch help includes fail-fast flag", () => {
		const result = runCli(["batch", "--help"]);
		const output = new TextDecoder().decode(result.stdout);
		expect(result.exitCode).toBe(0);
		expect(output).toContain("--fail-fast");
	});
});

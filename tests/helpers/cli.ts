import { resolve } from "node:path";
import { type Environment, gitEnvironment } from "./git";

export const cli = resolve(import.meta.dir, "../../src/cli.ts");
export function cliEnvironment(overrides: Environment = {}): Environment {
	const env = gitEnvironment();
	for (const key of [
		"BASE_BRANCH",
		"PR_NUMBER",
		"COPY_FROM",
		"DRY_RUN",
		"PUSH",
		"PUSH_ONLY",
	])
		delete env[key];
	return { ...env, ...overrides };
}
export function runCli(
	cwd: string,
	args: string[],
	overrides: Environment = {},
) {
	const result = Bun.spawnSync([process.execPath, cli, ...args], {
		cwd,
		env: cliEnvironment(overrides),
	});
	const out = result.stdout.toString();
	const err = result.stderr.toString();
	return { code: result.exitCode, out, err, text: out + err };
}

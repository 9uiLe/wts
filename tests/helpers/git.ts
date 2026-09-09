import { mkdirSync } from "node:fs";

export type Environment = Record<string, string | undefined>;

export function gitEnvironment(overrides: Environment = {}): Environment {
	const env: Environment = { ...process.env };
	for (const key of Object.keys(env)) {
		if (key.startsWith("GIT_")) delete env[key];
	}
	return {
		...env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.invalid",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.invalid",
		GIT_EDITOR: "true",
		GIT_TERMINAL_PROMPT: "0",
		...overrides,
	};
}

export function gitWithEnv(
	cwd: string,
	args: string[],
	overrides: Environment = {},
): string {
	const result = Bun.spawnSync(["git", ...args], {
		cwd,
		env: gitEnvironment(overrides),
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString().trimEnd();
}

export function git(cwd: string, ...args: string[]): string {
	return gitWithEnv(cwd, args);
}

export function initRepository(cwd: string, branch = "main"): void {
	mkdirSync(cwd, { recursive: true });
	git(cwd, "init", "-b", branch);
}

export function initBareOrigin(
	cwd: string,
	remote: string,
	branch = "main",
): void {
	git(cwd, "init", "--bare", "--initial-branch", branch, remote);
	git(cwd, "remote", "add", "origin", remote);
	git(cwd, "push", "-u", "origin", branch);
}

import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Environment, gitEnvironment } from "./git";

export const cli = resolve(import.meta.dir, "../../src/cli.ts");

type DisplayBlock =
	| { kind: "message"; text: string }
	| { kind: "key-value"; items: { label: string; value: unknown }[] }
	| { kind: "result"; message?: string; data?: unknown }
	| { kind: "error"; message: string };

export function outputText(output: string): string {
	return output
		.trimEnd()
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			const response: {
				blocks?: DisplayBlock[];
				error?: { message: string };
			} = JSON.parse(line);
			if (response.error) return [response.error.message];
			return (response.blocks ?? []).flatMap((block) => {
				switch (block.kind) {
					case "message":
						return [block.text];
					case "key-value":
						return block.items.map(({ label, value }) => `${label}  ${value}`);
					case "result":
						return [
							...(block.message === undefined ? [] : [block.message]),
							...(block.data === undefined ? [] : [JSON.stringify(block.data)]),
						];
					case "error":
						return [block.message];
				}
				throw new Error("Unknown hamio display block");
			});
		})
		.join("\n");
}

export function linkHamio(directory: string): void {
	const executable = Bun.which("hamio");
	if (!executable) throw new Error("hamio is required for this test");
	symlinkSync(executable, join(directory, "hamio"));
}

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
	return { code: result.exitCode, out, err, text: outputText(out) + err };
}

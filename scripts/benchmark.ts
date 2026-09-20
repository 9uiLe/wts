import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { cliEnvironment } from "../tests/helpers/cli";
import { git, initRepository } from "../tests/helpers/git";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: { output: { type: "string" }, help: { type: "boolean" } },
});
if (values.help || positionals.length < 1 || positionals.length > 2) {
	console.log(
		"Usage: bun scripts/benchmark.ts <baseline-binary> [candidate-binary] --output release/performance/benchmark.json",
	);
	process.exit(values.help ? 0 : 1);
}

const output = resolve(values.output ?? "release/performance/benchmark.json");
if (!output.startsWith(`${resolve("release")}${sep}`))
	throw new Error("Benchmark results must be written under release/.");
const binaries = positionals.map((path, index) => ({
	label: index === 0 ? "baseline" : "candidate",
	path: realpathSync(path),
	bytes: statSync(path).size,
	sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
}));
const environment = cliEnvironment();
const warmups = 1;
const samples = 5;
const directory = realpathSync(mkdtempSync(join(tmpdir(), "wts-benchmark-")));

function execute(
	command: string[],
	cwd: string,
	env = environment,
): { elapsedMs: number; stderr: string } {
	const start = performance.now();
	const result = Bun.spawnSync(command, { cwd, env });
	const elapsedMs = performance.now() - start;
	if (result.exitCode !== 0)
		throw new Error(
			`${command.join(" ")} failed (${result.exitCode}): ${result.stdout.toString()}${result.stderr.toString()}`,
		);
	return { elapsedMs, stderr: result.stderr.toString() };
}

function fixture(name: string, sessionCount: number, stackBranches: number) {
	const root = join(directory, name, "repo");
	initRepository(root);
	writeFileSync(join(root, ".wts.json"), JSON.stringify({ naming: {} }));
	writeFileSync(join(root, "file"), "base\n");
	git(root, "add", ".");
	git(root, "commit", "-m", "benchmark base");
	const targets = [];
	for (let index = 0; index < sessionCount; index++) {
		const branch = `session-${index + 1}`;
		const target = join(directory, name, "repo-worktrees", branch);
		git(root, "worktree", "add", "-b", branch, target);
		writeFileSync(
			join(git(target, "rev-parse", "--absolute-git-dir"), "wts-session.json"),
			JSON.stringify({ rootBranch: branch }),
		);
		for (let number = 2; number <= stackBranches + 1; number++)
			git(target, "switch", "-c", `${branch}-pr${number}-followup`);
		targets.push(target);
	}
	return { root, targets };
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function processCounter() {
	const bin = join(directory, "count-bin");
	const log = join(directory, "processes.log");
	mkdirSync(bin);
	for (const name of ["git", "hamio"]) {
		const executable = Bun.which(name);
		if (!executable) throw new Error(`${name} is required.`);
		writeFileSync(
			join(bin, name),
			`#!/bin/sh\nprintf '%s\\n' ${shellQuote(name)} >> ${shellQuote(log)}\nexec ${shellQuote(executable)} "$@"\n`,
			{ mode: 0o755 },
		);
	}
	return {
		measure(command: string[], cwd: string) {
			writeFileSync(log, "");
			execute(command, cwd, {
				...environment,
				PATH: `${bin}:${environment.PATH ?? ""}`,
			});
			const calls = readFileSync(log, "utf8").trim().split("\n");
			return {
				git: calls.filter((name) => name === "git").length,
				hamio: calls.filter((name) => name === "hamio").length,
			};
		},
	};
}

function snapshot(root: string): string {
	return JSON.stringify([
		git(root, "show-ref"),
		git(root, "worktree", "list", "--porcelain"),
		git(root, "status", "--porcelain"),
	]);
}

try {
	const one = fixture("one", 1, 3);
	const ten = fixture("ten", 10, 3);
	const discard = fixture("discard", 1, 9);
	const before = [one, ten, discard].map(({ root }) => snapshot(root));
	const counter = processCounter();
	const cases = [
		{ name: "version", cwd: directory, args: ["--version"] },
		{ name: "list-1-session-3-stack-branches", cwd: one.root, args: ["list"] },
		{
			name: "list-10-sessions-3-stack-branches",
			cwd: ten.root,
			args: ["list"],
		},
		{
			name: "discard-dry-run-10-total-branches",
			cwd: discard.root,
			args: ["discard", discard.targets[0] as string, "--dry-run"],
		},
	];
	const measurements = cases.map(({ name, cwd, args }) => {
		const results = binaries.map((binary) => ({
			label: binary.label,
			command: [binary.path, "--format", "json", ...args],
			samplesMs: [] as number[],
		}));
		for (let iteration = 0; iteration < warmups + samples; iteration++) {
			for (const result of results) {
				const { elapsedMs } = execute(result.command, cwd);
				if (iteration >= warmups) result.samplesMs.push(elapsedMs);
			}
		}
		return {
			name,
			results: results.map(({ label, command, samplesMs }) => {
				const rss =
					process.platform === "darwin"
						? execute(["/usr/bin/time", "-l", ...command], cwd).stderr.match(
								/(\d+)\s+maximum resident set size/,
							)
						: null;
				return {
					label,
					samplesMs,
					medianMs: samplesMs.toSorted((a, b) => a - b)[2],
					processes: counter.measure(command, cwd),
					maximumResidentSetSizeBytes: rss?.[1] ? Number(rss[1]) : null,
				};
			}),
		};
	});
	const after = [one, ten, discard].map(({ root }) => snapshot(root));
	if (JSON.stringify(before) !== JSON.stringify(after))
		throw new Error("Benchmark commands changed fixture refs or worktrees.");
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(
		output,
		`${JSON.stringify(
			{
				measuredAt: new Date().toISOString(),
				platform: process.platform,
				arch: process.arch,
				cpu: cpus()[0]?.model,
				bun: Bun.version,
				warmups,
				samples,
				method:
					"Warm filesystem caches; synchronous wall clock through process exit with captured JSON output. Versions alternate on the same fixtures. Process counts and RSS each use one separate untimed run. macOS time -l RSS is an OS-reported maximum, not simultaneous aggregate process-tree memory. No remote is configured. List fixtures have one root plus three stack branches per session; discard has one root plus nine stack branches. No pass/fail performance threshold.",
				binaries,
				measurements,
			},
			null,
			2,
		)}\n`,
	);
	console.log(output);
} finally {
	rmSync(directory, { recursive: true, force: true });
}

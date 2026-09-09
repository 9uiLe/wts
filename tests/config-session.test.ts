import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/cli";
import { git, initRepository, initBareOrigin } from "./helpers/git";
import { join } from "node:path";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function run(cwd: string, ...args: string[]) {
	return runCli(cwd, args, {
		PATH: `${join(cwd, "../bin")}:${process.env.PATH}`,
	});
}

function script(path: string, body: string) {
	writeFileSync(path, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
}

test("configured directory and independent names support stack, restack and protected cleanup", () => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-config-session-")));
	directories.push(dir);
	const main = join(dir, "repo");
	const origin = join(dir, "origin.git");
	initRepository(main);
	writeFileSync(join(main, "initial"), "initial\n");
	git(main, "add", ".");
	git(main, "commit", "-m", "initial");
	initBareOrigin(main, origin);
	const branchScript = join(dir, "branch-name");
	const worktreeScript = join(dir, "worktree-name");
	const branchInput = join(dir, "branch-input.json");
	const worktreeInput = join(dir, "worktree-input.json");
	script(
		branchScript,
		`const input = await Bun.stdin.text(); await Bun.write(${JSON.stringify(branchInput)}, input); console.log(JSON.parse(input).rootBranch ? "followup" : "feature/payment");`,
	);
	script(
		worktreeScript,
		`const input = await Bun.stdin.text(); await Bun.write(${JSON.stringify(worktreeInput)}, input); console.log("payment-workspace");`,
	);
	writeFileSync(
		join(main, ".wts.json"),
		JSON.stringify({
			worktreeDirectory: "../custom-sessions",
			naming: {
				branch: { script: branchScript, prompt: "branch instructions" },
				worktree: { script: worktreeScript, prompt: "worktree instructions" },
			},
		}),
	);
	const start = run(
		main,
		"start",
		"--task",
		"implement payment",
		"--base-branch",
		"main",
	);
	expect(start).toMatchObject({ code: 0 });
	const target = join(dir, "custom-sessions", "payment-workspace");
	expect(start.out).toContain(target);
	expect(git(target, "branch", "--show-current")).toBe("feature/payment");
	const branchData = JSON.parse(readFileSync(branchInput, "utf8"));
	const worktreeData = JSON.parse(readFileSync(worktreeInput, "utf8"));
	expect(branchData).toMatchObject({
		task: "implement payment",
		prompt: "branch instructions",
	});
	expect(worktreeData).toMatchObject({
		task: "implement payment",
		prompt: "worktree instructions",
	});
	expect(branchData.uuid).toMatch(/^[0-9a-f-]{36}$/);
	expect(branchData.date).toMatch(/^\d{8}$/);
	writeFileSync(join(target, "first"), "first\n");
	git(target, "add", ".");
	git(target, "commit", "-m", "first");
	const stack = run(target, "stack", "--task", "", "--pr-number", "2");
	expect(stack).toMatchObject({ code: 0 });
	const tip = git(target, "branch", "--show-current");
	expect(tip).toStartWith("feature/payment-pr2-");
	writeFileSync(join(target, "second"), "second\n");
	git(target, "add", ".");
	git(target, "commit", "-m", "second");
	writeFileSync(join(main, "upstream"), "upstream\n");
	git(main, "add", "upstream");
	git(main, "commit", "-m", "upstream");
	git(main, "push", "origin", "main");
	const restack = run(
		target,
		"restack",
		"--base-branch",
		"origin/main",
		"--push",
	);
	expect(restack).toMatchObject({ code: 0 });
	for (const branch of ["feature/payment", tip]) {
		git(main, "merge-base", "--is-ancestor", "main", branch);
		expect(git(origin, "rev-parse", branch)).toBe(
			git(main, "rev-parse", branch),
		);
	}
	git(main, "merge", "--ff-only", tip);
	git(main, "push", "origin", "main");
	const external = join(dir, "external-worktree");
	git(main, "worktree", "add", "-b", "external", external);
	const bin = join(dir, "bin");
	mkdirSync(bin);
	script(
		join(bin, "gh"),
		`
const args = process.argv.slice(2);
if (args[0] === "repo") console.log("test/repo");
else if (args[0] === "pr") {
 const branch = args[args.indexOf("--head") + 1];
 const oid = Bun.spawnSync(["git", "rev-parse", branch]).stdout.toString().trim();
 console.log(JSON.stringify([{headRefOid: oid, headRepository: {nameWithOwner: "test/repo"}}]));
} else if (args[0] !== "--version") process.exit(1);
`,
	);
	const cleanup = run(main, "cleanup", "--yes");
	expect(cleanup).toMatchObject({ code: 0 });
	expect(existsSync(target)).toBe(false);
	expect(git(main, "branch", "--list", "feature/payment*")).toBe("");
	expect(existsSync(external)).toBe(true);
	expect(git(external, "branch", "--show-current")).toBe("external");
});

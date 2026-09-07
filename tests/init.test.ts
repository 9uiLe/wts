import { expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");

function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-init-")));
	const root = join(dir, "repo");
	mkdirSync(root);
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.invalid",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.invalid",
	};
	function git(...args: string[]) {
		const result = Bun.spawnSync(["git", ...args], { cwd: root, env });
		if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		return result.stdout.toString();
	}
	git("init", "-b", "main");
	writeFileSync(join(root, "tracked"), "initial\n");
	git("add", ".");
	git("commit", "-m", "initial");
	function run(cwd: string, ...args: string[]) {
		const result = Bun.spawnSync([process.execPath, cli, ...args], {
			cwd,
			env,
		});
		return {
			code: result.exitCode,
			text: result.stdout.toString() + result.stderr.toString(),
		};
	}
	return {
		dir,
		root,
		git,
		run,
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("init writes default non-AI config in the repository root from root or a subdirectory", () => {
	for (const nested of [false, true]) {
		const f = fixture();
		try {
			const cwd = nested ? join(f.root, "nested") : f.root;
			if (nested) mkdirSync(cwd);
			expect(f.run(cwd, "init").code).toBe(0);
			expect(readFileSync(join(f.root, ".wts.json"), "utf8")).toBe(
				`${JSON.stringify({ worktreeDirectory: "../repo-worktrees", naming: {} }, null, 2)}\n`,
			);
			expect(existsSync(`${f.root}-worktrees`)).toBe(false);
			expect(f.run(cwd, "config", "check").code).toBe(0);
			const start = f.run(
				cwd,
				"start",
				"--dry-run",
				"--base-branch",
				"main",
				"--task",
				"",
			);
			expect(start.code).toBe(0);
			expect(start.text).toContain("repo-worktrees");
			expect(existsSync(`${f.root}-worktrees`)).toBe(false);
		} finally {
			f.dispose();
		}
	}
});

test("init never overwrites existing invalid files, directories, or symlinks", () => {
	for (const kind of ["file", "directory", "symlink"] as const) {
		const f = fixture();
		try {
			const path = join(f.root, ".wts.json");
			const target = join(f.dir, "target");
			if (kind === "file") writeFileSync(path, "invalid JSON");
			if (kind === "directory") mkdirSync(path);
			if (kind === "symlink") {
				writeFileSync(target, "target remains");
				symlinkSync(target, path);
			}
			const result = f.run(f.root, "init");
			expect(result.code).not.toBe(0);
			expect(result.text).toContain("初期化済み");
			if (kind === "file")
				expect(readFileSync(path, "utf8")).toBe("invalid JSON");
			if (kind === "directory")
				expect(lstatSync(path).isDirectory()).toBe(true);
			if (kind === "symlink") {
				expect(lstatSync(path).isSymbolicLink()).toBe(true);
				expect(readFileSync(target, "utf8")).toBe("target remains");
			}
		} finally {
			f.dispose();
		}
	}
});

test("commands requiring config fail before initialization without changing refs or paths", () => {
	const f = fixture();
	try {
		const refs = f.git("show-ref");
		const trees = f.git("worktree", "list", "--porcelain");
		for (const args of [
			["start", "--base-branch", "main"],
			["stack"],
			["cleanup", "--yes"],
			["restack"],
			["config", "check"],
		]) {
			const result = f.run(f.root, ...args);
			expect(result.code).not.toBe(0);
			expect(result.text).toContain(
				".wts.json がありません。wts init を実行してください。",
			);
		}
		expect(f.git("show-ref")).toBe(refs);
		expect(f.git("worktree", "list", "--porcelain")).toBe(trees);
		expect(existsSync(`${f.root}-worktrees`)).toBe(false);
		expect(existsSync(join(f.root, ".wts.json"))).toBe(false);
		expect(f.run(f.root, "doctor").code).toBe(0);
		expect(f.run(f.root, "--help").code).toBe(0);
	} finally {
		f.dispose();
	}
});

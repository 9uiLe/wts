import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "wts-cleanup-"));
	const root = join(dir, "repo");
	const remote = join(dir, "origin.git");
	const bin = join(dir, "bin");
	mkdirSync(root);
	mkdirSync(bin);
	const env = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@example.com",
		PATH: `${bin}:${process.env.PATH}`,
		PR_DATA: join(dir, "prs.json"),
	};
	function git(...args: string[]) {
		const result = Bun.spawnSync(["git", ...args], { cwd: root, env });
		if (result.exitCode) throw new Error(result.stderr.toString());
		return result.stdout.toString().trim();
	}
	git("init", "-b", "main");
	git("init", "--bare", remote);
	writeFileSync(join(root, ".wts.json"), JSON.stringify({ naming: {} }));
	writeFileSync(join(root, "file"), "base\n");
	git("add", ".");
	git("commit", "-m", "base");
	git("remote", "add", "origin", remote);
	git("push", "-u", "origin", "main");
	const heads: Record<
		string,
		{ headRefOid: string; headRepository: { nameWithOwner: string } }[]
	> = {};
	function merged(branch: string, oid: string, owner = "test/repo") {
		heads[branch] = [
			{ headRefOid: oid, headRepository: { nameWithOwner: owner } },
		];
	}
	writeFileSync(
		join(bin, "gh"),
		`#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] === 'repo') console.log('test/repo');\nelse if (a[0] === 'api') process.exit(process.env.API_FAIL === '1' ? 1 : 0);\nelse {if (process.env.PR_FAIL === '1') process.exit(1);const data = JSON.parse(await Bun.file(process.env.PR_DATA).text()); console.log(JSON.stringify(data[a[a.indexOf('--head') + 1]] || []));}\n`,
		{ mode: 0o755 },
	);
	const runner = join(dir, "run.ts");
	writeFileSync(
		runner,
		`import {cleanupSessionBranches} from ${JSON.stringify(resolve("src/commands/cleanup.ts"))}; await cleanupSessionBranches(JSON.parse(process.env.OPTIONS!));`,
	);
	function run(
		options: { dryRun?: boolean; yes?: boolean },
		extra: Record<string, string> = {},
	) {
		writeFileSync(env.PR_DATA, JSON.stringify(heads));
		const result = Bun.spawnSync([process.execPath, runner], {
			cwd: root,
			env: { ...env, ...extra, OPTIONS: JSON.stringify(options) },
		});
		return {
			code: result.exitCode,
			text: result.stdout.toString() + result.stderr.toString(),
		};
	}
	return {
		root,
		dir,
		git,
		merged,
		run,
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("cleanup deletes merged heads and reachable tips, protecting external worktrees and forks", () => {
	const f = fixture();
	try {
		const oid = f.git("rev-parse", "HEAD");
		for (const branch of ["exact", "ancestor", "fork", "outside", "unmerged"])
			f.git("branch", branch);
		f.merged("exact", oid);
		f.merged("ancestor", "rewritten");
		f.merged("fork", oid, "fork/repo");
		f.merged("outside", oid);
		f.git("worktree", "add", join(f.dir, "outside"), "outside");
		f.git("worktree", "add", `${f.root}-worktrees/exact`, "exact");
		writeFileSync(
			`${f.root}-worktrees/exact/untracked`,
			"removed with worktree",
		);
		const result = f.run({ yes: true });
		expect(result.code).toBe(0);
		expect(result.text).toContain("2 ブランチ・1 Worktree");
		expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
			"fork",
			"main",
			"outside",
			"unmerged",
		]);
	} finally {
		f.dispose();
	}
});

test("cleanup proves rebased patches, retaining whitespace differences and unpushed tips", () => {
	const f = fixture();
	try {
		f.git("switch", "-c", "rewritten");
		writeFileSync(join(f.root, "file"), "base\nchange\n");
		f.git("commit", "-am", "feature");
		const old = f.git("rev-parse", "HEAD");
		f.git("branch", "unpushed");
		f.git("switch", "main");
		writeFileSync(join(f.root, "other"), "independent\n");
		f.git("add", ".");
		f.git("commit", "-m", "independent");
		f.git("cherry-pick", old);
		const merged = f.git("rev-parse", "HEAD");
		f.git("push", "origin", "main");
		f.git("switch", "-c", "whitespace", "rewritten");
		writeFileSync(join(f.root, "file"), "base\nchange \n");
		f.git("commit", "-am", "whitespace", "--amend");
		f.git("switch", "main");
		for (const branch of ["rewritten", "whitespace", "unpushed"])
			f.merged(branch, merged);
		const review = f.run({ dryRun: true }, { API_FAIL: "1" });
		expect(review.code).toBe(0);
		expect(review.text).toContain("tip が origin に無い");
		expect(review.text).not.toContain("削除対象:");
		const result = f.run({ yes: true });
		expect(result.code).toBe(0);
		expect(result.text).toContain("要確認: whitespace");
		expect(result.text).toContain("パッチ非同値");
		expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
			"main",
			"whitespace",
		]);
	} finally {
		f.dispose();
	}
});

test("dry-run preserves refs and worktrees and never fetches", () => {
	const f = fixture();
	try {
		f.git("branch", "merged");
		const oid = f.git("rev-parse", "HEAD");
		f.merged("merged", oid);
		f.git("update-ref", "refs/remotes/origin/main", oid);
		f.git("remote", "set-url", "origin", join(f.dir, "missing"));
		const result = f.run({ dryRun: true });
		expect(result.code).toBe(0);
		expect(result.text).toContain("削除対象: merged");
		expect(result.text).not.toContain("fetch に失敗");
		expect(f.git("rev-parse", "merged")).toBe(oid);
	} finally {
		f.dispose();
	}
});

test("cleanup preserves locked worktree branches and fails safely on PR lookup errors", () => {
	const f = fixture();
	try {
		const oid = f.git("rev-parse", "HEAD");
		f.git("branch", "locked");
		f.merged("locked", oid);
		const path = `${f.root}-worktrees/locked`;
		f.git("worktree", "add", path, "locked");
		f.git("worktree", "lock", path);
		const failed = f.run({ yes: true }, { PR_FAIL: "1" });
		expect(failed.code).not.toBe(0);
		expect(failed.text).toContain("マージ済み PR を取得できません");
		const locked = f.run({ yes: true });
		expect(locked.code).not.toBe(0);
		expect(locked.text).toContain("削除に失敗したブランチ: locked");
		expect(f.git("rev-parse", "locked")).toBe(oid);
	} finally {
		f.dispose();
	}
});

test("cleanup reports missing gh without deleting candidates", () => {
	const f = fixture();
	try {
		f.git("branch", "candidate");
		const gitPath = Bun.which("git");
		if (!gitPath) throw new Error("Git is required for this test");
		const bin = join(f.dir, "git-only");
		mkdirSync(bin);
		symlinkSync(gitPath, join(bin, "git"));
		const result = f.run({ yes: true }, { PATH: bin });
		expect(result.code).not.toBe(0);
		expect(result.text).toContain("gh コマンドが見つかりません");
		expect(f.git("rev-parse", "candidate")).toBe(f.git("rev-parse", "HEAD"));
	} finally {
		f.dispose();
	}
});

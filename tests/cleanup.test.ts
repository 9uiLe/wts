import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliEnvironment, runCli } from "./helpers/cli";
import { gitWithEnv } from "./helpers/git";

function fixture(baseBranch?: string) {
	const base = baseBranch ?? "main";
	const dir = mkdtempSync(join(tmpdir(), "wts-cleanup-"));
	const root = join(dir, "repo");
	const remote = join(dir, "origin.git");
	const bin = join(dir, "bin");
	mkdirSync(root);
	mkdirSync(bin);
	const prData = join(dir, "prs.json");
	const env = cliEnvironment({
		PATH: `${bin}:${process.env.PATH}`,
		PR_DATA: prData,
		HOOK_MARKER: join(dir, "hook-done"),
	});
	function git(...args: string[]) {
		return gitWithEnv(root, args, env);
	}
	git("init", "-b", base);
	git("init", "--bare", remote);
	writeFileSync(
		join(root, ".wts.json"),
		JSON.stringify({ naming: {}, baseBranch }),
	);
	writeFileSync(join(root, "file"), "base\n");
	git("add", ".");
	git("commit", "-m", "base");
	git("remote", "add", "origin", remote);
	git("push", "-u", "origin", base);
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
		`#!${process.execPath}\nconst a = process.argv.slice(2);\nif (a[0] === 'repo') console.log('test/repo');\nelse if (a[0] === 'api') process.exit(process.env.API_FAIL === '1' ? 1 : 0);\nelse {if (process.env.PR_FAIL === '1') process.exit(1);const data = JSON.parse(await Bun.file(process.env.PR_DATA).text()); console.log(JSON.stringify(process.env.PR_RESPONSE ? JSON.parse(process.env.PR_RESPONSE) : data[a[a.indexOf('--head') + 1]] || []));}\n`,
		{ mode: 0o755 },
	);
	const realGit = Bun.which("git");
	if (!realGit) throw new Error("Git is required for this test");
	writeFileSync(
		join(bin, "git"),
		`#!${process.execPath}
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const git = (...a) => { const r = Bun.spawnSync([${JSON.stringify(realGit)}, ...a], { env: process.env }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
let phase = 'before';
if (process.env.GIT_HOOK) new Function('args', 'git', 'phase', 'existsSync', 'writeFileSync', process.env.GIT_HOOK)(args, git, phase, existsSync, writeFileSync);
const result = Bun.spawnSync([${JSON.stringify(realGit)}, ...args], { env: process.env, stdin: readFileSync(0) });
phase = 'after';
if (process.env.GIT_HOOK) new Function('args', 'git', 'phase', 'existsSync', 'writeFileSync', process.env.GIT_HOOK)(args, git, phase, existsSync, writeFileSync);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`,
		{ mode: 0o755 },
	);
	function run(
		options: { dryRun?: boolean; yes?: boolean },
		extra: Record<string, string> = {},
	) {
		writeFileSync(prData, JSON.stringify(heads));
		return runCli(
			root,
			[
				"cleanup",
				...(options.dryRun ? ["--dry-run"] : []),
				...(options.yes ? ["--yes"] : []),
			],
			{ ...env, ...extra },
		);
	}
	return {
		root,
		base,
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

const baseCases = [
	["default main", undefined],
	["configured master", "master"],
	["configured release/stable", "release/stable"],
] as const;

test.each(baseCases)(
	"cleanup proves rebased patches against %s, retaining whitespace differences and unpushed tips",
	(_label, baseBranch) => {
		const f = fixture(baseBranch);
		try {
			f.git("switch", "-c", "rewritten");
			writeFileSync(join(f.root, "file"), "base\nchange\n");
			f.git("commit", "-am", "feature");
			const old = f.git("rev-parse", "HEAD");
			f.git("branch", "unpushed");
			f.git("switch", f.base);
			writeFileSync(join(f.root, "other"), "independent\n");
			f.git("add", ".");
			f.git("commit", "-m", "independent");
			f.git("cherry-pick", old);
			const merged = f.git("rev-parse", "HEAD");
			f.git("push", "origin", f.base);
			f.git("switch", "-c", "whitespace", "rewritten");
			writeFileSync(join(f.root, "file"), "base\nchange \n");
			f.git("commit", "-am", "whitespace", "--amend");
			f.git("switch", f.base);
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
				f.base,
				"whitespace",
			]);
		} finally {
			f.dispose();
		}
	},
);

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
		expect(locked.text).toContain("worktree 削除: locked");
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

test.each(baseCases)(
	"cleanup protects %s independently of worktrees and fetches its updated ancestry",
	(_label, baseBranch) => {
		const f = fixture(baseBranch);
		try {
			const original = f.git("rev-parse", "HEAD");
			f.git("switch", "-c", "current");
			f.git("switch", "-c", "ancestor");
			writeFileSync(join(f.root, "file"), "updated base\n");
			f.git("commit", "-am", "update");
			const updated = f.git("rev-parse", "HEAD");
			f.git("push", "origin", `HEAD:refs/heads/${f.base}`);
			f.git("update-ref", `refs/remotes/origin/${f.base}`, original);
			f.git("switch", "current");
			f.merged(f.base, original);
			f.merged("ancestor", "rewritten");
			const result = f.run({ yes: true }, { API_FAIL: "1" });
			expect(result.code).toBe(0);
			expect(result.text).toContain("1 ブランチ・0 Worktree");
			expect(f.git("rev-parse", `origin/${f.base}`)).toBe(updated);
			expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual(
				["current", f.base].sort(),
			);
		} finally {
			f.dispose();
		}
	},
);

const beforeRevalidation = (mutation: string) => `
if (phase === 'before' && args.join(' ') === 'rev-parse --verify refs/heads/target') {
  if (existsSync(process.env.HOOK_MARKER)) { ${mutation} }
  else writeFileSync(process.env.HOOK_MARKER, 'classified');
}`;

test.each(["oid", "current", "other", "path"] as const)(
	"cleanup retains candidates when %s changes after classification",
	(change) => {
		const f = fixture();
		try {
			const oid = f.git("rev-parse", "HEAD");
			f.git("branch", "target");
			f.git("branch", "replacement");
			f.merged("target", oid);
			const path = `${f.root}-worktrees/target`;
			if (change === "path" || change === "oid")
				f.git("worktree", "add", path, "target");
			const mutation = {
				oid: `git('update-ref', 'refs/heads/target', git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'concurrent'));`,
				current: `git('switch', 'target');`,
				other: `git('worktree', 'add', ${JSON.stringify(join(f.dir, "other"))}, 'target');`,
				path: `git('-C', ${JSON.stringify(path)}, 'switch', 'replacement');`,
			}[change];
			const result = f.run(
				{ yes: true },
				{ GIT_HOOK: beforeRevalidation(mutation) },
			);
			expect(result.code).not.toBe(0);
			expect(result.text).toContain("再検証: target");
			expect(f.git("branch", "--format=%(refname:short)")).toContain("target");
			if (change === "path" || change === "oid")
				expect(f.git("worktree", "list", "--porcelain")).toContain(path);
		} finally {
			f.dispose();
		}
	},
);

test.each(["checkout", "oid"] as const)(
	"cleanup rechecks %s immediately before conditional ref deletion",
	(change) => {
		const f = fixture();
		try {
			const oid = f.git("rev-parse", "HEAD");
			f.git("branch", "target");
			f.git("config", "branch.target.description", "keep on failure");
			f.merged("target", oid);
			f.git("worktree", "add", `${f.root}-worktrees/target`, "target");
			const hook =
				change === "checkout"
					? `if (phase === 'after' && args[0] === 'worktree' && args[1] === 'remove') git('worktree', 'add', ${JSON.stringify(join(f.dir, "other"))}, 'target');`
					: `if (phase === 'before' && args[0] === 'update-ref') git('update-ref', 'refs/heads/target', git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'concurrent'));`;
			const result = f.run({ yes: true }, { GIT_HOOK: hook });
			expect(result.code).not.toBe(0);
			expect(result.text).toContain("参照削除: target");
			expect(result.text).toContain("0 ブランチ・1 Worktree");
			expect(f.git("branch", "--format=%(refname:short)")).toContain("target");
			expect(f.git("config", "branch.target.description")).toBe(
				"keep on failure",
			);
		} finally {
			f.dispose();
		}
	},
);

test("cleanup removes branch settings only after ref deletion and reports all failures despite prune failure", () => {
	const f = fixture();
	try {
		const oid = f.git("rev-parse", "HEAD");
		for (const branch of [
			"complete",
			"locked",
			"ref-failure",
			"settings-failure",
		]) {
			f.git("branch", branch);
			f.git("config", `branch.${branch}.description`, "description");
			f.merged(branch, oid);
		}
		const path = `${f.root}-worktrees/locked`;
		f.git("worktree", "add", path, "locked");
		f.git("worktree", "lock", path);
		const result = f.run(
			{ yes: true },
			{
				GIT_HOOK: `
if (phase === 'before' && (
  args.join(' ') === 'worktree prune' ||
  (args[0] === 'update-ref' && args[2] === 'refs/heads/ref-failure') ||
  (args[0] === 'config' && args[3] === 'branch.settings-failure')
)) { process.stderr.write('secret-token'); process.exit(1); }
`,
			},
		);
		expect(result.code).not.toBe(0);
		expect(result.text).toContain("2 ブランチ・0 Worktree");
		for (const phase of [
			"worktree 削除: locked",
			"参照削除: ref-failure",
			"ブランチ設定除去: settings-failure",
			"prune:",
		])
			expect(result.text).toContain(phase);
		expect(result.text).toContain("参照削除済み・設定残存");
		expect(result.text).not.toContain("secret-token");
		expect(f.git("branch", "--format=%(refname:short)").split("\n")).toEqual([
			"locked",
			"main",
			"ref-failure",
		]);
		expect(f.git("config", "--local", "--list")).not.toContain(
			"branch.complete.",
		);
		for (const branch of ["locked", "ref-failure", "settings-failure"])
			expect(f.git("config", `branch.${branch}.description`)).toBe(
				"description",
			);
	} finally {
		f.dispose();
	}
});

test.each(["dry-run-env", "missing-confirmation"] as const)(
	"cleanup CLI handles %s without deleting refs or worktrees",
	(mode) => {
		const f = fixture();
		try {
			const oid = f.git("rev-parse", "HEAD");
			f.git("branch", "target");
			f.merged("target", oid);
			const path = `${f.root}-worktrees/target`;
			f.git("worktree", "add", path, "target");
			const result = f.run(
				{},
				mode === "dry-run-env"
					? {
							DRY_RUN: "1",
							GIT_HOOK: `if (args[0] === 'fetch') { console.error('unexpected-fetch'); process.exit(1); }`,
						}
					: {},
			);
			expect(result.code === 0).toBe(mode === "dry-run-env");
			expect(result.text).toContain(
				mode === "dry-run-env" ? "削除予定:" : "TTY",
			);
			expect(result.text).not.toContain("unexpected-fetch");
			expect(f.git("rev-parse", "target")).toBe(oid);
			expect(f.git("worktree", "list", "--porcelain")).toContain(path);
		} finally {
			f.dispose();
		}
	},
);

test.each([
	"null",
	"[null]",
	'[{"headRefOid":42,"headRepository":null}]',
	'[{"headRefOid":"abc","headRepository":{}}]',
])(
	"cleanup rejects malformed PR data %s without deleting candidates",
	(response) => {
		const f = fixture();
		try {
			f.git("branch", "target");
			const result = f.run({ yes: true }, { PR_RESPONSE: response });
			expect(result.code).not.toBe(0);
			expect(result.text).toContain("gh が不正な PR 情報を返しました");
			expect(f.git("rev-parse", "target")).toBe(f.git("rev-parse", "HEAD"));
		} finally {
			f.dispose();
		}
	},
);

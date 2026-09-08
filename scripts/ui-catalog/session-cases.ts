import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type Capture, capture, context, fixture, git } from "./capture";

type Options = NonNullable<Parameters<typeof capture>[3]>;

function executable(path: string, source: string): void {
	writeFileSync(path, source);
	chmodSync(path, 0o755);
}

function gitWrapper(path: string, body: string): void {
	executable(
		path,
		`#!${context.bun}\nconst args = process.argv.slice(2);\n${body}\nconst child = Bun.spawnSync([${JSON.stringify(context.gitPath)}, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });\nprocess.exit(child.exitCode);\n`,
	);
}

export async function sessionCases(): Promise<Capture[]> {
	const items: Capture[] = [];
	const p = fixture("session-start");
	const d = dirname(p);
	const script = join(d, "name");
	const namingScript = `#!/bin/sh\nprintf "%s\\n" "\${PREVIEW_NAME:-feature-demo}"\n`;
	executable(script, namingScript);
	function config(value: unknown) {
		writeFileSync(join(p, ".wts.json"), JSON.stringify(value));
		git(p, "add", ".wts.json");
		git(p, "commit", "--allow-empty", "-m", "configure preview");
	}
	async function cap(
		title: string,
		args: string[],
		code: number,
		cwd = p,
		options: Options = {},
	) {
		const result = await capture(title, args, cwd, options);
		assert.equal(result.code, code, `${title}\n${result.raw}`);
		items.push(result);
		return result;
	}
	const base = ["start", "--base-branch", "main", "--task", ""];
	config({ baseBranch: "master", naming: { branch: { script } } });
	git(p, "push", "origin", "main:master");
	await cap(
		"start: 設定のベースで対話なし成功",
		["start", "--task", ""],
		0,
		p,
		{ pipe: true, env: { PREVIEW_NAME: "configured-base" } },
	);
	assert.equal(
		git(join(d, "repo-worktrees", "configured-base"), "rev-parse", "HEAD"),
		git(p, "rev-parse", "origin/master"),
	);
	config({ naming: { branch: { script } } });
	await cap("start: dry-run", [...base, "--dry-run"], 0);
	await cap("start: タスクとベースを対話入力", ["start", "--dry-run"], 0, p, {
		steps: [
			["作業内容", "preview\r"],
			["ベースブランチ", "\r"],
		],
	});
	await cap("start: タスク入力 Ctrl-C", ["start"], 0, p, {
		steps: [["作業内容", "\x03"]],
	});
	await cap("start: ベース入力 Ctrl-C", ["start", "--task", ""], 0, p, {
		steps: [["ベースブランチ", "\x03"]],
	});
	await cap("start: 非TTYで対話要求", ["start"], 1, p, { pipe: true });
	await cap(
		"start: 不正なベース",
		["start", "--task", "", "--base-branch=--bad"],
		1,
	);
	await cap(
		"start: ベースが見つからない",
		["start", "--task", "", "--base-branch", "missing"],
		1,
	);
	await cap("start: 不正なブランチ名", base, 1, p, {
		env: { PREVIEW_NAME: "invalid name" },
	});
	await cap("start: 既存ブランチ", base, 1, p, {
		env: { PREVIEW_NAME: "main" },
	});
	mkdirSync(join(d, "repo-worktrees", "existing"), { recursive: true });
	await cap("start: 作成先が既に存在", base, 1, p, {
		env: { PREVIEW_NAME: "existing" },
	});
	await cap("start: 通常成功", base, 0);
	const wt = join(d, "repo-worktrees", "feature-demo");
	// 登録済みパスのケースには、ディレクトリだけを移したworktreeが必要。
	const other = join(d, "repo-worktrees", "other");
	git(p, "worktree", "add", "-b", "other", other, "main");
	renameSync(other, join(d, "moved-other"));
	git(p, "branch", "-m", "other", "renamed-other");
	await cap("start: worktreeパスが登録済み", base, 1, p, {
		env: { PREVIEW_NAME: "other" },
	});
	git(p, "remote", "set-url", "origin", join(d, "no-origin"));
	await cap(
		"start: fetch失敗後ローカル参照で成功（通常実行）",
		["start", "--task", "", "--base-branch", "origin/main"],
		0,
		p,
		{ env: { PREVIEW_NAME: "fetch-warning" } },
	);
	for (const [name, body] of [
		["empty", 'printf "\\n"'],
		["multiple", 'printf "one\\ntwo\\n"'],
		["failure", "exit 1"],
	]) {
		writeFileSync(script, `#!/bin/sh\n${body}\n`);
		await cap(`start: 命名スクリプト ${name}`, base, 1);
	}
	writeFileSync(script, "#!/not-a-real-interpreter\n");
	await cap("start: 命名スクリプトを起動できない", base, 1);
	writeFileSync(script, namingScript);
	const wscript = join(d, "worktree-name");
	executable(wscript, '#!/bin/sh\nprintf ".git\\n"\n');
	config({ naming: { branch: { script }, worktree: { script: wscript } } });
	await cap("start: 不正なworktree名", base, 1, p, {
		env: { PREVIEW_NAME: "valid-branch" },
	});
	for (const [name, body] of [
		["empty", 'printf "\\n"'],
		["failure", "exit 1"],
		["spawn", ""],
	]) {
		writeFileSync(
			wscript,
			name === "spawn" ? "#!/not-a-real-interpreter\n" : `#!/bin/sh\n${body}\n`,
		);
		await cap(`start: worktree命名 ${name}`, base, 1, p, {
			env: { PREVIEW_NAME: "valid-branch" },
		});
	}
	config({ naming: { branch: { script } } });
	writeFileSync(
		join(p, ".worktree-copy"),
		"config.txt\n../outside\n.git\ninside-link\noutside-link\nspecial\nfolder\n",
	);
	writeFileSync(join(p, "config.txt"), "sample");
	symlinkSync(join(p, "config.txt"), join(p, "inside-link"));
	writeFileSync(join(d, "outside.txt"), "outside");
	symlinkSync(join(d, "outside.txt"), join(p, "outside-link"));
	const fifo = Bun.spawnSync(["/usr/bin/mkfifo", join(p, "special")], {
		stdout: "pipe",
		stderr: "pipe",
	});
	assert.equal(fifo.exitCode, 0, fifo.stderr.toString());
	mkdirSync(join(p, "folder"));
	writeFileSync(join(p, "folder", ".git"), "nested");
	await cap(
		"start: コピーdry-runと不正エントリ",
		[...base, "--dry-run"],
		0,
		p,
		{ env: { PREVIEW_NAME: "copy-dry" } },
	);
	await cap("start: コピー成功・リンク/FIFO/.git警告", base, 0, p, {
		env: { PREVIEW_NAME: "copy-real" },
	});
	await cap(
		"start: コピー元が存在しない",
		[...base, "--copy-from", "missing"],
		0,
		p,
		{ env: { PREVIEW_NAME: "copy-missing" } },
	);
	const stack = ["stack", "--task", "", "--pr-number", "2"];
	await cap("stack: worktree管理範囲外", stack, 1);
	await cap("stack: dry-run", [...stack, "--dry-run"], 0, wt);
	await cap("stack: タスクと番号を対話入力", ["stack", "--dry-run"], 0, wt, {
		steps: [
			["作業内容", "next\r"],
			["PR 番号", "\r"],
		],
	});
	await cap("stack: PR番号入力 Ctrl-C", ["stack", "--task", ""], 0, wt, {
		steps: [["PR 番号", "\x03"]],
	});
	await cap("stack: 非TTYで対話要求", ["stack"], 1, wt, { pipe: true });
	await cap(
		"stack: 不正なPR番号",
		["stack", "--task", "", "--pr-number", "1"],
		1,
		wt,
	);
	await cap("stack: 通常成功", stack, 0, wt);
	await cap("stack: 既存PR番号", stack, 1, wt);
	writeFileSync(join(wt, "dirty"), "dirty");
	await cap(
		"stack: 作業ツリーが非clean",
		["stack", "--task", "", "--pr-number", "3"],
		1,
		wt,
	);
	unlinkSync(join(wt, "dirty"));
	git(wt, "checkout", "feature-demo");
	await cap(
		"stack: 現在のブランチが先端以外",
		["stack", "--task", "", "--pr-number", "3"],
		1,
		wt,
	);
	const sf = join(
		git(wt, "rev-parse", "--absolute-git-dir"),
		"wts-session.json",
	);
	const original = readFileSync(sf, "utf8");
	unlinkSync(sf);
	await cap("stack: セッション情報なし", stack, 1, wt);
	for (const [title, content] of [
		["読み込み失敗", "{"],
		["構造不正", "{}"],
		["ブランチ名不正", '{"rootBranch":"invalid name"}'],
	] as const) {
		writeFileSync(sf, content);
		await cap(`stack: セッション${title}`, stack, 1, wt);
	}
	writeFileSync(sf, original);

	const c = fixture("session-cleanup");
	const cd = dirname(c);
	const bin = join(cd, "bin");
	mkdirSync(bin);
	executable(
		join(bin, "gh"),
		`#!${context.bun}\nconst a=process.argv.slice(2);const m=process.env.GH_MODE;if(a[0]==="repo"){if(m==="repo-fail")process.exit(1);console.log("preview/repo")}else if(a[0]==="api")process.exit(m==="api-fail"?1:0);else if(a[0]==="pr"){if(m==="pr-fail"){console.error("fixture: PR lookup failed");process.exit(1)}if(m==="invalid-json")console.log("{");else if(m==="non-array")console.log("{}");else console.log(m==="no-pr"?"[]":JSON.stringify([{headRefOid:process.env.GH_OID,headRepository:{nameWithOwner:"preview/repo"}}]));}\n`,
	);
	const env: Record<string, string> = {
		PATH: `${bin}:${dirname(context.gitPath)}:/usr/bin:/bin`,
	};
	async function clean(
		title: string,
		code = 0,
		args = ["cleanup", "--yes"],
		extra: Record<string, string> = {},
		options: Options = {},
	) {
		return cap(`cleanup: ${title}`, args, code, c, {
			...options,
			env: { ...env, ...extra },
		});
	}
	await clean("候補なし");
	await clean("候補なし dry-run", 0, ["cleanup", "--dry-run"]);
	git(c, "branch", "merged");
	env.GH_OID = git(c, "rev-parse", "HEAD");
	await clean("候補はあるがmerged PRなし（gh疑似応答）", 0, undefined, {
		GH_MODE: "no-pr",
	});
	await clean(
		"候補はあるがmerged PRなし dry-run（gh疑似応答）",
		0,
		["cleanup", "--dry-run"],
		{ GH_MODE: "no-pr" },
	);
	for (const mode of ["repo-fail", "pr-fail", "invalid-json", "non-array"]) {
		await clean(`${mode}（gh疑似応答）`, 1, undefined, { GH_MODE: mode });
	}
	await cap("cleanup: gh未導入", ["cleanup", "--yes"], 1, c);
	await clean("削除対象あり dry-run（gh疑似応答）", 0, [
		"cleanup",
		"--dry-run",
	]);
	await clean(
		"確認 No（gh疑似応答）",
		0,
		["cleanup"],
		{},
		{ steps: [["これらを削除しますか", "\r"]] },
	);
	await clean(
		"確認 Ctrl-C（gh疑似応答）",
		0,
		["cleanup"],
		{},
		{ steps: [["これらを削除しますか", "\x03"]] },
	);
	await clean(
		"非TTYで確認要求（gh疑似応答）",
		1,
		["cleanup"],
		{},
		{ pipe: true },
	);
	await clean(
		"確認 Yes、削除完了（gh疑似応答）",
		0,
		["cleanup"],
		{},
		{ steps: [["これらを削除しますか", "y\r"]] },
	);
	git(c, "branch", "tree");
	const tree = join(cd, "repo-worktrees", "tree");
	git(c, "worktree", "add", tree, "tree");
	await clean("worktree付き削除対象 dry-run（gh疑似応答）", 0, [
		"cleanup",
		"--dry-run",
	]);
	git(c, "worktree", "lock", tree);
	await clean("worktree削除失敗（gh疑似応答）", 1);
	git(c, "worktree", "unlock", tree);
	await clean("worktree付き削除完了（gh疑似応答）");
	git(c, "checkout", "-b", "review");
	writeFileSync(join(c, "change"), "change");
	git(c, "add", "change");
	git(c, "commit", "-m", "review");
	const reviewoid = git(c, "rev-parse", "HEAD");
	git(c, "checkout", "main");
	env.GH_OID = "0".repeat(40);
	await clean("パッチ非同値（gh疑似応答）", 0, ["cleanup", "--dry-run"]);
	await clean(
		"未push・パッチ非同値（gh疑似応答）",
		0,
		["cleanup", "--dry-run"],
		{ GH_MODE: "api-fail" },
	);
	git(c, "push", "origin", "review");
	await clean("originにブランチ残存・パッチ非同値（gh疑似応答）", 0, [
		"cleanup",
		"--dry-run",
	]);
	git(c, "worktree", "add", join(cd, "repo-worktrees", "review"), "review");
	await clean("要確認worktree削除指示（gh疑似応答）", 0, [
		"cleanup",
		"--dry-run",
	]);
	git(c, "remote", "set-url", "origin", join(cd, "missing-origin"));
	await clean("fetch失敗とorigin確認不能（gh疑似応答）");
	gitWrapper(
		join(bin, "git"),
		`const mode = process.env.PREVIEW_GIT_FAIL;\nif(mode === "merge" && args[0] === "rev-list") { console.log("2"); process.exit(0); }\nif(mode === "patch" && args[0] === "merge-base") process.exit(1);\nif(mode === "branch" && args[0] === "branch") process.exit(1);\nif(mode === "prune" && args[0] === "worktree" && args[1] === "prune") { console.error("fixture: prune failed"); process.exit(1); }`,
	);
	await clean(
		"独自merge commit（git/gh疑似応答）",
		0,
		["cleanup", "--dry-run"],
		{ PREVIEW_GIT_FAIL: "merge" },
	);
	await clean("パッチ比較失敗（git/gh疑似応答）", 0, ["cleanup", "--dry-run"], {
		PREVIEW_GIT_FAIL: "patch",
	});
	env.GH_OID = reviewoid;
	await clean("ブランチ削除失敗（git/gh疑似応答）", 1, undefined, {
		PREVIEW_GIT_FAIL: "branch",
	});
	await clean("worktree prune失敗（git/gh疑似応答）", 1, undefined, {
		PREVIEW_GIT_FAIL: "prune",
	});

	const failureRepo = fixture("session-failures");
	const ad = dirname(failureRepo);
	const s = join(ad, "naming");
	const defaultScript = `#!/bin/sh\nprintf "%s\\n" "\${PREVIEW_NAME:-demo}"\n`;
	executable(s, defaultScript);
	writeFileSync(
		join(failureRepo, ".wts.json"),
		JSON.stringify({ naming: { branch: { script: s } } }),
	);
	symlinkSync(join(ad, "destination"), join(failureRepo, "escape"));
	mkdirSync(join(ad, "destination"));
	git(failureRepo, "add", ".");
	git(failureRepo, "commit", "-m", "preview configuration");
	const copy = join(ad, "copy");
	mkdirSync(join(copy, "escape"), { recursive: true });
	writeFileSync(join(copy, "escape", "value"), "value");
	symlinkSync(join(copy, "not-present"), join(copy, "broken-link"));
	writeFileSync(join(failureRepo, ".worktree-copy"), "escape\nbroken-link\n");
	const failureBase = ["start", "--task", "", "--base-branch", "main"];
	await cap(
		"start: コピー先がシンボリックリンク",
		[...failureBase, "--copy-from", copy],
		0,
		failureRepo,
	);
	const awt = join(ad, "repo-worktrees", "demo");
	unlinkSync(join(failureRepo, ".worktree-copy"));
	mkdirSync(join(failureRepo, ".worktree-copy"));
	await cap("start: コピーリスト読み込み失敗", failureBase, 1, failureRepo, {
		env: { PREVIEW_NAME: "copy-list-error" },
	});
	rmdirSync(join(failureRepo, ".worktree-copy"));
	const abin = join(ad, "bin");
	mkdirSync(abin);
	gitWrapper(
		join(abin, "git"),
		`const mode = process.env.PREVIEW_GIT_FAIL;\nif(mode === "worktree" && args[0] === "worktree" && args[1] === "add") { console.error("fixture: worktree add failed"); process.exit(1); }\nif(mode === "checkout" && args[0] === "checkout") { console.error("fixture: checkout failed"); process.exit(1); }`,
	);
	const aenv = { PATH: `${abin}:${dirname(context.gitPath)}:/usr/bin:/bin` };
	await cap(
		"start: git worktree add失敗（git疑似応答）",
		failureBase,
		1,
		failureRepo,
		{
			env: { ...aenv, PREVIEW_NAME: "git-error", PREVIEW_GIT_FAIL: "worktree" },
		},
	);
	await cap("stack: git checkout失敗（git疑似応答）", stack, 1, awt, {
		env: { ...aenv, PREVIEW_GIT_FAIL: "checkout" },
	});
	await cap("stack: タスク入力Ctrl-C", ["stack"], 0, awt, {
		steps: [["作業内容", "\x03"]],
	});
	await cap(
		"stack: 非数字PR番号",
		["stack", "--task", "", "--pr-number", "abc"],
		1,
		awt,
	);
	await cap("stack: 生成したブランチ名が不正", stack, 1, awt, {
		env: { PREVIEW_NAME: "invalid name" },
	});
	for (const [name, body] of [
		["empty", 'printf "\\n"'],
		["failure", "exit 1"],
		["spawn", ""],
	]) {
		writeFileSync(
			s,
			name === "spawn" ? "#!/not-a-real-interpreter\n" : `#!/bin/sh\n${body}\n`,
		);
		await cap(`stack: branch命名 ${name}`, stack, 1, awt);
	}
	writeFileSync(s, defaultScript);
	git(failureRepo, "remote", "set-url", "origin", join(ad, "missing-origin"));
	git(failureRepo, "update-ref", "-d", "refs/remotes/origin/main");
	await cap(
		"start: fetch失敗後ローカル参照も不在",
		["start", "--task", "", "--base-branch", "origin/main"],
		1,
		failureRepo,
		{ env: { PREVIEW_NAME: "missing-base" } },
	);
	writeFileSync(join(failureRepo, ".wts.json"), "{}");
	git(failureRepo, "add", ".wts.json");
	git(failureRepo, "commit", "-m", "default naming");
	await cap(
		"start: 既定命名（日付UUID）",
		["start", "--base-branch", "main", "--dry-run"],
		0,
		failureRepo,
	);
	writeFileSync(
		join(failureRepo, ".wts.json"),
		JSON.stringify({
			worktreeDirectory: "../future-base",
			naming: { branch: { script: s } },
		}),
	);
	executable(
		s,
		`#!${context.bun}\nawait Bun.write(${JSON.stringify(join(ad, "future-base"))}, "file");\nconsole.log("fresh");\n`,
	);
	await cap("start: ファイルシステムI/O失敗", failureBase, 1, failureRepo);
	return items;
}

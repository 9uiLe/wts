import { mkdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Capture, capture, context, fixture, git } from "./capture";

type Options = Parameters<typeof capture>[3];

const errorEvidence: Record<string, string> = {
	"push-only leaseファイルなし": "rebase 開始時の lease 記録",
	"push-only branch leaseなし":
		"ブランチ session-pr2-second の lease 記録がありません",
	base不正: "不正なベースブランチ",
	base不存在: "ベースブランチ missing が見つかりません",
	作業ツリーdirty: "作業ツリーがクリーンではありません",
	rebase進行中: "rebase が進行中です",
	"他worktree checkout": "別の worktree でチェックアウト",
	非線形stack: "非線形スタックは対象外です",
	worktreesBase外: "配下ではありません",
	セッションなし: "セッション情報がありません",
	セッション読み込み不能: "セッション情報を読み込めません",
	セッション構造不正: "セッション情報が不正です",
	セッションbranch不正: "セッションのブランチ名が不正です",
	rebase競合: "CONFLICT",
	"origin lease取得失敗（Git疑似応答）": "simulated ls-remote failure",
	"tip checkout失敗（Git疑似応答）": "simulated checkout failure",
	"push失敗（Git疑似応答）": "simulated push failure",
	lease保存OSエラー: "EISDIR",
	lease読み込みOSエラー: "EISDIR",
	"push-only atomic lease拒否（実Git応答）": "stale info",
};

export async function restackCases(): Promise<Capture[]> {
	const items: Capture[] = [];
	const base = ["--base-branch", "origin/main"];
	const take = async (
		title: string,
		args: string[],
		cwd: string,
		expected = 1,
		options?: Options,
	) => {
		const result = await capture(
			`restack / ${title}`,
			["restack", ...args],
			cwd,
			options,
		);
		if (result.code !== expected)
			throw new Error(
				`${title}: expected exit ${expected}, got ${result.code}\n${result.raw}`,
			);
		const evidence = errorEvidence[title];
		if (evidence && !Bun.stripANSI(result.raw).includes(evidence))
			throw new Error(
				`${title}: expected diagnostic ${evidence}\n${result.raw}`,
			);
		items.push(result);
	};
	const setup = (name: string, conflict = false) => {
		const repo = fixture(`restack-${name}`);
		const worktree = join(`${repo}-worktrees`, "session");
		git(repo, "worktree", "add", "-b", "session", worktree);
		const gitDir = git(worktree, "rev-parse", "--absolute-git-dir");
		writeFileSync(join(gitDir, "wts-session.json"), '{"rootBranch":"session"}');
		writeFileSync(join(worktree, conflict ? "tracked" : "first"), "first\n");
		git(worktree, "add", ".");
		git(worktree, "commit", "-m", "first");
		git(worktree, "switch", "-c", "session-pr2-second");
		writeFileSync(join(worktree, "second"), "second\n");
		git(worktree, "add", ".");
		git(worktree, "commit", "-m", "second");
		git(worktree, "switch", "session");
		if (conflict) {
			writeFileSync(join(repo, "tracked"), "upstream\n");
			git(repo, "add", ".");
			git(repo, "commit", "-m", "upstream");
			git(repo, "push", "origin", "main");
		}
		return { repo, worktree, gitDir };
	};
	const normal = setup("normal");
	await take(
		"dry-run（未公開branchの空lease）",
		[...base, "--dry-run"],
		normal.worktree,
		0,
	);
	await take("ベース入力→push確認Yes", [], normal.worktree, 0, {
		steps: [
			["ベースブランチ", "\r"],
			["これらを push しますか？", "y\r"],
		],
	});
	await take("push不要", [...base, "--push"], normal.worktree, 0);
	const cancel = setup("cancel");
	await take("push確認No", base, cancel.worktree, 0, {
		steps: [["これらを push しますか？", "\r"]],
	});
	await take("push確認Ctrl-C", base, cancel.worktree, 0, {
		steps: [["これらを push しますか？", "\u0003"]],
	});
	await take(
		"push-only dry-run",
		[...base, "--push-only", "--dry-run"],
		cancel.worktree,
		0,
	);
	await take(
		"push-only成功",
		[...base, "--push-only", "--push"],
		cancel.worktree,
		0,
	);
	await take("ベース入力Ctrl-C", [], cancel.worktree, 0, {
		steps: [["ベースブランチ", "\u0003"]],
	});
	await take("ベース入力非TTY", [], cancel.worktree, 1, { pipe: true });
	const errors = setup("errors");
	await take("push確認非TTY", base, errors.worktree, 1, { pipe: true });
	unlinkSync(join(errors.gitDir, "restack-lease"));
	await take(
		"push-only leaseファイルなし",
		[...base, "--push-only"],
		errors.worktree,
	);
	writeFileSync(join(errors.gitDir, "restack-lease"), "session \n");
	await take(
		"push-only branch leaseなし",
		[...base, "--push-only"],
		errors.worktree,
	);
	await take("base不正", ["--base-branch=-bad"], errors.worktree);
	await take("base不存在", ["--base-branch", "missing"], errors.worktree);
	writeFileSync(join(errors.worktree, "dirty"), "dirty");
	await take("作業ツリーdirty", base, errors.worktree);
	unlinkSync(join(errors.worktree, "dirty"));
	mkdirSync(join(errors.gitDir, "rebase-merge"));
	await take("rebase進行中", base, errors.worktree);
	rmdirSync(join(errors.gitDir, "rebase-merge"));
	const other = join(dirname(errors.worktree), "other");
	git(errors.repo, "worktree", "add", other, "session-pr2-second");
	await take("他worktree checkout", base, errors.worktree);
	git(errors.repo, "worktree", "remove", other);
	git(errors.repo, "branch", "-f", "session-pr2-second", "main");
	await take("非線形stack", base, errors.worktree);
	const session = setup("session");
	await take("worktreesBase外", base, session.repo);
	const sessionFile = join(session.gitDir, "wts-session.json");
	unlinkSync(sessionFile);
	await take("セッションなし", base, session.worktree);
	for (const [title, content] of [
		["セッション読み込み不能", "no json"],
		["セッション構造不正", "{}"],
		["セッションbranch不正", '{"rootBranch":"@{bad"}'],
		["Git rev-parse失敗（root branchなし）", '{"rootBranch":"missing"}'],
	] as const) {
		writeFileSync(sessionFile, content);
		await take(title, base, session.worktree);
	}
	const conflict = setup("conflict", true);
	await take("rebase競合", [...base, "--push"], conflict.worktree);
	const wrapper = join(context.root, "restack-wrapper");
	mkdirSync(wrapper);
	writeFileSync(
		join(wrapper, "git"),
		`#!${context.bun}\nconst args=process.argv.slice(2);const mode=process.env.WTS_PREVIEW_MODE;
if(mode==='old-version'&&args[0]==='--version'){console.log('git version 2.37.0');process.exit(0)}
if(mode==='bad-version'&&args[0]==='--version'){console.log('unknown version');process.exit(0)}
const fail=(mode==='fetch'&&args[0]==='fetch')||(mode==='remote'&&args[0]==='ls-remote')||(mode==='push'&&args[0]==='push')||(mode==='checkout'&&args.join(' ')==='checkout session-pr2-second')||(mode==='restore'&&args.join(' ')==='checkout session');
if(fail){console.error('preview: simulated '+args[0]+' failure');process.exit(1)}
const result=Bun.spawnSync([${JSON.stringify(context.gitPath)},...args],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(result.exitCode);\n`,
		{ mode: 0o755 },
	);
	const fake = (mode: string) => ({
		PATH: `${wrapper}:${dirname(context.gitPath)}:/usr/bin:/bin`,
		WTS_PREVIEW_MODE: mode,
	});
	const injected = setup("injected");
	for (const [mode, title] of [
		["old-version", "Git 2.38未満"],
		["bad-version", "Git版数判定不能"],
		["remote", "origin lease取得失敗"],
		["checkout", "tip checkout失敗"],
		["push", "push失敗"],
		["restore", "元branch復帰失敗"],
	] as const)
		await take(
			`${title}（Git疑似応答）`,
			[...base, "--push"],
			injected.worktree,
			mode === "restore" ? 0 : 1,
			{ env: fake(mode) },
		);
	git(injected.worktree, "checkout", "session");
	await take(
		"fetch失敗→ローカル参照で成功（Git疑似応答）",
		[...base, "--push"],
		injected.worktree,
		0,
		{ env: fake("fetch") },
	);
	const filesystem = setup("filesystem");
	mkdirSync(join(filesystem.gitDir, "restack-lease"));
	await take("lease保存OSエラー", [...base, "--push"], filesystem.worktree);
	await take(
		"lease読み込みOSエラー",
		[...base, "--push-only"],
		filesystem.worktree,
	);
	await take(
		"dry-run（公開済みbranchのOID付きlease）",
		[...base, "--dry-run"],
		normal.worktree,
		0,
	);
	const extraWrapper = join(context.root, "restack-extra-wrapper");
	mkdirSync(extraWrapper);
	writeFileSync(
		join(extraWrapper, "git"),
		`#!${context.bun}\nconst args=process.argv.slice(2);if(args[0]===process.env.WTS_PREVIEW_FAIL){console.error('preview: simulated '+args[0]+' failure');process.exit(1)}const result=Bun.spawnSync([${JSON.stringify(context.gitPath)},...args],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(result.exitCode);\n`,
		{ mode: 0o755 },
	);
	for (const sub of ["status", "--version", "for-each-ref", "worktree"])
		await take(
			`Git ${sub}失敗（Git疑似応答）`,
			[...base, "--push"],
			normal.worktree,
			1,
			{ env: { PATH: `${extraWrapper}:/usr/bin:/bin`, WTS_PREVIEW_FAIL: sub } },
		);
	await take("Gitコマンドなし", base, normal.worktree, 1, {
		env: { PATH: join(context.root, "no-tools") },
	});
	git(conflict.repo, "config", "core.editor", "/usr/bin/true");
	writeFileSync(join(conflict.worktree, "tracked"), "resolved\n");
	git(conflict.worktree, "add", "tracked");
	git(conflict.worktree, "rebase", "--continue");
	git(conflict.repo, "push", "origin", "main:session");
	await take(
		"push-only atomic lease拒否（実Git応答）",
		[...base, "--push-only", "--push"],
		conflict.worktree,
	);
	return items;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Capture, capture, fixture, git } from "./capture";

export async function discardCases(): Promise<Capture[]> {
	const repo = fixture("discard");
	const target = join(dirname(repo), "repo-worktrees", "discard-demo");
	git(repo, "worktree", "add", "-b", "discard-demo", target);
	writeFileSync(
		join(git(target, "rev-parse", "--absolute-git-dir"), "wts-session.json"),
		JSON.stringify({ rootBranch: "discard-demo" }),
	);
	git(repo, "branch", "discard-demo-pr2-next");
	const items: Capture[] = [];
	const take = async (
		title: string,
		args: string[],
		expected: number,
		cwd = repo,
		options: Parameters<typeof capture>[3] = {},
	) => {
		const result = await capture(`discard: ${title}`, args, cwd, options);
		if (result.code !== expected) throw new Error(`${title}: ${result.raw}`);
		items.push(result);
	};
	await take("削除予定", ["discard", target, "--dry-run"], 0);
	await take("実行中のworktreeを保護", ["discard", target, "--yes"], 1, target);
	await take("メインworktreeを保護", ["discard", repo, "--yes"], 1);
	await take("非TTYで確認要求", ["discard", target], 1, repo, { pipe: true });
	for (const [title, input] of [
		["否定", "\r"],
		["Ctrl-C", "\x03"],
	]) {
		await take(title as string, ["discard", target], 0, repo, {
			steps: [["このセッションを破棄しますか", input as string]],
		});
	}
	git(repo, "worktree", "lock", target);
	await take("ロックを保護", ["discard", target, "--yes", "--force"], 1);
	git(repo, "worktree", "unlock", target);
	writeFileSync(join(target, "unsaved"), "work");
	await take("未保存ファイルの予定", ["discard", target, "--dry-run"], 0);
	await take("未保存ファイルを保護", ["discard", target, "--yes"], 1);
	await take("forceで破棄を確認", ["discard", target, "--force"], 0, repo, {
		steps: [["このセッションを破棄しますか", "y\r"]],
	});
	const unmanaged = join(dirname(repo), "repo-worktrees", "unmanaged");
	git(repo, "worktree", "add", "-b", "unmanaged", unmanaged);
	await take("未管理worktreeを保護", ["discard", unmanaged, "--yes"], 1);
	mkdirSync(join(unmanaged, "child"));
	await take(
		"worktreeのサブディレクトリを拒否",
		["discard", join(unmanaged, "child"), "--yes"],
		1,
	);
	return items;
}

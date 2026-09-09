import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSameOrDescendant } from "./path";
import { Git } from "./git";

export function sessionRootBranch(repo: {
	root: string;
	worktreesBase: string;
	gitDir: string;
}): string {
	if (
		repo.root === repo.worktreesBase ||
		!isSameOrDescendant(repo.root, repo.worktreesBase)
	) {
		throw new Error(
			`この worktree は ${repo.worktreesBase} 配下ではありません。`,
		);
	}
	const file = join(repo.gitDir, "wts-session.json");
	if (!existsSync(file)) {
		throw new Error(
			"wts のセッション情報がありません。wts start で作成した worktree 内で実行してください。",
		);
	}
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new Error(`セッション情報を読み込めません: ${file}`);
	}
	if (
		!data ||
		typeof data !== "object" ||
		!("rootBranch" in data) ||
		typeof data.rootBranch !== "string"
	) {
		throw new Error(`セッション情報が不正です: ${file}`);
	}
	const git = new Git(repo.root);
	if (
		data.rootBranch.startsWith("@{") ||
		git.tryRun(["check-ref-format", "--branch", data.rootBranch]).code !== 0
	) {
		throw new Error(`セッションのブランチ名が不正です: ${file}`);
	}
	return data.rootBranch;
}

export function recordSession(
	git: Git,
	target: string,
	rootBranch: string,
): void {
	const gitDir = git.run(["-C", target, "rev-parse", "--absolute-git-dir"]);
	writeFileSync(
		join(gitDir, "wts-session.json"),
		`${JSON.stringify({ rootBranch })}\n`,
		{ flag: "wx" },
	);
}

export function stackBranches(
	git: Git,
	rootBranch: string,
): { branch: string; number: bigint }[] {
	const prefix = `${rootBranch}-pr`;
	const members = git
		.run(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
		.split("\n")
		.flatMap((branch) => {
			if (!branch.startsWith(prefix)) return [];
			const match = /^(\d+)-/.exec(branch.slice(prefix.length));
			return match ? [{ branch, number: BigInt(match[1] as string) }] : [];
		});
	members.sort((a, b) =>
		a.number < b.number
			? -1
			: a.number > b.number
				? 1
				: a.branch.localeCompare(b.branch),
	);
	return [{ branch: rootBranch, number: 1n }, ...members];
}

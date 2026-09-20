import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSameOrDescendant } from "./path";
import type { Git } from "./git";

type StackBranch = { branch: string; number: bigint; oid: string };

export type Session = { root: string; branches: StackBranch[] };

export function readSession(
	repo: { root: string; worktreesBase: string; gitDir: string },
	refs: ReadonlyMap<string, string>,
): Session {
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
	// refs/heads の参照名として存在しても checkout のブランチ名には使えない。
	if (
		data.rootBranch === "HEAD" ||
		data.rootBranch.startsWith("-") ||
		data.rootBranch.startsWith("@{")
	)
		throw new Error(`セッションのブランチ名が不正です: ${file}`);
	return {
		root: data.rootBranch,
		branches: stackBranches(refs, data.rootBranch),
	};
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

function stackBranches(
	refs: ReadonlyMap<string, string>,
	rootBranch: string,
): StackBranch[] {
	const oid = refs.get(rootBranch);
	if (!oid)
		throw new Error(`セッションのブランチが存在しません: ${rootBranch}`);
	const prefix = `${rootBranch}-pr`;
	const members = [...refs].flatMap(([branch, oid]) => {
		if (!branch.startsWith(prefix)) return [];
		const match = /^(\d+)-/.exec(branch.slice(prefix.length));
		return match ? [{ branch, oid, number: BigInt(match[1] as string) }] : [];
	});
	members.sort((a, b) =>
		a.number < b.number
			? -1
			: a.number > b.number
				? 1
				: a.branch.localeCompare(b.branch),
	);
	return [{ branch: rootBranch, number: 1n, oid }, ...members];
}

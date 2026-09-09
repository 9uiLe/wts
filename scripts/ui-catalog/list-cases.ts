import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { type Capture, capture, git, fixture } from "./capture";

export async function listCases(): Promise<Capture[]> {
	const repo = fixture("list");
	const cases: Capture[] = [];
	const take = async (title: string) => {
		const result = await capture(title, ["list"], repo);
		if (result.code !== 0) throw new Error(`${title}: ${result.raw}`);
		cases.push(result);
	};
	await take("list 空の管理範囲");
	for (const name of ["session", "clean", "manual", "broken"]) {
		const path = `${repo}-worktrees/${name}`;
		git(repo, "worktree", "add", "-b", name, path);
		if (name !== "manual") {
			const gitDir = git(path, "rev-parse", "--absolute-git-dir");
			writeFileSync(
				join(gitDir, "wts-session.json"),
				name === "broken" ? "{" : JSON.stringify({ rootBranch: name }),
			);
		}
		if (name === "session") {
			git(path, "switch", "-c", "session-pr2-followup");
			writeFileSync(join(path, "untracked"), "dirty");
		}
	}
	await take("list セッションと未管理 worktree");
	return cases;
}

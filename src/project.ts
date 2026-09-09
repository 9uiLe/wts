import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadProjectConfig, type ProjectConfig } from "./config";
import { Git } from "./git";
import { askText } from "./prompts";

export function projectBase(config: ProjectConfig) {
	const branch = config.baseBranch ?? "main";
	return { branch, remoteRef: `origin/${branch}` };
}

export async function resolveBaseRef(
	config: ProjectConfig,
	override?: string,
): Promise<string> {
	if (override) return override;
	const { remoteRef } = projectBase(config);
	return config.baseBranch
		? remoteRef
		: askText("ベースブランチ", defaultBaseRef());
}

export function repositoryLocation() {
	const initial = new Git();
	const root = realpathSync(initial.run(["rev-parse", "--show-toplevel"]));
	const git = new Git(root);
	const common = realpathSync(
		resolve(root, git.run(["rev-parse", "--git-common-dir"])),
	);
	const main = dirname(common);
	const gitDir = realpathSync(
		resolve(root, git.run(["rev-parse", "--git-dir"])),
	);
	return { git, root, main, gitDir };
}

export async function repository() {
	const location = repositoryLocation();
	const config = loadProjectConfig(location.root, location.main);
	return {
		...location,
		worktreesBase: config.worktreesBase,
		config,
	};
}

export function defaultBaseRef(git = new Git()): string {
	const result = git.tryRun([
		"symbolic-ref",
		"--quiet",
		"--short",
		"refs/remotes/origin/HEAD",
	]);
	return result.code === 0 && result.out.startsWith("origin/")
		? result.out
		: "origin/main";
}

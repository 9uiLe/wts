import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadProjectConfig } from "./config";
import { Git } from "./git";

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

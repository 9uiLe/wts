import { initializeConfig } from "../config";
import { repositoryLocation } from "../project";
import { ui } from "../ui";

export function init(options: { baseBranch?: string } = {}): void {
	ui.heading("init");
	const { git, root, main } = repositoryLocation();
	const path = initializeConfig(root, main, options.baseBranch);
	if (options.baseBranch === undefined) {
		const candidate = git.tryRun([
			"symbolic-ref",
			"--quiet",
			"--short",
			"refs/remotes/origin/HEAD",
		]);
		if (candidate.code === 0)
			ui.info(
				`ベース候補: ${candidate.out}（未保存。作業の基準を確認して baseBranch を設定してください）`,
			);
	}
	ui.success("設定を生成しました");
	ui.details([
		["Config", path],
		["Next", "wts config check"],
	]);
}

import { commandAsync } from "../process";
import { parseGitVersion, supportsUpdateRefs } from "../git-version";
import { confirmAction, isInteractive } from "../prompts";
import { ui } from "../ui";
import { version } from "../version";

export async function doctor({
	interactive,
	check,
}: {
	interactive?: boolean;
	check?: boolean;
}): Promise<void> {
	if (check) {
		await checkEnvironment();
		return;
	}
	if (!interactive) {
		ui.heading("doctor");
		ui.line(`wts ${version}`);
		ui.line(`platform=${process.platform}`);
		ui.line(`arch=${process.arch}`);
		return;
	}

	if (!isInteractive()) {
		throw new Error("対話モードは TTY 端末で実行してください。");
	}

	ui.heading("doctor");
	if (
		!(await confirmAction("起動環境を表示しますか？", { initialValue: true }))
	)
		return;

	ui.success(`${process.platform} / ${process.arch}`);
}

async function run(executable: string, args: string[]) {
	try {
		const result = await commandAsync(executable, args, process.cwd());
		return { exitCode: result.code, stdout: result.out };
	} catch {
		return undefined;
	}
}

export async function checkEnvironment({
	platform = process.platform,
	arch = process.arch,
}: {
	platform?: string;
	arch?: string;
} = {}): Promise<void> {
	let failed = false;
	function report(ok: boolean, message: string) {
		ui.check(ok, message);
		if (!ok) failed = true;
	}

	ui.heading("doctor");
	report(
		platform === "darwin" && arch === "arm64",
		`実行環境 ${platform} / ${arch}（対応: Apple Silicon macOS）`,
	);

	const git = await ui.task("Git のバージョンを確認しています…", () =>
		run("git", ["--version"]),
	);
	const version = parseGitVersion(git?.stdout ?? "");
	const compatible = git?.exitCode === 0 && supportsUpdateRefs(git.stdout);
	report(
		compatible,
		compatible
			? `Git ${version?.major}.${version?.minor}（restack に必要な 2.38 以上）`
			: "Git 2.38 以上が必要です。導入・更新: brew install git（導入済みなら brew upgrade git）。PATH も確認してください。",
	);

	const gh = await ui.task("GitHub CLI を確認しています…", () =>
		run("gh", ["--version"]),
	);
	const hasGh = gh?.exitCode === 0;
	report(
		hasGh,
		hasGh ? "GitHub CLI" : "GitHub CLI を実行できません。導入: brew install gh",
	);
	if (hasGh) {
		const authenticated =
			(
				await ui.task("GitHub CLI の認証を確認しています…", () =>
					run("gh", ["auth", "status"]),
				)
			)?.exitCode === 0;
		report(
			authenticated,
			authenticated
				? "GitHub CLI 認証"
				: "GitHub CLI の認証を確認できません。gh auth login とネットワーク接続を確認してください。",
		);
	}

	if (Bun.which("claude")) {
		ui.check(
			true,
			"Claude CLI（任意・Claude 用命名スクリプトを設定した場合に使用）",
		);
	} else {
		ui.info(
			"任意: Claude CLI は未導入です。日付＋UUID によるブランチ命名を利用できます。",
		);
	}
	process.exitCode = failed ? 1 : 0;
}

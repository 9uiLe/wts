function run(executable: string, args: string[]) {
	try {
		return Bun.spawnSync([executable, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
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
		console.log(`${ok ? "OK" : "NG"}: ${message}`);
		if (!ok) failed = true;
	}

	report(
		platform === "darwin" && arch === "arm64",
		`実行環境 ${platform} / ${arch}（対応: Apple Silicon macOS）`,
	);

	const git = run("git", ["--version"]);
	const version = git?.stdout.toString().match(/^git version (\d+)\.(\d+)/);
	const compatible =
		git?.exitCode === 0 &&
		version !== null &&
		version !== undefined &&
		(Number(version[1]) > 2 ||
			(Number(version[1]) === 2 && Number(version[2]) >= 38));
	report(
		compatible,
		compatible
			? `Git ${version?.[1]}.${version?.[2]}（restack に必要な 2.38 以上）`
			: "Git 2.38 以上が必要です。導入・更新: brew install git（導入済みなら brew upgrade git）。PATH も確認してください。",
	);

	const gh = run("gh", ["--version"]);
	const hasGh = gh?.exitCode === 0;
	report(
		hasGh,
		hasGh ? "GitHub CLI" : "GitHub CLI を実行できません。導入: brew install gh",
	);
	if (hasGh) {
		const authenticated = run("gh", ["auth", "status"])?.exitCode === 0;
		report(
			authenticated,
			authenticated
				? "GitHub CLI 認証"
				: "GitHub CLI の認証を確認できません。gh auth login とネットワーク接続を確認してください。",
		);
	}

	console.log(
		Bun.which("claude")
			? "OK: Claude CLI（任意・作業内容からのブランチ命名に使用）"
			: "任意: Claude CLI は未導入です。日時によるブランチ命名を利用できます。",
	);
	process.exitCode = failed ? 1 : 0;
}

import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Capture, capture, context, fixture } from "./capture";

type Options = Parameters<typeof capture>[3];

const errorEvidence: Record<string, string> = {
	"init 初期化済み": "初期化済みです。既存の設定を確認してください",
	"init Git外": "git rev-parse に失敗しました。",
	"config check 読込不可": "設定ファイルを読み込めません",
	"config check JSON構文不正": "設定ファイルの JSON 構文が不正です",
	"config check ルート型不正": ".wts.json はオブジェクトで指定してください。",
	"config check 未知キー": "不明な設定キー: .wts.json.unknown",
	"config check worktreeDirectory型不正":
		"worktreeDirectory は文字列で指定してください。",
	"config check NUL": "worktreeDirectory に NUL は使用できません。",
	"config check 空パス": "worktreeDirectory に空のパスは指定できません。",
	"config check naming型不正": "naming はオブジェクトで指定してください。",
	"config check naming未知キー": "不明な設定キー: naming.unknown",
	"config check branch型不正":
		"naming.branch はオブジェクトで指定してください。",
	"config check branch未知キー": "不明な設定キー: naming.branch.unknown",
	"config check script型不正":
		"naming.branch.script は文字列で指定してください。",
	"config check script存在しない":
		"naming.branch.script は実在する実行可能ファイルを指定してください",
	"config check メイン自身":
		"worktreeDirectory にメインリポジトリそのものは指定できません。",
	"config check git配下":
		"worktreeDirectory に .git 管理情報の配下は指定できません。",
	"config check 親がファイル":
		"worktreeDirectory の既存の親は書き込み可能なディレクトリである必要があります",
	"config check branch prompt型不正":
		"naming.branch.prompt は文字列で指定してください。",
	"config check branch prompt NUL":
		"naming.branch.prompt に NUL は使用できません。",
	"config check worktree prompt型不正":
		"naming.worktree.prompt は文字列で指定してください。",
	"config check worktree prompt NUL":
		"naming.worktree.prompt に NUL は使用できません。",
	"config 設定なし": ".wts.json がありません。wts init を実行してください。",
	"start 設定なし": ".wts.json がありません。wts init を実行してください。",
	"stack 設定なし": ".wts.json がありません。wts init を実行してください。",
	"cleanup 設定なし": ".wts.json がありません。wts init を実行してください。",
	"restack 設定なし": ".wts.json がありません。wts init を実行してください。",
	"init Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"config Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"start Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"stack Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"cleanup Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"restack Gitコマンドなし":
		"git コマンドが見つかりません。PATH を確認してください。",
	"init 設定書込不可": "設定ファイルを作成できません",
	"config check 設定読込権限なし": "設定ファイルを読み込めません",
	"config check パス確認不可": "パスを確認できません",
	"config check 親ディレクトリ書込不可":
		"worktreeDirectory の既存の親は書き込み可能なディレクトリである必要があります",
	"config check branch 型不正":
		"naming.branch はオブジェクトで指定してください。",
	"config check branch 未知キー": "不明な設定キー: naming.branch.unknown",
	"config check branch script型不正":
		"naming.branch.script は文字列で指定してください。",
	"config check branch script NUL":
		"naming.branch.script に NUL は使用できません。",
	"config check branch script空パス":
		"naming.branch.script に空のパスは指定できません。",
	"config check branch script不在":
		"naming.branch.script は実在する実行可能ファイルを指定してください",
	"config check worktree 型不正":
		"naming.worktree はオブジェクトで指定してください。",
	"config check worktree 未知キー": "不明な設定キー: naming.worktree.unknown",
	"config check worktree script型不正":
		"naming.worktree.script は文字列で指定してください。",
	"config check worktree script NUL":
		"naming.worktree.script に NUL は使用できません。",
	"config check worktree script空パス":
		"naming.worktree.script に空のパスは指定できません。",
	"config check worktree script不在":
		"naming.worktree.script は実在する実行可能ファイルを指定してください",
	"config check script実行権限なし":
		"naming.branch.script は実在する実行可能ファイルを指定してください",
	"config Gitリポジトリ外": "git rev-parse に失敗しました。",
	"start Gitリポジトリ外": "git rev-parse に失敗しました。",
	"stack Gitリポジトリ外": "git rev-parse に失敗しました。",
	"cleanup Gitリポジトリ外": "git rev-parse に失敗しました。",
	"restack Gitリポジトリ外": "git rev-parse に失敗しました。",
};

export async function configCases(): Promise<Capture[]> {
	const items: Capture[] = [];
	const take = async (
		title: string,
		args: string[],
		cwd = context.root,
		expected = 1,
		options?: Options,
	) => {
		const result = await capture(title, args, cwd, options);
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
	const repo = fixture("config-fixture");
	const config = join(repo, ".wts.json");
	unlinkSync(config);
	await take("init 設定生成", ["init"], repo, 0);
	await take("init 初期化済み", ["init"], repo);
	await take("init Git外", ["init"]);
	await take("config check 正常・自動探索", ["config", "check"], repo, 0);
	await take(
		"config check 明示パス",
		["config", "check", config],
		context.root,
		0,
	);
	await take("config check 読込不可", [
		"config",
		"check",
		join(repo, "missing"),
	]);
	for (const [name, data] of [
		["JSON構文不正", "{"],
		["ルート型不正", "[]"],
		["未知キー", '{"unknown":true}'],
		["worktreeDirectory型不正", '{"worktreeDirectory":1}'],
		["NUL", '{"worktreeDirectory":"\\u0000"}'],
		["空パス", '{"worktreeDirectory":" "}'],
		["naming型不正", '{"naming":[]}'],
		["naming未知キー", '{"naming":{"unknown":{}}}'],
		["branch型不正", '{"naming":{"branch":[]}}'],
		["branch未知キー", '{"naming":{"branch":{"unknown":1}}}'],
		["script型不正", '{"naming":{"branch":{}}}'],
		["script存在しない", '{"naming":{"branch":{"script":"missing"}}}'],
		["メイン自身", '{"worktreeDirectory":"."}'],
		["git配下", '{"worktreeDirectory":".git/inside"}'],
		["親がファイル", '{"worktreeDirectory":"tracked/inside"}'],
	] as const) {
		writeFileSync(config, data);
		await take(`config check ${name}`, ["config", "check"], repo);
	}
	writeFileSync(join(repo, "namer"), "#!/bin/sh\necho preview\n", {
		mode: 0o755,
	});
	for (const kind of ["branch", "worktree"])
		for (const [name, value] of [
			["prompt型不正", 1],
			["prompt NUL", "\0"],
		] as const) {
			writeFileSync(
				config,
				JSON.stringify({
					naming: { [kind]: { script: "./namer", prompt: value } },
				}),
			);
			await take(`config check ${kind} ${name}`, ["config", "check"], repo);
		}
	unlinkSync(config);
	for (const command of ["config", "start", "stack", "cleanup", "restack"])
		await take(
			`${command} 設定なし`,
			command === "config" ? ["config", "check"] : [command, "--dry-run"],
			repo,
		);
	for (const command of [
		"init",
		"config",
		"start",
		"stack",
		"cleanup",
		"restack",
	])
		await take(
			`${command} Gitコマンドなし`,
			command === "config" ? ["config", "check"] : [command],
			repo,
			1,
			{ env: { PATH: "" } },
		);
	items.push(...(await configurationValidationCases()));
	return items;
}

async function configurationValidationCases(): Promise<Capture[]> {
	const items: Capture[] = [];
	const repo = fixture("config-validation");
	const config = join(repo, ".wts.json");
	const take = async (
		title: string,
		args = ["config", "check"],
		expected = 1,
		cwd = repo,
	) => {
		const result = await capture(title, args, cwd);
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
	unlinkSync(config);
	chmodSync(repo, 0o555);
	try {
		await take("init 設定書込不可", ["init"]);
	} finally {
		chmodSync(repo, 0o755);
	}
	writeFileSync(config, "{}");
	chmodSync(config, 0);
	try {
		await take("config check 設定読込権限なし");
	} finally {
		chmodSync(config, 0o644);
	}
	const locked = join(repo, "locked");
	mkdirSync(locked);
	chmodSync(locked, 0);
	writeFileSync(config, JSON.stringify({ worktreeDirectory: "locked/child" }));
	try {
		await take("config check パス確認不可");
	} finally {
		chmodSync(locked, 0o555);
	}
	writeFileSync(config, JSON.stringify({ worktreeDirectory: "locked" }));
	try {
		await take("config check 親ディレクトリ書込不可");
	} finally {
		chmodSync(locked, 0o755);
	}
	for (const kind of ["branch", "worktree"])
		for (const [name, value] of [
			["型不正", []],
			["未知キー", { unknown: 1 }],
			["script型不正", { script: 1 }],
			["script NUL", { script: "\0" }],
			["script空パス", { script: " " }],
			["script不在", { script: "absent" }],
		] as const) {
			writeFileSync(config, JSON.stringify({ naming: { [kind]: value } }));
			await take(`config check ${kind} ${name}`);
		}
	const script = join(repo, "namer");
	writeFileSync(script, "#!/bin/sh\necho preview\n", { mode: 0o755 });
	writeFileSync(
		config,
		JSON.stringify({
			naming: {
				branch: { script: "./namer" },
				worktree: { script: "./namer" },
			},
		}),
	);
	await take("config check 命名script指定で正常", ["config", "check"], 0);
	chmodSync(script, 0o644);
	await take("config check script実行権限なし");
	chmodSync(script, 0o755);
	writeFileSync(config, "{}");
	for (const command of ["config", "start", "stack", "cleanup", "restack"])
		await take(
			`${command} Gitリポジトリ外`,
			command === "config" ? ["config", "check"] : [command],
			1,
			context.root,
		);
	return items;
}

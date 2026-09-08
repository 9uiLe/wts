import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Capture, context } from "./ui-catalog/capture";
import { commonCases } from "./ui-catalog/common-cases";
import { configCases } from "./ui-catalog/config-cases";
import { discardCases } from "./ui-catalog/discard-cases";
import { compareCaptures, normalizeRecord } from "./ui-catalog/normalize";
import { escapeHtml } from "./ui-catalog/html";
import { renderPage } from "./ui-catalog/render";
import { restackCases } from "./ui-catalog/restack-cases";
import { sessionCases } from "./ui-catalog/session-cases";

function readBaseline(path: string): Capture[] {
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (
		!value ||
		typeof value !== "object" ||
		!("version" in value) ||
		value.version !== 1 ||
		!("cases" in value) ||
		!Array.isArray(value.cases)
	)
		throw new Error(`基準データの形式が不正です: ${path}`);
	for (const item of value.cases) {
		if (
			!item ||
			typeof item.title !== "string" ||
			typeof item.command !== "string" ||
			typeof item.cwd !== "string" ||
			typeof item.code !== "number" ||
			typeof item.raw !== "string" ||
			typeof item.mode !== "string" ||
			!Array.isArray(item.args) ||
			!Array.isArray(item.frames) ||
			!Array.isArray(item.input) ||
			!item.args.every((arg: unknown) => typeof arg === "string") ||
			!item.frames.every((frame: unknown) => typeof frame === "string") ||
			!item.input.every(
				(step: unknown) =>
					Array.isArray(step) &&
					step.length === 2 &&
					step.every((part) => typeof part === "string"),
			)
		)
			throw new Error(`基準データのケースが不正です: ${path}`);
	}
	return value.cases as Capture[];
}

const workspace = resolve(import.meta.dir, "..");
const captures: Capture[] = [];
let output = resolve(workspace, "release/ui-catalog");
try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			baseline: {
				type: "string",
				default: resolve(workspace, "tests/fixtures/ui-baseline.json"),
			},
			output: { type: "string", default: output },
			"update-baseline": { type: "string" },
		},
		strict: true,
	});
	output = resolve(values.output);
	const baseline = readBaseline(resolve(values.baseline));
	mkdirSync(output, { recursive: true });
	for (const cases of [
		commonCases,
		configCases,
		sessionCases,
		restackCases,
		discardCases,
	]) {
		const group = await cases();
		captures.push(...group);
		console.log(`${cases.name}: ${group.length} ケースを収録しました。`);
	}
	const comparisons = compareCaptures(captures, baseline, context.root);
	const display = (item: Capture) => normalizeRecord(item, context.root);
	const displayComparisons = comparisons.map((comparison) => {
		return {
			...comparison,
			...(comparison.current ? { current: display(comparison.current) } : {}),
			...(comparison.previous
				? { previous: display(comparison.previous) }
				: {}),
		};
	});
	const diagnostics = {
		captures: `${JSON.stringify({ version: 1, cases: captures }, null, 2)}\n`,
		comparison: `${JSON.stringify(
			comparisons.map((comparison) => ({
				title: comparison.current?.title ?? comparison.previous?.title,
				changed: comparison.changed,
				added: !comparison.previous,
				removed: !comparison.current,
				beforeExit: comparison.previous?.code,
				afterExit: comparison.current?.code,
			})),
			null,
			2,
		)}\n`,
		coverage: `# 出力一覧の収録範囲\n\n${captures.length} ケースを実 CLI で収録しています。入力待ちの各画面と最終画面、終了コードを記録します。GitHub CLI の応答、外部コマンド障害、非対応環境はシナリオの疑似応答を使用し、実サービスへの接続結果ではありません。\n\n未実測の条件:\n\n- src/copy.ts: glob 走査自体の例外。\n- src/commands/restack.ts: lease ファイル削除時の OS 例外。\n- src/copy.ts: コピー先が worktree 外になる防御的分岐。公開入力の検査と glob の相対パスにより通常は到達しません。\n- src/commands/stack.ts と restack.ts: スタックの先端が空になる防御的分岐。stackBranches は root を先頭要素に含めるため通常は到達しません。\n\n任意のパス・日付・UUID・SHA の全値や外部ツールの診断文の全組合せは列挙せず、表示形式と条件で分類しています。\n\nシナリオ定義: scripts/ui-catalog/common-cases.ts、config-cases.ts、session-cases.ts、restack-cases.ts、discard-cases.ts。\n`,
	};
	writeFileSync(resolve(output, "captures.json"), diagnostics.captures);
	writeFileSync(resolve(output, "comparison.json"), diagnostics.comparison);
	writeFileSync(resolve(output, "coverage.md"), diagnostics.coverage);
	writeFileSync(
		resolve(output, "index.html"),
		renderPage(displayComparisons, false),
	);
	writeFileSync(
		resolve(output, "changes.html"),
		renderPage(displayComparisons, true),
	);
	rmSync(resolve(output, "failure.txt"), { force: true });
	rmSync(resolve(output, "partial-captures.json"), { force: true });
	if (values["update-baseline"]) {
		const destination = resolve(values["update-baseline"]);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(
			destination,
			`${JSON.stringify({ version: 1, cases: captures.map((item) => normalizeRecord(item, context.root)) }, null, 2)}\n`,
		);
		console.log(`基準を更新しました: ${destination}`);
	}
	console.log(
		`${captures.length} ケース、変更 ${comparisons.filter((item) => item.changed).length} 件: ${output}/index.html`,
	);
} catch (error) {
	mkdirSync(output, { recursive: true });
	const failurePage = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>wts 出力一覧の生成失敗</title><h1>出力一覧の生成に失敗しました</h1><p>一覧は未完成です。診断ログで失敗の原因を確認し、再生成してください。</p><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre><p><a href="failure.txt">診断ログ</a> · <a href="partial-captures.json">部分収録</a></p></html>`;
	writeFileSync(resolve(output, "index.html"), failurePage);
	writeFileSync(resolve(output, "changes.html"), failurePage);
	writeFileSync(
		resolve(output, "failure.txt"),
		`${error instanceof Error ? error.stack : String(error)}\n`,
	);
	writeFileSync(
		resolve(output, "partial-captures.json"),
		`${JSON.stringify({ version: 1, cases: captures }, null, 2)}\n`,
	);
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	rmSync(context.root, { recursive: true, force: true });
}

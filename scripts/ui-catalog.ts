import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Capture, context } from "./ui-catalog/capture";
import { mainCases, extraCases } from "./ui-catalog/main-cases";
import { compareCaptures, normalize } from "./ui-catalog/normalize";
import { escapeHtml, renderPage } from "./ui-catalog/render";
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
	for (const cases of [mainCases, extraCases, sessionCases, restackCases]) {
		const group = await cases();
		captures.push(...group);
		console.log(`${cases.name}: ${group.length} ケースを収録しました。`);
	}
	const comparisons = compareCaptures(captures, baseline, context.root);
	const normalized = comparisons.map((comparison) => {
		const display = (item: Capture): Capture => ({
			...item,
			cwd: normalize(item.cwd, context.root),
			command: normalize(item.command, context.root),
			raw: normalize(item.raw, context.root),
			frames: item.frames.map((frame) => normalize(frame, context.root)),
			input: item.input.map(([trigger, keys]) => [
				normalize(trigger, context.root),
				keys,
			]),
		});
		return {
			...comparison,
			...(comparison.current ? { current: display(comparison.current) } : {}),
			...(comparison.previous
				? { previous: display(comparison.previous) }
				: {}),
		};
	});
	writeFileSync(
		resolve(output, "captures.json"),
		`${JSON.stringify({ version: 1, cases: captures }, null, 2)}\n`,
	);
	writeFileSync(
		resolve(output, "comparison.json"),
		`${JSON.stringify(
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
	);
	writeFileSync(resolve(output, "index.html"), renderPage(normalized, false));
	writeFileSync(resolve(output, "changes.html"), renderPage(normalized, true));
	rmSync(resolve(output, "failure.txt"), { force: true });
	rmSync(resolve(output, "partial-captures.json"), { force: true });
	writeFileSync(
		resolve(output, "coverage.md"),
		`# 出力一覧の収録範囲\n\n${captures.length} ケースを実 CLI で収録しています。入力待ちの各画面と最終画面、終了コードを記録します。GitHub CLI の応答、外部コマンド障害、非対応環境はシナリオの疑似応答を使用し、実サービスへの接続結果ではありません。\n\n未実測: glob 走査の例外 catch、lease ファイル unlink の失敗、通常到達しない分岐 3 件。任意のパス・日付・UUID・SHA の全値や外部ツールの診断文の全組合せは列挙せず、表示形式と条件で分類しています。\n\nシナリオ定義: scripts/ui-catalog/main-cases.ts、session-cases.ts、restack-cases.ts。\n`,
	);
	if (values["update-baseline"]) {
		const destination = resolve(values["update-baseline"]);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(
			destination,
			`${JSON.stringify({ version: 1, cases: captures }, null, 2)}\n`,
		);
		console.log(`基準を更新しました: ${destination}`);
	}
	console.log(
		`${captures.length} ケース、変更 ${comparisons.filter((item) => item.changed).length} 件: ${output}/index.html`,
	);
} catch (error) {
	mkdirSync(output, { recursive: true });
	const failurePage = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>wts 出力一覧の生成失敗</title><h1>出力一覧の生成に失敗しました</h1><p>今回の一覧は完成していません。診断を修正して再生成してください。</p><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre><p><a href="failure.txt">診断ログ</a> · <a href="partial-captures.json">部分収録</a></p></html>`;
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

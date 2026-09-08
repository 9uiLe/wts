import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { commandLine } from "../src/ui";

const modulePath = resolve(import.meta.dir, "../src/ui.ts");

function render(source: string, env: Record<string, string | undefined> = {}) {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--eval",
			`import { ui } from ${JSON.stringify(modulePath)}; ${source}`,
		],
		{
			env: {
				...process.env,
				FORCE_COLOR: undefined,
				NO_COLOR: undefined,
				CI: undefined,
				TERM: "xterm-256color",
				...env,
			},
		},
	);
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

test("piped output stays plain even with forced color and keeps diagnostics separate", () => {
	const result = render(
		'ui.heading("start"); ui.success("完了"); ui.detail("Path", "/tmp/work"); ui.warn("注意"); ui.error("失敗");',
		{ FORCE_COLOR: "1" },
	);
	expect(result).toEqual({
		code: 0,
		out: "完了\nPath  /tmp/work\n",
		err: "警告: 注意\nエラー: 失敗\n",
	});
});

test("terminal output uses hierarchy and status symbols", () => {
	const result = render(
		'Object.defineProperty(process.stdout, "isTTY", { value: true }); ui.heading("start"); ui.success("完了");',
	);
	expect(result.out).toContain("\u001b[");
	expect(Bun.stripANSI(result.out)).toBe("\n  wts start\n\n  ✓ 完了\n");
});

test("NO_COLOR takes priority over FORCE_COLOR on a terminal", () => {
	const result = render(
		'Object.defineProperty(process.stdout, "isTTY", { value: true }); ui.success("完了");',
		{ NO_COLOR: "", FORCE_COLOR: "1" },
	);
	expect(result.out).toBe("  ✓ 完了\n");
});

test("dumb terminals and CI produce plain output", () => {
	for (const env of [{ TERM: "dumb" }, { CI: "true" }]) {
		const result = render(
			'Object.defineProperty(process.stdout, "isTTY", { value: true }); ui.success("完了");',
			env,
		);
		expect(result.out).toBe("完了\n");
	}
});

test("tasks preserve results and errors without progress output in a pipe", () => {
	const result = render(
		'const value = await ui.task("処理中", async () => "完了"); ui.success(value); try { await ui.task("処理中", async () => { throw new Error("失敗"); }); } catch (error) { ui.error(error.message); }',
	);
	expect(result).toEqual({ code: 0, out: "完了\n", err: "エラー: 失敗\n" });
});

test("external ANSI diagnostics are readable when redirected", () => {
	const result = render('ui.error("\\u001b[31mremote rejected\\u001b[0m");');
	expect(result.err).toBe("エラー: remote rejected\n");
});

test("suggested commands preserve spaces, quotes, and shell metacharacters as arguments", () => {
	const values = [
		"/tmp/my worktree",
		"日本語",
		"it's-a-branch",
		"$(printf expanded)",
		"",
		"semi;colon",
	];
	const result = Bun.spawnSync([
		"/bin/sh",
		"-c",
		`printf '%s\\0' ${commandLine(values)}`,
	]);
	expect(result.exitCode).toBe(0);
	expect(result.stdout.toString().split("\0").slice(0, -1)).toEqual(values);
});

test("terminal details align values using displayed label widths", () => {
	const result = render(
		'Object.defineProperty(process.stdout, "isTTY", { value: true }); ui.details([["Branch", "topic"], ["Path", "/tmp/topic"]]);',
	);
	expect(Bun.stripANSI(result.out)).toBe(
		"    Branch  topic\n    Path    /tmp/topic\n",
	);
});

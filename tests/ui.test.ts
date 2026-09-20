import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commandLine } from "../src/ui";
import { runCli } from "./helpers/cli";

const modulePath = resolve(import.meta.dir, "../src/ui.ts");
const hamioPath = resolve(import.meta.dir, "../src/hamio.ts");

function render(source: string, format?: "human" | "json") {
	const result = Bun.spawnSync([
		process.execPath,
		"--eval",
		`import { ui } from ${JSON.stringify(modulePath)}; import { configureHamio } from ${JSON.stringify(hamioPath)}; configureHamio(() => ${JSON.stringify(format)}); ${source}`,
	]);
	const out = result.stdout.toString();
	return {
		code: result.exitCode,
		out,
		err: result.stderr.toString(),
		responses: out
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line)),
	};
}

test("piped output contains hamio JSON for results, details and diagnostics", () => {
	const result = render(
		'ui.success("完了"); ui.detail("Path", "/tmp/work"); ui.warn("注意"); ui.error("失敗");',
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("");
	expect(result.responses).toEqual([
		{
			apiVersion: 1,
			status: "ok",
			blocks: [{ kind: "message", level: "success", text: "完了" }],
		},
		{
			apiVersion: 1,
			status: "ok",
			blocks: [
				{
					kind: "key-value",
					items: [{ label: "Path", value: "/tmp/work", secret: false }],
				},
			],
		},
		{
			apiVersion: 1,
			status: "ok",
			blocks: [{ kind: "message", level: "warning", text: "注意" }],
		},
		{
			apiVersion: 1,
			status: "ok",
			blocks: [{ kind: "message", level: "error", text: "失敗" }],
		},
	]);
});

test("explicit human output uses stderr and keeps stdout acknowledgements as JSON", () => {
	const result = render(
		'ui.heading("start"); ui.success("完了"); ui.detail("Path", "/tmp/work"); ui.warn("注意");',
		"human",
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("● wts start\n✓ 完了\nPath: /tmp/work\n▲ 注意\n");
	expect(result.responses).toEqual(
		Array.from({ length: 4 }, () => ({ apiVersion: 1, status: "ok" })),
	);
});

test("multiline messages cross hamio's block and UTF-8 limits without losing text", () => {
	const lines = Array.from({ length: 33 }, (_, index) => `line ${index}`);
	const longLine = "日本語".repeat(500);
	const result = render(
		`ui.line(${JSON.stringify([...lines, longLine].join("\n"))});`,
	);
	expect(result.code).toBe(0);
	expect(result.responses.map((response) => response.blocks.length)).toEqual([
		32, 3,
	]);
	const blocks = result.responses.flatMap((response) => response.blocks);
	expect(blocks.slice(0, lines.length).map((block) => block.text)).toEqual(
		lines,
	);
	expect(
		blocks
			.slice(lines.length)
			.map((block) => block.text)
			.join(""),
	).toBe(longLine);
});

test("messages split JSON-escaped content before the request byte limit", () => {
	const line = "\u0000".repeat(4096);
	const result = render(
		`ui.line(Array.from({ length: 32 }, () => ${JSON.stringify(line)}).join("\\n"));`,
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("");
	expect(result.responses.length).toBeGreaterThan(1);
	expect(
		result.responses
			.flatMap((response) => response.blocks)
			.map((block) => block.text),
	).toEqual(Array.from({ length: 32 }, () => line));
});

test("details preserve more than 200 items in bounded blocks", () => {
	const result = render(
		'ui.details(Array.from({ length: 201 }, (_, index) => ["項目", String(index)]));',
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("");
	expect(result.responses).toHaveLength(1);
	const blocks = result.responses.flatMap((response) => response.blocks);
	expect(blocks.map((block) => block.items.length)).toEqual([200, 1]);
	expect(blocks.flatMap((block) => block.items)).toEqual(
		Array.from({ length: 201 }, (_, index) => ({
			label: "項目",
			value: String(index),
			secret: false,
		})),
	);
});

test("large details preserve Unicode and JSON escapes across requests", () => {
	const value = '日本語"\\\u0000'.repeat(300);
	const result = render(
		`ui.details(Array.from({ length: 100 }, (_, index) => [\`項目\${index}\`, ${JSON.stringify(value)}]));`,
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("");
	expect(result.responses.length).toBeGreaterThan(1);
	expect(
		result.responses
			.flatMap((response) => response.blocks)
			.flatMap((block) => block.items),
	).toEqual(
		Array.from({ length: 100 }, (_, index) => ({
			label: `項目${index}`,
			value,
			secret: false,
		})),
	);
});

test("oversized detail strings keep hamio's validation failure", () => {
	const result = render('ui.detail("項目", "x".repeat(4097));');
	expect(result.code).toBe(1);
	expect(result.responses).toEqual([]);
	expect(result.err).toContain("hamio の処理に失敗しました");
});

test("tasks report completion and preserve business results and failures", () => {
	const result = render(
		'ui.success(await ui.task("処理中", async () => "完了")); try { await ui.task("処理中", async () => { throw new Error("失敗"); }); } catch (error) { ui.error(error.message); }',
	);
	expect(result.code).toBe(0);
	expect(result.err).toBe("");
	expect(result.responses[0]).toEqual({
		apiVersion: 1,
		status: "ok",
		runId: "wts",
		result: { success: true },
		tasks: { succeeded: 1, failed: 0 },
		warnings: [],
	});
	expect(result.responses[2]).toEqual({
		apiVersion: 1,
		status: "ok",
		runId: "wts",
		result: { success: false },
		tasks: { succeeded: 0, failed: 1 },
		warnings: [],
	});
	expect(result.responses[3].blocks[0].text).toBe("失敗");
});

test("human diagnostics neutralize terminal control sequences", () => {
	const result = render(
		'ui.error("\\u001b[31mremote rejected\\u001b[0m");',
		"human",
	);
	expect(result.code).toBe(0);
	expect(result.err).not.toContain("\u001b");
	expect(result.err).toContain("remote rejected");
});

test("global format selection applies to nested command help and errors", () => {
	for (const args of [["start", "--help"], ["unknown"]]) {
		const result = runCli(process.cwd(), ["--format", "human", ...args]);
		expect(result.err).toContain(
			args[0] === "start" ? "Usage: wts start" : "unknown command",
		);
		for (const line of result.out.trim().split("\n"))
			expect(JSON.parse(line)).toEqual({ apiVersion: 1, status: "ok" });
	}
});

test("missing hamio reports JSON and prevents file changes", () => {
	const cwd = mkdtempSync(join(tmpdir(), "wts-no-hamio-"));
	try {
		const result = runCli(
			cwd,
			["skills", "install", "wts-cli", "--path", cwd],
			{ PATH: "" },
		);
		expect(result.code).toBe(1);
		expect(result.err).toBe("");
		expect(JSON.parse(result.out).error.code).toBe("HAMIO_UNAVAILABLE");
		expect(existsSync(join(cwd, "wts-cli"))).toBe(false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

for (const mode of [
	"wrong-version",
	"invalid-response",
	"render-failure",
] as const) {
	test(`hamio ${mode} is an explicit failure`, () => {
		const cwd = mkdtempSync(join(tmpdir(), "wts-bad-hamio-"));
		try {
			writeFileSync(
				join(cwd, "hamio"),
				`#!${process.execPath}\nif (process.argv[2] === "capabilities") console.log(JSON.stringify({apiVersion: 1, version: ${JSON.stringify(mode === "wrong-version" ? "0.2.0" : "0.1.0")}})); else { ${mode === "invalid-response" ? 'console.log("broken")' : 'console.log(JSON.stringify({apiVersion:1,status:"error",error:{code:"IO_ERROR"}})); process.exit(7)'}; }\n`,
				{ mode: 0o755 },
			);
			const result = runCli(cwd, ["doctor"], { PATH: cwd });
			expect(result.code).toBe(1);
			expect(result.err).toBe("");
			expect(JSON.parse(result.out).error.code).toBe("HAMIO_UNAVAILABLE");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
}

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

test("an executable with a missing interpreter reports only a JSON failure", () => {
	const cwd = mkdtempSync(join(tmpdir(), "wts-unlaunchable-hamio-"));
	try {
		writeFileSync(join(cwd, "hamio"), "#!/missing/hamio/interpreter\n", {
			mode: 0o755,
		});
		const result = runCli(cwd, ["--version"], { PATH: cwd });
		expect(result.code).toBe(1);
		expect(result.err).toBe("");
		expect(JSON.parse(result.out).error.code).toBe("HAMIO_UNAVAILABLE");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

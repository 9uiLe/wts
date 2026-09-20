import { expect, test } from "bun:test";
import { cliEnvironment } from "./helpers/cli";

const terminalTest = process.platform === "darwin" ? test : test.skip;

async function doctorTerminal(input: string, env: Record<string, string> = {}) {
	let output = "";
	let answered = false;
	const decoder = new TextDecoder();
	const closed = Promise.withResolvers<void>();
	const child = Bun.spawn(
		[process.execPath, "run", "--silent", "dev", "doctor", "--interactive"],
		{
			env: cliEnvironment({
				CI: undefined,
				NO_COLOR: undefined,
				FORCE_COLOR: "1",
				TERM: "xterm-256color",
				...env,
			}),
			terminal: {
				data(terminal, data) {
					output += decoder.decode(data, { stream: true });
					if (
						!answered &&
						output.includes("起動環境を表示しますか？") &&
						output.includes("いいえ")
					) {
						answered = true;
						terminal.write(input);
					}
				},
				exit() {
					closed.resolve();
				},
			},
		},
	);
	try {
		const [code] = await Promise.all([child.exited, closed.promise]);
		output += decoder.decode();
		return { code, output, answered };
	} finally {
		child.terminal?.close();
		if (child.exitCode === null) child.kill();
	}
}

for (const [name, input, cancelled] of [
	["affirmative", "\u001b[C\r", false],
	["negative", "\r", true],
	["Ctrl-C", "\u0003", true],
] as const) {
	terminalTest(
		`interactive doctor handles ${name} in a real terminal`,
		async () => {
			const result = await doctorTerminal(input);
			expect(result.code).toBe(0);
			expect(result.answered).toBe(true);
			const plain = Bun.stripANSI(result.output);
			expect(plain).toContain("はい");
			expect(plain).toContain("いいえ");
			expect(plain.match(/キャンセルしました。/g)?.length ?? 0).toBe(
				cancelled ? 1 : 0,
			);
			if (!cancelled)
				expect(plain).toContain(`${process.platform} / ${process.arch}`);
			expect(result.output).toContain("\u001b[?25h");
			expect(result.output.lastIndexOf("\u001b[?25h")).toBeGreaterThan(
				result.output.lastIndexOf("\u001b[?25l"),
			);
		},
	);
}

terminalTest("interactive doctor follows hamio NO_COLOR handling", async () => {
	const result = await doctorTerminal("\u001b[C\r", {
		NO_COLOR: "1",
		FORCE_COLOR: "1",
	});
	expect(result.code).toBe(0);
	expect(result.answered).toBe(true);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: カーソル制御を許し、装飾の SGR だけが無いことを検査する。
	expect(result.output).not.toMatch(/\u001b\[[\d;]*m/);
	expect(Bun.stripANSI(result.output)).toContain(
		`${process.platform} / ${process.arch}`,
	);
});

async function textTerminal(steps: Array<[string, string]>, format?: "json") {
	let output = "";
	let consumed = 0;
	const decoder = new TextDecoder();
	const closed = Promise.withResolvers<void>();
	const prompts = new URL("../src/prompts.ts", import.meta.url).pathname;
	const hamio = new URL("../src/hamio.ts", import.meta.url).pathname;
	const ui = new URL("../src/ui.ts", import.meta.url).pathname;
	const child = Bun.spawn(
		[
			process.execPath,
			"--eval",
			`import { askText, Cancelled } from ${JSON.stringify(prompts)}; import { configureHamio } from ${JSON.stringify(hamio)}; import { ui } from ${JSON.stringify(ui)}; configureHamio(() => ${JSON.stringify(format)}); try { const value = await askText("作業名", "既定値"); ui.detail("回答", value); } catch (error) { if (!(error instanceof Cancelled)) { ui.error(error.message); process.exitCode = 1; } }`,
		],
		{
			env: cliEnvironment({ CI: undefined, TERM: "xterm-256color" }),
			terminal: {
				data(terminal, data) {
					output += decoder.decode(data, { stream: true });
					const step = steps[consumed];
					if (step && Bun.stripANSI(output).includes(step[0])) {
						consumed++;
						terminal.write(step[1]);
					}
				},
				exit() {
					closed.resolve();
				},
			},
		},
	);
	try {
		const [code] = await Promise.all([child.exited, closed.promise]);
		return { code, output: output + decoder.decode(), consumed };
	} finally {
		child.terminal?.close();
		if (child.exitCode === null) child.kill();
	}
}

terminalTest(
	"text input can keep the default without opening a text field",
	async () => {
		const result = await textTerminal([["入力する", "\r"]]);
		expect(result.code).toBe(0);
		expect(result.consumed).toBe(1);
		expect(Bun.stripANSI(result.output)).toContain("回答: 既定値");
		expect(Bun.stripANSI(result.output)).not.toContain("作業名を入力");
	},
);

terminalTest("text input returns an entered Unicode value", async () => {
	const result = await textTerminal([
		["入力する", "\u001b[B\r"],
		["作業名を入力", "日本語の作業\r"],
	]);
	expect(result.code).toBe(0);
	expect(result.consumed).toBe(2);
	expect(Bun.stripANSI(result.output)).toContain("回答: 日本語の作業");
});

terminalTest(
	"Ctrl-C at the text field cancels without returning a partial answer",
	async () => {
		const result = await textTerminal([
			["入力する", "\u001b[B\r"],
			["作業名を入力", "\u0003"],
		]);
		expect(result.code).toBe(0);
		expect(result.consumed).toBe(2);
		expect(Bun.stripANSI(result.output)).toContain("キャンセルしました。");
		expect(Bun.stripANSI(result.output)).not.toContain("回答:");
	},
);

terminalTest(
	"explicit JSON mode does not open an interactive form on a TTY",
	async () => {
		const result = await textTerminal([], "json");
		expect(result.code).toBe(1);
		const response = JSON.parse(result.output);
		expect(response.blocks[0].level).toBe("error");
		expect(response.blocks[0].text).toContain("オプション");
	},
);

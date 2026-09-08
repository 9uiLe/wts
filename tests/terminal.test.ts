import { expect, test } from "bun:test";
import { resolve } from "node:path";

const terminalTest = process.platform === "darwin" ? test : test.skip;
const cli = resolve(import.meta.dir, "../src/cli.ts");

async function doctorTerminal(input: string, env: Record<string, string> = {}) {
	let output = "";
	let answered = false;
	const decoder = new TextDecoder();
	const closed = Promise.withResolvers<void>();
	const child = Bun.spawn([process.execPath, cli, "doctor", "--interactive"], {
		env: {
			...process.env,
			CI: undefined,
			NO_COLOR: undefined,
			FORCE_COLOR: "1",
			TERM: "xterm-256color",
			...env,
		},
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
	});
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
	["affirmative", "\r", false],
	["negative", "\u001b[C\r", true],
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

terminalTest(
	"interactive doctor honors NO_COLOR over FORCE_COLOR",
	async () => {
		const result = await doctorTerminal("\r", {
			NO_COLOR: "",
			FORCE_COLOR: "1",
		});
		expect(result.code).toBe(0);
		expect(result.answered).toBe(true);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: カーソル制御を許し、装飾の SGR だけが無いことを検査する。
		expect(result.output).not.toMatch(/\u001b\[[\d;]*m/);
		expect(Bun.stripANSI(result.output)).toContain(
			`${process.platform} / ${process.arch}`,
		);
	},
);

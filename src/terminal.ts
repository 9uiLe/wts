import { Chalk } from "chalk";

// Clack と Ora も同じ色方針を使う。Bun は両変数の併存時に警告を出すため、
// 依存の色検出より前に FORCE_COLOR を解決する。
if (process.env.NO_COLOR !== undefined) delete process.env.FORCE_COLOR;
else if (process.env.TERM === "dumb" || process.env.CI)
	process.env.FORCE_COLOR = "0";

export function terminal(stream: NodeJS.WriteStream): boolean {
	return (
		Boolean(stream.isTTY) && process.env.TERM !== "dumb" && !process.env.CI
	);
}

export function colors(stream: NodeJS.WriteStream) {
	return new Chalk({
		level:
			terminal(stream) &&
			process.env.NO_COLOR === undefined &&
			process.env.FORCE_COLOR !== "0"
				? 1
				: 0,
	});
}

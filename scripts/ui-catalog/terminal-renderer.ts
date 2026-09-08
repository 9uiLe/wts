import { escapeHtml } from "./html";

const palette = [
	"#20242c",
	"#ff6b73",
	"#8ddb8c",
	"#eac06d",
	"#82aaff",
	"#c792ea",
	"#7fdbca",
	"#d8dee9",
	"#8a919f",
	"#ff6b73",
	"#8ddb8c",
	"#eac06d",
	"#82aaff",
	"#c792ea",
	"#7fdbca",
	"#ffffff",
];
interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	reverse?: boolean;
	hidden?: boolean;
	strike?: boolean;
	underline?: boolean;
}
interface Cell {
	text: string;
	style: Style;
}

function indexedColor(value: number): string {
	if (value < 16) return palette[value] ?? "#d8dee9";
	if (value >= 232)
		return `rgb(${[0, 0, 0].map(() => 8 + (value - 232) * 10).join(",")})`;
	const index = value - 16;
	const component = (part: number) => (part === 0 ? 0 : 55 + part * 40);
	return `rgb(${[Math.floor(index / 36), Math.floor(index / 6) % 6, index % 6].map(component).join(",")})`;
}

function span(text: string, style: Style): string {
	const css = [
		style.fg ? `color:${style.fg}` : "",
		style.bg ? `background:${style.bg}` : "",
		style.bold ? "font-weight:700" : "",
		style.dim ? "opacity:.58" : "",
		style.reverse
			? `background:${style.fg ?? "#d8dee9"};color:${style.bg ?? "#0d1117"}`
			: "",
		style.hidden ? "visibility:hidden" : "",
		style.strike ? "text-decoration:line-through" : "",
		style.underline ? "text-decoration:underline" : "",
	]
		.filter(Boolean)
		.join(";");
	return css
		? `<span style="${css}">${escapeHtml(text)}</span>`
		: escapeHtml(text);
}

export function terminal(
	raw: string,
	pipe = false,
): { html: string; plain: string } {
	if (pipe) raw = raw.replace(/(?<!\r)\n/g, "\r\n");
	let rows: Cell[][] = [[]];
	let rowIndex = 0;
	let column = 0;
	let style: Style = {};
	let saved = [0, 0];
	const row = (index: number) => {
		while (rows.length <= index) rows.push([]);
		return rows[index] as Cell[];
	};
	const blank = (): Cell => ({ text: " ", style: {} });
	let i = 0;
	while (i < raw.length) {
		if (raw[i] === "\u001b") {
			// biome-ignore lint/suspicious/noControlCharactersInRegex: 実際の端末が受け取る CSI 制御列を解析する。
			const match = /^\u001b\[([\d;?]*)([ -/]*)([@-~])/.exec(raw.slice(i));
			if (match) {
				const values = (match[1] ?? "")
					.replace(/^\?/, "")
					.split(";")
					.map((value) => Number(value || 0));
				const first = values[0] ?? 0;
				const n = first || 1;
				const op = match[3];
				if (op === "m") {
					for (let k = 0; k < values.length; k++) {
						const value = values[k] ?? 0;
						if (value === 0) style = {};
						else if (value === 1) style.bold = true;
						else if (value === 2) style.dim = true;
						else if (value === 22) {
							delete style.bold;
							delete style.dim;
						} else if (value === 4) style.underline = true;
						else if (value === 24) delete style.underline;
						else if (value === 7) style.reverse = true;
						else if (value === 27) delete style.reverse;
						else if (value === 8) style.hidden = true;
						else if (value === 28) delete style.hidden;
						else if (value === 9) style.strike = true;
						else if (value === 29) delete style.strike;
						else if (value === 39) delete style.fg;
						else if (value === 49) delete style.bg;
						else if (value >= 30 && value <= 37)
							style.fg = indexedColor(value - 30);
						else if (value >= 90 && value <= 97)
							style.fg = indexedColor(value - 90 + 8);
						else if (value >= 40 && value <= 47)
							style.bg = indexedColor(value - 40);
						else if (value >= 100 && value <= 107)
							style.bg = indexedColor(value - 100 + 8);
						else if (value === 38 || value === 48) {
							let color: string | undefined;
							if (values[k + 1] === 5) {
								color = indexedColor(values[k + 2] ?? 0);
								k += 2;
							} else if (values[k + 1] === 2) {
								color = `rgb(${values.slice(k + 2, k + 5).join(",")})`;
								k += 4;
							}
							if (color) style[value === 38 ? "fg" : "bg"] = color;
						}
					}
				} else if (op === "A") rowIndex = Math.max(0, rowIndex - n);
				else if (op === "B") rowIndex += n;
				else if (op === "C") column = Math.min(119, column + n);
				else if (op === "D") column = Math.max(0, column - n);
				else if (op === "G") column = n - 1;
				else if (op === "H" || op === "f") {
					rowIndex = n - 1;
					column = (values[1] || 1) - 1;
				} else if (op === "s") saved = [rowIndex, column];
				else if (op === "u") {
					rowIndex = saved[0] ?? 0;
					column = saved[1] ?? 0;
				} else if (op === "K") {
					const line = row(rowIndex);
					if (first === 2) rows[rowIndex] = [];
					else if (first === 0) line.splice(column);
					else
						for (let j = 0; j <= column && j < line.length; j++)
							line[j] = blank();
				} else if (op === "J") {
					if (first === 2) {
						rows = [[]];
						rowIndex = 0;
						column = 0;
					} else if (first === 0) {
						row(rowIndex).splice(column);
						rows.splice(rowIndex + 1);
					}
				}
				i += match[0].length;
				continue;
			}
			// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC は BEL または ST 制御文字で終端する。
			const osc = /^\u001b\][\s\S]*?(?:\u0007|\u001b\\)/.exec(raw.slice(i));
			if (osc) {
				i += osc[0].length;
				continue;
			}
			i++;
			continue;
		}
		const point = raw.codePointAt(i);
		if (point === undefined) break;
		const ch = String.fromCodePoint(point);
		i += ch.length;
		if (ch === "\r") {
			column = 0;
			continue;
		}
		if (ch === "\n") {
			rowIndex++;
			row(rowIndex);
			continue;
		}
		if (ch === "\b") {
			column = Math.max(0, column - 1);
			continue;
		}
		if (ch === "\t") {
			column = (Math.floor(column / 8) + 1) * 8;
			continue;
		}
		if (point < 32 || point === 127) continue;
		const width = Bun.stringWidth(ch);
		if (column + width > 120) {
			rowIndex++;
			column = 0;
		}
		const line = row(rowIndex);
		while (line.length < column + width) line.push(blank());
		if (width === 0) {
			let previous = column - 1;
			while (previous >= 0 && line[previous]?.text === "") previous--;
			const cell = line[previous];
			if (cell) cell.text += ch;
			continue;
		}
		line[column] = { text: ch, style: { ...style } };
		for (let j = 1; j < width; j++)
			line[column + j] = { text: "", style: { ...style } };
		column += width;
	}
	while (rows.length && !rows.at(-1)?.length) rows.pop();
	const html = rows
		.map((line) => {
			let buffer = "";
			let previous: Style = {};
			let output = "";
			for (const cell of line) {
				if (span("", previous) !== span("", cell.style)) {
					output += span(buffer, previous);
					buffer = "";
					previous = cell.style;
				}
				buffer += cell.text;
			}
			return output + span(buffer, previous);
		})
		.join("\n");
	return {
		html,
		plain: rows
			.map((line) =>
				line
					.map((cell) => cell.text)
					.join("")
					.trimEnd(),
			)
			.join("\n"),
	};
}

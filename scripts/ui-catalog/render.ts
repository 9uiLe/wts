import type { Capture } from "./capture";

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

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

export interface Comparison {
	current?: Capture;
	previous?: Capture;
	changed: boolean;
}

function changedLines(
	before: string[],
	after: string[],
): [Set<number>, Set<number>] {
	const lengths = Array.from(
		{ length: before.length + 1 },
		() => new Uint32Array(after.length + 1),
	);
	for (let i = before.length - 1; i >= 0; i--) {
		for (let j = after.length - 1; j >= 0; j--) {
			const current = lengths[i];
			const next = lengths[i + 1];
			if (current && next)
				current[j] =
					before[i] === after[j]
						? (next[j + 1] ?? 0) + 1
						: Math.max(next[j] ?? 0, current[j + 1] ?? 0);
		}
	}
	const left = new Set(before.map((_, index) => index));
	const right = new Set(after.map((_, index) => index));
	let i = 0;
	let j = 0;
	while (i < before.length && j < after.length) {
		if (before[i] === after[j]) {
			left.delete(i++);
			right.delete(j++);
		} else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i++;
		else j++;
	}
	return [left, right];
}

function screen(
	item: Capture,
	label: string,
	highlighted = new Set<number>(),
): string {
	const final = terminal(item.raw, item.mode.startsWith("PIPE"));
	const rendered = final.html
		.split("\n")
		.map((line, index) =>
			highlighted.has(index)
				? `<span class="diff-line">${line || " "}</span>`
				: line,
		)
		.join("\n");
	const inputs = item.input
		.map(
			([trigger, keys]) =>
				`${trigger} → ${keys.replaceAll("\u001b[C", "→").replaceAll("\u001b[D", "←").replaceAll("\r", "Enter").replaceAll("\u0003", "Ctrl-C")}`,
		)
		.join(" / ");
	return `<section class="screen"><h3>${label}</h3><p class="meta">${escapeHtml(item.mode)} · exit ${item.code}</p>${inputs ? `<p class="meta">入力: ${escapeHtml(inputs)}</p>` : ""}<div class="terminal"><div class="command">$ ${escapeHtml(item.command)}</div><pre>${final.plain ? rendered : '<span class="empty">（出力なし）</span>'}</pre></div>${item.frames.map((frame, index) => `<details><summary>入力前 ${index + 1}</summary><pre>${terminal(frame).html}</pre></details>`).join("")}</section>`;
}

export function renderPage(
	comparisons: Comparison[],
	changesOnly: boolean,
): string {
	const cards = comparisons
		.map((comparison, index) => {
			const item = comparison.current ?? comparison.previous;
			if (!item) return "";
			const anchor = `case-${Bun.hash(item.title).toString(16)}`;
			const group = [
				"doctor",
				"init",
				"config",
				"start",
				"stack",
				"cleanup",
				"restack",
			].includes(item.args[0] ?? "")
				? item.args[0]
				: "共通";
			const state = !comparison.previous
				? "追加"
				: !comparison.current
					? "削除"
					: comparison.changed
						? "変更"
						: "変更なし";
			const before = terminal(
				comparison.previous?.raw ?? "",
				comparison.previous?.mode.startsWith("PIPE"),
			);
			const after = terminal(
				comparison.current?.raw ?? "",
				comparison.current?.mode.startsWith("PIPE"),
			);
			const [left, right] = changedLines(
				before.html.split("\n"),
				after.html.split("\n"),
			);
			const reasons: string[] = [];
			if (comparison.changed && comparison.previous && comparison.current) {
				if (before.plain !== after.plain) reasons.push("文言・配置");
				else if (before.html !== after.html) reasons.push("配色・装飾");
				if (comparison.previous.code !== comparison.current.code)
					reasons.push("終了コード");
				if (comparison.previous.command !== comparison.current.command)
					reasons.push("コマンド");
				if (
					JSON.stringify(comparison.previous.input) !==
					JSON.stringify(comparison.current.input)
				)
					reasons.push("入力");
				if (
					JSON.stringify(
						comparison.previous.frames.map((frame) => terminal(frame).html),
					) !==
					JSON.stringify(
						comparison.current.frames.map((frame) => terminal(frame).html),
					)
				)
					reasons.push("入力前画面");
			}
			const screens =
				comparison.previous && comparison.current
					? comparison.changed
						? `<div class="pair">${screen(comparison.previous, "変更前", left)}${screen(comparison.current, "変更後", right)}</div>`
						: screen(comparison.current, "出力")
					: comparison.current
						? screen(comparison.current, "追加された出力")
						: screen(item, "削除された出力");
			return `<article id="${anchor}" data-group="${group}" data-changed="${comparison.changed}"${changesOnly && !comparison.changed ? " hidden" : ""}><h2><a href="#${anchor}">C${String(index + 1).padStart(3, "0")}</a> · ${escapeHtml(item.title)} <span class="badge">${state}</span></h2>${reasons.length ? `<p class="meta">変更点: ${reasons.join(" / ")}。背景付きの行が表示の差分です。</p>` : ""}${screens}</article>`;
		})
		.join("");
	return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>wts 出力デザイン ${changesOnly ? "変更のみ" : "全件"}</title><style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#10141a;color:#dce2eb}body{margin:0 auto;padding:32px 24px;max-width:1800px}h1{font-size:28px}h2{font-size:18px}h3{font-size:14px;color:#adbed3}p{line-height:1.7}a{color:#85baff}nav{position:sticky;top:0;background:#10141af5;padding:16px 0;display:flex;gap:8px;flex-wrap:wrap;z-index:1}button,input{background:#212a36;border:1px solid #405066;color:#e0e8f4;padding:9px 13px;border-radius:6px}button{cursor:pointer}button[aria-pressed="true"]{background:#335883}button:focus-visible,input:focus-visible{outline:2px solid #85baff;outline-offset:3px}.view-navigation{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:180px}article{border:1px solid #303b49;border-radius:10px;padding:20px;margin:20px 0;background:#171d26}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.screen{min-width:0}.meta{font-size:12px;color:#99a8bd;overflow-wrap:anywhere}.terminal,details{background:#0d1117;border-radius:6px;overflow:auto}pre,.command{font-family:Menlo,"Noto Sans Mono CJK JP","Hiragino Kaku Gothic ProN",monospace;font-size:13px;line-height:1.65;white-space:pre;tab-size:8}pre{margin:0;padding:16px;min-width:max-content;color:#d8dee9}.command{padding:12px 16px;border-bottom:1px solid #253142;color:#a9b9ce}details{margin-top:10px}summary{cursor:pointer;padding:12px;color:#a9b9ce}.empty,.count{color:#95abc5}.diff-line{display:inline-block;min-width:100%;background:#4b392b;box-shadow:inset 3px 0 #eac06d}.badge{font-size:12px;background:#263747;padding:4px 8px;border-radius:4px}[hidden]{display:none!important}@media(max-width:1000px){.pair{grid-template-columns:1fr}}
</style><h1 id="page-title">wts 出力デザイン · ${changesOnly ? "変更のみ" : "全件"}</h1><div class="view-navigation" role="group" aria-label="表示内容">${[
		["all", "全件"],
		["changes", "変更のみ"],
	]
		.map(
			([view, label]) =>
				`<button type="button" data-view="${view}" aria-pressed="${view === (changesOnly ? "changes" : "all")}">${label}</button>`,
		)
		.join(
			"",
		)}</div><p>変更がないケースは出力を1画面で、変更があるケースは変更前・変更後を並べて表示します。背景色が付いた行は変更箇所です。検索やコマンドで絞り込めます。</p><p class="meta">一部の外部応答は疑似環境で再現しています。</p><section><nav aria-label="コマンドで絞り込み">${["すべて", "共通", "doctor", "init", "config", "start", "stack", "cleanup", "restack"].map((group) => `<button type="button" data-filter="${group}" aria-pressed="${group === "すべて"}">${group}</button>`).join("")}<input id="search" aria-label="ケース名・コマンド・出力を検索" placeholder="ケース名・コマンド・出力を検索"></nav><p id="count" class="count" aria-live="polite"></p><p id="empty" hidden></p>${cards}</section><script>let group='すべて';let view='${changesOnly ? "changes" : "all"}';const articles=[...document.querySelectorAll('article')];const labels={all:'全件',changes:'変更のみ'};function filter(){const q=document.querySelector('#search').value.toLowerCase();let count=0;for(const article of articles){article.hidden=!((view!=='changes'||article.dataset.changed==='true')&&(group==='すべて'||article.dataset.group===group)&&article.textContent.toLowerCase().includes(q));if(!article.hidden)count++;}document.querySelector('#count').textContent=count+' / '+articles.length+' ケース';const empty=document.querySelector('#empty');empty.hidden=count!==0;empty.textContent=view==='changes'&&!articles.some(article=>article.dataset.changed==='true')?'表示差分はありません。':'条件に一致するケースはありません。';for(const button of document.querySelectorAll('button[data-filter]'))button.setAttribute('aria-pressed',String(button.dataset.filter===group));}function showView(next){view=next;for(const button of document.querySelectorAll('button[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));document.querySelector('#page-title').textContent='wts 出力デザイン · '+labels[view];document.title='wts 出力デザイン '+labels[view];filter();}document.querySelectorAll('button[data-view]').forEach(button=>button.onclick=()=>showView(button.dataset.view));document.querySelectorAll('button[data-filter]').forEach(button=>button.onclick=()=>{group=button.dataset.filter;filter()});document.querySelector('#search').oninput=filter;showView(view);</script></html>`;
}

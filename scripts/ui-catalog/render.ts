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
	return `<section class="screen"><div class="screen-heading"><h3>${label}</h3><p class="meta">${escapeHtml(item.mode)} · 終了コード ${item.code}</p></div>${inputs ? `<p class="meta">入力: ${escapeHtml(inputs)}</p>` : ""}<div class="terminal"><div class="command">$ ${escapeHtml(item.command)}</div><pre>${final.plain ? rendered : '<span class="empty">（出力なし）</span>'}</pre></div>${item.frames.map((frame, index) => `<details><summary>入力前 ${index + 1}</summary><pre>${terminal(frame).html}</pre></details>`).join("")}</section>`;
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
			const stateClass = !comparison.previous
				? "added"
				: !comparison.current
					? "removed"
					: comparison.changed
						? "changed"
						: "unchanged";
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
			return `<article id="${anchor}" data-group="${group}" data-changed="${comparison.changed}"${changesOnly && !comparison.changed ? " hidden" : ""}><header class="case-heading"><div class="case-identity"><a class="case-id" href="#${anchor}" aria-label="ケース C${String(index + 1).padStart(3, "0")} へのリンク">C${String(index + 1).padStart(3, "0")}</a><h2>${escapeHtml(item.title)}</h2></div><span class="badge ${stateClass}">${state}</span></header>${reasons.length ? `<p class="change-summary"><span>変更点</span> ${reasons.join(" / ")}</p>` : ""}${screens}</article>`;
		})
		.join("");
	const total = comparisons.filter(
		(item) => item.current || item.previous,
	).length;
	const changed = comparisons.filter(
		(item) => (item.current || item.previous) && item.changed,
	).length;
	return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>wts 端末UIレビュー · ${changesOnly ? "変更のみ" : "全件"}</title>
<style>
:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
  background: #10141b;
  color: #e1e7ef;
  --muted: #9caabd;
  --border: #2c3543;
  --accent: #a4c7ff;
  --toolbar-offset: 16px;
}
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1800px; padding: 40px 32px 64px; }
button, input { font: inherit; }
button { cursor: pointer; }
a { color: var(--accent); }
button, input, summary, a { -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, summary:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 4px;
}
.page-header { margin-bottom: 28px; }
.brand { display: inline-block; font: 700 15px Menlo, monospace; letter-spacing: -.04em; color: var(--accent); margin-bottom: 12px; }
h1 { margin: 0 0 12px; font-size: clamp(24px, 3vw, 32px); letter-spacing: -.025em; line-height: 1.4; }
.page-description { max-width: 780px; margin: 0; color: var(--muted); font-size: 14px; line-height: 1.9; }
.toolbar { position: sticky; top: var(--toolbar-offset); z-index: 2; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: #181e28; box-shadow: 0 8px 24px #00000026; }
.toolbar-primary { display: flex; gap: 24px; align-items: flex-end; justify-content: space-between; }
.control-label { display: block; margin: 0 0 8px; color: var(--muted); font-size: 12px; font-weight: 600; }
.view-navigation { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 8px; background: #10151d; }
button { border: 1px solid transparent; border-radius: 6px; background: transparent; color: #acb9ca; padding: 8px 12px; font-size: 13px; line-height: 1.4; }
button:hover { background: #263142; color: #f1f5fa; }
.view-navigation button { display: inline-flex; align-items: center; gap: 12px; }
.view-navigation button[aria-pressed="true"] { background: #304663; color: #f0f6ff; box-shadow: 0 1px 3px #0003; }
.view-count { border-radius: 4px; background: #ffffff0a; padding: 1px 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
.search-field { flex: 1; max-width: 440px; min-width: 0; }
input { width: 100%; min-width: 0; border: 1px solid #3c485a; border-radius: 7px; padding: 10px 12px; background: #111720; color: #e1e7ef; font-size: 14px; }
input::placeholder { color: #8493a7; }
.command-filters { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
.command-filters .control-label { margin-bottom: 8px; }
.filter-buttons { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-buttons button { padding: 6px 10px; }
.filter-buttons button[aria-pressed="true"] { color: #cee0fc; background: #26374f; border-color: #405777; }
.results-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin: 24px 0 14px; }
.count { margin: 0; color: #c3cedd; font-size: 13px; font-variant-numeric: tabular-nums; }
.results-note { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
article { min-width: 0; margin: 0 0 20px; padding: 22px; border: 1px solid var(--border); border-radius: 12px; background: #191f29; scroll-margin-top: calc(230px + var(--toolbar-offset)); }
.case-heading { display: flex; gap: 16px; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.case-identity { min-width: 0; display: flex; align-items: baseline; gap: 14px; }
.case-id { flex-shrink: 0; color: #8e9db1; font: 12px Menlo, monospace; text-decoration: none; }
.case-id:hover { color: var(--accent); text-decoration: underline; }
h2 { margin: 0; font-size: 16px; line-height: 1.65; font-weight: 600; overflow-wrap: anywhere; }
.badge { flex-shrink: 0; margin-top: 2px; border: 1px solid transparent; padding: 3px 8px; font-size: 11px; font-weight: 500; line-height: 1.5; border-radius: 5px; }
.badge.unchanged { color: #99a8bb; }
.badge.changed { background: #443725; border-color: #665133; color: #efd09a; }
.badge.added { background: #213e35; border-color: #36574b; color: #a3d9bf; }
.badge.removed { background: #402b33; border-color: #60414b; color: #e3afb9; }
.change-summary { margin: -8px 0 18px; font-size: 12px; color: #c7b591; line-height: 1.7; }
.change-summary > span { color: var(--muted); margin-right: 8px; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.screen { min-width: 0; }
.screen-heading { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 8px; }
h3 { margin: 0; font-size: 12px; color: #c2cedf; font-weight: 600; }
.meta { margin: 0; font-size: 11px; line-height: 1.7; color: #91a1b7; overflow-wrap: anywhere; }
.screen > .meta { margin-bottom: 8px; }
.terminal, details { background: #0d1117; border: 1px solid #2b3442; border-radius: 8px; overflow: auto; }
pre, .command { font-family: Menlo, "Noto Sans Mono CJK JP", "Hiragino Kaku Gothic ProN", monospace; font-size: 13px; line-height: 1.65; white-space: pre; tab-size: 8; }
pre { margin: 0; padding: 16px; min-width: max-content; color: #d8dee9; }
.command { padding: 12px 16px; border-bottom: 1px solid #253142; color: #a9b9ce; min-width: max-content; }
details { margin-top: 10px; }
summary { cursor: pointer; padding: 11px 16px; color: #a9b9ce; font-size: 12px; }
summary:hover { color: #dde8f6; }
.empty { color: #95abc5; }
.diff-line { display: inline-block; min-width: 100%; background: #4b392b; box-shadow: inset 3px 0 #eac06d; }
.empty-state { border: 1px dashed #3b4758; border-radius: 12px; padding: 56px 24px; text-align: center; background: #161c25; }
.empty-state h2 { font-size: 18px; }
.empty-state p { color: var(--muted); font-size: 14px; line-height: 1.8; margin: 12px 0 20px; }
.empty-state button { background: #2b405c; color: #e2edfc; border-color: #435e80; }
.empty-state button:hover { background: #365373; }
[hidden] { display: none !important; }
@media (max-width: 1000px) { .pair { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  body { padding: 24px 14px 40px; }
  .page-header { margin-bottom: 20px; }
  .toolbar { padding: 12px; }
  .toolbar-primary { align-items: stretch; flex-direction: column; gap: 14px; }
  .search-field { max-width: none; }
  .command-filters { margin-top: 12px; padding-top: 12px; }
  .filter-buttons { gap: 2px; }
  .filter-buttons button { padding: 5px 8px; }
  .results-heading { flex-direction: column; gap: 6px; margin-top: 20px; }
  article { padding: 16px 12px; scroll-margin-top: calc(340px + var(--toolbar-offset)); }
  .case-heading { gap: 8px; }
  .case-identity { display: block; }
  .case-id { display: inline-block; margin-bottom: 6px; }
  h2 { font-size: 14px; }
  .badge { padding: 3px 5px; }
}
@media (max-height: 600px) { .toolbar { position: static; } article { scroll-margin-top: 16px; } }
</style>
</head>
<body>
<header class="page-header">
  <span class="brand">wts</span>
  <h1 id="page-title">端末UIレビュー</h1>
  <p class="page-description">コマンドの表示を一覧で確認できます。変更があるケースは変更前・変更後を並べ、変わった行を背景色で示します。</p>
</header>
<main>
  <div class="toolbar" role="region" aria-label="表示と絞り込み">
    <div class="toolbar-primary">
      <div>
        <span class="control-label" id="view-label">表示するケース</span>
        <div class="view-navigation" role="group" aria-labelledby="view-label">${[
					["all", "全件", total],
					["changes", "変更のみ", changed],
				]
					.map(
						([view, label, count]) =>
							`<button type="button" data-view="${view}" aria-pressed="${view === (changesOnly ? "changes" : "all")}">${label}<span class="view-count">${count}件</span></button>`,
					)
					.join("")}</div>
      </div>
      <div class="search-field">
        <label class="control-label" for="search">ケースを検索</label>
        <input type="search" id="search" placeholder="ケース名・コマンド・出力" autocomplete="off">
      </div>
    </div>
    <nav class="command-filters" aria-labelledby="command-filter-label">
      <span class="control-label" id="command-filter-label">コマンドで絞り込み</span>
      <div class="filter-buttons">${["すべて", "共通", "doctor", "init", "config", "start", "stack", "cleanup", "restack"].map((group) => `<button type="button" data-filter="${group}" aria-pressed="${group === "すべて"}">${group}</button>`).join("")}</div>
    </nav>
  </div>
  <div class="results-heading">
    <p id="count" class="count" role="status" aria-live="polite"></p>
    <p class="results-note">外部サービスの応答を再現したケースには「疑似」と記載しています。</p>
  </div>
  <section id="empty" class="empty-state" aria-labelledby="empty-title" hidden>
    <h2 id="empty-title"></h2>
    <p id="empty-description"></p>
    <button type="button" id="show-all" hidden>全件を表示</button>
    <button type="button" id="clear-filters" hidden>絞り込みを解除</button>
  </section>
  ${cards}
</main>
<script>
let group = 'すべて';
let view = '${changesOnly ? "changes" : "all"}';
const articles = [...document.querySelectorAll('article')];
const search = document.querySelector('#search');
const labels = { all: '全件', changes: '変更のみ' };
const changedCount = articles.filter(article => article.dataset.changed === 'true').length;
function filter() {
  const query = search.value.trim().toLowerCase();
  let count = 0;
  for (const article of articles) {
    article.hidden = !((view !== 'changes' || article.dataset.changed === 'true')
      && (group === 'すべて' || article.dataset.group === group)
      && article.textContent.toLowerCase().includes(query));
    if (!article.hidden) count++;
  }
  const available = view === 'changes' ? changedCount : articles.length;
  document.querySelector('#count').textContent = labels[view] + ' ' + available + '件中 ' + count + '件を表示';
  const noChanges = view === 'changes' && changedCount === 0;
  document.querySelector('#empty').hidden = count !== 0;
  document.querySelector('#empty-title').textContent = noChanges ? '表示の変更はありません' : '一致するケースがありません';
  document.querySelector('#empty-description').textContent = noChanges
    ? '全件に切り替えると、現在のコマンドの表示を確認できます。'
    : '検索語やコマンドの絞り込みを変えて、もう一度お試しください。';
  document.querySelector('#show-all').hidden = !noChanges;
  document.querySelector('#clear-filters').hidden = noChanges;
  for (const button of document.querySelectorAll('button[data-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === group));
  }
}
function showView(next) {
  view = next;
  for (const button of document.querySelectorAll('button[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  document.title = 'wts 端末UIレビュー · ' + labels[view];
  filter();
}
document.querySelectorAll('button[data-view]').forEach(button => {
  button.onclick = () => showView(button.dataset.view);
});
document.querySelectorAll('button[data-filter]').forEach(button => {
  button.onclick = () => { group = button.dataset.filter; filter(); };
});
search.oninput = filter;
document.querySelector('#show-all').onclick = () => {
  showView('all');
  document.querySelector('button[data-view="all"]').focus();
};
document.querySelector('#clear-filters').onclick = () => {
  search.value = '';
  group = 'すべて';
  filter();
  search.focus();
};
showView(view);
</script>
</body>
</html>`;
}

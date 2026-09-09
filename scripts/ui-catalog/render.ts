import type { Capture } from "./capture";
import type { Comparison } from "./comparison";
import { escapeHtml } from "./html";
import { pageScript, pageStyles } from "./page-assets";
import { terminal } from "./terminal-renderer";

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

function commandGroup(item: Capture): string {
	const command = item.args[0];
	return command && !command.startsWith("-") ? command : "共通";
}

const stateLabels = {
	added: "追加",
	removed: "削除",
	changed: "変更",
	unchanged: "変更なし",
};

function caseCard(
	comparison: Comparison,
	index: number,
	changesOnly: boolean,
): string {
	const item = comparison.current ?? comparison.previous;
	if (!item) return "";
	const anchor = `case-${Bun.hash(item.title).toString(16)}`;
	const group = escapeHtml(commandGroup(item));
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
	return `<article id="${anchor}" data-group="${group}" data-changed="${comparison.changed}"${changesOnly && !comparison.changed ? " hidden" : ""}><header class="case-heading"><div class="case-identity"><a class="case-id" href="#${anchor}" aria-label="ケース C${String(index + 1).padStart(3, "0")} へのリンク">C${String(index + 1).padStart(3, "0")}</a><h2>${escapeHtml(item.title)}</h2></div><span class="badge ${stateClass}">${stateLabels[stateClass]}</span></header>${reasons.length ? `<p class="change-summary"><span>変更点</span> ${reasons.join(" / ")}</p>` : ""}${screens}</article>`;
}

export function renderPage(
	comparisons: Comparison[],
	changesOnly: boolean,
): string {
	const commands = [
		...new Set(
			comparisons.flatMap((comparison) => {
				const item = comparison.current ?? comparison.previous;
				return item ? [commandGroup(item)] : [];
			}),
		),
	];
	const cards = comparisons
		.map((comparison, index) => caseCard(comparison, index, changesOnly))
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
<style>${pageStyles}</style>
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
      <div class="filter-buttons">${["すべて", ...commands].map((group) => `<button type="button" data-filter="${escapeHtml(group)}" aria-pressed="${group === "すべて"}">${escapeHtml(group)}</button>`).join("")}</div>
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
<script>${pageScript(changesOnly)}</script>
</body>
</html>`;
}

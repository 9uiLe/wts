export const pageStyles = `
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
`;

export function pageScript(changesOnly: boolean): string {
	return `
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
`;
}

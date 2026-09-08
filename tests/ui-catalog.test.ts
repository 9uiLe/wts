import { expect, test } from "bun:test";
import type { Capture } from "../scripts/ui-catalog/capture";
import {
	compareCaptures,
	normalize,
	normalizeCapture,
	normalizeRecord,
} from "../scripts/ui-catalog/normalize";
import { renderPage } from "../scripts/ui-catalog/render";
import { terminal } from "../scripts/ui-catalog/terminal-renderer";

function snapshot(overrides: Partial<Capture> = {}): Capture {
	return {
		title: "start 成功",
		args: ["start"],
		command: "wts start",
		cwd: "<fixture>/repo",
		code: 0,
		raw: "完了\r\n",
		frames: [],
		mode: "TTY 実測",
		input: [],
		...overrides,
	};
}

test("catalog replays cursor edits and Japanese display widths", () => {
	expect(terminal("first\nsecond\n", true).plain).toBe("first\nsecond");
	expect(terminal("日本語\r\u001b[2K完了\r\n").plain).toBe("完了");
	expect(terminal("日本\u001b[2D本\r\n").plain).toBe("日本");
	expect(
		terminal("古い画面\r\n入力中\u001b[1A\r\u001b[J新しい画面\r\n").plain,
	).toBe("新しい画面");
});

test("catalog ignores completed spinner frames and fixture values", () => {
	const baseline = snapshot({
		raw: "Path <fixture>/repo\r\n",
	});
	const current = snapshot({
		cwd: "/private/tmp/catalog-current/repo",
		raw: "\u001b[?25l⠋ 処理中\r\u001b[2K⠙ 処理中\r\u001b[2K\u001b[?25hPath /private/tmp/catalog-current/repo\r\n",
	});
	expect(normalizeCapture(current, "/private/tmp/catalog-current")).toBe(
		normalizeCapture(baseline),
	);
});

test("catalog compares saved captures across Nix temporary directories", () => {
	const first = snapshot({
		raw: "Path /private/tmp/nix-shell.rk8A4K/wts-ui-catalog-O7r2uU/repo\r\n",
	});
	const second = snapshot({
		raw: "Path /private/tmp/nix-shell.ezDlr7/wts-ui-catalog-E87LoF/repo\r\n",
	});
	expect(compareCaptures([second], [first])[0]?.changed).toBe(false);
});

test("catalog baseline records portable fixture values and preserves terminal input", () => {
	const root = "/private/tmp/wts-ui-catalog-example";
	const item = snapshot({
		args: ["start", "--copy-from", `${root}/source`],
		cwd: `${root}/repo`,
		command: `wts start --copy-from ${root}/source`,
		raw: `Path ${root}/repo\r\n`,
		frames: [`Path ${root}/repo\r\n`],
		input: [[`確認 ${root}/repo`, "\u0003"]],
	});
	const saved = normalizeRecord(item, root);
	expect(JSON.stringify(saved)).not.toContain(root);
	expect(saved.args).toEqual(["start", "--copy-from", "<fixture>/source"]);
	expect(saved.input).toEqual([["確認 <fixture>/repo", "\u0003"]]);
	expect(normalizeCapture(saved)).toBe(normalizeCapture(item, root));
	expect(normalizeRecord(saved)).toEqual(saved);
});

test("catalog detects text, color, input, prompt frames, and exit status changes", () => {
	for (const override of [
		{ raw: "失敗\r\n" },
		{ raw: "\u001b[32m完了\u001b[39m\r\n" },
		{ input: [["確認", "\r"]] as Array<[string, string]> },
		{ frames: ["入力してください\r\n"] },
		{ code: 1 },
	]) {
		expect(
			compareCaptures([snapshot(override)], [snapshot()])[0]?.changed,
		).toBe(true);
	}
});

test("catalog preserves branch names and numbers that only resemble abbreviated hashes", () => {
	expect(normalize("Branch deadbeef\nPR 20260908\n完了 1234567 件")).toBe(
		"Branch deadbeef\nPR 20260908\n完了 1234567 件",
	);
	const first = snapshot({
		raw: "Branch 20260908-9134a0ac-82f6-4cba-b516-b6343be9cc65",
	});
	const second = snapshot({
		raw: "Branch 20260909-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	});
	expect(normalizeCapture(first)).toBe(normalizeCapture(second));
});

test("catalog shows only modified, added, and removed cases on the changes page", () => {
	const baseline = [snapshot(), snapshot({ title: "削除されたケース" })];
	const current = [snapshot(), snapshot({ title: "追加されたケース" })];
	const comparison = compareCaptures(current, baseline);
	expect(comparison.filter((item) => item.changed)).toHaveLength(2);
	const changes = renderPage(comparison, true);
	expect(changes).toContain("追加されたケース");
	expect(changes).toContain("削除されたケース");
	expect(changes).toMatch(/<article[^>]*data-changed="false"[^>]*hidden/);
	expect(changes.match(/<article[^>]*data-changed="true"[^>]*>/g)).toHaveLength(
		2,
	);
	expect(changes).not.toMatch(/<article[^>]*data-changed="true"[^>]*hidden/);
	expect(renderPage(comparison, false)).toContain("start 成功");
});

test("catalog escapes terminal and case text in standalone HTML", () => {
	const dangerous = '<img src=x onerror="alert(1)">';
	const page = renderPage(
		[
			{
				current: snapshot({ title: dangerous, raw: dangerous }),
				changed: true,
			},
		],
		false,
	);
	expect(page).not.toContain(dangerous);
	expect(page).toContain("&lt;img");
	expect(page).not.toContain('src="https://');
});

test("catalog navigation works without loading neighboring local files", () => {
	const page = renderPage(
		[
			{
				current: snapshot(),
				previous: snapshot(),
				changed: false,
			},
		],
		false,
	);
	expect(
		[...page.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map(
			(match) => match[1],
		),
	).toEqual(["all", "changes"]);
	for (const link of page.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
		expect(link[1]?.startsWith("#")).toBe(true);
	}
});

test("catalog review contains only visual review controls and screens", () => {
	const page = renderPage([{ current: snapshot(), changed: true }], false);
	expect(
		[...page.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map(
			(match) => match[1],
		),
	).toEqual(["all", "changes"]);
	expect(page).not.toContain(snapshot().cwd);
	expect(page).toContain("$ wts start");
	expect(page).toContain("追加された出力");
});

test("catalog compares only changed outputs and shows other cases once", () => {
	const before = snapshot({ raw: "旧表示\r\n" });
	const after = snapshot({ raw: "新表示\r\n" });
	for (const [item, count, labels] of [
		[{ previous: after, current: after, changed: false }, 1, ["出力"]],
		[
			{ previous: before, current: after, changed: true },
			2,
			["変更前", "変更後"],
		],
		[{ current: after, changed: true }, 1, ["追加された出力"]],
		[{ previous: before, changed: true }, 1, ["削除された出力"]],
	] as const) {
		const page = renderPage([item], false);
		expect(page.match(/class="screen"/g)).toHaveLength(count);
		for (const label of labels) expect(page).toContain(`<h3>${label}</h3>`);
		expect(
			[...page.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]),
		).toEqual([...labels]);
		if (count === 1) expect(page).not.toContain('<div class="pair">');
	}
});

test("catalog makes review scope, search, and empty-state recovery discoverable", () => {
	const page = renderPage(
		[
			{ current: snapshot(), previous: snapshot(), changed: false },
			{ current: snapshot({ title: "追加ケース" }), changed: true },
		],
		false,
	);
	expect(page).toMatch(/<label[^>]*for="search"/);
	expect(page).toContain('id="show-all"');
	expect(page).toContain('id="clear-filters"');
	expect(page).toContain("全件を表示");
	expect(page).toContain("絞り込みを解除");
	expect(page).toContain("終了コード");
});

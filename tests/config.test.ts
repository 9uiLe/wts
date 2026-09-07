import { expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFile, loadProjectConfig } from "../src/config";

function fixture() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "wts-config-")));
	const main = join(dir, "main");
	const root = join(dir, "session");
	mkdirSync(main);
	mkdirSync(root);
	mkdirSync(join(main, ".git"));
	const file = join(root, ".wts.json");
	function config(value: unknown) {
		writeFileSync(file, JSON.stringify(value));
	}
	return {
		dir,
		main,
		root,
		file,
		config,
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("config resolves worktree paths from main and naming scripts from the selected config without execution", () => {
	const f = fixture();
	try {
		const marker = join(f.dir, "executed");
		const script = join(f.root, "name.sh");
		writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
		f.config({
			worktreeDirectory: "sessions",
			naming: {
				branch: { script: "name.sh", prompt: "Branch?" },
				worktree: { script: "name.sh" },
			},
		});
		const result = loadProjectConfig(f.root, f.main);
		expect(result.path).toBe(f.file);
		expect(result.directory).toBe(f.root);
		expect(result.worktreesBase).toBe(join(f.main, "sessions"));
		expect(result.config.naming?.branch).toEqual({ script, prompt: "Branch?" });
		expect(result.config.naming?.worktree).toEqual({ script });
		expect(existsSync(marker)).toBe(false);
		expect(existsSync(result.worktreesBase)).toBe(false);
	} finally {
		f.dispose();
	}
});

test("config requires a file, falls back to main, and prefers root config", () => {
	const f = fixture();
	try {
		expect(() => loadProjectConfig(f.root, f.main)).toThrow("wts init");
		expect(() => loadProjectConfig(f.main, f.main)).toThrow("wts init");
		writeFileSync(
			join(f.main, ".wts.json"),
			JSON.stringify({ worktreeDirectory: "../shared" }),
		);
		expect(loadProjectConfig(f.root, f.main).worktreesBase).toBe(
			join(f.dir, "shared"),
		);
		f.config({});
		expect(loadProjectConfig(f.root, f.main).path).toBe(f.file);
		expect(loadProjectConfig(f.root, f.main).worktreesBase).toBe(
			`${f.main}-worktrees`,
		);
	} finally {
		f.dispose();
	}
});

test("config rejects unknown keys, null, invalid types, NUL and missing naming scripts", () => {
	const f = fixture();
	try {
		for (const [value, message] of [
			[null, "オブジェクト"],
			[[], "オブジェクト"],
			[{ unknown: true }, "不明な設定キー"],
			[{ worktreeDirectory: null }, "worktreeDirectory"],
			[{ worktreeDirectory: "" }, "空のパス"],
			[{ worktreeDirectory: "a\0b" }, "NUL"],
			[{ naming: null }, "naming"],
			[{ naming: { unknown: {} } }, "naming.unknown"],
			[{ naming: { branch: {} } }, "naming.branch.script"],
			[
				{ naming: { worktree: { script: "", prompt: 4 } } },
				"naming.worktree.script",
			],
			[
				{ naming: { branch: { script: "missing", unknown: true } } },
				"naming.branch.unknown",
			],
		] as const) {
			f.config(value);
			expect(() => loadProjectConfig(f.root, f.main)).toThrow(message);
		}
		const script = join(f.root, "script");
		writeFileSync(script, "#!/bin/sh\n", { mode: 0o755 });
		for (const prompt of [null, 42, "a\0b"]) {
			f.config({ naming: { branch: { script, prompt } } });
			expect(() => loadConfigFile(f.file, f.main)).toThrow(
				"naming.branch.prompt",
			);
		}
	} finally {
		f.dispose();
	}
});

test("config reports unreadable or malformed explicit files and rejects missing or nonexecutable scripts", () => {
	const f = fixture();
	try {
		expect(() => loadConfigFile(f.file)).toThrow(
			"設定ファイルを読み込めません",
		);
		writeFileSync(f.file, "{");
		expect(() => loadConfigFile(f.file)).toThrow("JSON 構文");
		const script = join(f.root, "script");
		for (const path of ["missing", f.root]) {
			f.config({ naming: { worktree: { script: path } } });
			expect(() => loadConfigFile(f.file)).toThrow("実行可能ファイル");
		}
		writeFileSync(script, "#!/bin/sh\n");
		chmodSync(script, 0o644);
		f.config({ naming: { branch: { script } } });
		expect(() => loadConfigFile(f.file)).toThrow("実行可能ファイル");
	} finally {
		f.dispose();
	}
});

test("config canonicalizes symlink ancestors and rejects files and Git metadata as destinations", () => {
	const f = fixture();
	try {
		const actual = join(f.dir, "actual");
		mkdirSync(actual);
		symlinkSync(actual, join(f.dir, "alias"));
		f.config({ worktreeDirectory: "../alias/new/nested" });
		expect(loadConfigFile(f.file, f.main).worktreesBase).toBe(
			join(actual, "new/nested"),
		);
		writeFileSync(join(f.dir, "file"), "file");
		f.config({ worktreeDirectory: "../file/nested" });
		expect(() => loadConfigFile(f.file, f.main)).toThrow("ディレクトリ");
		for (const path of [".", ".git/objects/new"]) {
			f.config({ worktreeDirectory: path });
			expect(() => loadConfigFile(f.file, f.main)).toThrow(
				path === "." ? "メインリポジトリ" : ".git 管理情報",
			);
		}
		symlinkSync(join(f.main, ".git"), join(f.dir, "metadata"));
		f.config({ worktreeDirectory: "../metadata/new" });
		expect(() => loadConfigFile(f.file, f.main)).toThrow(".git 管理情報");
		const gitdir = join(f.dir, "linked-gitdir");
		mkdirSync(gitdir);
		writeFileSync(join(f.root, ".git"), `gitdir: ${gitdir}\n`);
		f.config({ worktreeDirectory: "../linked-gitdir/new" });
		expect(() => loadConfigFile(f.file, f.main)).toThrow(".git 管理情報");
	} finally {
		f.dispose();
	}
});

import { expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");
const discovery = readFileSync(
	resolve(import.meta.dir, "../skills/wts-cli/SKILL.md"),
	"utf8",
);
const guide = readFileSync(
	resolve(import.meta.dir, "../skills/wts-cli/references/guide.md"),
	"utf8",
);

function run(cwd: string, ...args: string[]) {
	const result = Bun.spawnSync([process.execPath, cli, "skills", ...args], {
		cwd,
		env: { ...process.env, PATH: "", HOME: cwd },
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString(),
		err: result.stderr.toString(),
	};
}

test("guide is available without a repository, external commands or a TTY", () => {
	expect(run(tmpdir(), "get", "wts-cli")).toEqual({
		code: 0,
		out: guide,
		err: "",
	});
	expect(run(tmpdir(), "get", "../unknown").code).toBe(1);
});

test("install supports default and explicit paths, repeated installation and deliberate updates", () => {
	const dir = mkdtempSync(join(tmpdir(), "wts-skills-"));
	try {
		expect(run(dir, "install", "wts-cli").code).toBe(0);
		expect(
			readFileSync(join(dir, ".agents/skills/wts-cli/SKILL.md"), "utf8"),
		).toBe(discovery);
		const parent = join(dir, "custom skills");
		const args = ["install", "wts-cli", "--path", parent];
		expect(run(dir, ...args).code).toBe(0);
		const file = join(parent, "wts-cli/SKILL.md");
		expect(readFileSync(file, "utf8")).toBe(discovery);
		expect(run(dir, ...args).code).toBe(0);
		writeFileSync(file, "user customization");
		expect(run(dir, ...args).code).toBe(1);
		expect(readFileSync(file, "utf8")).toBe("user customization");
		expect(run(dir, ...args, "--force").code).toBe(0);
		expect(readFileSync(file, "utf8")).toBe(discovery);
		expect(run(dir, "install", "../unknown", "--path", parent).code).toBe(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("install refuses symlink destinations even with force", () => {
	const dir = mkdtempSync(join(tmpdir(), "wts-skills-"));
	try {
		expect(run(dir, "install", "wts-cli", "--path", dir).code).toBe(0);
		const target = join(dir, "target");
		writeFileSync(target, "preserve");
		const file = join(dir, "wts-cli/SKILL.md");
		rmSync(file);
		symlinkSync(target, file);
		expect(run(dir, "install", "wts-cli", "--path", dir, "--force").code).toBe(
			1,
		);
		expect(readFileSync(target, "utf8")).toBe("preserve");
		rmSync(join(dir, "wts-cli"), { recursive: true });
		symlinkSync(dir, join(dir, "wts-cli"));
		expect(run(dir, "install", "wts-cli", "--path", dir, "--force").code).toBe(
			1,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

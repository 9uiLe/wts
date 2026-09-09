import { afterEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCli } from "./helpers/cli";
const entrypoint = readFileSync(
	resolve(import.meta.dir, "../skills/wts-cli/SKILL.md"),
	"utf8",
);
const guide = readFileSync(
	resolve(import.meta.dir, "../skills/wts-cli/references/guide.md"),
	"utf8",
);
const fixtures = new Set<string>();

afterEach(() => {
	for (const directory of fixtures)
		rmSync(directory, { recursive: true, force: true });
	fixtures.clear();
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "wts-skills-"));
	fixtures.add(directory);
	const userHome = join(directory, "home");
	mkdirSync(userHome);
	function run(...args: string[]) {
		const { code, out, err } = runCli(directory, ["skills", ...args], {
			PATH: "",
			HOME: userHome,
		});
		return { code, out, err };
	}
	const skillDirectory = join(directory, "wts-cli");
	const skillFile = join(skillDirectory, "SKILL.md");
	function install(...options: string[]) {
		return run("install", "wts-cli", "--path", directory, ...options);
	}
	return { directory, userHome, skillDirectory, skillFile, run, install };
}

test("get returns the complete guide without a repository, external commands or a TTY", () => {
	expect(fixture().run("get", "wts-cli")).toEqual({
		code: 0,
		out: guide,
		err: "",
	});
});

test.each(["get", "install"])(
	"%s rejects an unknown skill without creating a skill directory",
	(command) => {
		const f = fixture();
		const options =
			command === "install" ? ["--path", join(f.directory, "skills")] : [];
		const result = f.run(command, "../unknown", ...options);
		expect(result.code).toBe(1);
		expect(result.out).toBe("");
		expect(result.err).toContain("未知のスキル");
		expect(readdirSync(f.directory)).toEqual(["home"]);
	},
);

test("install places the entrypoint in the user's default skills directory", () => {
	const f = fixture();
	expect(f.run("install", "wts-cli").code).toBe(0);
	expect(
		readFileSync(join(f.userHome, ".agents/skills/wts-cli/SKILL.md"), "utf8"),
	).toBe(entrypoint);
});

test("install resolves an explicit relative skills directory from the working directory", () => {
	const f = fixture();
	expect(f.run("install", "wts-cli", "--path", "custom skills").code).toBe(0);
	expect(
		readFileSync(join(f.directory, "custom skills/wts-cli/SKILL.md"), "utf8"),
	).toBe(entrypoint);
});

test("reinstalling identical content succeeds without rewriting the file", () => {
	const f = fixture();
	expect(f.install().code).toBe(0);
	const installed = statSync(f.skillFile);
	expect(f.install().code).toBe(0);
	expect(statSync(f.skillFile).ino).toBe(installed.ino);
	expect(statSync(f.skillFile).mtimeMs).toBe(installed.mtimeMs);
	expect(readFileSync(f.skillFile, "utf8")).toBe(entrypoint);
});

test("install preserves customized content unless force is specified", () => {
	const f = fixture();
	mkdirSync(f.skillDirectory);
	writeFileSync(f.skillFile, "custom instructions");
	const result = f.install();
	expect(result.code).toBe(1);
	expect(result.err).toContain("--force");
	expect(readFileSync(f.skillFile, "utf8")).toBe("custom instructions");
});

test("forced installation replaces only the entrypoint and preserves other files", () => {
	const f = fixture();
	mkdirSync(f.skillDirectory);
	writeFileSync(f.skillFile, "custom instructions");
	const notes = join(f.skillDirectory, "notes.md");
	writeFileSync(notes, "user notes");
	expect(f.install("--force").code).toBe(0);
	expect(readFileSync(f.skillFile, "utf8")).toBe(entrypoint);
	expect(readFileSync(notes, "utf8")).toBe("user notes");
	expect(readdirSync(f.skillDirectory).sort()).toEqual([
		"SKILL.md",
		"notes.md",
	]);
});

test.each([
	"entrypoint symlink",
	"entrypoint directory",
	"skill directory symlink",
])("install rejects %s even with force", (kind) => {
	const f = fixture();
	const target = join(f.directory, "target");
	writeFileSync(target, "preserve");
	if (kind === "skill directory symlink") {
		symlinkSync(f.directory, f.skillDirectory);
	} else {
		mkdirSync(f.skillDirectory);
		if (kind === "entrypoint symlink") symlinkSync(target, f.skillFile);
		else mkdirSync(f.skillFile);
	}
	expect(f.install("--force").code).toBe(1);
	expect(readFileSync(target, "utf8")).toBe("preserve");
});

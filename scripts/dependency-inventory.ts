import { readFile } from "node:fs/promises";

type DependencyLock = {
	packages: Record<string, [string, string, unknown, string]>;
};

const registryUrl = "https://registry.npmjs.org";
const installLifecycle = ["preinstall", "install", "postinstall"];
const lock = Bun.JSON5.parse(
	await readFile("bun.lock", "utf8"),
) as DependencyLock;
const inventory = [];

for (const [name, [resolved, registry, , integrity]] of Object.entries(
	lock.packages,
)) {
	if (registry !== "" && !registry.startsWith(`${registryUrl}/`)) {
		throw new Error(`Unexpected dependency source: ${name}`);
	}
	if (!integrity?.startsWith("sha512-")) {
		throw new Error(`Missing integrity: ${name}`);
	}

	const file = Bun.file(`node_modules/${name}/package.json`);
	if (!(await file.exists())) {
		inventory.push({ name, resolved, integrity, installed: false });
		continue;
	}
	const metadata = await file.json();
	const scripts = metadata.scripts ?? {};
	const installScripts = Object.fromEntries(
		installLifecycle
			.filter((key) => key in scripts)
			.map((key) => [key, scripts[key]]),
	);
	inventory.push({
		name,
		version: metadata.version,
		resolved,
		registry: registry || registryUrl,
		integrity,
		license: metadata.license ?? "UNKNOWN",
		repository: metadata.repository,
		installScripts,
	});
}

console.log(JSON.stringify(inventory, null, 2));

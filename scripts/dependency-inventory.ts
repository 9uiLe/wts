import { readFile } from "node:fs/promises";

const lock = Bun.JSON5.parse(await readFile("bun.lock", "utf8")) as {
  packages: Record<string, [string, string, unknown, string]>;
};
const inventory = [];
for (const [name, [resolved, registry, , integrity]] of Object.entries(lock.packages)) {
  if (registry !== "" && !registry.startsWith("https://registry.npmjs.org/")) {
    throw new Error(`Unexpected dependency source: ${name}`);
  }
  if (!integrity?.startsWith("sha512-")) throw new Error(`Missing integrity: ${name}`);
  const file = Bun.file(`node_modules/${name}/package.json`);
  if (!(await file.exists())) {
    inventory.push({ name, resolved, integrity, installed: false });
    continue;
  }
  const metadata = await file.json();
  const scripts = metadata.scripts ?? {};
  inventory.push({ name, version: metadata.version, resolved, registry: registry || "https://registry.npmjs.org", integrity,
    license: metadata.license ?? "UNKNOWN", repository: metadata.repository,
    installScripts: Object.fromEntries(["preinstall", "install", "postinstall"].filter(key => key in scripts).map(key => [key, scripts[key]])),
  });
}
console.log(JSON.stringify(inventory, null, 2));

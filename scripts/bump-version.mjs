import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workspaceDirectory } from "./tool-paths.mjs";

const file = (name) => resolve(workspaceDirectory, name);
const pkg = JSON.parse(await readFile(file("package.json"), "utf8"));
const validVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
if (!validVersion.test(pkg.version))
  throw new Error("Expected semantic version");
const [major, minor, patch] = pkg.version.split(".").map(Number);
if (
  ![major, minor, patch].every(
    (part) => Number.isSafeInteger(part) && part >= 0,
  )
)
  throw new Error("Expected semantic version");
const override = process.argv.indexOf("--set");
const next =
  override < 0 ? `${major}.${minor}.${patch + 1}` : process.argv[override + 1];
if (!validVersion.test(next ?? ""))
  throw new Error("Expected --set major.minor.patch");
const edits = new Map();
for (const name of ["package.json", "src-tauri/tauri.conf.json"]) {
  const data = JSON.parse(await readFile(file(name), "utf8"));
  if (data.version !== pkg.version)
    throw new Error(`Version mismatch: ${name}`);
  data.version = next;
  edits.set(name, JSON.stringify(data, null, 2) + "\n");
}
const manifest = (await readFile(file("src-tauri/Cargo.toml"), "utf8")).replace(
  /\r\n/g,
  "\n",
);
const lock = (await readFile(file("src-tauri/Cargo.lock"), "utf8")).replace(
  /\r\n/g,
  "\n",
);
const packageEntry = `name = "animeread"\nversion = "${pkg.version}"`;
if (
  !manifest.includes(`version = "${pkg.version}"`) ||
  !lock.includes(packageEntry)
)
  throw new Error("Rust version mismatch");
edits.set(
  "src-tauri/Cargo.toml",
  manifest.replace(`version = "${pkg.version}"`, `version = "${next}"`),
);
edits.set(
  "src-tauri/Cargo.lock",
  lock.replace(packageEntry, `name = "animeread"\nversion = "${next}"`),
);
edits.set(
  "README.md",
  (await readFile(file("README.md"), "utf8"))
    .replace(/当前版本 \*\*[0-9.]+\*\*/, `当前版本 **${next}**`)
    .replace(/构建版本 [0-9.]+/, `构建版本 ${next}`),
);
if (!process.argv.includes("--dry-run"))
  for (const [name, content] of edits) await writeFile(file(name), content);
console.log(`AnimeRead ${next}`);

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { verificationDirectory } from "./tool-paths.mjs";

const root = resolve(import.meta.dirname, "..");
const files = new Set([
  ".gitignore",
  ".gitattributes",
  ".prettierignore",
  "index.html",
  "LICENSE",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "knip.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/icons/icon.ico",
  "src-tauri/icons/icon.png",
  ...[
    "ARCHITECTURE.md",
    "USER_GUIDE.md",
    "BUILD.md",
    "FILES.md",
    "RELEASE.md",
    "VOICE_TRAINING.md",
  ].map((name) => `docs/${name}`),
]);
async function walk(directory) {
  for (const entry of await readdir(resolve(root, directory), {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink())
      throw new Error(
        `Source export does not follow links: ${directory}/${entry.name}`,
      );
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(name);
    else if (entry.isFile()) files.add(name);
  }
}
for (const directory of [
  "src",
  "src-tauri/src",
  "src-tauri/capabilities",
  "src-tauri/windows",
  "public",
  "scripts",
  "tests",
  "vendor",
  ".github",
  "docs/licenses",
])
  await walk(directory);

const writer = new ZipWriter(new Uint8ArrayWriter());
const records = [];
const normalizePath = (value) => value.replace(/\\+/g, "/").toLowerCase();
const privatePaths = [process.env.USERPROFILE, process.env.ANIMEREAD_TEST_BOOK]
  .filter(Boolean)
  .map(normalizePath);
for (const name of [...files].sort()) {
  const path = resolve(root, name);
  if (relative(root, path).startsWith(".."))
    throw new Error("Source path escaped workspace");
  const bytes = await readFile(path);
  const content = normalizePath(bytes.toString("utf8"));
  if (
    !/\.(?:png|ico|wav|ogg)$/i.test(name) &&
    (/[a-z]:\/users\//i.test(content) ||
      privatePaths.some((path) => content.includes(path)))
  )
    throw new Error(`Personal path found in public source: ${name}`);
  await writer.add(name, new Uint8ArrayReader(bytes), {
    lastModDate: new Date("2026-10-05T00:00:00Z"),
  });
  records.push({
    path: name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = {
  version: pkg.version,
  files: records,
  excluded: [
    "personal books and media",
    "reading data",
    "private handoff notes",
    "node_modules",
    ".tools",
    ".cache",
    "target",
    "dist",
    "artifacts",
    "runtime",
    "AnimeRead.exe",
    "test-results",
  ],
};
await writer.add(
  "SOURCE_MANIFEST.json",
  new Uint8ArrayReader(Buffer.from(JSON.stringify(manifest, null, 2))),
  { lastModDate: new Date("2026-10-05T00:00:00Z") },
);
const bytes = new Uint8Array(await writer.close());
await mkdir(verificationDirectory, { recursive: true });
const output = resolve(root, `AnimeRead-source-${pkg.version}.zip`);
await writeFile(output, bytes);
await writeFile(
  resolve(verificationDirectory, "source-export.json"),
  JSON.stringify(
    {
      file: relative(root, output),
      files: records.length + 1,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      excluded: manifest.excluded,
    },
    null,
    2,
  ),
);
console.log(`Source package: ${output} (${records.length + 1} files)`);

import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
} from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { toolsDirectory, runtimeDirectory } from "./tool-paths.mjs";
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/licenses");
await mkdir(output, { recursive: true });
const pnpm = process.env.npm_execpath ?? process.env.PNPM_CLI;
if (!pnpm)
  throw new Error(
    "请使用 pnpm run licenses:collect，或设置 PNPM_CLI 指向 pnpm.cjs",
  );
const report = JSON.parse(
  execFileSync(
    process.execPath,
    [pnpm, "licenses", "list", "--prod", "--json"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  ),
);
const records = [];
for (const packages of Object.values(report))
  for (const item of packages) {
    const directory = item.paths[0];
    const name = item.name.replaceAll("/", "__");
    const files = (await readdir(directory)).filter((name) =>
      /^(license|licence|notice|copying)(\.|$)/i.test(name),
    );
    const saved = [];
    for (const file of files) {
      const target = `npm-${name}-${file}`;
      await copyFile(join(directory, file), join(output, target));
      saved.push(target);
    }
    records.push({
      name: item.name,
      versions: item.versions,
      license: item.license,
      homepage: item.homepage,
      notices: saved,
    });
  }
await copyFile(
  resolve("vendor/foliate-js/LICENSE"),
  join(output, "foliate-js-MIT.txt"),
);
await copyFile(
  resolve("vendor/page-flip/LICENSE"),
  join(output, "StPageFlip-MIT.txt"),
);
// 源码 checkout 可以没有可选模型，已有公开许可仍可使用。
// 优先实际发行资源，避免目录整理后继续引用已删除的 runtime/gpu。
for (const source of [
  resolve(runtimeDirectory, "waifu2x/LICENSE"),
  resolve(toolsDirectory, "waifu2x/LICENSE"),
]) {
  try {
    await copyFile(source, join(output, "waifu2x-ncnn-vulkan-MIT.txt"));
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await writeFile(
  join(output, "frontend-components.json"),
  JSON.stringify(records, null, 2),
);
const selected = JSON.parse(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& './scripts/detect-toolchain.ps1' | ConvertTo-Json -Compress",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  ).replace(/^\uFEFF/, ""),
);
if (selected.kind === "Missing")
  throw new Error("No usable Rust toolchain detected");
const environment = {
  ...process.env,
  CARGO_HOME: selected.cargoHome,
  RUSTUP_HOME: selected.rustupHome,
  RUSTUP_TOOLCHAIN: selected.toolchain,
};
const metadata = JSON.parse(
  execFileSync(
    selected.cargo,
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      selected.toolchain.replace(/^stable-/, ""),
    ],
    {
      cwd: root,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    },
  ),
);
const active = new Set(metadata.resolve.nodes.map((node) => node.id));
const rust = metadata.packages
  .filter((pkg) => active.has(pkg.id) && pkg.name !== "animeread")
  .map((pkg) => ({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    licenseFile: pkg.license_file ? basename(pkg.license_file) : null,
    source: pkg.source,
    repository: pkg.repository,
  }));
await writeFile(
  join(output, "rust-components.json"),
  JSON.stringify(rust, null, 2),
);
console.log(
  "License inventories:",
  records.length,
  "frontend;",
  rust.length,
  "Rust packages.",
);

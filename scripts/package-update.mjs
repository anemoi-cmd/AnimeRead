/** 生成签名与更新清单，两个渠道使用同一把发行密钥。私钥从项目外读取，
 * 永不写入源码包、便携包或清单。CI 可通过环境变量提供自己的密钥。
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { workspaceDirectory } from "./tool-paths.mjs";

const pkg = JSON.parse(
  await readFile(resolve(workspaceDirectory, "package.json"), "utf8"),
);
const configuredKey =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  (process.env.LOCALAPPDATA &&
    join(process.env.LOCALAPPDATA, "AnimeRead/release-signing/update.key"));
if (!configuredKey)
  throw new Error("Set TAURI_SIGNING_PRIVATE_KEY to sign a release");
// build 支持密钥路径，但 signer sign 的 KEY 环境变量只接受密钥内容。
// 两种输入统一在内存中读取，避免把私钥放进命令行参数或日志。
const key = (await stat(configuredKey).catch(() => null))?.isFile()
  ? await readFile(configuredKey, "utf8")
  : configuredKey;
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: key,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
};
const platforms = {};
for (const [target, suffix] of [
  ["windows-x86_64", "setup.exe"],
  ["windows-x86_64-portable", "portable.zip"],
]) {
  const name = `AnimeRead-${pkg.version}-${suffix}`;
  const path = resolve(workspaceDirectory, name);
  const result = spawnSync(
    process.execPath,
    [
      resolve(workspaceDirectory, "node_modules/@tauri-apps/cli/tauri.js"),
      "signer",
      "sign",
      "--app-version",
      pkg.version,
      path,
    ],
    { cwd: workspaceDirectory, env, encoding: "utf8", windowsHide: true },
  );
  // signer 的标准输出包含签名；只公开成功与否，不记录密钥环境变量。
  if (result.error || result.status !== 0)
    throw new Error(`Failed to sign ${name}`);
  platforms[target] = {
    url: `https://github.com/anemoi-cmd/AnimeRead/releases/download/v${pkg.version}/${name}`,
    signature: (await readFile(`${path}.sig`, "utf8")).trim(),
  };
}
const changelog = await readFile(
  resolve(workspaceDirectory, "CHANGELOG.md"),
  "utf8",
);
const notes =
  changelog.split(`## ${pkg.version}`)[1]?.split(/\n## /)[0]?.trim() ??
  `AnimeRead ${pkg.version}`;
await writeFile(
  resolve(workspaceDirectory, "latest.json"),
  JSON.stringify(
    {
      version: pkg.version,
      notes,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Signed installer, portable archive and latest.json for ${pkg.version}`,
);

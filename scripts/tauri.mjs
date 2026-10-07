import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  buildDirectory,
  frontendDist,
  workspaceDirectory,
} from "./tool-paths.mjs";

const args = process.argv.slice(2);
const signingKey =
  process.env.LOCALAPPDATA &&
  resolve(process.env.LOCALAPPDATA, "AnimeRead/release-signing/update.key");
if (
  !process.env.TAURI_SIGNING_PRIVATE_KEY &&
  signingKey &&
  existsSync(signingKey)
) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = signingKey;
  process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
}
if (["build", "dev", "bundle"].includes(args[0])) {
  // 源码 ZIP／GitHub checkout 不包含 runtime。先同步帮助与许可证，
  // 没有可选 Waifu2x 模型也能正常编译；已有模型只复制必要运行文件。
  const resources = spawnSync(
    process.execPath,
    [
      resolve(workspaceDirectory, "scripts/package-portable.mjs"),
      "--runtime-only",
    ],
    { cwd: workspaceDirectory, stdio: "inherit", windowsHide: true },
  );
  if (resources.error) throw resources.error;
  if (resources.status !== 0) process.exit(resources.status ?? 1);
  args.push(
    "--config",
    JSON.stringify({
      build: { frontendDist },
    }),
  );
}
const result = spawnSync(
  process.execPath,
  [
    resolve(workspaceDirectory, "node_modules/@tauri-apps/cli/tauri.js"),
    ...args,
  ],
  {
    cwd: workspaceDirectory,
    env: { ...process.env, CARGO_TARGET_DIR: buildDirectory },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

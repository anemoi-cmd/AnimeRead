import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  buildDirectory,
  frontendDist,
  workspaceDirectory,
} from "./tool-paths.mjs";

const proxy = resolve(
  process.env.CARGO_HOME || resolve(homedir(), ".cargo"),
  "bin/cargo.exe",
);
const checking = ["check", "clippy", "test", "fmt"].includes(process.argv[2]);
const result = spawnSync(
  process.platform === "win32" && existsSync(proxy) ? proxy : "cargo",
  process.argv.slice(2),
  {
    cwd: workspaceDirectory,
    // 独立运行 clippy／test 时也需嵌入 pnpm build 的项目外前端产物。
    // 明确传入的 Tauri 配置优先，避免覆盖 CLI 的其他构建选项。
    env: {
      ...process.env,
      CARGO_TARGET_DIR: buildDirectory,
      TAURI_CONFIG:
        process.env.TAURI_CONFIG ||
        JSON.stringify({
          build: { frontendDist },
          // 干净源码不带模型二进制；类型／逻辑检查无需复制发行资源。
          ...(checking ? { bundle: { resources: [] } } : {}),
        }),
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

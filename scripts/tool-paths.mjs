import { resolve, relative, toNamespacedPath } from "node:path";
import { homedir } from "node:os";
export const workspaceDirectory = resolve(import.meta.dirname, "..");
export const cacheDirectory = resolve(
  process.env.ANIMEREAD_CACHE_DIR ||
    resolve(
      process.env.LOCALAPPDATA || resolve(homedir(), ".cache"),
      "AnimeRead/build-cache",
    ),
);
export const runtimeDirectory = resolve(workspaceDirectory, "runtime");
const frontendDirectory = resolve(cacheDirectory, "frontend/dist");
const frontendRelative = relative(
  resolve(workspaceDirectory, "src-tauri"),
  frontendDirectory,
);
// Tauri 配置会把 Windows 盘符识别为 URL；跨盘缓存使用命名空间路径。
// Cargo 检查与 Tauri 打包必须指向同一份前端，不能另建项目内 dist。
export const frontendDist = /^[A-Z]:/i.test(frontendRelative)
  ? toNamespacedPath(frontendDirectory)
  : frontendRelative;
export const verificationDirectory = resolve(cacheDirectory, "verification");
export const toolsDirectory = resolve(
  process.env.ANIMEREAD_TOOLS_DIR || resolve(cacheDirectory, "tools"),
);
export const buildDirectory = resolve(
  process.env.CARGO_TARGET_DIR ||
    resolve(
      cacheDirectory,
      process.env.RUSTUP_TOOLCHAIN || "stable-x86_64-pc-windows-msvc",
    ),
);

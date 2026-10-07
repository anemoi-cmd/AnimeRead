# 构建与缓存

## 工具安装

- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)：选“使用 C++ 的桌面开发”，保留 MSVC x64／x86 和 Windows SDK，安装在默认 Program Files 位置。脚本用官方 vswhere 定位，不依赖具体年份。
- [Rust](https://www.rust-lang.org/tools/install)：使用 1.90+ MSVC 工具链；Rustup 默认位于 `%USERPROFILE%/.cargo` 和 `.rustup`，不默认装到 Program Files。
- Node.js 22.13+ 和 pnpm 11.19.0，系统 WebView2 Runtime。编译与阅读均用普通账户。

```powershell
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal --component rustfmt --component clippy
pnpm install --frozen-lockfile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action InspectTools -Toolchain System
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action Build -Toolchain System
```

`InspectTools` 返回 `kind: System` 和实际工具路径；`Build` 生成根目录 AnimeRead.exe。需要旧版 GNU 工具时显式传入 `-ToolsDir` 或 `ANIMEREAD_TOOLS_DIR`，不会自动下载编译器。

## 编译如何变成程序

1. pnpm 根据 pnpm-lock.yaml 把开发依赖连接到 node_modules。
2. copy-pdf-assets 复制 PDF 字体／WASM 并生成文字层 CSS；TypeScript 检查类型，Vite 把 src、vendor 和帮助文档打成网页与 Worker。
3. Tauri／Cargo 用系统 MSVC、Windows SDK 和 Rust 编译 src-tauri，嵌入步骤 2 的网页。此后运行程序不需要 node_modules。
4. package-portable 把自用程序复制到根目录，把画质模型和许可放在 runtime。`-Action Package` 先同步发行资源、编译 NSIS 安装包，再生成无数据的便携 ZIP、安装 EXE 与签名更新清单；`portable.flag` 仅在便携 ZIP 中。

干净源码不带 runtime 二进制。Tauri 包装脚本会先生成许可和帮助资源；未安装可选 Waifu2x 组件也能编译，Anime4K 随前端构建。独立 Cargo 检查／测试跳过发行资源复制，GitHub CI 无需下载模型。

## 缓存与清理

默认前端、PDF 资源、Rust 产物、下载和测试报告在 `%LOCALAPPDATA%/AnimeRead/build-cache`。使用 `reader.ps1`、`pnpm tauri` 和 `node scripts/cargo.mjs`，避免直接 Cargo 命令在源码内生成 target。`ANIMEREAD_CACHE_DIR` 可指定外部缓存，`CARGO_TARGET_DIR` 或 `-TargetDir` 可单独指定 Rust 产物位置。

停止编译和测试后可清理默认缓存：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action CleanCache
```

此命令不清理已安装的工具、根目录程序、runtime 或阅读记录；发现目录链接会停止。node_modules 是标准开发依赖目录，可在停止开发后删除，再开发时重新安装。

`-Action CleanupTools` 兼容旧项目的 .tools：必须先用系统工具完成 release 编译，才删除项目内 Cargo／Rustup／MinGW 副本。GPU 模型属于 runtime，不是编译工具。

## 导出与版本

- `node scripts/setup-enhancement.mjs`：安装固定、校验过的 Waifu2x 扩展。
- `node scripts/package-source.mjs`：根目录生成可开源的源码 ZIP，不包括作品、阅读数据、程序、runtime 或缓存。
- `pnpm version:next`：补丁版本递增，如 0.9.5 → 0.9.6，同步 package.json、Tauri 配置和 Rust 清单／锁文件；加 --dry-run 可预览，加 --set 0.9.5 可指定版本。
- `ANIMEREAD_ENHANCEMENT_DEVICE` 设为已检测的 Vulkan 显卡编号可验证指定显卡；cpu／-1 仅用于禁用 Waifu2x 的验收，不会运行 CPU 模型。默认自动优先独显；未匹配的编号会禁用该后端。测试必须隔离 `ANIMEREAD_DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER`。

发布需要项目外的签名私钥，见 [RELEASE.md](RELEASE.md)。普通 Build 不要求私钥；Package 用于维护者发布，必须使用与公钥匹配的密钥。

源文件及生成目录逐项说明见 [FILES.md](FILES.md)。

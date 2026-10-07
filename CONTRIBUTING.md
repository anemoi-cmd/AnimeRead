# 参与开发

先阅读 README、docs/ARCHITECTURE.md 和 docs/USER_GUIDE.md，再安装锁定依赖。界面、来源读取、排版和 GPU 生命周期分别保存在独立模块中；新增文件格式应通过 ReaderEngine 和 ByteSource 接入。

修复问题时记录具体触发操作与实际结果。涉及导航、销毁、缓存或持久化时，补充能够触发原故障的回归测试；仅改变文案、颜色等低影响内容时不必增加实现镜像测试。

提交前运行：

```powershell
pnpm check
pnpm test
pnpm build
pnpm test:e2e
pnpm audit:code
pnpm format:check
node scripts/cargo.mjs fmt --manifest-path src-tauri/Cargo.toml --check
node scripts/cargo.mjs clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
node scripts/cargo.mjs test --manifest-path src-tauri/Cargo.toml --locked
```

真实漫画测试用 ANIMEREAD_TEST_BOOK 明确指定自己的文件。测试副本、报告和 WebView2 配置保存在项目外的 `%LOCALAPPDATA%/AnimeRead/build-cache`；不要提交作品、账号令牌、绝对个人路径或运行缓存。使用项目 Cargo 包装脚本避免直接调用 Cargo 在源码中产生 target。

修改 vendor 时保留许可证，更新 UPSTREAM.json 并记录补丁。修改增强模型或分发范围时更新 THIRD_PARTY_NOTICES.md。PR 描述应解释可复现问题、最终行为与相关验证，附上必要的结果，不需要复制完整日志。

GitHub 工作流只验证通用测试和 Rust 构建。NVIDIA 实机、增强预设、取消任务和连续翻页仍需使用原生验收脚本验证。

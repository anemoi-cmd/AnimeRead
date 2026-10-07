# 发布与软件内更新

官方仓库为 https://github.com/anemoi-cmd/AnimeRead，主分支 main，版本标签 v0.9.5 等。程序和模型放 Releases，源码仓库不包含用户书籍、读档或编译缓存。

## 更新渠道

从 0.9.5 起，侧栏“软件更新”可检查、下载并重启升级。安装版下载签名的 NSIS 包，继续使用当前用户安装位置；便携版下载签名的 ZIP，退出后仅替换程序和 runtime，保留 data、portable.flag 及现有目录中的其他文件。失败时还原已替换文件并重新启动旧程序。更新包必须来自官方仓库并通过签名校验；网络失败可重试，不用重新发包给用户。

0.9.4 及更早版本没有更新入口，首次需要手动升级到 0.9.5。安装版与便携版不混用更新包。签名用于证明更新包来源和完整性，与 Windows Authenticode／SmartScreen 证书是不同机制。

## 维护者第一次配置

使用 Tauri 官方 signer 生成私钥，保存在项目外。tauri.conf.json 只提交公钥，updater.endpoints 指向 Releases 的 latest.json。私钥丢失会让已有客户端无法验证后续更新，因此单独安全备份；不能提交到 Git 或发布资产。

设置仓库 Actions Secret `TAURI_SIGNING_PRIVATE_KEY` 和可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。本机脚本默认读取 `%LOCALAPPDATA%/AnimeRead/release-signing/update.key`；CI 从上述环境变量读取。自己维护的 fork 应替换公钥、仓库地址和自己的私钥，不能使用原维护者的签名身份。

## 后续版本发布

1. `pnpm install --frozen-lockfile`，`pnpm version:next`，更新 CHANGELOG.md。提交到 main。
2. GitHub 的 Actions 中手动运行 **Release** 工作流。它运行检查和测试，安装校验过的画质运行资源，构建便携／安装／源码包并签名。
3. 工作流先创建草稿 Release，上传两种程序包、两份签名、源码包和 latest.json，最后公开为最新版本。用户在阅读器中检查更新即可。已经发布的版本号不能重复使用。

也可本机构建：`reader.ps1 -Action Package -Toolchain System` 生成两种包和签名，再 `node scripts/package-source.mjs` 导出源码；将这些资产和 latest.json 全部上传到对应 v版本的草稿 Release，再发布。两个包必须同一次编译、同一把密钥签名，不能把旧签名套在新程序上。

前端、Rust、依赖和测试缓存均保留在项目外。发行后使用 CleanCache 清构建缓存；release-signing 下的私钥必须保留。

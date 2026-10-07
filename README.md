# AnimeRead

Windows 小说与漫画阅读器，当前版本 **0.9.5**。基于 Tauri 2、Rust、React、TypeScript 和 WebView2。

## 运行与功能

支持 Windows 10／11 x64，需要 Microsoft WebView2 Runtime。双击根目录 **AnimeRead.exe**，继续使用当前账户的阅读记录；移动程序时一起复制 **runtime**。阅读无需开发环境。

发行包：**AnimeRead-0.9.5-portable.zip** 解压后运行，记录保存在自身的 data 目录；**AnimeRead-0.9.5-setup.exe** 安装到当前账户，注册表仅使用本应用的 HKCU 键，卸载默认保留阅读记录。两包不附带书籍、私人记录或背景。不支持 Windows 7／8。若电脑缺少 WebView2，安装版会联网下载微软运行时，便携版需先安装该运行时。

- TXT、文字／漫画 EPUB、PDF、CBZ／ZIP、常用图片，自动分类和读取封面。
- 系统字体与文字排版、单双页、小说书脊、缩放、左右和上下阅读。
- 即时、滑动、可调速度的拖动仿真翻页与翻书声；全屏设置、书签、进度、阅读计时。
- 漫画纸张／墨水与木纹合成底色；软件内签名更新，便携／安装渠道分别升级。
- 同名系列自动分组、自定义卷序与轮换封面；移动文件重新导入可合并记录。
- Anime4K／Waifu2x、顺序滤镜链、后台增强与预缓存、原图／增强拖线对比。
- 最近阅读封面／时间、自定义首页文字、雨景与雨声、主题配色和图片／视频壁纸。

[使用说明](docs/USER_GUIDE.md) · [每个文件的用途](docs/FILES.md) · [架构](docs/ARCHITECTURE.md)

[版本下载](https://github.com/anemoi-cmd/AnimeRead/releases/latest) · [发布与软件内更新](docs/RELEASE.md) · [声音训练教程与路线](docs/VOICE_TRAINING.md)

待开发：网盘账号接入；小说朗读，后续按需规划总结与生图。旧 AI 占位接口已移除。当前不支持 DRM／密码文件及 RAR／7z。

Anime4K 需要硬件 WebGPU；Waifu2x 支持 NVIDIA／AMD／Intel Vulkan 显卡。本版实际验证 NVIDIA 独显和 AMD 核显，Intel 与 Windows 10 尚未实机验证。CPU 不支持超分；无可用硬件显卡时自动关闭，增强、引擎、滤镜与对比选项不可选。处理失败保留原图，阅读和翻页仍可使用。

## 开发

安装 Node.js 22.13+、pnpm 11.19.0、Rust MSVC、Microsoft C++ Build Tools，详见 [构建说明](docs/BUILD.md)。

~~~powershell
pnpm install --frozen-lockfile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action Dev
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action Build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reader.ps1 -Action Package
~~~

pnpm install --frozen-lockfile 按锁文件安装开发依赖；锁文件与依赖声明不一致会报错，不自动更改版本。仅阅读已编译程序时不需要运行它。

构建／测试缓存默认在 %LOCALAPPDATA%/AnimeRead/build-cache，程序输出到项目根目录。node scripts/setup-enhancement.mjs 可安装经 SHA-256 校验的 Waifu2x 扩展到 runtime/waifu2x。

## 验证与版本

~~~powershell
pnpm check
pnpm test
pnpm build
pnpm test:e2e
pnpm audit:code
pnpm format:check
node scripts/cargo.mjs fmt --manifest-path src-tauri/Cargo.toml --check
node scripts/cargo.mjs clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
node scripts/cargo.mjs test --manifest-path src-tauri/Cargo.toml --locked
~~~

可选实机验收：设置 ANIMEREAD_TEST_BOOK 指向自己的 170 页漫画 EPUB，运行 node scripts/verify-comic-native.mjs --full-gpu --stress 和 node scripts/verify-enhancement.mjs --stress。使用独立书架与 WebView2 配置，不修改原书；普通 CI 跳过私有书籍和 GPU 场景。

pnpm version:next 按 **0.9.5 → 0.9.6** 同步四处版本；--dry-run 只预览，--set 0.9.5 指定版本。源码导出：node scripts/package-source.mjs，排除程序、模型二进制、依赖、缓存和个人资料。用户小说验收可设置 ANIMEREAD_TEST_NOVELS 为自己的 EPUB 目录。

## 许可

自有源码采用 [MIT](LICENSE)，第三方代码与模型条款见 [许可记录](THIRD_PARTY_NOTICES.md)。参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)，问题报告见 [SECURITY.md](SECURITY.md)。

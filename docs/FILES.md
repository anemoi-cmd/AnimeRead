# 文件用途与精简记录

日常阅读只需根目录 **AnimeRead.exe** 和 **runtime**。下表列出保留文件的作用；源码包只包含源码、构建配置、测试和关键说明。开发依赖、程序和模型二进制不提交 GitHub。

## 根目录与 GitHub

目录分为：src（前端源码）、src-tauri（Windows 后端）、vendor（固定版本的第三方源码）、public（图标与音效）、scripts（构建和验证）、tests（自动化测试）、docs（关键说明和许可）、.github（开源协作与 CI）、runtime（程序运行所需资源）。这九个目录均有实际用途；不放书籍、开发笔记或编译器副本。

| 文件 | 作用 |
| --- | --- |
| AnimeRead.exe | 编译后的 Windows 程序，双击启动；生成产物 |
| AnimeRead-source-*.zip | 可开源源码导出；生成产物，仅保留当前版本 |
| AnimeRead-*-portable.zip、AnimeRead-*-setup.exe | 无私人数据的便携／安装发行包；生成产物 |
| index.html | 前端入口 HTML |
| package.json | 前端依赖、构建／验证命令、版本 |
| pnpm-lock.yaml | 锁定准确依赖版本，保证重装一致 |
| pnpm-workspace.yaml | pnpm 安装与依赖构建策略 |
| tsconfig.json | TypeScript 类型与模块配置 |
| vite.config.ts | 前端／Worker 构建、别名和外部缓存路径 |
| vitest.config.ts | 核心逻辑测试配置 |
| playwright.config.ts | 界面测试、浏览器和项目外报告路径 |
| knip.json | 未使用源码与依赖检查范围 |
| .gitignore | 排除程序、模型、依赖、缓存和私人数据 |
| .gitattributes | 换行与二进制规则；PowerShell 保留 Windows 换行 |
| .prettierignore | 保护自动生成的 PDF 文字层样式，避免格式化改写 |
| README.md | 功能、运行、开发、验证的唯一入口 |
| CHANGELOG.md | 版本变化记录 |
| CONTRIBUTING.md | 提交前检查与第三方补丁规则 |
| SECURITY.md | 漏洞报告方式及书籍隔离边界 |
| LICENSE | 自有源码 MIT 许可 |
| THIRD_PARTY_NOTICES.md | 第三方代码、模型来源与许可记录 |
| .github/workflows/verify.yml | GitHub 自动验证通用界面、类型和 Rust |
| .github/workflows/release.yml | 检查、构建、签名并完整发布新版 |
| docs/RELEASE.md | 签名密钥、发布渠道与更新维护流程 |
| docs/VOICE_TRAINING.md | 下一阶段声音训练教程和按需模型分发设计 |
| .github/ISSUE_TEMPLATE/bug.yml | 问题报告表单 |

## 界面与阅读源码

以下位置均在 **src/**，保留它们才能继续开发和编译。

| 文件 | 作用 |
| --- | --- |
| main.tsx | 挂载 React 界面 |
| App.tsx | 应用状态、快捷键、打开／关闭／导航队列 |
| reader-types.ts | 书籍、样式、位置、来源和阅读引擎类型 |
| file-sources.ts | Tauri 与浏览器验证环境的文件来源适配 |
| reading-storage.ts | 设置、进度、书签和数据迁移／恢复 |
| appearance-settings.ts | 软件配色与背景设置定义 |
| book-groups.ts | 分组成员、卷序、书目合并、同名系列匹配与手工排除 |
| reading-time.ts | 阅读计时与时间显示 |
| book-covers.ts | EPUB／PDF／漫画封面提取与生命周期 |
| cover-wallpaper-store.ts | IndexedDB 封面／壁纸存储、图片缩略图与视频有效性验证 |
| image-enhancement.ts | 选择增强引擎，准备 Waifu2x IPC |
| styles.css | 应用布局、主题、阅读和对比线样式 |
| vendor.d.ts | 第三方 JS 模块的 TypeScript 声明 |
| components/LibraryShelf.tsx | 分页书架、最近阅读封面／时间、轮换分组封面、总阅读时间 |
| components/BookCard.tsx | 单本封面、进度、阅读时间 |
| components/BookMenu.tsx | 书目右键删除与更多工具菜单 |
| components/GroupManager.tsx | 分组与卷序编辑 |
| components/Preferences.tsx | 阅读排版、单双页、增强与雨景设置 |
| components/AppearanceSettings.tsx | 软件主题、首页文字和图片／视频壁纸入口 |
| components/VideoWallpaper.tsx | 书架视频播放，失焦暂停、阅读卸载 |
| components/FilterStack.tsx | A／B／C 预设、添加、排序、删除 |
| components/ReaderProgress.tsx | 可拖动进度条与位置显示 |
| components/Help.tsx | 从 USER_GUIDE.md 显示帮助，避免重复文案 |
| components/SoftwareUpdate.tsx | 软件内检查、下载进度与升级入口 |
| components/Rain.tsx | 雨景画布与动画生命周期 |
| ambience/rain-field.ts | 有界雨丝、水滴、滑落与尾迹 |
| ambience/reading-sounds.ts | 雨声与翻书录音共用解码缓存和 AudioContext，雨声交叉淡入淡出 |
| gpu/anime4k-client.ts | 管理增强 Worker、任务与取消 |
| gpu/anime4k.worker.ts | GPU 设备／管线复用、分块推理、编码 |
| gpu/screentone-protection.ts | 识别并保留密集网点，减少 CNN 叠加产生的斑纹 |
| reader/create-reader.ts | 按真实格式选择阅读引擎 |
| reader/book-archive.ts | ZIP 随机读取、解压和路径边界 |
| reader/epub-inspection.ts | 漫画识别、书脊顺序和封面读取 |
| reader/text-chapters.ts | TXT 编码、章节与安全 HTML |
| reader/novel-reader.ts | TXT／文字 EPUB 的单双栏与 CFI 定位 |
| reader/comic-pdf-reader.ts | 漫画／PDF 固定页面框、等比适配、单双页槽、缩放与增强预缓存 |
| reader/image-page-cache.ts | 原图／增强压缩缓存、加载与取消 |
| reader/image-page-view.ts | 固定原图尺寸和可拖动画质对比 |
| reader/comic-scroll-reader.ts | 最多五页的漫画上下阅读、拖动与页顶对齐 |
| reader/spread-layout.ts | 双页分组、封面与翻页步长 |
| reader/page-transitions.ts | 共用翻页事务、包含留白的页面快照、准备遮罩、书脊卷页、滑动过渡 |
| reader/paper-theme.ts | 一次生成的木纹、纸张显示合成与动画一致性 |
| reader/reading-input.ts | 共用鼠标状态、文字选择、页边拖动、上下滚动与快捷键转发 |
| reader/pdf-text.css | 从 PDF.js 生成的文字层样式；保留版权头 |
| sources/http-range.ts | 经验证的远程随机读取基础，供后续网盘接入 |

## Windows 后端与资源

| 文件 | 作用 |
| --- | --- |
| src-tauri/Cargo.toml | Rust 依赖、版本与 release 优化 |
| src-tauri/Cargo.lock | Rust 依赖精确版本 |
| src-tauri/build.rs | Tauri 构建入口 |
| src-tauri/tauri.conf.json | 窗口、应用标识、版本、CSP 与安装包 |
| src-tauri/capabilities/main.json | 主窗口的最小桌面权限 |
| src-tauri/src/main.rs | 本地读取、导入、系统字体和 Tauri IPC |
| src-tauri/src/book_library.rs | 内容指纹、漫画分类、书架合并与持久化 |
| src-tauri/src/gpu_enhancement.rs | Vulkan 硬件显卡检测、Waifu2x 队列、取消与进程超时 |
| src-tauri/src/app_updates.rs | 官方更新检查、签名验证与便携解包白名单 |
| src-tauri/windows/portable-update.ps1 | 退出后替换便携程序，失败回滚，保留数据 |
| src-tauri/windows/hooks.nsh | Windows 10 安装边界、去除发布者字段与本应用注册表清理 |
| src-tauri/icons/icon.ico、icon.png | Windows 程序与安装包图标 |
| public/icon.svg | 前端图标原始资源 |
| public/audio/rain.ogg、page-turn.wav | 有明确再发行许可的雨声与翻书录音，嵌入程序 |
| runtime/waifu2x/waifu2x-ncnn-vulkan.exe | 实际运行增强的程序，约 5 MB；不是 C++ 编译器 |
| runtime/waifu2x/vcomp140.dll | 增强程序所需 OpenMP 运行库 |
| runtime/waifu2x/models-cunet/scale2.0x_model.bin、.param | A 的权重与网络定义 |
| runtime/waifu2x/models-cunet/noise2_model.bin、.param | C 的权重与网络定义 |
| runtime/waifu2x/LICENSE、README.md | 官方增强程序许可与参数说明 |
| runtime/licenses/*、THIRD_PARTY_NOTICES.md、使用说明.txt | 程序随附的许可和使用说明，打包时生成 |

**src/gpu 是源码，runtime/waifu2x 是运行模型，系统 Build Tools／Rust 是编译工具。** 三者职责不同。

## 第三方源码

vendor 保存经过必要修补、固定版本的源码。直接删除会使小说分页或仿真翻页无法编译。

| 文件 | 作用 |
| --- | --- |
| vendor/foliate-js/view.js | 小说阅读视图、链接、CFI 和目录 |
| vendor/foliate-js/paginator.js | 小说分页与双栏排版 |
| vendor/foliate-js/fixed-layout.js | 混合／固定布局 EPUB |
| vendor/foliate-js/epub.js | EPUB 元数据与正文解析 |
| vendor/foliate-js/epubcfi.js | EPUB 标准位置编码和范围 |
| vendor/foliate-js/progress.js | 章节／目录进度计算 |
| vendor/page-flip/page-flip.module.js | 带释放修补的真实卷页动画 |
| vendor/*/UPSTREAM.json | 上游版本、提交与本地补丁，便于更新 |
| vendor/*/LICENSE | 第三方版权和许可证，必须保留 |

## 构建与验证脚本

以下文件在 **scripts/**。

| 文件 | 作用 |
| --- | --- |
| reader.ps1 | 开发、构建、运行、检测与缓存清理入口 |
| detect-toolchain.ps1 | 定位已安装的 MSVC／Rust，验证位于项目之外 |
| tool-paths.mjs、tool-paths.d.mts | 集中定义外部缓存／运行资源路径及类型 |
| cargo.mjs | 使用项目外 Rust 缓存，并让独立检查与测试读取同一份前端产物 |
| tauri.mjs | 使用项目外前端产物构建桌面程序 |
| copy-pdf-assets.mjs | 同步图标／音效及 PDF 字体、CMap、WASM，生成文字层 CSS |
| enhancement-runtime.mjs | GPU 扩展的最小必要文件清单 |
| setup-enhancement.mjs | 校验官方归档，只安装实际使用的模型 |
| package-portable.mjs | 同步根目录程序与 runtime；生成无数据的便携 ZIP 和安装 EXE |
| package-update.mjs | 签名两种包，生成 Releases 的 latest.json |
| package-source.mjs | 白名单导出源码，检查个人路径和链接 |
| bump-version.mjs | 一致更新语义版本，默认增加补丁号，支持指定版本和预览 |
| collect-licenses.mjs | 收集锁定依赖的版本和许可 |
| vendor-pageflip.mjs | 可重现地生成第三方卷页补丁 |
| verify-comic-native.mjs | Windows／真实漫画／两引擎与压力验收 |
| verify-enhancement.mjs | 原图尺寸、增强耗时、帧间隔、对比、预缓存与大图边界测量 |

## 测试与说明

| 文件 | 作用 |
| --- | --- |
| tests/core/text.spec.ts | 编码、章节与文本边界 |
| tests/core/reading.spec.ts | 键盘动作与双页边界 |
| tests/core/storage.spec.ts | 设置迁移与异常恢复 |
| tests/core/groups.spec.ts | 分组、卷序与合并 |
| tests/core/range.spec.ts | HTTP 区间和版本边界 |
| tests/e2e/comic.spec.ts | 漫画分类、动画、声音、上下阅读与缩放 |
| tests/e2e/regression.spec.ts | TXT／EPUB／PDF、单双页、全屏设置与隔离 |
| tests/e2e/reading-upgrade.spec.ts | 封面、主题、计时、漫画双页 |
| tests/e2e/groups.spec.ts | 分组操作与重启恢复 |
| tests/e2e/novel-update.spec.ts | 用户小说、初次全屏、共用鼠标拖动、首页、自动分组与视频壁纸 |
| tests/e2e/stress.spec.ts | 损坏恢复、快速输入、定位与千卷书架 |
| tests/curl-motion.mjs | 检查卷页的实际逐帧运动和纸张宽度 |
| tests/portable-update.ps1 | Windows 更新助手的普通／扩展路径、回滚和数据保护 |
| docs/USER_GUIDE.md | 快捷键、功能、引擎和滤镜说明；应用直接读取 |
| docs/ARCHITECTURE.md | 模块职责、数据生命周期和资源上限 |
| docs/BUILD.md | 安装编译工具、缓存、导出与版本流程 |
| docs/FILES.md | 本文件：逐项用途与删除依据 |
| docs/licenses/*LICENSE*、*-MIT.txt | 每个相应依赖／第三方组件的原始许可正文 |
| docs/licenses/frontend-components.json、rust-components.json | 锁定前端／Rust 依赖的版本及许可清单 |

## 命名与精简原则

自有阅读模块按职责命名：novel-reader 是小说排版，comic-pdf-reader 是漫画／PDF，reading-input 是共用输入，page-transitions 是共用翻页。main.tsx、App.tsx、Cargo.toml、index.html、锁文件等按工具约定保留标准名称；上游模型、第三方源码、许可证保留原名以便核对来源。

本版删除旧文字串快照及字体基线校准，使用原排版 DOM 快照；删除 CPU 模型自检和 GPU 失败后的 CPU 重试；上下拖动与卷页共用跨章指针代理。每个保留模块有实际调用，没有模拟成功的占位接口。翻页、缓存与显示层各有资源生命周期，避免为减少文件数把它们重新混成一个大文件。

完成验证后删除旧发行包／源码备份、node_modules、src-tauri/gen、外部 build-cache；保留当前源码、程序、运行模型和许可。依赖和构建缓存可重新生成。私人阅读记录、原书和当前验收资料在项目外；不进入源码包。

# 第三方组件与发行边界

AnimeRead 自有源码采用根目录 LICENSE 中的 MIT 许可证。第三方组件保留各自的许可证，根目录许可证不覆盖它们的原始权利声明。源码整理包不包含书籍、编译工具或独立 GPU 模型二进制。

| 组件 | 当前用途 | 许可证及记录 |
|---|---|---|
| Tauri 2 / Rust 依赖 | Windows 容器、文件、字体、任务 | MIT/Apache 等，完整版本清单见 docs/licenses/rust-components.json |
| React / React DOM | 自有阅读界面 | MIT |
| foliate-js | 文字 EPUB/TXT 排版与 CFI | MIT；固定提交和补丁见 vendor/foliate-js/UPSTREAM.json |
| PDF.js | PDF 画布与文字层 | Apache 2.0；LICENSE 随附，使用自身字体、WASM、CMap；仅保留需要的文字层 CSS |
| zip.js | ZIP/EPUB/CBZ 随机读取 | BSD 3-Clause |
| Lucide | 图标 | ISC |
| StPageFlip 2.0.7 | 前后卷页动画 | MIT；停止 RAF、移除监听和 canvas 拷贝补丁见 vendor/page-flip/UPSTREAM.json |
| Anime4K-WebGPU 1.0.0 | CNNSoftM/CNNx2M 与双边降噪 | MIT；包内含 WGSL 模型权重，许可证随附 |
| waifu2x-ncnn-vulkan 20250915 | Vulkan 显卡或 CPU 超分与降噪 | 上游代码 MIT；官方归档来源和固定哈希见 [下载脚本](scripts/setup-enhancement.mjs) |
| Rainy — Ove Melaa | 雨声录音 public/audio/rain.ogg | [原始录音](https://opengameart.org/content/rain-ambient-not-loopable-2-versions-available)，[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)，文件未修改，播放时截取并交叉淡入淡出 |
| Page Turning Sfx — Nicole Marie T | 翻纸录音 public/audio/page-turn.wav | Sound Effect By Nicole Marie T；[原始录音](https://opengameart.org/content/page-turning-sfx-sound-effect)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，文件未修改，播放时调低音量 |

前端直接及传递依赖清单和许可证正文在 docs/licenses/，Rust 清单记录锁定版本与许可证。PDF.js 的 Node 可选 canvas 依赖也在依赖清单中；桌面阅读使用浏览器画布。系统字体只枚举名称，不分发 Windows 字体文件。

Magpie 仅用于参考滤镜依次执行的设计和其 Anime4K 指向的上游技术资料，没有复制 Magpie GPL 应用代码。Anime4K 上游资料：https://github.com/bloc97/Anime4K ，WebGPU 实现：https://github.com/Anime4KWebBoost/Anime4K-WebGPU 。阅读器 C 预设保持尺寸，与视频上游 Mode C 的完整超分管线不同。

Waifu2x 保留官方 MIT 文本和模型来源，其内置 ncnn 遵循 [BSD 3-Clause](https://github.com/Tencent/ncnn/blob/master/LICENSE.txt)。随附 vcomp140.dll 是 Microsoft OpenMP 运行库，列于 [Visual Studio 可再发行文件清单](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution)，遵循 Microsoft Visual C++ 条款；不受本项目 MIT 许可覆盖。WebView2Loader／WebView2 Runtime／安装引导程序遵循 [Microsoft WebView2 分发条款](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)，安装版在缺少系统 Runtime 时联网下载官方引导程序及运行时。

雨景研究参考 [rainyday.js](https://github.com/mubaidr/rainyday.js) 的窗面水滴和 [RainEffect](https://github.com/codrops/RainEffect) 的水滴精灵设计；应用使用独立 Canvas 实现，没有分发这两个项目的源代码、着色器或素材，也没有新增运行依赖。

源码与二进制分开打包，许可和归属随程序分发。Windows 二进制暂未进行证书签名，SmartScreen 可能显示未知发布者；源码及依赖版本可用于自行复现构建。硬件和系统验收范围见 README 和使用说明。

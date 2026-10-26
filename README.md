<p align="center">
  <img src="public/icon.svg" width="112" alt="AnimeRead 图标">
</p>

<h1 align="center">AnimeRead</h1>

<p align="center">一款安静、好看的 Windows 小说与漫画阅读器。<br>让故事，慢慢发生。</p>

<p align="center">
  <a href="https://github.com/anemoi-cmd/AnimeRead/releases/latest"><b>⬇ 下载最新版</b></a>
  ·
  <a href="docs/USER_GUIDE.md">使用说明</a>
  ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

---

## 下载与安装

前往 [最新版本页面](https://github.com/anemoi-cmd/AnimeRead/releases/latest)，二选一：

| 文件 | 适合谁 |
| --- | --- |
| **AnimeRead-版本号-setup.exe** | 想像普通软件一样安装、在开始菜单里打开。卸载时默认保留阅读记录。 |
| **AnimeRead-版本号-portable.zip** | 想放在 U 盘或任意文件夹里用。解压后双击 AnimeRead.exe，记录保存在旁边的 data 文件夹。 |

需要 Windows 10 或 11（64 位）。安装版会自动准备所需的系统组件（Microsoft WebView2）；如果便携版打不开，请先安装 [WebView2 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)。

以后有新版本时，在软件左下角 **设置 → 软件更新** 里一键升级，书籍、书签和阅读进度都会保留。

## 能做什么

**📚 一个书架装下小说和漫画**
TXT、EPUB、PDF、CBZ／ZIP 压缩包和图片都能直接拖进来读。自动识别小说或漫画、读取封面，记住每本书读到哪里、读了多久。

**📖 舒服的阅读体验**
单页或双页、左右翻或从上往下滚动；仿真翻书动画和翻书声；纸张、墨水、木纹等多种底色；小说可以自由调整字体、字号和行距。

**✨ 让旧漫画变清晰**
借助显卡的超分辨率处理，让低清扫描的线条和文字更锐利，翻页时在后台自动完成。拖动对比线就能看到前后差别。

**🗂 多卷整理成套**
自动发现同一系列的多卷书，一键归成一组；以后导入的新卷会自动加入。

**🎨 按你的喜好装扮**
主题色、首页欢迎语、图片或视频壁纸、可调节的液态玻璃质感，还有雨景和雨声陪你读书。

## 隐私

AnimeRead 完全在本机运行，不需要账号。阅读记录只保存在你的电脑上，书籍文件留在原来的位置，软件不会上传或修改它们。联网只用于检查软件更新。

## 常见问题

**支持哪些格式？** TXT、EPUB、PDF、CBZ、ZIP，以及 PNG／JPG／WebP 等图片。暂不支持 RAR／7z 和带 DRM 或密码的文件。

**超分需要什么电脑？** 需要一块显卡（独立显卡或较新的核显都可以）。没有可用显卡时这个功能会自动关闭，其他功能照常使用。

**遇到问题怎么办？** 欢迎在 [Issues](https://github.com/anemoi-cmd/AnimeRead/issues) 里告诉我们，附上系统版本和出问题的步骤会很有帮助。

---

<details>
<summary>开发者信息</summary>

AnimeRead 基于 Tauri 2、Rust、React 和 TypeScript。编译方法见 [构建说明](docs/BUILD.md)，代码结构见 [架构](docs/ARCHITECTURE.md) 与 [文件说明](docs/FILES.md)，发布流程见 [发布说明](docs/RELEASE.md)，参与方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

</details>

## 许可

源码采用 [MIT](LICENSE) 许可，第三方组件与素材的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const packageDirectory = dirname(require.resolve("page-flip/package.json"));
const source = resolve(packageDirectory, "dist/js/page-flip.module.js");
const directory = resolve("vendor/page-flip");
await mkdir(directory, { recursive: true });
let code = await readFile(source, "utf8");
const upstreamHash = createHash("sha256").update(code).digest("hex");
const replace = (before, after) => {
  if (!code.includes(before))
    throw new Error(`Pinned upstream patch no longer matches: ${before}`);
  code = code.replace(before, after);
};
replace(
  "start(){this.update();const t=e=>{this.render(e),requestAnimationFrame(t)};requestAnimationFrame(t)}",
  "stop(){this._stopped=true;cancelAnimationFrame(this._raf);this.animation=null}start(){this.update();this._stopped=false;const t=e=>{if(this._stopped)return;this.render(e);this._raf=requestAnimationFrame(t)};this._raf=requestAnimationFrame(t)}",
);
replace(
  "destroy(){this.app.getSettings().useMouseEvents&&this.removeHandlers(),this.distElement.remove(),this.wrapper.remove()}",
  "destroy(){this.removeHandlers(),this.distElement.remove(),this.wrapper.remove()}",
);
replace(
  "destroy(){this.ui.destroy(),this.block.remove()}",
  "destroy(){this.render.stop(),this.ui.destroy(),this.block.remove()}",
);
// Windows 缩放下页面尺寸常有小数。offsetWidth/Height 和 parseInt 会
// 分别舍入舞台、截断纸张。这里仅保留静态／动画的数值精度；不同
// 图片比例的稳定布局由阅读器的固定页面框负责，不再靠数值补偿。
replace(
  "getBlockWidth(){return this.app.getUI().getDistElement().offsetWidth}",
  "getBlockWidth(){return this.app.getUI().getDistElement().getBoundingClientRect().width}",
);
replace(
  "getBlockHeight(){return this.app.getUI().getDistElement().offsetHeight}",
  "getBlockHeight(){return this.app.getUI().getDistElement().getBoundingClientRect().height}",
);
replace(
  "this.pageWidth=parseInt(i,10),this.pageHeight=parseInt(s,10)",
  "this.pageWidth=Number(i),this.pageHeight=Number(s)",
);
replace(
  "this.copiedElement=this.element.cloneNode(!0),this.element.parentElement.appendChild(this.copiedElement)",
  // cloneNode 不复制 canvas 像素或 Shadow DOM。单页仿真使用临时副本
  // 作为翻动纸张；必须保留漫画像素和小说隔离样式／正文，避免空白页。
  // 显式复制兼容较早的 WebView2，不依赖较新的 clonable ShadowRoot。
  'this.copiedElement=this.element.cloneNode(!0),Array.from(this.element.querySelectorAll("canvas")).forEach((c,i)=>this.copiedElement.querySelectorAll("canvas")[i].getContext("2d").drawImage(c,0,0)),Array.from(this.element.querySelectorAll("*")).forEach((s,i)=>{if(!s.shadowRoot)return;const d=this.copiedElement.querySelectorAll("*")[i];if(d.shadowRoot)return;const r=d.attachShadow({mode:"open"});Array.from(s.shadowRoot.childNodes).forEach(n=>r.appendChild(n.cloneNode(true)))}),this.element.parentElement.appendChild(this.copiedElement)',
);
await writeFile(resolve(directory, "page-flip.module.js"), code);
await copyFile(
  resolve(packageDirectory, "LICENSE"),
  resolve(directory, "LICENSE"),
);
await writeFile(
  resolve(directory, "UPSTREAM.json"),
  JSON.stringify(
    {
      package: "page-flip",
      version: "2.0.7",
      repository: "https://github.com/Nodlik/StPageFlip",
      upstreamSha256: upstreamHash,
      modifiedSha256: createHash("sha256").update(code).digest("hex"),
      patches: [
        "Stop requestAnimationFrame loop on destroy",
        "Always remove resize listeners even with mouse events disabled",
        "Copy canvas bitmap when creating the temporary back of a page",
        "Copy open Shadow DOM styles and text into temporary pages",
        "Preserve fractional CSS dimensions in renderer and fold geometry",
      ],
    },
    null,
    2,
  ),
);
console.log("Page flip patches applied");

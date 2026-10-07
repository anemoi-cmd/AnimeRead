import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cacheDirectory } from "./tool-paths.mjs";
const root = resolve(import.meta.dirname, "..");
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = resolve(cacheDirectory, "frontend/public/pdfjs", name);
  await mkdir(destination, { recursive: true });
  await cp(resolve(root, "node_modules", "pdfjs-dist", name), destination, {
    recursive: true,
  });
}
console.log("PDF CMaps, standard fonts, WASM copied");
// All authored assets follow the same path as the generated PDF resources.
await cp(resolve(root, "public"), resolve(cacheDirectory, "frontend/public"), {
  recursive: true,
});

const viewerCss = await readFile(
  resolve("node_modules/pdfjs-dist/web/pdf_viewer.css"),
  "utf8",
);
const textStart = viewerCss.indexOf(".textLayer{");
const textEnd = viewerCss.indexOf(".annotationLayer{", textStart);
if (textStart < 0 || textEnd < 0)
  throw new Error(
    "PDF.js CSS boundaries changed; review the text-layer subset",
  );
await writeFile(
  resolve("src/reader/pdf-text.css"),
  viewerCss.slice(0, viewerCss.indexOf("*/") + 2) +
    "\n\n" +
    viewerCss.slice(textStart, textEnd).trimEnd() +
    "\n",
);

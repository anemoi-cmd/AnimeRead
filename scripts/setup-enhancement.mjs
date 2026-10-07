import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import { GPU_RUNTIME_FILES } from "./enhancement-runtime.mjs";
import {
  toolsDirectory,
  runtimeDirectory,
  verificationDirectory,
} from "./tool-paths.mjs";
const tools = toolsDirectory;
await mkdir(tools, { recursive: true });
// Pin the verified upstream release instead of depending on GitHub API quotas.
const tag = "20250915";
const expectedHash =
  "7425be94b94e4c8f37a1e433ac0e0100c43790e2c37418f4b65d8235adfbdc87";
const asset = {
  name: `waifu2x-ncnn-vulkan-${tag}-windows.zip`,
  browser_download_url: `https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/${tag}/waifu2x-ncnn-vulkan-${tag}-windows.zip`,
};
const archive = resolve(tools, asset.name);
let bytes;
try {
  if ((await stat(archive)).size > 0) bytes = await readFile(archive);
} catch {}
if (!bytes) {
  const response = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Archive ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(archive, bytes);
}
const directory = process.env.ANIMEREAD_TOOLS_DIR
  ? resolve(tools, "waifu2x")
  : resolve(runtimeDirectory, "waifu2x");
if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
  throw new Error("Official archive SHA-256 mismatch");
await mkdir(directory, { recursive: true });
const reader = new ZipReader(new Uint8ArrayReader(bytes));
try {
  const entries = await reader.getEntries();
  for (const name of GPU_RUNTIME_FILES) {
    const matches = entries.filter(
      (entry) =>
        !entry.directory &&
        entry.filename.split("/").slice(1).join("/") === name,
    );
    if (matches.length !== 1) throw new Error(`Missing runtime file: ${name}`);
    const destination = resolve(directory, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      await matches[0].getData(new Uint8ArrayWriter()),
    );
  }
} finally {
  await reader.close();
}
const record = {
  repository: `https://github.com/nihui/waifu2x-ncnn-vulkan/releases/tag/${tag}`,
  tag,
  publishedAt: "2025-09-15T11:32:12Z",
  asset: asset.name,
  url: asset.browser_download_url,
  bytes: bytes.length,
  sha256: expectedHash,
  verifiedAgainstUpstream: true,
  directory,
  installedFiles: GPU_RUNTIME_FILES,
};
await mkdir(verificationDirectory, { recursive: true });
await writeFile(
  resolve(verificationDirectory, "enhancement-runtime.json"),
  JSON.stringify(record, null, 2),
);
console.log(JSON.stringify(record, null, 2));

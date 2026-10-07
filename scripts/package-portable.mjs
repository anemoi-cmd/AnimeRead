import {
  cp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  stat,
  rm,
  readdir,
} from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } from "@zip.js/zip.js";
import { GPU_RUNTIME_FILES } from "./enhancement-runtime.mjs";
import {
  toolsDirectory,
  buildDirectory,
  runtimeDirectory,
  verificationDirectory,
  workspaceDirectory,
} from "./tool-paths.mjs";
const directory = workspaceDirectory;
await mkdir(runtimeDirectory, { recursive: true });
await mkdir(verificationDirectory, { recursive: true });
const runtimeOnly = process.argv.includes("--runtime-only");
if (!runtimeOnly) {
  await copyFile(
    resolve(buildDirectory, "release/animeread.exe"),
    resolve(directory, "AnimeRead.exe"),
  );
  const loader = resolve(buildDirectory, "release/WebView2Loader.dll");
  try {
    await copyFile(loader, resolve(directory, "WebView2Loader.dll"));
  } catch (error) {
    // MSVC can link the loader statically; GNU builds require the sibling DLL.
    if (
      error.code !== "ENOENT" ||
      process.env.ANIMEREAD_BUILD_TARGET?.endsWith("gnu")
    )
      throw error;
    await rm(resolve(directory, "WebView2Loader.dll"), { force: true });
  }
}
const downloadedGpu = resolve(toolsDirectory, "waifu2x");
const packagedGpu = resolve(runtimeDirectory, "waifu2x");
if (
  await stat(resolve(downloadedGpu, "waifu2x-ncnn-vulkan.exe")).catch(
    () => null,
  )
)
  for (const name of GPU_RUNTIME_FILES) {
    const destination = resolve(packagedGpu, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(downloadedGpu, name), destination);
  }
const hasGpu = !!(await stat(
  resolve(packagedGpu, "waifu2x-ncnn-vulkan.exe"),
).catch(() => null));
await cp(resolve("docs/licenses"), resolve(runtimeDirectory, "licenses"), {
  recursive: true,
});
await copyFile(
  resolve("THIRD_PARTY_NOTICES.md"),
  resolve(runtimeDirectory, "THIRD_PARTY_NOTICES.md"),
);
await writeFile(
  resolve(runtimeDirectory, "使用说明.txt"),
  (await readFile(resolve("docs/USER_GUIDE.md"), "utf8")).replaceAll(
    "\n",
    "\r\n",
  ),
);
if (runtimeOnly) {
  console.log("Runtime resources and licences updated");
  process.exit(0);
}
const executable = await readFile(resolve(directory, "AnimeRead.exe"));
await writeFile(
  resolve(verificationDirectory, "portable-package.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      executable: "AnimeRead.exe",
      bytes: executable.length,
      sha256: createHash("sha256").update(executable).digest("hex"),
      gpuRuntime: hasGpu ? "waifu2x-ncnn-vulkan-20250915" : null,
      anime4kRuntime:
        "anime4k-webgpu-1.0.0; CNNx2M/CNNSoftM/BilateralMean; texture guard",
      kind: "Personal build; existing user profile retained",
      target: `${process.env.ANIMEREAD_BUILD_TARGET || "Windows x64"}; WebView2 runtime required`,
      licenseAudit:
        "Third-party inventory, model provenance and recording attribution included in runtime",
    },
    null,
    2,
  ),
);
if (process.argv.includes("--release")) {
  const pkg = JSON.parse(
    await readFile(resolve(directory, "package.json"), "utf8"),
  );
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const files = ["AnimeRead.exe"];
  if (await stat(resolve(directory, "WebView2Loader.dll")).catch(() => null))
    files.push("WebView2Loader.dll");
  async function runtimeFiles(folder) {
    for (const entry of await readdir(resolve(directory, folder), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        throw new Error("Runtime package cannot contain links");
      const name = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await runtimeFiles(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  await runtimeFiles("runtime");
  for (const name of files.sort())
    await writer.add(
      `AnimeRead/${name}`,
      new Uint8ArrayReader(await readFile(resolve(directory, name))),
    );
  await writer.add(
    "AnimeRead/portable.flag",
    new Uint8ArrayReader(new Uint8Array()),
  );
  const portable = resolve(directory, `AnimeRead-${pkg.version}-portable.zip`);
  await writeFile(portable, await writer.close());
  const installers = resolve(buildDirectory, "release/bundle/nsis");
  const names = (await readdir(installers)).filter(
    (name) => name.includes(pkg.version) && name.endsWith(".exe"),
  );
  if (names.length !== 1)
    throw new Error("Expected one version-matched NSIS installer");
  const installer = resolve(directory, `AnimeRead-${pkg.version}-setup.exe`);
  await copyFile(resolve(installers, names[0]), installer);
  const records = [];
  for (const path of [portable, installer]) {
    const bytes = await readFile(path);
    records.push({
      file: relative(directory, path),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await writeFile(
    resolve(verificationDirectory, "release-packages.json"),
    JSON.stringify(
      {
        version: pkg.version,
        portableProfile: "data beside executable; initially empty",
        installerProfile: "current user; preserve on uninstall by default",
        files: records,
      },
      null,
      2,
    ),
  );
  console.log("Clean portable and current-user installer:", records);
}
console.log(
  "Portable development package:",
  directory,
  (await stat(resolve(directory, "AnimeRead.exe"))).size,
  "bytes",
);

/** Binary media live in IndexedDB, never in synchronous settings JSON. */
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("animeread-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction("images", mode);
    const request = action(transaction.objectStore("images"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export const readMedia = (key: string) =>
  transaction<Blob | undefined>("readonly", (store) => store.get(key));
export const writeMedia = (key: string, blob: Blob) =>
  transaction("readwrite", (store) => store.put(blob, key));
export const deleteMedia = (key: string) =>
  transaction("readwrite", (store) => store.delete(key));
export const coverKey = (id: string, revision: string) =>
  `cover:${id}:${revision}`;

export async function validateVideo(blob: Blob) {
  const url = URL.createObjectURL(blob),
    video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("视频读取超时，请选择 MP4 或 WebM")),
        10000,
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法播放这个视频，请选择 H.264 MP4 或 WebM"));
      };
      video.src = url;
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function thumbnail(
  blob: Blob,
  maxWidth: number,
  maxHeight: number,
) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(
      1,
      maxWidth / bitmap.width,
      maxHeight / bitmap.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理背景图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("图片编码失败"))),
        "image/jpeg",
        0.86,
      ),
    );
  } finally {
    bitmap.close();
  }
}

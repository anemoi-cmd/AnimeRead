import type { FilterMode } from "../reader-types";
type Output = { blob: Blob; scale: number; device: string };
let worker: Worker | undefined;
let sequence = 0;
const jobs = new Map<
  number,
  {
    resolve: (output: Output) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  }
>();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./anime4k.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const job = jobs.get(data.id);
    if (!job) return;
    jobs.delete(data.id);
    job.cleanup();
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.output);
  };
  worker.onerror = (event) =>
    releaseAnime4k(new Error(event.message || "Anime4K 后台处理失败"));
  return worker;
}
export async function anime4kImage(
  image: HTMLImageElement,
  filters: FilterMode[],
  signal?: AbortSignal,
): Promise<Output> {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(image);
  if (signal?.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  let target: Worker;
  try {
    target = getWorker();
  } catch (error) {
    bitmap.close();
    throw error;
  }
  const id = ++sequence;
  return new Promise<Output>((resolve, reject) => {
    const abort = () => {
      target.postMessage({ type: "cancel", id });
      jobs.delete(id);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("增强已取消", "AbortError"));
    };
    jobs.set(id, {
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener("abort", abort),
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      target.postMessage({ type: "image", id, bitmap, filters }, [bitmap]);
    } catch (error) {
      jobs.delete(id);
      signal?.removeEventListener("abort", abort);
      bitmap.close();
      reject(error);
    }
  });
}
export function releaseAnime4k(
  error: Error = new DOMException("增强已取消", "AbortError"),
) {
  worker?.terminate();
  worker = undefined;
  for (const job of jobs.values()) {
    job.cleanup();
    job.reject(error);
  }
  jobs.clear();
}

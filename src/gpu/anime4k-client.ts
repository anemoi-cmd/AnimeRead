import type { FilterMode } from "../reader-types";
import type { EnhanceTarget } from "./output-size";
type Output = { bitmap: ImageBitmap; scale: number; device: string };
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
    if (!job) {
      // 已取消的任务仍可能送回位图；立即释放显存。
      (data.output?.bitmap as ImageBitmap | undefined)?.close();
      return;
    }
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
  source: Blob,
  filters: FilterMode[],
  target: EnhanceTarget | undefined,
  signal?: AbortSignal,
): Promise<Output> {
  signal?.throwIfAborted();
  // 直接从压缩数据解码，避免在主线程再画一遍已解码的图片。
  const bitmap = await createImageBitmap(source);
  if (signal?.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  let thread: Worker;
  try {
    thread = getWorker();
  } catch (error) {
    bitmap.close();
    throw error;
  }
  const id = ++sequence;
  return new Promise<Output>((resolve, reject) => {
    const abort = () => {
      thread.postMessage({ type: "cancel", id });
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
      thread.postMessage({ type: "image", id, bitmap, filters, target }, [
        bitmap,
      ]);
    } catch (error) {
      jobs.delete(id);
      signal?.removeEventListener("abort", abort);
      bitmap.close();
      reject(error);
    }
  });
}
/** 后台预先编译模型；失败时静默，真正处理页面时再报告。 */
export function warmAnime4k(filters: FilterMode[]) {
  try {
    getWorker().postMessage({ type: "warm", filters });
  } catch {
    // Worker 无法创建时，处理页面会走正常的错误提示。
  }
}
function releaseAnime4k(
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

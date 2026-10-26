import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, RefreshCw } from "lucide-react";
import { native } from "../file-sources";
import { version } from "../../package.json";

interface UpdateInfo {
  currentVersion: string;
  mode: "installed" | "portable";
  version?: string;
  notes?: string;
}
/** 设置中心的“软件更新”页。安装期间通知外层锁定关闭按钮。 */
export function UpdatePanel({
  prepare,
  lock,
}: {
  prepare: () => Promise<void>;
  lock: (installing: boolean) => void;
}) {
  const [info, setInfo] = useState<UpdateInfo>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const subscription = native
      ? listen<{ downloaded: number; total?: number }>(
          "update-download",
          ({ payload }) => {
            if (mounted.current)
              setProgress(
                payload.total
                  ? Math.min(
                      100,
                      Math.round((payload.downloaded / payload.total) * 100),
                    )
                  : undefined,
              );
          },
        )
      : undefined;
    return () => {
      mounted.current = false;
      void subscription?.then((unlisten) => unlisten());
    };
  }, []);
  const check = async () => {
    setBusy(true);
    setMessage("");
    setInfo(undefined);
    try {
      const result = await invoke<UpdateInfo>("check_app_update");
      if (mounted.current) {
        setInfo(result);
        setMessage(result.version ? "发现新版本" : "已经是最新版本");
      }
    } catch (error) {
      if (mounted.current) setMessage(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const install = async () => {
    if (!info?.version) return;
    setBusy(true);
    lock(true);
    setMessage("正在下载更新，完成后会自动重启…");
    setProgress(undefined);
    try {
      await prepare();
      await invoke("install_app_update", { expectedVersion: info.version });
    } catch (error) {
      if (mounted.current) {
        setMessage(String(error));
        setBusy(false);
        lock(false);
      }
    }
  };
  return (
    <div className="update-panel">
      <div className="version-card">
        <span>当前版本</span>
        <strong>AnimeRead {version}</strong>
      </div>
      {!native ? (
        <p>请在 Windows 阅读器内检查更新。</p>
      ) : (
        <>
          {info?.version && (
            <div className="version-card is-new">
              <span>新版本</span>
              <strong>{info.version}</strong>
            </div>
          )}
          {info?.notes && <p className="update-notes">{info.notes}</p>}
          {message && <p role="status">{message}</p>}
          {busy && progress !== undefined && (
            <progress aria-label="更新下载进度" value={progress} max={100} />
          )}
          <div className="update-actions">
            <button
              className="outline-button"
              disabled={busy}
              onClick={() => void check()}
            >
              <RefreshCw size={16} />
              检查更新
            </button>
            {info?.version && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void install()}
              >
                <Download size={16} /> 下载并重启更新
              </button>
            )}
          </div>
        </>
      )}
      <p className="setting-note">
        更新只替换程序本身，书籍、书签、阅读进度和设置都会保留。
      </p>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X, Download } from "lucide-react";
import { native } from "../file-sources";
import { version } from "../../package.json";

interface UpdateInfo {
  currentVersion: string;
  mode: "installed" | "portable";
  version?: string;
  notes?: string;
}
export function SoftwareUpdate({
  close,
  prepare,
}: {
  close: () => void;
  prepare: () => Promise<void>;
}) {
  const [info, setInfo] = useState<UpdateInfo>();
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
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
        setMessage(result.version ? "发现新版本" : "已是最新版本");
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
    setInstalling(true);
    setMessage("正在下载并验证更新…");
    setProgress(undefined);
    try {
      await prepare();
      await invoke("install_app_update", { expectedVersion: info.version });
    } catch (error) {
      if (mounted.current) {
        setMessage(String(error));
        setBusy(false);
        setInstalling(false);
      }
    }
  };
  return (
    <div className="modal-backdrop" data-no-page>
      <section
        className="help-modal"
        role="dialog"
        aria-label="软件更新"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !installing) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="panel-heading">
          <h2>软件更新</h2>
          <button
            className="icon-button"
            aria-label="关闭软件更新"
            autoFocus
            disabled={installing}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <p>AnimeRead {version}</p>
        {!native ? (
          <p>请在 Windows 阅读器内检查更新。</p>
        ) : (
          <>
            {info?.version && <p>新版本 {info.version}</p>}
            {info?.notes && <p className="update-notes">{info.notes}</p>}
            {message && <p role="status">{message}</p>}
            {busy && progress !== undefined && (
              <progress aria-label="更新下载进度" value={progress} max={100} />
            )}
            <div className="segmented">
              <button disabled={busy} onClick={() => void check()}>
                检查更新
              </button>
              {info?.version && (
                <button disabled={busy} onClick={() => void install()}>
                  <Download size={16} /> 下载并重启更新
                </button>
              )}
            </div>
            <p>更新保留书籍、书签、阅读进度和设置。</p>
          </>
        )}
      </section>
    </div>
  );
}

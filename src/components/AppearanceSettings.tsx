import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { PALETTES, type Appearance } from "../appearance-settings";

export function AppearanceOptions({
  value,
  change,
  background,
}: {
  value: Appearance;
  change: (patch: Partial<Appearance>) => void;
  background: (file?: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="setting-group">
        <h3>软件主题色</h3>
        <div className="palette-options">
          {PALETTES.map((palette) => (
            <button
              key={palette.id}
              aria-label={`${palette.name}主题`}
              aria-pressed={value.palette === palette.id}
              className={value.palette === palette.id ? "selected" : ""}
              onClick={() => change({ palette: palette.id })}
            >
              <i style={{ background: palette.color }} />
              {palette.name}
            </button>
          ))}
        </div>
        <label className="switch-row">
          自定义颜色
          <input
            aria-label="自定义主题颜色"
            type="color"
            value={value.customColor}
            onChange={(event) =>
              change({ palette: "custom", customColor: event.target.value })
            }
          />
        </label>
      </div>
      <div className="setting-group">
        <h3>液态玻璃</h3>
        <label className="range-label" htmlFor="glass-strength">
          玻璃质感
          <output>
            {value.glass === 0 ? "关闭" : `${Math.round(value.glass * 100)}%`}
          </output>
        </label>
        <input
          id="glass-strength"
          aria-label="液态玻璃强度"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={value.glass}
          onChange={(event) => change({ glass: Number(event.target.value) })}
        />
        <p className="setting-note">
          侧栏、首页卡片、面板和弹窗的通透程度。配合背景壁纸效果最明显；调到最左为不透明。
        </p>
      </div>
      <div className="setting-group">
        <h3>背景壁纸</h3>
        <input
          ref={input}
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/bmp,video/mp4,video/webm,.mp4,.webm"
          aria-label="选择背景图片或视频文件"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              setBusy(true);
              void background(file).finally(() => setBusy(false));
            }
          }}
        />
        <div className="segmented">
          <button disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus size={16} />
            {busy ? "正在处理" : "选择图片或视频"}
          </button>
          {value.background && (
            <button disabled={busy} onClick={() => void background()}>
              移除壁纸
            </button>
          )}
        </div>
        {value.background && (
          <>
            <label className="range-label" htmlFor="background-opacity">
              壁纸浓度
              <output>{Math.round(value.backgroundOpacity * 100)}%</output>
            </label>
            <input
              id="background-opacity"
              aria-label="背景壁纸浓度"
              type="range"
              min="0.05"
              max="0.65"
              step="0.05"
              value={value.backgroundOpacity}
              onChange={(event) =>
                change({ backgroundOpacity: Number(event.target.value) })
              }
            />
          </>
        )}
      </div>
      <div className="setting-group">
        <h3>首页文字</h3>
        <label className="field-label" htmlFor="welcome-title">
          欢迎语
        </label>
        <input
          id="welcome-title"
          maxLength={100}
          value={value.welcomeTitle}
          onChange={(event) => change({ welcomeTitle: event.target.value })}
        />
        <label className="field-label" htmlFor="welcome-subtitle">
          副标题
        </label>
        <input
          id="welcome-subtitle"
          maxLength={100}
          value={value.welcomeSubtitle}
          onChange={(event) => change({ welcomeSubtitle: event.target.value })}
        />
      </div>
    </>
  );
}

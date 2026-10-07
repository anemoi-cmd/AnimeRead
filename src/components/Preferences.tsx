import type { ReaderStyle, Theme } from "../reader-types";
import { X, Bold, Italic, Volume2, CloudRain } from "lucide-react";
import { FilterStack } from "./FilterStack";
import type { EnhancementRuntime } from "../image-enhancement";

export interface Ambience {
  rain: boolean;
  sound: boolean;
  strength: number;
  volume: number;
}
export function Preferences({
  style,
  setStyle,
  fonts,
  reflow,
  ambience,
  setAmbience,
  close,
  comic,
  enhancement,
  animeDevice,
}: {
  style: ReaderStyle;
  setStyle: (patch: Partial<ReaderStyle>) => void;
  fonts: string[];
  reflow: boolean;
  ambience: Ambience;
  setAmbience: (patch: Partial<Ambience>) => void;
  close: () => void;
  comic?: boolean;
  enhancement?: EnhancementRuntime;
  animeDevice?: string;
}) {
  // 启动检测结束前也视为不可用，不能因旧设置曾开启超分而绕过显卡检测。
  const enhancementAvailable =
    !!animeDevice ||
    !!(
      enhancement?.available &&
      typeof enhancement.gpuId === "number" &&
      enhancement.gpuId >= 0
    );
  const themes: { id: Theme; name: string }[] = [
    { id: "light", name: "浅色" },
    { id: "dark", name: "深色" },
    { id: "paper", name: "纸张" },
    { id: "ink", name: "墨水" },
    { id: "wood", name: "木纹" },
  ];
  return (
    <aside className="preferences" aria-label="阅读设置" data-no-page>
      <div className="panel-heading">
        <h2>阅读设置</h2>
        <button
          className="icon-button"
          aria-label="关闭阅读设置"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <div className="setting-group">
        <h3>阅读底色</h3>
        <div className="theme-options">
          {themes.map((theme) => (
            <button
              key={theme.id}
              aria-label={theme.name}
              className={`theme-choice theme-${theme.id} ${style.theme === theme.id ? "selected" : ""}`}
              aria-pressed={style.theme === theme.id}
              onClick={() => setStyle({ theme: theme.id })}
            >
              <span aria-hidden="true">Aa</span>
              {theme.name}
            </button>
          ))}
        </div>
      </div>
      {reflow ? (
        <div className="setting-group">
          <h3>文字排版</h3>
          <label className="field-label" htmlFor="font-family">
            系统字体
          </label>
          <select
            id="font-family"
            value={style.fontFamily}
            onChange={(event) => setStyle({ fontFamily: event.target.value })}
          >
            {Array.from(new Set([style.fontFamily, ...fonts])).map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
          <label className="range-label" htmlFor="font-size">
            字号 <output>{style.fontSize} px</output>
          </label>
          <input
            id="font-size"
            aria-label="字号"
            type="range"
            min="12"
            max="48"
            value={style.fontSize}
            onChange={(event) =>
              setStyle({ fontSize: Number(event.target.value) })
            }
          />
          <label className="range-label" htmlFor="margin">
            页边距 <output>{style.margin} px</output>
          </label>
          <input
            id="margin"
            aria-label="页边距"
            type="range"
            min="12"
            max="110"
            step="2"
            value={style.margin}
            onChange={(event) =>
              setStyle({ margin: Number(event.target.value) })
            }
          />
          <label className="range-label" htmlFor="line-height">
            行距 <output>{style.lineHeight.toFixed(2)}</output>
          </label>
          <input
            id="line-height"
            aria-label="行距"
            type="range"
            min="1.2"
            max="2.6"
            step="0.05"
            value={style.lineHeight}
            onChange={(event) =>
              setStyle({ lineHeight: Number(event.target.value) })
            }
          />
          <div className="segmented">
            <button
              aria-pressed={style.bold}
              onClick={() => setStyle({ bold: !style.bold })}
            >
              <Bold size={16} /> 加粗
            </button>
            <button
              aria-pressed={style.italic}
              onClick={() => setStyle({ italic: !style.italic })}
            >
              <Italic size={16} /> 斜体
            </button>
          </div>
        </div>
      ) : (
        <div className="setting-group">
          <h3>页面显示</h3>
          <label className="range-label" htmlFor="zoom">
            缩放 <output>{Math.round(style.zoom * 100)}%</output>
          </label>
          <input
            id="zoom"
            aria-label="缩放"
            type="range"
            min="0.5"
            max="3"
            step="0.05"
            value={style.zoom}
            onChange={(event) => setStyle({ zoom: Number(event.target.value) })}
          />
        </div>
      )}
      <div className="setting-group">
        <h3>页面布局</h3>
        <label className="field-label" htmlFor="page-layout">
          单双页
        </label>
        <select
          id="page-layout"
          value={style.comicLayout}
          disabled={style.direction === "ttb"}
          onChange={(event) =>
            setStyle({
              comicLayout: event.target.value as ReaderStyle["comicLayout"],
            })
          }
        >
          <option value="single">单页</option>
          <option value="double">双页</option>
        </select>
      </div>
      {comic && (
        <div className="setting-group">
          <h3>漫画画质</h3>
          <label className="switch-row">
            <span>超分画质</span>
            <input
              aria-label="超分画质"
              type="checkbox"
              disabled={!enhancementAvailable}
              checked={enhancementAvailable && style.enhanceEnabled}
              title={enhancementAvailable ? undefined : "未检测到可用显卡"}
              onChange={(event) =>
                setStyle({
                  enhanceEnabled: event.target.checked,
                  enhanceBackend:
                    style.enhanceBackend === "anime4k" && !animeDevice
                      ? "waifu2x"
                      : style.enhanceBackend,
                })
              }
            />
          </label>
          <fieldset
            className="enhancement-controls"
            disabled={!enhancementAvailable}
          >
            <label className="field-label" htmlFor="enhance-backend">
              增强引擎
            </label>
            <select
              id="enhance-backend"
              value={style.enhanceBackend}
              onChange={(event) =>
                setStyle({
                  enhanceBackend: event.target
                    .value as ReaderStyle["enhanceBackend"],
                })
              }
            >
              <option value="anime4k" disabled={!animeDevice}>
                Anime4K
              </option>
              <option value="waifu2x" disabled={!enhancement?.available}>
                Waifu2x
              </option>
            </select>
            <FilterStack
              filters={style.filters}
              change={(filters) => setStyle({ filters })}
            />
            <label className="switch-row">
              <span>画质对比</span>
              <input
                aria-label="画质对比"
                type="checkbox"
                disabled={!style.enhanceEnabled}
                checked={style.compare}
                onChange={(event) =>
                  setStyle({ compare: event.target.checked })
                }
              />
            </label>
          </fieldset>
        </div>
      )}
      <div className="setting-group">
        <h3>翻页</h3>
        <label className="field-label" htmlFor="direction">
          阅读顺序
        </label>
        <select
          id="direction"
          value={style.direction}
          onChange={(event) =>
            setStyle({
              direction: event.target.value as ReaderStyle["direction"],
            })
          }
        >
          <option value="ltr">从左往右</option>
          <option value="rtl">从右往左</option>
          {(comic || reflow) && <option value="ttb">从上往下</option>}
        </select>
        <label className="field-label" htmlFor="motion">
          翻页方式
        </label>
        <select
          id="motion"
          disabled={style.direction === "ttb"}
          value={style.motion}
          onChange={(event) =>
            setStyle({ motion: event.target.value as ReaderStyle["motion"] })
          }
        >
          <option value="slide">平滑翻页</option>
          <option value="instant">即时翻页</option>
          <option value="curl">仿真翻页</option>
        </select>
        {style.motion === "curl" && style.direction !== "ttb" && (
          <>
            <label className="range-label" htmlFor="turn-duration">
              翻页时长 <output>{style.turnDuration} 毫秒</output>
            </label>
            <input
              id="turn-duration"
              aria-label="仿真翻页时长"
              type="range"
              min="150"
              max="1500"
              step="50"
              value={style.turnDuration}
              onChange={(event) =>
                setStyle({ turnDuration: Number(event.target.value) })
              }
            />
          </>
        )}
        <label className="switch-row">
          <span>翻书声</span>
          <input
            aria-label="翻书声"
            type="checkbox"
            checked={style.pageTurnSound}
            onChange={(event) =>
              setStyle({ pageTurnSound: event.target.checked })
            }
          />
        </label>
      </div>
      <div className="setting-group">
        <h3>雨天氛围</h3>
        <label className="switch-row">
          <span>
            <CloudRain size={17} /> 雨景
          </span>
          <input
            aria-label="雨景"
            type="checkbox"
            checked={ambience.rain}
            onChange={(event) => setAmbience({ rain: event.target.checked })}
          />
        </label>
        <label className="switch-row">
          <span>
            <Volume2 size={17} /> 雨声
          </span>
          <input
            aria-label="雨声"
            type="checkbox"
            checked={ambience.sound}
            onChange={(event) => setAmbience({ sound: event.target.checked })}
          />
        </label>
        {ambience.rain && (
          <>
            <label className="range-label" htmlFor="rain-strength">
              雨量
            </label>
            <input
              id="rain-strength"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={ambience.strength}
              onChange={(event) =>
                setAmbience({ strength: Number(event.target.value) })
              }
            />
          </>
        )}
        {ambience.sound && (
          <>
            <label className="range-label" htmlFor="rain-volume">
              音量
            </label>
            <input
              id="rain-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={ambience.volume}
              onChange={(event) =>
                setAmbience({ volume: Number(event.target.value) })
              }
            />
          </>
        )}
      </div>
      {reflow && (
        <div className="setting-group">
          <h3>TXT 编码</h3>
          <select
            aria-label="TXT 编码"
            value={style.encoding}
            onChange={(event) =>
              setStyle({
                encoding: event.target.value as ReaderStyle["encoding"],
              })
            }
          >
            <option value="auto">自动识别</option>
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GB18030／GBK</option>
            <option value="utf-16le">UTF-16 LE</option>
            <option value="utf-16be">UTF-16 BE</option>
          </select>
        </div>
      )}
    </aside>
  );
}

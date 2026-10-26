import { useState, type ReactNode } from "react";
import { X, Palette, Download, BookOpenText, Info } from "lucide-react";
import { AppearanceOptions } from "./AppearanceSettings";
import { UpdatePanel } from "./SoftwareUpdate";
import { UserGuide } from "./Help";
import { BrandMark } from "./BrandMark";
import { version } from "../../package.json";

export type SettingsTab = "appearance" | "update" | "guide" | "about";
/** 软件级设置的统一入口。新增功能在 TABS 里加一页即可，不再在侧栏
 * 单独开按钮；阅读相关的选项仍留在阅读界面的“阅读设置”中。
 */
const TABS: { id: SettingsTab; name: string; icon: ReactNode }[] = [
  { id: "appearance", name: "外观", icon: <Palette size={17} /> },
  { id: "update", name: "软件更新", icon: <Download size={17} /> },
  { id: "guide", name: "使用说明", icon: <BookOpenText size={17} /> },
  { id: "about", name: "关于", icon: <Info size={17} /> },
];
export function SettingsCenter({
  tab,
  setTab,
  close,
  appearance,
  prepareUpdate,
}: {
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  close: () => void;
  appearance: Parameters<typeof AppearanceOptions>[0];
  prepareUpdate: () => Promise<void>;
}) {
  const [locked, setLocked] = useState(false);
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];
  return (
    <div className="modal-backdrop" data-no-page>
      <section
        className="settings-center"
        role="dialog"
        aria-label="设置"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!locked) close();
          }
        }}
      >
        <nav className="settings-nav" aria-label="设置分类">
          <h2>设置</h2>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={item.id === current.id ? "selected" : ""}
              aria-current={item.id === current.id ? "page" : undefined}
              disabled={locked}
              onClick={() => setTab(item.id)}
            >
              {item.icon}
              {item.name}
            </button>
          ))}
        </nav>
        <div className="settings-page" aria-label={current.name}>
          <div className="panel-heading">
            <h2>{current.name}</h2>
            <button
              className="icon-button"
              aria-label="关闭设置"
              autoFocus
              disabled={locked}
              onClick={close}
            >
              <X size={19} />
            </button>
          </div>
          {current.id === "appearance" && <AppearanceOptions {...appearance} />}
          {current.id === "update" && (
            <UpdatePanel prepare={prepareUpdate} lock={setLocked} />
          )}
          {current.id === "guide" && <UserGuide />}
          {current.id === "about" && (
            <div className="about-page">
              <BrandMark size={84} />
              <h3>AnimeRead</h3>
              <p>版本 {version}</p>
              <p>小说与漫画阅读器 · 让故事，慢慢发生</p>
              <p className="setting-note">
                阅读记录、书签和设置只保存在这台电脑上。书籍文件始终留在原来的位置，删除书目不会删除文件。
              </p>
              <p className="setting-note">
                翻书音效：Sound Effect By Nicole Marie T（CC BY 4.0）；雨声：Ove
                Melaa（CC0）。开源许可见程序目录
                runtime/THIRD_PARTY_NOTICES.md。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

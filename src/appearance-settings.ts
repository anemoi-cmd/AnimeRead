export const PALETTES = [
  { id: "sage", name: "青苔", color: "#547660" },
  { id: "blue", name: "海蓝", color: "#386c9a" },
  { id: "violet", name: "暮紫", color: "#795a9b" },
  { id: "rose", name: "蔷薇", color: "#a05670" },
  { id: "amber", name: "琥珀", color: "#926b36" },
  { id: "slate", name: "石墨", color: "#586775" },
] as const;
export interface Appearance {
  palette: string;
  customColor: string;
  background: boolean;
  backgroundOpacity: number;
  backgroundKind: "image" | "video";
  welcomeTitle: string;
  welcomeSubtitle: string;
}
export const DEFAULT_APPEARANCE: Appearance = {
  palette: "sage",
  customColor: "#547660",
  background: false,
  backgroundOpacity: 0.25,
  backgroundKind: "image",
  welcomeTitle: "给阅读，留一点时间。",
  welcomeSubtitle: "翻开一页，让世界安静下来。",
};
export function appearanceColor(appearance: Appearance) {
  return (
    PALETTES.find((palette) => palette.id === appearance.palette)?.color ??
    appearance.customColor
  );
}

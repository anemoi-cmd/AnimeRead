import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import type { FilterMode } from "../reader-types";

const LABELS: Record<FilterMode, string> = {
  A: "超分",
  B: "柔和线条",
  C: "降噪",
};
const PRESETS = [
  "A",
  "B",
  "C",
  "A+A",
  "A+B",
  "A+C",
  "B+A",
  "B+B",
  "B+C",
  "C+A",
  "C+B",
  "C+C",
  "C+B+A",
];
export function FilterStack({
  filters,
  change,
}: {
  filters: FilterMode[];
  change: (filters: FilterMode[]) => void;
}) {
  const [next, setNext] = useState<FilterMode>("A");
  const preset = filters.join("+");
  const swap = (index: number, delta: number) => {
    const list = [...filters];
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    change(list);
  };
  return (
    <>
      <label className="field-label" htmlFor="filter-preset">
        滤镜预设
      </label>
      <select
        id="filter-preset"
        value={PRESETS.includes(preset) ? preset : "custom"}
        onChange={(event) => {
          if (event.target.value !== "custom")
            change(event.target.value.split("+") as FilterMode[]);
        }}
      >
        {PRESETS.map((preset) => (
          <option key={preset}>{preset}</option>
        ))}
        <option value="custom">自定义</option>
      </select>
      <ol className="filter-stack" aria-label="滤镜链">
        {filters.map((mode, index) => (
          <li key={`${index}-${mode}`}>
            <span>
              {mode} · {LABELS[mode]}
            </span>
            <button
              className="icon-button"
              aria-label={`上移滤镜 ${index + 1}`}
              disabled={index === 0}
              onClick={() => swap(index, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={`下移滤镜 ${index + 1}`}
              disabled={index === filters.length - 1}
              onClick={() => swap(index, 1)}
            >
              <ArrowDown size={13} />
            </button>
            <button
              className="icon-button"
              aria-label={`删除滤镜 ${index + 1}`}
              disabled={filters.length === 1}
              onClick={() => change(filters.filter((_, i) => i !== index))}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
      <div className="filter-add">
        <select
          aria-label="新增滤镜类型"
          value={next}
          onChange={(event) => setNext(event.target.value as FilterMode)}
        >
          {Object.entries(LABELS).map(([mode, name]) => (
            <option key={mode} value={mode}>
              {mode} · {name}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="添加滤镜"
          disabled={filters.length >= 4}
          onClick={() => change([...filters, next])}
        >
          <Plus size={16} />
        </button>
      </div>
    </>
  );
}

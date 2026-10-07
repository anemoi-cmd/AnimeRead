import { X } from "lucide-react";
import guide from "../../docs/USER_GUIDE.md?raw";

function text(value: string) {
  return value
    .split(/(`[^`]+`)/g)
    .map((part, index) =>
      part.startsWith("`") ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
const blocks = guide
  .trim()
  .split(/\r?\n\s*\r?\n/)
  .filter((block) => !block.startsWith("# "));
export function Help({ close }: { close: () => void }) {
  return (
    <div className="modal-backdrop">
      <section
        className="help-modal"
        role="dialog"
        aria-label="使用说明"
        aria-modal="true"
      >
        <div className="panel-heading">
          <h2>使用说明</h2>
          <button
            className="icon-button"
            aria-label="关闭使用说明"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        {blocks.map((block, index) => {
          const lines = block.split(/\r?\n/);
          if (block.startsWith("## "))
            return <h3 key={index}>{block.slice(3)}</h3>;
          if (block.startsWith("- "))
            return (
              <ul key={index}>
                {lines.map((line, row) => (
                  <li key={row}>{text(line.slice(2))}</li>
                ))}
              </ul>
            );
          if (block.startsWith("|")) {
            const rows = lines
              .filter((line) => !/^\|[\s:|\-]+\|$/.test(line))
              .map((line) =>
                line
                  .split("|")
                  .slice(1, -1)
                  .map((cell) => cell.trim()),
              );
            return (
              <table key={index} className="enhancement-help">
                <thead>
                  <tr>
                    {rows[0].map((cell, col) => (
                      <th key={col}>{text(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((row, id) => (
                    <tr key={id}>
                      {row.map((cell, col) => (
                        <td key={col}>{text(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          return <p key={index}>{text(lines.join(" "))}</p>;
        })}
      </section>
    </div>
  );
}

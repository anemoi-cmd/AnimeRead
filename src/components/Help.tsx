import guide from "../../docs/USER_GUIDE.md?raw";

/** 行内格式：`快捷键` 与 **重点**。 */
function text(value: string) {
  return value
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((part, index) =>
      part.startsWith("`") ? (
        <kbd key={index}>{part.slice(1, -1)}</kbd>
      ) : part.startsWith("**") ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}
const blocks = guide
  .trim()
  .split(/\r?\n\s*\r?\n/)
  .filter((block) => !block.startsWith("# "));
/** 设置中心的“使用说明”页，内容来自 docs/USER_GUIDE.md。 */
export function UserGuide() {
  return (
    <div className="user-guide">
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
    </div>
  );
}

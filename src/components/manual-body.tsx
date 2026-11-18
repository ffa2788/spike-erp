import type { ManualBlock } from "@/lib/manual";

export function ManualBody({ blocks }: { blocks: ManualBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "ol") {
          return <ol key={index}>{block.items.map((item) => <li key={item}>{rich(item)}</li>)}</ol>;
        }
        if (block.type === "ul") {
          return <ul key={index}>{block.items.map((item) => <li key={item}>{rich(item)}</li>)}</ul>;
        }
        if (block.type === "table") {
          return (
            <div className="wrap" key={index}>
              <table>
                <thead><tr>{block.headers.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.join("|")}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{rich(cell)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{rich(block.text)}</p>;
      })}
    </>
  );
}

function rich(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(#[a-z0-9-]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(#([a-z0-9-]+)\)$/.exec(part);
    if (link) return <a key={index} href={`#${link[2]}`}>{link[1]}</a>;
    return <span key={index}>{part}</span>;
  });
}

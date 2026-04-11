import { useMemo } from "react";

interface TextPreviewProps {
  content: string;
  contentType: string;
  fileName: string;
}

export function TextPreview({ content, contentType }: TextPreviewProps) {
  const lines = useMemo(() => content.split("\n"), [content]);

  return (
    <div className="h-full overflow-auto" data-selectable>
      <table className="w-full text-xs font-mono leading-relaxed">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              <td className="px-3 py-0 text-right text-zinc-300 dark:text-zinc-600 select-none w-10 align-top shrink-0 border-r border-zinc-100 dark:border-zinc-800">
                {i + 1}
              </td>
              <td className="px-3 py-0 whitespace-pre-wrap break-all">
                {line || "\u00A0"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import clike from "react-syntax-highlighter/dist/esm/languages/prism/clike";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import elixir from "react-syntax-highlighter/dist/esm/languages/prism/elixir";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import haskell from "react-syntax-highlighter/dist/esm/languages/prism/haskell";
import hcl from "react-syntax-highlighter/dist/esm/languages/prism/hcl";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import makefile from "react-syntax-highlighter/dist/esm/languages/prism/makefile";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import perl from "react-syntax-highlighter/dist/esm/languages/prism/perl";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import protobuf from "react-syntax-highlighter/dist/esm/languages/prism/protobuf";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import r from "react-syntax-highlighter/dist/esm/languages/prism/r";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";

// Register languages once at module load
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("clike", clike);
SyntaxHighlighter.registerLanguage("cpp", cpp);
SyntaxHighlighter.registerLanguage("csharp", csharp);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("docker", docker);
SyntaxHighlighter.registerLanguage("elixir", elixir);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("graphql", graphql);
SyntaxHighlighter.registerLanguage("haskell", haskell);
SyntaxHighlighter.registerLanguage("hcl", hcl);
SyntaxHighlighter.registerLanguage("ini", ini);
SyntaxHighlighter.registerLanguage("java", java);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("kotlin", kotlin);
SyntaxHighlighter.registerLanguage("lua", lua);
SyntaxHighlighter.registerLanguage("makefile", makefile);
SyntaxHighlighter.registerLanguage("markup", markup);
SyntaxHighlighter.registerLanguage("perl", perl);
SyntaxHighlighter.registerLanguage("php", php);
SyntaxHighlighter.registerLanguage("powershell", powershell);
SyntaxHighlighter.registerLanguage("protobuf", protobuf);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("r", r);
SyntaxHighlighter.registerLanguage("ruby", ruby);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("scala", scala);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("swift", swift);
SyntaxHighlighter.registerLanguage("toml", toml);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("yaml", yaml);

// Map file extension → Prism language key. Returns null for plain-text formats
// (txt, csv, log) to skip highlighting overhead.
function detectLanguage(fileName: string): string | null {
  const lower = fileName.toLowerCase();

  // Filenames without extension (Dockerfile, Makefile)
  if (lower === "dockerfile" || lower.endsWith("/dockerfile")) return "docker";
  if (lower === "makefile" || lower.endsWith("/makefile")) return "makefile";

  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "xml":
    case "html":
    case "htm":
    case "svg":
      return "markup";
    case "css":
      return "css";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "kt":
    case "kts":
      return "kotlin";
    case "scala":
    case "sbt":
      return "scala";
    case "swift":
      return "swift";
    case "c":
    case "h":
      return "clike";
    case "cpp":
    case "hpp":
    case "cc":
    case "cxx":
      return "cpp";
    case "cs":
      return "csharp";
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
      return "bash";
    case "ps1":
      return "powershell";
    case "sql":
      return "sql";
    case "graphql":
    case "gql":
      return "graphql";
    case "proto":
      return "protobuf";
    case "tf":
    case "hcl":
      return "hcl";
    case "ini":
    case "cfg":
    case "conf":
    case "properties":
    case "env":
      return "ini";
    case "pl":
      return "perl";
    case "php":
      return "php";
    case "r":
      return "r";
    case "lua":
      return "lua";
    case "ex":
    case "exs":
      return "elixir";
    case "hs":
      return "haskell";
    case "dockerfile":
      return "docker";
    default:
      return null;
  }
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface TextPreviewProps {
  content: string;
  contentType: string;
  fileName: string;
}

export function TextPreview({ content, fileName }: TextPreviewProps) {
  const isDark = useIsDark();
  const language = useMemo(() => detectLanguage(fileName), [fileName]);
  const lines = useMemo(() => content.split("\n"), [content]);

  // Plain text (no detected language): fall back to the simple line-numbered
  // table — faster and avoids tokenizing unknown content.
  if (!language) {
    return (
      <div className="h-full overflow-auto" data-selectable>
        <table className="w-full text-xs font-mono leading-relaxed">
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={i}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
              >
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

  return (
    <div className="h-full overflow-auto" data-selectable>
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        showLineNumbers
        wrapLongLines
        customStyle={{
          margin: 0,
          padding: "0.5rem 0",
          background: "transparent",
          fontSize: "0.75rem",
          lineHeight: "1.5",
        }}
        lineNumberStyle={{
          minWidth: "2.5rem",
          paddingRight: "0.75rem",
          textAlign: "right",
          userSelect: "none",
          opacity: 0.5,
        }}
        codeTagProps={{
          style: { fontFamily: "inherit" },
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

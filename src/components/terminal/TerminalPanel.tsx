import { tauriInvoke } from "@/lib/tauri";
import { useConnectionStore } from "@/stores/connectionStore";
import { useObjectStore } from "@/stores/objectStore";
import { useUiStore } from "@/stores/uiStore";
import { Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Line {
  kind: "input" | "output" | "error" | "info";
  text: string;
}

interface Cwd {
  bucket: string | null;
  prefix: string;
}

const HELP = `Available commands:
  help                 Show this help
  pwd                  Print current S3 location
  cd <path>            Change directory (s3://bucket/, relative, ..)
  ls [path]            List objects under the current or given prefix
  cat <key>            Print object content (text only, truncated)
  cp <src> <dst>       Copy object (same bucket)
  mv <src> <dst>       Move object (same bucket)
  rm <key> [<key>...]  Delete one or more objects
  clear                Clear the output

Paths can be:
  s3://bucket/key         absolute
  key                     relative to the current prefix
  ..                      one level up
  /                       bucket root`;

export function TerminalPanel() {
  const { t } = useTranslation();
  const toggle = useUiStore((s) => s.toggleTerminalPanel);
  const connectionId = useConnectionStore((s) => s.activeConnectionId);
  // Seed the cwd from whatever the user has open when the terminal
  // first mounts; from there on the terminal owns its own cwd.
  const seedBucket = useObjectStore((s) => s.currentBucket);
  const seedPrefix = useObjectStore((s) => s.currentPrefix);

  const [cwd, setCwd] = useState<Cwd>(() => ({
    bucket: seedBucket ?? null,
    prefix: seedPrefix ?? "",
  }));
  const [lines, setLines] = useState<Line[]>([
    {
      kind: "info",
      text: "S3 terminal — type `help` for commands.",
    },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-scroll on new lines.
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines.length]);

  const prompt = useMemo(() => formatPrompt(cwd), [cwd]);

  const push = (line: Line) => setLines((prev) => [...prev, line]);

  const onSubmit = async () => {
    const raw = input.trim();
    if (!raw || running) return;
    setHistory((prev) => [...prev, raw]);
    setHistoryIdx(null);
    setInput("");
    push({ kind: "input", text: `${prompt}$ ${raw}` });

    if (raw === "clear") {
      setLines([]);
      return;
    }

    if (!connectionId) {
      push({
        kind: "error",
        text: "No active connection. Pick one in the sidebar first.",
      });
      return;
    }

    setRunning(true);
    try {
      await dispatch(raw, cwd, connectionId, setCwd, push);
    } catch (e) {
      push({ kind: "error", text: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void onSubmit();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next =
        historyIdx === null ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(history[next]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === null) return;
      const next = historyIdx + 1;
      if (next >= history.length) {
        setHistoryIdx(null);
        setInput("");
      } else {
        setHistoryIdx(next);
        setInput(history[next]);
      }
      return;
    }
    if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+L: clear the screen, classic.
      e.preventDefault();
      setLines([]);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
          <TerminalIcon size={12} />
          {t("terminal.title")}
        </div>
        <button
          type="button"
          onClick={toggle}
          className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800"
          aria-label={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-snug whitespace-pre-wrap break-all"
      >
        {lines.map((l, i) => (
          <div key={i} className={lineClass(l.kind)}>
            {l.text}
          </div>
        ))}
      </div>

      {/* Prompt */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-800 font-mono text-[12px] shrink-0">
        <span className="text-emerald-600 dark:text-emerald-400 shrink-0">
          {prompt}$
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={running}
          className="flex-1 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 disabled:opacity-50"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function lineClass(kind: Line["kind"]): string {
  switch (kind) {
    case "input":
      return "text-zinc-500";
    case "error":
      return "text-red-600 dark:text-red-400";
    case "info":
      return "text-zinc-400 italic";
    default:
      return "text-zinc-900 dark:text-zinc-100";
  }
}

function formatPrompt(cwd: Cwd): string {
  if (!cwd.bucket) return "s3:";
  const p = cwd.prefix || "/";
  return `s3://${cwd.bucket}${p.startsWith("/") ? "" : "/"}${p}`;
}

// --- Command dispatch ---------------------------------------------------

interface ListedObject {
  key: string;
  display_name: string;
  is_folder: boolean;
  size: number | null;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}
interface ListObjectsResponse {
  // The backend folds common-prefixes (sub-folders) into `objects`
  // with `is_folder: true` and leaves `common_prefixes` empty. The
  // terminal needs to split them back out for display.
  objects: ListedObject[];
  common_prefixes: string[];
  continuation_token: string | null;
  is_truncated: boolean;
}

interface PreviewResponse {
  preview_type: string;
  content: string;
  content_type: string;
  size: number;
  truncated: boolean;
}

async function dispatch(
  raw: string,
  cwd: Cwd,
  connectionId: string,
  setCwd: (cwd: Cwd) => void,
  push: (l: Line) => void,
) {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return;
  const [cmd, ...args] = tokens;

  switch (cmd) {
    case "help":
      push({ kind: "output", text: HELP });
      return;

    case "pwd":
      push({ kind: "output", text: formatPrompt(cwd) });
      return;

    case "cd":
      handleCd(args, cwd, setCwd, push);
      return;

    case "ls": {
      const target = resolvePath(args[0] ?? "", cwd);
      if (!target.bucket) {
        push({
          kind: "error",
          text: "ls: no bucket. Use `cd s3://<bucket>` first.",
        });
        return;
      }
      const result = await tauriInvoke<ListObjectsResponse>("list_objects", {
        request: {
          connection_id: connectionId,
          bucket: target.bucket,
          prefix: target.prefix || null,
          delimiter: "/",
          max_keys: 1000,
          continuation_token: null,
        },
      });
      const folders = result.objects
        .filter((o) => o.is_folder)
        .map((o) => stripPrefix(o.key, target.prefix))
        .filter((s) => s.length > 0);
      const files = result.objects
        .filter((o) => !o.is_folder && !o.key.endsWith("/"))
        .map((o) => {
          const name = stripPrefix(o.key, target.prefix);
          const size = o.size != null ? formatBytes(o.size) : "—";
          return `${name.padEnd(40)} ${size.padStart(10)}`;
        });
      const lines = [...folders, ...files];
      push({
        kind: "output",
        text: lines.length > 0 ? lines.join("\n") : "(empty)",
      });
      if (result.is_truncated) {
        push({ kind: "info", text: "(truncated — first 1000 entries only)" });
      }
      return;
    }

    case "cat": {
      if (args.length !== 1) {
        push({ kind: "error", text: "cat: expected exactly one argument" });
        return;
      }
      const target = resolvePath(args[0], cwd);
      if (!target.bucket || !target.prefix) {
        push({ kind: "error", text: "cat: missing bucket/key" });
        return;
      }
      const result = await tauriInvoke<PreviewResponse>("get_object_preview", {
        connectionId,
        bucket: target.bucket,
        key: target.prefix,
      });
      if (
        result.preview_type !== "text" &&
        result.preview_type !== "markdown"
      ) {
        push({
          kind: "error",
          text: `cat: object is ${result.content_type || "binary"}, refusing to dump`,
        });
        return;
      }
      push({ kind: "output", text: result.content || "(empty)" });
      if (result.truncated) {
        push({
          kind: "info",
          text: "(truncated — open the preview panel for full content)",
        });
      }
      return;
    }

    case "cp":
    case "mv": {
      if (args.length !== 2) {
        push({ kind: "error", text: `${cmd}: expected <src> <dst>` });
        return;
      }
      const src = resolvePath(args[0], cwd);
      const dst = resolvePath(args[1], cwd);
      if (!src.bucket || !src.prefix || !dst.bucket || !dst.prefix) {
        push({
          kind: "error",
          text: `${cmd}: both src and dst must be full object paths`,
        });
        return;
      }
      if (src.bucket !== dst.bucket) {
        push({
          kind: "error",
          text: `${cmd}: cross-bucket not supported here. Use the Cross-Transfer dialog in the UI.`,
        });
        return;
      }
      const command = cmd === "cp" ? "copy_object" : "move_object";
      await tauriInvoke(command, {
        request: {
          connection_id: connectionId,
          bucket: src.bucket,
          source_key: src.prefix,
          dest_key: dst.prefix,
        },
      });
      push({
        kind: "output",
        text: `${cmd} OK: ${src.prefix} → ${dst.prefix}`,
      });
      return;
    }

    case "rm": {
      if (args.length === 0) {
        push({ kind: "error", text: "rm: missing keys" });
        return;
      }
      // Group by bucket so a multi-key delete with absolute paths
      // hitting different buckets still works.
      const byBucket: Record<string, string[]> = {};
      for (const a of args) {
        const r = resolvePath(a, cwd);
        if (!r.bucket || !r.prefix) {
          push({ kind: "error", text: `rm: invalid path "${a}"` });
          return;
        }
        (byBucket[r.bucket] ??= []).push(r.prefix);
      }
      for (const [bucket, keys] of Object.entries(byBucket)) {
        await tauriInvoke("delete_objects", {
          request: { connection_id: connectionId, bucket, keys },
        });
        push({
          kind: "output",
          text: `rm OK: ${keys.length} object(s) in ${bucket}`,
        });
      }
      return;
    }

    default:
      push({ kind: "error", text: `Unknown command: ${cmd}. Type \`help\`.` });
  }
}

function handleCd(
  args: string[],
  cwd: Cwd,
  setCwd: (c: Cwd) => void,
  push: (l: Line) => void,
) {
  if (args.length === 0 || args[0] === "/") {
    setCwd({ bucket: cwd.bucket, prefix: "" });
    return;
  }
  if (args[0] === "..") {
    if (!cwd.prefix) {
      // Already at bucket root — cd .. clears the bucket too.
      setCwd({ bucket: null, prefix: "" });
      return;
    }
    const parts = cwd.prefix.replace(/\/$/, "").split("/");
    parts.pop();
    const np = parts.length > 0 ? `${parts.join("/")}/` : "";
    setCwd({ bucket: cwd.bucket, prefix: np });
    return;
  }
  const target = resolvePath(args[0], cwd);
  if (!target.bucket) {
    push({ kind: "error", text: "cd: no bucket specified" });
    return;
  }
  // Ensure trailing slash — cd target is always a "directory".
  let prefix = target.prefix;
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  setCwd({ bucket: target.bucket, prefix });
}

/** Tokenize an input line, honoring double-quoted strings. */
function tokenize(raw: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of raw) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && (ch === " " || ch === "\t")) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Resolve a user-provided path against the current `cwd`.
 * Returns `{ bucket, prefix }` where `prefix` is the literal S3 key
 * (without leading slash). For `cd` semantics the caller will append
 * a trailing `/`; `cat`/`rm` use the value as-is.
 */
function resolvePath(input: string, cwd: Cwd): Cwd {
  if (input === "" || input === ".") {
    return { bucket: cwd.bucket, prefix: cwd.prefix };
  }
  if (input.startsWith("s3://")) {
    const rest = input.slice("s3://".length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      return { bucket: rest, prefix: "" };
    }
    return { bucket: rest.slice(0, slash), prefix: rest.slice(slash + 1) };
  }
  if (input.startsWith("/")) {
    // /something inside the current bucket
    return { bucket: cwd.bucket, prefix: input.slice(1) };
  }
  // Relative to current prefix
  const base =
    cwd.prefix && !cwd.prefix.endsWith("/") ? `${cwd.prefix}/` : cwd.prefix;
  return { bucket: cwd.bucket, prefix: base + input };
}

function stripPrefix(key: string, prefix: string): string {
  if (prefix && key.startsWith(prefix)) return key.slice(prefix.length);
  return key;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

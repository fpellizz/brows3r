import Markdown from "react-markdown";
import type { Components } from "react-markdown";

interface MarkdownPreviewProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-xl font-bold mt-4 mb-2 text-zinc-900 dark:text-zinc-100">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-bold mt-3 mb-2 text-zinc-900 dark:text-zinc-100">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-bold mt-3 mb-1 text-zinc-900 dark:text-zinc-100">
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 mb-3 text-zinc-700 dark:text-zinc-300">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 mb-3 text-zinc-700 dark:text-zinc-300">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="mb-1">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-brand-500 underline hover:text-brand-600"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 py-1 my-3 italic text-zinc-600 dark:text-zinc-400">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block bg-zinc-100 dark:bg-zinc-800 rounded-md p-3 my-3 text-xs font-mono overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-zinc-100 dark:bg-zinc-800 rounded px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-3">{children}</pre>,
  hr: () => <hr className="my-4 border-zinc-200 dark:border-zinc-700" />,
  strong: ({ children }) => (
    <strong className="font-bold text-zinc-900 dark:text-zinc-100">
      {children}
    </strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="h-full overflow-auto p-4 text-sm" data-selectable>
      <Markdown components={components}>{content}</Markdown>
    </div>
  );
}

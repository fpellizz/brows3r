interface PdfPreviewProps {
  url: string;
}

export function PdfPreview({ url }: PdfPreviewProps) {
  return (
    <div className="h-full bg-zinc-100 dark:bg-zinc-900">
      <iframe
        src={url}
        title="PDF Preview"
        className="w-full h-full border-0"
      />
    </div>
  );
}

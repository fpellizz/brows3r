interface ImagePreviewProps {
  base64Data: string;
  contentType: string;
}

export function ImagePreview({ base64Data, contentType }: ImagePreviewProps) {
  const src = `data:${contentType};base64,${base64Data}`;

  return (
    <div className="flex items-center justify-center h-full p-4 bg-zinc-100 dark:bg-zinc-900">
      <img
        src={src}
        alt="Preview"
        className="max-w-full max-h-full object-contain rounded shadow-sm"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}

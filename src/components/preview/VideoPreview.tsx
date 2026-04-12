interface VideoPreviewProps {
  url: string;
  contentType: string;
}

export function VideoPreview({ url, contentType }: VideoPreviewProps) {
  return (
    <div className="flex items-center justify-center h-full p-4 bg-zinc-100 dark:bg-zinc-900">
      <video
        controls
        className="max-w-full max-h-full rounded shadow-sm"
      >
        <source src={url} type={contentType} />
        Your browser does not support video playback.
      </video>
    </div>
  );
}

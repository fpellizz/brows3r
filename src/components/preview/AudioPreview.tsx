interface AudioPreviewProps {
  url: string;
  contentType: string;
}

export function AudioPreview({ url, contentType }: AudioPreviewProps) {
  return (
    <div className="flex items-center justify-center h-full p-4 bg-zinc-100 dark:bg-zinc-900">
      <audio
        controls
        className="w-full max-w-md"
      >
        <source src={url} type={contentType} />
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

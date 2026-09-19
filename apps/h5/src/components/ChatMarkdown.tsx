import { ImageOff, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveMediaUrl } from "../api/media";

const FANTO_MEDIA_PREFIX = "fanto-media://";

function mediaIdFromUrl(value: string): string | null {
  if (!value.startsWith(FANTO_MEDIA_PREFIX)) return null;
  const raw = value.slice(FANTO_MEDIA_PREFIX.length).replace(/^\/+/, "");
  const mediaId = raw.split(/[/?#]/, 1)[0]?.trim();
  return mediaId || null;
}

function markdownUrlTransform(url: string) {
  return url.startsWith(FANTO_MEDIA_PREFIX) ? url : defaultUrlTransform(url);
}

function FantoMediaImage({ mediaId, alt }: { mediaId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void resolveMediaUrl(mediaId)
      .then(next => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [mediaId]);

  if (failed) {
    return (
      <span className="chat-media-fallback">
        <ImageOff size={18} />
        <span>图片暂时无法加载</span>
      </span>
    );
  }

  if (!url) {
    return (
      <span className="chat-media-loading">
        <LoaderCircle size={18} />
        <span>正在加载图片</span>
      </span>
    );
  }

  return (
    <a className="chat-media-image" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} loading="lazy" />
    </a>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const content = useMemo(() => text, [text]);

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          img: ({ src, alt }) => {
            if (typeof src !== "string") return null;
            const mediaId = mediaIdFromUrl(src);
            return mediaId
              ? <FantoMediaImage mediaId={mediaId} alt={alt ?? "记录图片"} />
              : <img src={src} alt={alt ?? ""} loading="lazy" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

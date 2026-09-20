import { ImageOff, LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getCachedMediaUrl,
  resolveMediaUrl,
} from "../api/media";

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

function useLegacyMediaUrl(mediaId: string) {
  const [url, setUrl] = useState<string | null>(() => getCachedMediaUrl(mediaId));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedMediaUrl(mediaId);
    setUrl(cached);
    setFailed(false);
    if (cached) return () => { cancelled = true; };

    void resolveMediaUrl(mediaId)
      .then(next => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [mediaId]);

  return { url, failed };
}

function FantoMediaImage({ mediaId, alt }: { mediaId: string; alt: string }) {
  const { url, failed } = useLegacyMediaUrl(mediaId);

  if (failed) {
    return (
      <span className="legacy-media-tile chat-media-fallback">
        <ImageOff size={18} />
        <span>图片暂时无法加载</span>
      </span>
    );
  }

  if (!url) {
    return (
      <span className="legacy-media-tile chat-media-loading">
        <LoaderCircle size={18} className="spin" />
      </span>
    );
  }

  return (
    <a className="legacy-media-image" href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} loading="lazy" />
    </a>
  );
}

function FantoMediaAudio({ mediaId, children }: { mediaId: string; children: ReactNode }) {
  const { url, failed } = useLegacyMediaUrl(mediaId);
  if (failed) return <span className="legacy-media-audio-state">语音暂时无法加载</span>;
  if (!url) return <span className="legacy-media-audio-state"><LoaderCircle size={15} className="spin" />加载语音</span>;

  return (
    <span className="legacy-media-audio">
      <span>{children}</span>
      <audio controls preload="metadata" src={url} />
    </span>
  );
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => {
    if (typeof href === "string") {
      const mediaId = mediaIdFromUrl(href);
      if (mediaId) return <FantoMediaAudio mediaId={mediaId}>{children}</FantoMediaAudio>;
    }
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
  img: ({ src, alt }) => {
    if (typeof src !== "string") return null;
    const mediaId = mediaIdFromUrl(src);
    return mediaId
      ? <FantoMediaImage mediaId={mediaId} alt={alt ?? "记录图片"} />
      : <img src={src} alt={alt ?? ""} loading="lazy" />;
  },
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={markdownUrlTransform}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

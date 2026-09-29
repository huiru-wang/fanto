import {
  ImageOff,
  LoaderCircle,
  Volume2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PresentedMedia } from "../api/agent";
import {
  getCachedMediaUrl,
  resolveMediaUrl,
} from "../api/media";
import { ImageLightbox } from "./media/ImageLightbox";

type MediaUrlState = {
  url: string | null;
  failed: boolean;
};

function useMediaUrl(mediaId: string) {
  const [state, setState] = useState<MediaUrlState>(() => ({
    url: getCachedMediaUrl(mediaId),
    failed: false,
  }));

  const load = useCallback(async (force = false) => {
    const cached = force ? null : getCachedMediaUrl(mediaId);
    if (cached) {
      setState({ url: cached, failed: false });
      return cached;
    }
    setState(current => current.url && !force ? current : { url: null, failed: false });
    try {
      const url = await resolveMediaUrl(mediaId, "original", force);
      setState({ url, failed: false });
      return url;
    } catch {
      setState({ url: null, failed: true });
      return null;
    }
  }, [mediaId]);

  useEffect(() => {
    const cached = getCachedMediaUrl(mediaId);
    setState({ url: cached, failed: false });
    if (!cached) void load();
  }, [load, mediaId]);

  return { ...state, reload: () => load(true) };
}

function formatDuration(durationMs?: number) {
  if (!durationMs) return "语音";
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ImageTile({
  item,
  index,
  onOpen,
}: {
  item: PresentedMedia;
  index: number;
  onOpen: (index: number) => void;
}) {
  const { url, failed, reload } = useMediaUrl(item.mediaId);
  const retried = useRef(false);

  return (
    <button
      type="button"
      className="media-image-tile"
      onClick={() => onOpen(index)}
      aria-label={`查看第 ${index + 1} 张图片`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => {
            if (retried.current) return;
            retried.current = true;
            void reload();
          }}
        />
      ) : failed ? (
        <span className="media-tile-status">
          <ImageOff size={18} />
          <span>无法加载</span>
        </span>
      ) : (
        <span className="media-tile-status">
          <LoaderCircle size={18} className="spin" />
        </span>
      )}
    </button>
  );
}

function AudioTile({ item }: { item: PresentedMedia }) {
  const { url, failed, reload } = useMediaUrl(item.mediaId);
  const retried = useRef(false);

  return (
    <div className="media-audio-tile">
      <div className="media-audio-meta">
        <span className="media-audio-icon"><Volume2 size={16} /></span>
        <span>{formatDuration(item.durationMs)}</span>
      </div>
      {url ? (
        <audio
          controls
          preload="metadata"
          src={url}
          onError={() => {
            if (retried.current) return;
            retried.current = true;
            void reload();
          }}
        />
      ) : failed ? (
        <button className="media-audio-retry" type="button" onClick={() => void reload()}>
          重新加载
        </button>
      ) : (
        <span className="media-audio-loading"><LoaderCircle size={16} className="spin" />加载中</span>
      )}
    </div>
  );
}

function ImageRail({ items }: { items: PresentedMedia[] }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <section className="media-section">
      <span className="media-section-label">图片</span>
      <div className="media-rail image-rail">
        {items.map((item, index) => (
          <ImageTile key={item.mediaId} item={item} index={index} onOpen={setViewerIndex} />
        ))}
      </div>
      {viewerIndex !== null && (
        <ImageLightbox items={items.map(item => ({ mediaId: item.mediaId }))} initialIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </section>
  );
}

function AudioRail({ items }: { items: PresentedMedia[] }) {
  return (
    <section className="media-section">
      <span className="media-section-label">语音</span>
      <div className="media-rail audio-rail">
        {items.map(item => <AudioTile key={item.mediaId} item={item} />)}
      </div>
    </section>
  );
}

export function MediaPresentation({ items }: { items: PresentedMedia[] }) {
  const { images, audio } = useMemo(() => ({
    images: items.filter(item => item.mediaType === "image"),
    audio: items.filter(item => item.mediaType === "audio"),
  }), [items]);

  if (images.length === 0 && audio.length === 0) return null;

  return (
    <div className="media-presentation">
      {images.length > 0 && <ImageRail items={images} />}
      {audio.length > 0 && <AudioRail items={audio} />}
    </div>
  );
}

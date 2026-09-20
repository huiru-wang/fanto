import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  LoaderCircle,
  Volume2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import type { PresentedMedia } from "../api/agent";
import {
  getCachedMediaUrl,
  resolveMediaUrl,
} from "../api/media";

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
      const url = await resolveMediaUrl(mediaId, force);
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

function ViewerImage({ item }: { item: PresentedMedia }) {
  const { url, failed, reload } = useMediaUrl(item.mediaId);
  const retried = useRef(false);

  if (failed) {
    return (
      <button type="button" className="image-viewer-fallback" onClick={() => void reload()}>
        <ImageOff size={28} />
        <span>图片暂时无法加载，点击重试</span>
      </button>
    );
  }

  if (!url) {
    return (
      <div className="image-viewer-loading">
        <LoaderCircle size={28} className="spin" />
      </div>
    );
  }

  return (
    <img
      className="image-viewer-image"
      src={url}
      alt=""
      onError={() => {
        if (retried.current) return;
        retried.current = true;
        void reload();
      }}
    />
  );
}

function ImageViewer({
  items,
  initialIndex,
  onClose,
}: {
  items: PresentedMedia[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const touchStartX = useRef<number | null>(null);
  const lastIndex = items.length - 1;

  const previous = useCallback(() => {
    setIndex(current => current <= 0 ? lastIndex : current - 1);
  }, [lastIndex]);

  const next = useCallback(() => {
    setIndex(current => current >= lastIndex ? 0 : current + 1);
  }, [lastIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && items.length > 1) previous();
      if (event.key === "ArrowRight" && items.length > 1) next();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [items.length, next, onClose, previous]);

  const onTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || items.length <= 1) return;
    const end = event.changedTouches[0]?.clientX;
    if (end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) < 44) return;
    if (delta > 0) previous();
    else next();
  };

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button className="image-viewer-close" type="button" onClick={onClose} aria-label="关闭图片预览">
        <X size={22} />
      </button>
      {items.length > 1 && (
        <>
          <button className="image-viewer-nav previous" type="button" onClick={previous} aria-label="上一张">
            <ChevronLeft size={28} />
          </button>
          <button className="image-viewer-nav next" type="button" onClick={next} aria-label="下一张">
            <ChevronRight size={28} />
          </button>
        </>
      )}
      <div className="image-viewer-stage">
        <ViewerImage item={items[index]!} />
      </div>
      {items.length > 1 && <span className="image-viewer-counter">{index + 1} / {items.length}</span>}
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
        <ImageViewer items={items} initialIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
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

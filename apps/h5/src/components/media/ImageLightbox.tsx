import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type TouchEvent } from "react";
import { getCachedMediaUrl, invalidateMediaUrl, resolveMediaUrl } from "../../api/media";

export type LightboxImage = {
  mediaId: string;
  alt?: string;
  previewUrl?: string | null;
};

function ViewerImage({ item }: { item: LightboxImage }) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(() => getCachedMediaUrl(item.mediaId, "original"));
  const [originalReady, setOriginalReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const previewUrl = item.previewUrl ?? getCachedMediaUrl(item.mediaId, "thumbnail") ?? originalUrl;

  const loadOriginal = useCallback(async (force = false) => {
    setFailed(false);
    if (force) {
      invalidateMediaUrl(item.mediaId, "original");
      setOriginalUrl(null);
      setOriginalReady(false);
    }
    try {
      const url = await resolveMediaUrl(item.mediaId, "original", force);
      setOriginalUrl(url);
    } catch {
      setFailed(true);
    }
  }, [item.mediaId]);

  useEffect(() => {
    setOriginalUrl(getCachedMediaUrl(item.mediaId, "original"));
    setOriginalReady(false);
    setFailed(false);
    void loadOriginal();
  }, [item.mediaId, loadOriginal]);

  return (
    <div className="image-viewer-frame">
      {previewUrl && (
        <img
          className={`image-viewer-image image-viewer-preview ${originalReady ? "is-hidden" : ""}`}
          src={previewUrl}
          alt={item.alt ?? ""}
        />
      )}
      {originalUrl && (
        <img
          className={`image-viewer-image image-viewer-original ${originalReady ? "is-ready" : ""}`}
          src={originalUrl}
          alt={item.alt ?? ""}
          onLoad={() => setOriginalReady(true)}
          onError={() => {
            setOriginalUrl(null);
            setOriginalReady(false);
            setFailed(true);
          }}
        />
      )}
      {!previewUrl && !originalUrl && !failed && (
        <div className="image-viewer-loading">
          <LoaderCircle size={28} className="spin" />
        </div>
      )}
      {failed && (
        <button type="button" className="image-viewer-fallback" onClick={() => void loadOriginal(true)}>
          <ImageOff size={28} />
          <span>原图加载失败</span>
          <span>点击重试</span>
        </button>
      )}
      {originalUrl && (
        <a className="image-viewer-original-link" href={originalUrl} target="_blank" rel="noopener noreferrer">
          查看原图
        </a>
      )}
    </div>
  );
}

export function ImageLightbox({
  items,
  initialIndex,
  onClose,
}: {
  items: LightboxImage[];
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

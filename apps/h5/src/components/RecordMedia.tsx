import { FileAudio2, ImageOff, LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedMediaUrl, resolveMediaUrl } from "../api/media";
import type { RecordContentBlock } from "../api/records";
import { ImageLightbox } from "./media/ImageLightbox";

type ImageBlock = Extract<RecordContentBlock, { type: "image" }>;
type AudioBlock = Extract<RecordContentBlock, { type: "audio" }>;

function durationText(milliseconds: number | null | undefined) {
  if (!milliseconds) return null;
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function useNearViewport(rootMargin = "300px") {
  const ref = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return { ref, near };
}

function RecordImage({
  block,
  index,
  onOpen,
}: {
  block: ImageBlock;
  index: number;
  onOpen: (index: number) => void;
}) {
  const cached = getCachedMediaUrl(block.mediaId, "thumbnail");
  const [url, setUrl] = useState<string | null>(cached);
  const [failed, setFailed] = useState(false);
  const retryRef = useRef(0);
  const { ref, near } = useNearViewport();

  const loadUrl = useCallback(async (force = false) => {
    try {
      const next = await resolveMediaUrl(block.mediaId, "thumbnail", force);
      setUrl(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [block.mediaId]);

  useEffect(() => {
    retryRef.current = 0;
    const nextCached = getCachedMediaUrl(block.mediaId, "thumbnail");
    setUrl(nextCached);
    setFailed(false);
  }, [block.mediaId]);

  useEffect(() => {
    if (near && !url && !failed) void loadUrl();
  }, [failed, loadUrl, near, url]);

  const retryOnce = () => {
    if (retryRef.current >= 1) {
      setFailed(true);
      return;
    }
    retryRef.current += 1;
    void loadUrl(true);
  };

  return (
    <button
      ref={node => { ref.current = node; }}
      className="record-image"
      type="button"
      onClick={() => onOpen(index)}
      aria-label={`查看第 ${index + 1} 张图片`}
    >
      {url ? (
        <img src={url} alt={block.description || "记录图片"} loading="lazy" onError={retryOnce} />
      ) : failed ? (
        <span className="record-image-fallback">
          <ImageOff size={18} />
          <span>图片暂时无法加载</span>
        </span>
      ) : (
        <span className="record-image-loading"><LoaderCircle size={18} /></span>
      )}
    </button>
  );
}

function RecordAudio({ block }: { block: AudioBlock }) {
  const [url, setUrl] = useState<string | null>(() => getCachedMediaUrl(block.mediaId, "original"));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadAudio = useCallback(async (force = false) => {
    setLoading(true);
    setFailed(false);
    try {
      setUrl(await resolveMediaUrl(block.mediaId, "original", force));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [block.mediaId]);

  return (
    <div className="record-audio">
      <div className="record-audio-head">
        <FileAudio2 size={16} />
        <span>语音{durationText(block.durationMs) ? ` · ${durationText(block.durationMs)}` : ""}</span>
      </div>
      {url ? (
        <audio controls preload="metadata" src={url} onError={() => { setUrl(null); setFailed(true); }} />
      ) : failed ? (
        <button type="button" className="audio-retry" onClick={() => void loadAudio(true)}>
          重新加载音频
        </button>
      ) : (
        <button type="button" className="audio-retry" disabled={loading} onClick={() => void loadAudio()}>
          {loading ? <><LoaderCircle size={16} />正在加载</> : <><Play size={15} />播放语音</>}
        </button>
      )}
      {block.transcription && <p className="audio-transcript">{block.transcription}</p>}
    </div>
  );
}

export function RecordMediaList({ blocks }: { blocks: RecordContentBlock[] }) {
  const images = blocks.filter((item): item is ImageBlock => item.type === "image");
  const audio = blocks.filter((item): item is AudioBlock => item.type === "audio");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  if (!blocks.length) return null;

  return (
    <div className="record-media-list">
      {images.length > 0 && (
        <div className={`record-image-grid count-${Math.min(images.length, 4)}`}>
          {images.map((item, index) => (
            <RecordImage key={item.mediaId} block={item} index={index} onOpen={setViewerIndex} />
          ))}
        </div>
      )}
      {audio.map(item => <RecordAudio key={item.mediaId} block={item} />)}
      {viewerIndex !== null && (
        <ImageLightbox
          items={images.map(item => ({
            mediaId: item.mediaId,
            alt: item.description || "记录图片",
            previewUrl: getCachedMediaUrl(item.mediaId, "thumbnail"),
          }))}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}

import { FileAudio2, ImageOff, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveMediaUrl } from "../api/media";
import type { RecordMedia } from "../api/records";

function durationText(milliseconds: number | null | undefined) {
  if (!milliseconds) return null;
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ServerMedia({ media }: { media: RecordMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retryRef = useRef(0);

  const loadUrl = useCallback(async () => {
    try {
      const next = await resolveMediaUrl(media.mediaId);
      setUrl(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [media.mediaId]);

  useEffect(() => {
    retryRef.current = 0;
    setUrl(null);
    setFailed(false);
    void loadUrl();
  }, [loadUrl]);

  const retryOnce = () => {
    if (retryRef.current >= 1) {
      setFailed(true);
      return;
    }
    retryRef.current += 1;
    void loadUrl();
  };

  if (media.type === "image") {
    if (failed) {
      return (
        <div className="record-image-fallback">
          <ImageOff size={18} />
          <span>图片暂时无法加载</span>
        </div>
      );
    }
    if (!url) {
      return <div className="record-image-loading"><LoaderCircle size={18} /></div>;
    }
    return (
      <a className="record-image" href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={media.description || "记录图片"} loading="lazy" onError={retryOnce} />
      </a>
    );
  }

  return (
    <div className="record-audio">
      <div className="record-audio-head">
        <FileAudio2 size={16} />
        <span>语音{durationText(media.durationMs) ? ` · ${durationText(media.durationMs)}` : ""}</span>
      </div>
      {failed ? (
        <button type="button" className="audio-retry" onClick={() => { retryRef.current = 0; void loadUrl(); }}>
          重新加载音频
        </button>
      ) : url ? (
        <audio controls preload="metadata" src={url} onError={retryOnce} />
      ) : (
        <div className="audio-loading"><LoaderCircle size={16} />正在加载</div>
      )}
      {media.asr?.transcript && <p className="audio-transcript">{media.asr.transcript}</p>}
    </div>
  );
}

export function RecordMediaList({ media }: { media: RecordMedia[] }) {
  const images = media.filter(item => item.type === "image");
  const audio = media.filter(item => item.type === "audio");
  if (!media.length) return null;

  return (
    <div className="record-media-list">
      {images.length > 0 && (
        <div className={`record-image-grid count-${Math.min(images.length, 4)}`}>
          {images.map(item => <ServerMedia key={item.mediaId} media={item} />)}
        </div>
      )}
      {audio.map(item => <ServerMedia key={item.mediaId} media={item} />)}
    </div>
  );
}

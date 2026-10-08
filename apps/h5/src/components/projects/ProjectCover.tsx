import { ImageOff, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getCachedMediaUrl, resolveMediaUrl } from "../../api/media";

export function ProjectCover({ mediaId }: { mediaId: string | null }) {
  const [url, setUrl] = useState<string | null>(() => mediaId ? getCachedMediaUrl(mediaId, "thumbnail") : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mediaId) return;
    let cancelled = false;
    setFailed(false);
    setUrl(getCachedMediaUrl(mediaId, "thumbnail"));
    void resolveMediaUrl(mediaId, "thumbnail").then(value => {
      if (!cancelled) setUrl(value);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [mediaId]);

  return (
    <div className={`project-cover ${url ? "has-image" : ""}`}>
      {url ? <img src={url} alt="" loading="lazy" onError={() => { setUrl(null); setFailed(true); }} /> : failed ? <ImageOff size={27} strokeWidth={1.3} /> : <><span className="project-cover-orbit" /><Sparkles size={25} strokeWidth={1.25} /></>}
    </div>
  );
}

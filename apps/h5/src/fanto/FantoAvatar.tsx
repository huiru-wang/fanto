import { useEffect, useState } from "react";
import { resolveMediaUrl } from "../api/media";
import { useFanto } from "./FantoContext";
export function FantoAvatar({ size = 36 }: {
    size?: number;
}) {
    const { settings } = useFanto();
    const id = settings?.avatarMediaId;
    const [source, setSource] = useState<{
        id: string;
        url: string;
    } | null>(null), [retried, setRetried] = useState(false);
    useEffect(() => { let active = true; setSource(null); setRetried(false); if (id)
        void resolveMediaUrl(id, "thumbnail").then(url => { if (active)
            setSource({ id, url }); }).catch(() => { }); return () => { active = false; }; }, [id]);
    return <span className="fanto-profile-avatar" style={{ width: size, height: size }}>{source && source.id === id ? <img alt={settings?.nickname ?? "Fanto"} src={source.url} onError={() => { setSource(null); if (!retried && id) {
        setRetried(true);
        void resolveMediaUrl(id, "thumbnail", true).then(url => setSource({ id, url })).catch(() => { });
    } }}/> : <img alt="Fanto" src="/assets/fanto/avatar/fanto-avatar-512.png"/>}</span>;
}

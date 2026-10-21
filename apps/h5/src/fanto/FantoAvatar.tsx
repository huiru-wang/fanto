import { useEffect, useState } from "react";
import { resolveMediaUrl } from "../api/media";
import { useFanto } from "./FantoContext";

export function FantoAvatar({ size = 36, avatarMediaId, label }: {
  size?: number;
  avatarMediaId?: string | null;
  label?: string;
}) {
  const { settings } = useFanto();
  const id = avatarMediaId === undefined ? settings?.avatarMediaId : avatarMediaId;
  const name = label ?? settings?.nickname ?? "Fanto";
  const [source, setSource] = useState<{ id: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(null); setFailed(false);
    if (id) void resolveMediaUrl(id, "thumbnail").then(url => {
      if (active) setSource({ id, url });
    }).catch(() => {});
    return () => { active = false; };
  }, [id]);
  return <span className="fanto-profile-avatar" style={{ width: size, height: size }}>
    <img alt={name || "未命名角色"} src={!failed && source && source.id === id ? source.url : "/assets/fanto/avatar/fanto-avatar.webp"}
      onError={() => { if (source) setFailed(true); }} />
  </span>;
}

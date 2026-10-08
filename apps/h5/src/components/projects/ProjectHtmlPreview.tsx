import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveMediaUrl } from "../../api/media";
import { FantoMarkdown } from "../FantoMarkdown";

const mediaPattern = /fanto-media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

function SafeHtmlPreview({ html }: { html: string }) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setError(false);
    const ids = [...new Set([...html.matchAll(mediaPattern)].map(match => match[1]!.toLowerCase()))];
    void Promise.all(ids.map(async id => [id, await resolveMediaUrl(id, "original", revision > 0)] as const))
      .then(urls => {
        if (cancelled) return;
        const resolved = new Map(urls);
        const content = html.replace(mediaPattern, (_, id: string) => resolved.get(id.toLowerCase()) ?? "");
        const hosts = [...new Set(urls.map(([, url]) => {
          try { return new URL(url).origin; } catch { return ""; }
        }).filter(Boolean))];
        const policy = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${hosts.join(" ") || "'none'"}; font-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`;
        setSrcDoc(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}body{font:16px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;overflow-wrap:anywhere;color:#24231f}img{max-width:100%;height:auto}a{pointer-events:none}</style></head><body>${content}</body></html>`);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [html, revision]);

  return (
    <div className="project-html-preview">
      <div className="project-preview-head"><span><ExternalLink size={14} />作品预览</span><button type="button" onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />刷新</button></div>
      {error ? <p className="project-preview-state">预览暂时无法加载，请尝试刷新。</p> : srcDoc
        ? <iframe title="静态作品预览" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} />
        : <p className="project-preview-state">正在准备作品预览…</p>}
    </div>
  );
}

export function ProjectDocument({ content, title }: { content: string; title: string }) {
  const leading = content.replace(new RegExp(`^\\s*#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\r?\\n|$)`), "");
  const fragments = leading.split(/```html-preview[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g);
  return <div className="project-document">{fragments.map((part, index) =>
    index % 2 ? <SafeHtmlPreview key={index} html={part} /> : part.trim() ? <FantoMarkdown key={index} text={part} /> : null,
  )}</div>;
}

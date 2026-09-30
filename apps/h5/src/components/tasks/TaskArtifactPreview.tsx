import { AlertCircle, Download, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskArtifactDto, TaskArtifactPreviewDto } from "../../api/tasks";
import { getTaskArtifactPreview } from "../../api/tasks";
import { resolveMediaUrl } from "../../api/media";
import { FantoMarkdown } from "../FantoMarkdown";

const FANTO_MEDIA_PREFIX = "fanto-media://";

function fantoMediaId(value: string): string | null {
  if (!value.startsWith(FANTO_MEDIA_PREFIX)) return null;
  const raw = value.slice(FANTO_MEDIA_PREFIX.length).replace(/^\/+/, "");
  return raw.split(/[/?#]/, 1)[0]?.trim() || null;
}

function safeExternalUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://") || normalized.startsWith("data:");
}

function replaceUnavailable(node: Element) {
  if (node.tagName.toLowerCase() === "source") {
    node.remove();
    return;
  }
  const placeholder = node.ownerDocument.createElement("span");
  placeholder.textContent = "媒体暂时无法加载";
  placeholder.setAttribute("style", "display:block;padding:16px;border:1px solid rgba(0,0,0,.1);border-radius:10px;color:#777;font:14px sans-serif;");
  node.replaceWith(placeholder);
}

async function prepareHtmlPreview(content: string): Promise<string> {
  const document = new DOMParser().parseFromString(content, "text/html");
  document.querySelectorAll("script,iframe,object,embed,base,link,meta[http-equiv]").forEach(node => node.remove());
  document.querySelectorAll("style").forEach(node => {
    node.textContent = (node.textContent ?? "").replace(/@import\s+[^;]+;?/gi, "");
  });

  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcset" || name === "poster") element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && (/^javascript:/i.test(value) || /^data:text\/html/i.test(value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    if (href && !href.startsWith("#") && !/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
      anchor.removeAttribute("href");
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }

  const mediaNodes = Array.from(document.querySelectorAll("img[src],audio[src],video[src],source[src]"));
  await Promise.all(mediaNodes.map(async node => {
    const source = node.getAttribute("src")?.trim() ?? "";
    const mediaId = fantoMediaId(source);
    if (mediaId) {
      try {
        node.setAttribute("src", await resolveMediaUrl(mediaId, "original"));
      } catch {
        replaceUnavailable(node);
      }
      return;
    }
    if (!safeExternalUrl(source)) replaceUnavailable(node);
  }));

  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TaskArtifactPreview({ artifact, onClose }: { artifact: TaskArtifactDto; onClose: () => void }) {
  const [preview, setPreview] = useState<TaskArtifactPreviewDto | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setHtml(null);
    setError(null);
    void getTaskArtifactPreview(artifact.mediaId)
      .then(async result => {
        if (cancelled) return;
        setPreview(result);
        if (result.format === "html") {
          const resolved = await prepareHtmlPreview(result.content);
          if (!cancelled) setHtml(resolved);
        }
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "暂时无法预览这个结果");
      });
    return () => { cancelled = true; };
  }, [artifact.mediaId]);

  const download = async () => {
    try {
      const url = await resolveMediaUrl(artifact.mediaId, "original");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法下载这个结果");
    }
  };

  return (
    <div className="artifact-preview-overlay" role="dialog" aria-modal="true" aria-label={`${artifact.filename} 预览`}>
      <div className="artifact-preview-shell">
        <header className="artifact-preview-header">
          <div>
            <strong>{artifact.filename}</strong>
            <span>{artifact.mimeType} · {formatBytes(artifact.bytes)}</span>
          </div>
          <div className="artifact-preview-actions">
            <button type="button" onClick={() => void download()}><Download size={16} />下载</button>
            <button type="button" className="icon-button compact" onClick={onClose} aria-label="关闭预览"><X size={18} /></button>
          </div>
        </header>
        <div className="artifact-preview-body">
          {error ? (
            <div className="task-preview-state error"><AlertCircle size={20} /><span>{error}</span></div>
          ) : !preview || (preview.format === "html" && !html) ? (
            <div className="task-preview-state"><LoaderCircle size={20} className="spin" /><span>正在准备预览…</span></div>
          ) : preview.format === "html" ? (
            <iframe className="task-html-preview" sandbox="" srcDoc={html ?? ""} title={artifact.filename} />
          ) : preview.format === "markdown" ? (
            <div className="task-markdown-preview"><FantoMarkdown text={preview.content} /></div>
          ) : (
            <pre className="task-text-preview">{preview.content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

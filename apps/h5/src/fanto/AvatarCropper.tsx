import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cropGeometry, exportAvatar, loadAvatar, type CropTransform } from "./crop";
import { uploadDraft, type UploadProgress, type UploadTicket } from "../api/media-upload";
import { ApiError, requestJson } from "../api/http";
export function AvatarCropper({ file, onCancel, onSave }: {
    file: File;
    onCancel: () => void;
    onSave: (id: string) => Promise<void>;
}) {
    const [image, setImage] = useState<HTMLCanvasElement | null>(null), [transform, setTransform] = useState<CropTransform>({ zoom: 1, x: 0, y: 0 }), [diameter, setDiameter] = useState(300), [stage, setStage] = useState(""), [error, setError] = useState("");
    const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), cancel = useRef<HTMLButtonElement>(null), pointers = useRef(new Map<number, {
        x: number;
        y: number;
    }>());
    const attempt = useRef<{
        blob: Blob;
        upload?: UploadProgress;
    } | null>(null), transformRef = useRef(transform), busy = useRef(false);
    useEffect(() => { let active = true; void loadAvatar(file).then(value => { if (active)
        setImage(value);
    else {
        value.width = 0;
        value.height = 0;
    } }).catch(e => { if (active)
        setError(e.message); }); cancel.current?.focus(); return () => { active = false; }; }, [file]);
    useEffect(() => () => { if (image) {
        image.width = 0;
        image.height = 0;
    } }, [image]);
    useEffect(() => { const node = viewport.current; if (!node)
        return; const observer = new ResizeObserver(() => setDiameter(node.clientWidth)); observer.observe(node); return () => observer.disconnect(); }, []);
    useEffect(() => {
        if (!image || !canvas.current)
            return;
        const c = canvas.current;
        c.width = diameter * devicePixelRatio;
        c.height = diameter * devicePixelRatio;
        const ctx = c.getContext("2d");
        if (!ctx)
            return;
        ctx.scale(devicePixelRatio, devicePixelRatio);
        ctx.clearRect(0, 0, diameter, diameter);
        const g = cropGeometry(image.width, image.height, diameter, transform);
        ctx.drawImage(image, diameter / 2 + g.x - image.width * g.scale / 2, diameter / 2 + g.y - image.height * g.scale / 2, image.width * g.scale, image.height * g.scale);
    }, [image, diameter, transform]);
    const update = (value: CropTransform) => { if (busy.current || !image)
        return; const next = cropGeometry(image.width, image.height, diameter, value); const t = { zoom: next.zoom, x: next.x, y: next.y }; transformRef.current = t; setTransform(t); attempt.current = null; };
    const move = (event: PointerEvent) => {
        const old = pointers.current.get(event.pointerId);
        if (!old)
            return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        const t = transformRef.current;
        if (before.length === 2 && after.length === 2) {
            const dist = (v: typeof before) => Math.hypot(v[0]!.x - v[1]!.x, v[0]!.y - v[1]!.y);
            const ratio = dist(after) / Math.max(1, dist(before));
            const rect = viewport.current!.getBoundingClientRect();
            const cx = (before[0]!.x + before[1]!.x) / 2 - rect.left - diameter / 2, cy = (before[0]!.y + before[1]!.y) / 2 - rect.top - diameter / 2;
            const z = image ? cropGeometry(image.width, image.height, diameter, { ...t, zoom: t.zoom * ratio }).zoom : t.zoom;
            const r = z / t.zoom;
            update({ zoom: z, x: t.x * r + cx * (1 - r) + (after[0]!.x + after[1]!.x - before[0]!.x - before[1]!.x) / 2, y: t.y * r + cy * (1 - r) + (after[0]!.y + after[1]!.y - before[0]!.y - before[1]!.y) / 2 });
        }
        else
            update({ ...t, x: t.x + event.clientX - old.x, y: t.y + event.clientY - old.y });
    };
    const save = async () => {
        if (!image || busy.current)
            return;
        busy.current = true;
        setError("");
        try {
            setStage("正在生成头像…");
            attempt.current ??= { blob: await exportAvatar(image, diameter, transformRef.current) };
            const data = attempt.current;
            setStage("正在上传头像…");
            const id = await uploadDraft(data, { create: () => requestJson<UploadTicket>("/api/uploads", { method: "POST", body: JSON.stringify({ purpose: "fanto_avatar", mimeType: "image/jpeg", bytes: data.blob.size }) }), put: ticket => fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: data.blob, signal: AbortSignal.timeout(60000) }), complete: id => requestJson(`/api/uploads/${encodeURIComponent(id)}/complete`, { method: "POST", body: "{}", signal: AbortSignal.timeout(90000) }), isMissing: e => e instanceof ApiError && e.code === "UPLOAD_NOT_FOUND" });
            setStage("正在保存头像…");
            await onSave(id);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "保存失败，请重试");
        }
        finally {
            setStage("");
            busy.current = false;
        }
    };
    return <div className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" onKeyDown={e => { if (e.key === "Escape" && !busy.current)
        onCancel(); if (e.key === "Tab") {
        const nodes = e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']");
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
        }
    } }}>
  <h2 id="avatar-crop-title">调整头像</h2><p>拖动或缩放图片，保存后立即更新头像</p>
  <div className="avatar-crop-viewport" ref={viewport} tabIndex={0} aria-label="头像取景区域，方向键调整位置" onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        update({ ...transformRef.current, x: transformRef.current.x + (e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0), y: transformRef.current.y + (e.key === "ArrowUp" ? -10 : e.key === "ArrowDown" ? 10 : 0) });
    } }} onPointerDown={e => { if (stage)
        return; e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }} onPointerMove={move} onPointerUp={e => pointers.current.delete(e.pointerId)} onPointerCancel={() => pointers.current.clear()}>
   <canvas ref={canvas}/><div className="avatar-crop-mask"/>
  </div>
  <label className="avatar-zoom">缩放<input type="range" min={1} max={image ? Math.min(5, Math.min(image.width, image.height) / 128) : 1} step={.01} value={transform.zoom} disabled={!!stage || !image} onChange={e => update({ ...transformRef.current, zoom: Number(e.target.value) })}/></label>
  <button type="button" disabled={!!stage} onClick={() => update({ zoom: 1, x: 0, y: 0 })}>重置构图</button>
  {error && <p role="alert">{error}</p>}{stage && <p role="status">{stage}</p>}
  <footer><button ref={cancel} type="button" onClick={onCancel} disabled={!!stage}>取消</button><button type="button" className="provider-action" onClick={() => void save()} disabled={!image || !!stage}>保存</button></footer>
 </div>;
}

import { requestJson } from "./http";

export type MediaKind = "image" | "audio";
export type MediaCapture = {
  width?: number;
  height?: number;
  durationMs?: number;
};

export type DraftMedia = {
  id: string;
  kind: MediaKind;
  blob: Blob;
  mimeType: string;
  name: string;
  previewUrl: string;
  capture: MediaCapture;
};

type UploadTicket = {
  mediaId: string;
  uploadUrl: string;
  expiresAt: string;
};

const MAX_MEDIA_BYTES = 50_000_000;

const mimeByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

const acceptedMime = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

function canonicalMime(file: Blob, name = ""): string {
  const declared = file.type.split(";", 1)[0]?.trim().toLowerCase();
  if (acceptedMime.has(declared)) return declared;
  if (declared === "audio/x-m4a" || declared === "audio/m4a") return "audio/mp4";
  if (declared === "audio/x-wav" || declared === "audio/wave") return "audio/wav";
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const fallback = mimeByExtension[extension];
  if (fallback) return fallback;
  throw new Error("仅支持 JPG、PNG、WebP、M4A、MP3 和 WAV");
}

function kindForMime(mimeType: string): MediaKind {
  return mimeType.startsWith("image/") ? "image" : "audio";
}

function imageCapture(blob: Blob): Promise<MediaCapture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    image.src = url;
  });
}

function audioCapture(blob: Blob): Promise<MediaCapture> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.max(1, Math.round(audio.duration * 1000))
        : undefined;
      cleanup();
      resolve(durationMs ? { durationMs } : {});
    };
    audio.onerror = () => {
      cleanup();
      resolve({});
    };
    audio.src = url;
  });
}

export async function createDraftMedia(file: File): Promise<DraftMedia> {
  if (file.size <= 0) throw new Error("附件内容为空");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("单个附件不能超过 50MB");

  const mimeType = canonicalMime(file, file.name);
  const kind = kindForMime(mimeType);
  const blob = file.type === mimeType ? file : file.slice(0, file.size, mimeType);
  const capture = kind === "image" ? await imageCapture(blob) : await audioCapture(blob);

  return {
    id: crypto.randomUUID(),
    kind,
    blob,
    mimeType,
    name: file.name,
    previewUrl: URL.createObjectURL(blob),
    capture,
  };
}

export function createRecordedDraft(blob: Blob, durationMs: number): DraftMedia {
  const mimeType = canonicalMime(blob, blob.type === "audio/wav" ? "recording.wav" : "recording.m4a");
  if (blob.size > MAX_MEDIA_BYTES) throw new Error("录音超过 50MB，请缩短后重试");
  return {
    id: crypto.randomUUID(),
    kind: "audio",
    blob,
    mimeType,
    name: mimeType === "audio/wav" ? "录音.wav" : "录音.m4a",
    previewUrl: URL.createObjectURL(blob),
    capture: { durationMs: Math.max(1, Math.round(durationMs)) },
  };
}

export function disposeDraftMedia(media: DraftMedia): void {
  URL.revokeObjectURL(media.previewUrl);
}

export async function uploadMedia(media: DraftMedia): Promise<string> {
  const ticket = await requestJson<UploadTicket>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ mimeType: media.mimeType, bytes: media.blob.size }),
  });

  const upload = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": media.mimeType },
    body: media.blob,
  });
  if (!upload.ok) throw new Error(`附件上传失败（${upload.status}）`);

  await requestJson(`/api/uploads/${encodeURIComponent(ticket.mediaId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ capture: media.capture }),
  });

  return ticket.mediaId;
}

export async function resolveMediaUrl(mediaId: string): Promise<string> {
  const result = await requestJson<{ url: string }>(`/api/media/${encodeURIComponent(mediaId)}/url`);
  return result.url;
}

export type MediaMime = { mimeType: string; mediaType: "audio" | "image"; extension: string };

const supported: Record<string, MediaMime> = {
  "audio/mp4": { mimeType: "audio/mp4", mediaType: "audio", extension: ".m4a" },
  "audio/mpeg": { mimeType: "audio/mpeg", mediaType: "audio", extension: ".mp3" },
  "audio/wav": { mimeType: "audio/wav", mediaType: "audio", extension: ".wav" },
  "image/jpeg": { mimeType: "image/jpeg", mediaType: "image", extension: ".jpg" },
  "image/png": { mimeType: "image/png", mediaType: "image", extension: ".png" },
  "image/webp": { mimeType: "image/webp", mediaType: "image", extension: ".webp" },
};

export function normalizeMimeType(value: string | undefined | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

export function mediaMime(value: string | undefined | null) {
  const mimeType = normalizeMimeType(value);
  return mimeType ? supported[mimeType] ?? null : null;
}

export function mediaObjectKey(userId: string, mediaId: string, extension: string, createdAt = new Date()) {
  return `users/${userId}/media/${yearMonth(createdAt)}/${mediaId}${extension}`;
}

export function taskObjectKey(userId: string, workerSessionId: string, filename: string, completedAt = new Date()) {
  return `users/${userId}/task/${yearMonth(completedAt)}/${workerSessionId}/${filename}`;
}

function yearMonth(value: Date): string {
  return value.toISOString().slice(0, 7);
}

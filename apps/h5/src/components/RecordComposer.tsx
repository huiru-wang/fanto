import { ArrowUp, CalendarDays, ImagePlus, Mic, Music2, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createDraftMedia,
  createRecordedDraft,
  disposeDraftMedia,
  uploadMedia,
  type DraftMedia,
} from "../api/media";
import { createRecord, type RecordItem } from "../api/records";
import { startAudioRecording, type AudioRecordingSession } from "../lib/audio-recorder";

function localDateTimeValue(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function durationText(milliseconds: number | undefined) {
  if (!milliseconds) return "";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecordComposer({ onCreated }: { onCreated: (record: RecordItem) => void }) {
  const [text, setText] = useState("");
  const [eventAt, setEventAt] = useState(() => localDateTimeValue());
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const recordingRef = useRef<AudioRecordingSession | null>(null);
  const recordingStartedAtRef = useRef(0);
  const uploadedIdsRef = useRef(new Map<string, string>());
  const mediaRef = useRef(media);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => () => {
    for (const item of mediaRef.current) disposeDraftMedia(item);
    void recordingRef.current?.stop().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const available = 4 - media.length;
    if (available <= 0) {
      setError("一条记录最多添加 4 个附件");
      return;
    }

    const selected = [...files].slice(0, available);
    if (files.length > available) setError(`最多还能添加 ${available} 个附件`);
    else setError(null);

    try {
      const drafts = await Promise.all(selected.map(createDraftMedia));
      setMedia(current => [...current, ...drafts]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "附件读取失败");
    }
  };

  const removeMedia = (id: string) => {
    setMedia(current => {
      const target = current.find(item => item.id === id);
      if (target) disposeDraftMedia(target);
      return current.filter(item => item.id !== id);
    });
    uploadedIdsRef.current.delete(id);
  };

  const startRecording = async () => {
    if (media.length >= 4) {
      setError("一条记录最多添加 4 个附件");
      return;
    }
    try {
      setError(null);
      recordingRef.current = await startAudioRecording();
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法开始录音");
    }
  };

  const stopRecording = async () => {
    const session = recordingRef.current;
    if (!session) return;
    recordingRef.current = null;
    setRecording(false);
    try {
      const result = await session.stop();
      const draft = createRecordedDraft(result.blob, result.durationMs);
      setMedia(current => [...current, draft]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "录音没有保存成功");
    }
  };

  const submit = async () => {
    if (saving) return;
    const value = text.trim();
    const hasAudio = media.some(item => item.kind === "audio");
    if (!value && !hasAudio) {
      setError(media.length ? "只有图片时，请补充一点文字" : "写点文字，或者添加一段语音");
      return;
    }
    if (!eventAt || Number.isNaN(new Date(eventAt).getTime())) {
      setError("请选择有效的发生时间");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const mediaIds: string[] = [];
      for (let index = 0; index < media.length; index += 1) {
        const item = media[index]!;
        let mediaId = uploadedIdsRef.current.get(item.id);
        if (!mediaId) {
          setUploadProgress(`正在上传 ${index + 1}/${media.length}`);
          mediaId = await uploadMedia(item);
          uploadedIdsRef.current.set(item.id, mediaId);
        }
        mediaIds.push(mediaId);
      }

      setUploadProgress("正在保存");
      const record = await createRecord({
        text: value,
        mediaIds,
        eventAt: new Date(eventAt).toISOString(),
      });

      onCreated(record);
      for (const item of media) disposeDraftMedia(item);
      uploadedIdsRef.current.clear();
      setMedia([]);
      setText("");
      setEventAt(localDateTimeValue());
      setUploadProgress("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "记录没有保存成功");
    } finally {
      setSaving(false);
      setUploadProgress("");
    }
  };

  const canSave = !!text.trim() || media.some(item => item.kind === "audio");

  return (
    <section className="record-composer panel">
      <textarea
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder="此刻想到什么？"
        rows={4}
        maxLength={20_000}
        onKeyDown={event => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
        }}
      />

      {media.length > 0 && (
        <div className="draft-media-list">
          {media.map(item => (
            <div className={`draft-media ${item.kind}`} key={item.id}>
              {item.kind === "image" ? (
                <img src={item.previewUrl} alt={item.name} />
              ) : (
                <div className="draft-audio">
                  <audio controls preload="metadata" src={item.previewUrl} />
                  <span>{item.name}{item.capture.durationMs ? ` · ${durationText(item.capture.durationMs)}` : ""}</span>
                </div>
              )}
              <button
                type="button"
                className="media-remove"
                onClick={() => removeMedia(item.id)}
                aria-label="移除附件"
                disabled={saving}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="composer-error">{error}</div>}

      <div className="composer-actions">
        <div className="media-actions">
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={event => {
              void addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={audioInputRef}
            className="visually-hidden"
            type="file"
            accept="audio/mp4,audio/mpeg,audio/wav,.m4a,.mp3,.wav"
            multiple
            onChange={event => {
              void addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />

          <button type="button" className="composer-tool" onClick={() => imageInputRef.current?.click()} disabled={saving || media.length >= 4}>
            <ImagePlus size={17} />
            <span>图片</span>
          </button>
          <button type="button" className="composer-tool" onClick={() => audioInputRef.current?.click()} disabled={saving || media.length >= 4}>
            <Music2 size={17} />
            <span>音频</span>
          </button>
          <button
            type="button"
            className={`composer-tool ${recording ? "recording" : ""}`}
            onClick={recording ? () => void stopRecording() : () => void startRecording()}
            disabled={saving || (!recording && media.length >= 4)}
          >
            {recording ? <Square size={14} fill="currentColor" /> : <Mic size={17} />}
            <span>{recording ? `停止 ${durationText(recordingSeconds * 1000)}` : "录音"}</span>
          </button>

          <label className="composer-date">
            <CalendarDays size={16} />
            <input
              type="datetime-local"
              value={eventAt}
              onChange={event => setEventAt(event.target.value)}
              disabled={saving}
              aria-label="发生时间"
            />
          </label>
        </div>

        <div className="composer-save">
          <span className="composer-hint">{saving ? uploadProgress : `${media.length}/4 附件`}</span>
          <button className="send-button" disabled={!canSave || saving || recording} onClick={() => void submit()}>
            {saving ? <span className="button-loading" /> : <ArrowUp size={18} />}
            <span>{saving ? "保存中" : "记录"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

export type RecordedAudio = {
  blob: Blob;
  durationMs: number;
};

export type AudioRecordingSession = {
  stop: () => Promise<RecordedAudio>;
};

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function startMediaRecorder(stream: MediaStream): AudioRecordingSession {
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();
  const recorder = new MediaRecorder(stream, { mimeType: "audio/mp4" });
  recorder.ondataavailable = event => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.start(1000);

  return {
    stop: () => new Promise((resolve, reject) => {
      recorder.onerror = () => {
        stopTracks(stream);
        reject(new Error("录音失败"));
      };
      recorder.onstop = () => {
        stopTracks(stream);
        resolve({
          blob: new Blob(chunks, { type: "audio/mp4" }),
          durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        });
      };
      recorder.stop();
    }),
  };
}

function encodeWav(chunks: Float32Array[], sampleRate: number, sampleCount: number): Blob {
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function startWavRecorder(stream: MediaStream): Promise<AudioRecordingSession> {
  const AudioContextClass = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    stopTracks(stream);
    throw new Error("当前浏览器不支持录音");
  }

  const context = new AudioContextClass();
  if (context.state === "suspended") await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;

  const chunks: Float32Array[] = [];
  let sampleCount = 0;
  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input);
    chunks.push(copy);
    sampleCount += copy.length;
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) throw new Error("录音已经结束");
      stopped = true;
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      mute.disconnect();
      stopTracks(stream);
      await context.close();

      const durationMs = sampleCount > 0 ? (sampleCount / context.sampleRate) * 1000 : 1;
      return {
        blob: encodeWav(chunks, context.sampleRate, sampleCount),
        durationMs,
      };
    },
  };
}

export async function startAudioRecording(): Promise<AudioRecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器无法访问麦克风");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/mp4")) {
    return startMediaRecorder(stream);
  }
  return await startWavRecorder(stream);
}

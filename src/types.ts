export type TranscriptSegment = {
  id: string;
  recordingId: string;
  speakerId: string;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  createdAt: string;
};

export type RecordingMetadata = {
  id: string;
  filePath: string;
  startedAt: string;
  stoppedAt?: string;
  durationMs: number;
};

export type ModelStatus = 'missing' | 'downloading' | 'extracting' | 'ready' | 'failed';

export type ModelDownloadProgress = {
  status: ModelStatus;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  message?: string;
};

export type PcmChunk = {
  samples: Float32Array | number[];
  sampleRate: number;
  timestampMs: number;
};

export type SpeakerAssignment = {
  speakerId: string;
  confidence: number;
};

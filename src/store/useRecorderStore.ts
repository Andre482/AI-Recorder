import { create } from 'zustand';
import { modelManager } from '../services/ModelManager';
import { recorderService } from '../services/RecorderService';
import { databaseService } from '../services/DatabaseService';
import type {
  ModelDownloadProgress,
  RecordingMetadata,
  TranscriptSegment,
} from '../types';

type RecorderState = {
  recording: RecordingMetadata | null;
  isRecording: boolean;
  liveTranscription: boolean;
  modelPath: string | null;
  modelProgress: ModelDownloadProgress;
  transcripts: TranscriptSegment[];
  error: string | null;
  initialize: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleLiveTranscription: (enabled: boolean) => Promise<void>;
  downloadOfflineModel: () => Promise<void>;
  refreshTranscripts: () => void;
};

export const useRecorderStore = create<RecorderState>((set, get) => ({
  recording: null,
  isRecording: false,
  liveTranscription: false,
  modelPath: null,
  modelProgress: {
    status: 'missing',
    percent: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
  },
  transcripts: [],
  error: null,

  initialize: async () => {
    databaseService.initialize();
    modelManager.subscribe(progress => set({ modelProgress: progress }));
    recorderService.subscribe(recording =>
      set({ recording, isRecording: Boolean(recording) })
    );
    const status = await modelManager.refreshParakeetStatus();
    set({
      modelPath: status.status === 'ready' ? status.modelPath : null,
      transcripts: databaseService.listRecentSegments().reverse(),
    });
  },

  startRecording: async () => {
    try {
      await recorderService.startRecording();
      set({ error: null });
    } catch (error) {
      set({ error: toMessage(error) });
      throw error;
    }
  },

  stopRecording: async () => {
    try {
      await recorderService.stopRecording();
      set({ liveTranscription: false, error: null });
      get().refreshTranscripts();
    } catch (error) {
      set({ error: toMessage(error) });
      throw error;
    }
  },

  toggleLiveTranscription: async enabled => {
    try {
      if (enabled) {
        const modelPath =
          get().modelPath ?? (await modelManager.getParakeetModelPath());
        if (!(await modelManager.isParakeetReady(modelPath))) {
          throw new Error('Download the offline model before live transcription');
        }
        await recorderService.enableLiveTranscription(modelPath);
      } else {
        await recorderService.disableLiveTranscription();
      }

      set({ liveTranscription: enabled, error: null });
    } catch (error) {
      set({ liveTranscription: false, error: toMessage(error) });
      throw error;
    }
  },

  downloadOfflineModel: async () => {
    try {
      const modelPath = await modelManager.downloadParakeetModel();
      set({ modelPath, error: null });
    } catch (error) {
      set({ error: toMessage(error) });
      throw error;
    }
  },

  refreshTranscripts: () => {
    set({ transcripts: databaseService.listRecentSegments().reverse() });
  },
}));

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

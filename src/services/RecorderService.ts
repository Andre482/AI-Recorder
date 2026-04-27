import {
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import AudioRecorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  type AudioSet,
} from 'react-native-audio-recorder-player';
import BackgroundService from 'react-native-background-actions';
import * as RNFS from 'react-native-fs';
import type { EmitterSubscription } from 'react-native';
import type { PcmChunk, RecordingMetadata } from '../types';
import { aiProcessor } from './AIProcessor';
import { databaseService } from './DatabaseService';

type AudioPcmRecorderNative = {
  start(path: string, sampleRate: number): Promise<string>;
  stop(): Promise<string>;
  isRunning(): Promise<boolean>;
};

type PcmChunkPayload = {
  base64Pcm16: string;
  sampleRate: number;
  timestampMs: number;
};

type RecorderListener = (recording: RecordingMetadata | null) => void;

const SAMPLE_RATE = 16000;
const RECORDINGS_DIR = `${RNFS.DocumentDirectoryPath}/recordings`;
const nativePcmRecorder =
  NativeModules.AudioPcmRecorder as AudioPcmRecorderNative | undefined;

class RecorderService {
  private activeRecording: RecordingMetadata | null = null;
  private listeners = new Set<RecorderListener>();
  private pcmSubscription: EmitterSubscription | null = null;
  private useNativePcm = Boolean(nativePcmRecorder);

  subscribe(listener: RecorderListener) {
    this.listeners.add(listener);
    listener(this.activeRecording);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getCurrentRecording() {
    return this.activeRecording;
  }

  async startRecording() {
    databaseService.initialize();
    await this.ensurePermissions();
    await this.ensureDir(RECORDINGS_DIR);

    const now = new Date();
    const id = `rec-${now.getTime()}`;
    const filePath = `${RECORDINGS_DIR}/${id}.wav`;

    this.activeRecording = {
      id,
      filePath,
      startedAt: now.toISOString(),
      durationMs: 0,
    };
    databaseService.saveRecording(this.activeRecording);
    this.emit();

    await this.startBackgroundTask();
    this.attachPcmListener();

    if (this.useNativePcm && nativePcmRecorder) {
      await nativePcmRecorder.start(filePath, SAMPLE_RATE);
    } else {
      await this.startFallbackRecorder(filePath);
    }

    return this.activeRecording;
  }

  async stopRecording() {
    const recording = this.activeRecording;
    if (!recording) {
      return null;
    }

    if (this.useNativePcm && nativePcmRecorder) {
      await nativePcmRecorder.stop();
    } else {
      await AudioRecorderPlayer.stopRecorder();
      AudioRecorderPlayer.removeRecordBackListener();
    }

    this.detachPcmListener();
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }

    await aiProcessor.stop();

    const stoppedAt = new Date();
    const completed: RecordingMetadata = {
      ...recording,
      stoppedAt: stoppedAt.toISOString(),
      durationMs: stoppedAt.getTime() - new Date(recording.startedAt).getTime(),
    };
    this.activeRecording = completed;
    databaseService.saveRecording(completed);
    this.emit();
    this.activeRecording = null;
    this.emit();

    return completed;
  }

  async enableLiveTranscription(modelPath: string) {
    const recording = this.activeRecording;
    if (!recording) {
      throw new Error('Start recording before enabling live transcription');
    }

    await aiProcessor.start({
      modelPath,
      recordingId: recording.id,
      sampleRate: SAMPLE_RATE,
      numThreads: 4,
      onSegment: segment => {
        databaseService.saveTranscriptSegment(segment);
      },
    });
  }

  async disableLiveTranscription() {
    await aiProcessor.stop();
  }

  private attachPcmListener() {
    if (this.pcmSubscription) {
      return;
    }

    this.pcmSubscription = DeviceEventEmitter.addListener(
      'AudioPcmChunk',
      (payload: PcmChunkPayload) => {
        const chunk: PcmChunk = {
          samples: this.decodePcm16(payload.base64Pcm16),
          sampleRate: payload.sampleRate,
          timestampMs: payload.timestampMs,
        };

        if (aiProcessor.isActive()) {
          aiProcessor
            .acceptWaveform(chunk.samples, chunk.sampleRate, chunk.timestampMs)
            .catch(() => {
              // Errors are reported through AIProcessor callbacks.
            });
        }
      }
    );
  }

  private detachPcmListener() {
    this.pcmSubscription?.remove();
    this.pcmSubscription = null;
  }

  private async startFallbackRecorder(filePath: string) {
    const audioSet: AudioSet = {
      AudioSourceAndroid: AudioSourceAndroidType.VOICE_RECOGNITION,
      OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
      AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
      AudioSamplingRate: SAMPLE_RATE,
      AudioChannels: 1,
      AudioEncodingBitRate: 128000,
    };

    AudioRecorderPlayer.setSubscriptionDuration(0.25);
    await AudioRecorderPlayer.startRecorder(filePath, audioSet, true);
  }

  private async startBackgroundTask() {
    if (BackgroundService.isRunning()) {
      return;
    }

    await BackgroundService.start(
      async () => {
        while (BackgroundService.isRunning()) {
          await new Promise<void>(resolve => setTimeout(resolve, 1000));
        }
      },
      {
        taskName: 'AIRecorder',
        taskTitle: 'AI Recorder is recording',
        taskDesc: 'Capturing audio locally on this tablet',
        taskIcon: {
          name: 'ic_launcher',
          type: 'mipmap',
        },
        foregroundServiceType: ['microphone'],
      }
    );
  }

  private async ensurePermissions() {
    if (Platform.OS !== 'android') {
      return;
    }

    const permissions = [
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    ].filter(Boolean);

    const result = await PermissionsAndroid.requestMultiple(permissions);
    const audioGranted =
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED;

    if (!audioGranted) {
      throw new Error('Microphone permission is required for offline recording');
    }
  }

  private decodePcm16(base64: string) {
    const atob = (globalThis as unknown as { atob: (input: string) => string })
      .atob;
    const binary = atob(base64);
    const samples = new Float32Array(binary.length / 2);

    for (let offset = 0; offset < binary.length; offset += 2) {
      const low = binary.charCodeAt(offset);
      const high = binary.charCodeAt(offset + 1);
      const signed = high * 256 + low;
      const value = signed >= 0x8000 ? signed - 0x10000 : signed;
      samples[offset / 2] = value / 32768;
    }

    return samples;
  }

  private async ensureDir(path: string) {
    if (!(await RNFS.exists(path))) {
      await RNFS.mkdir(path);
    }
  }

  private emit() {
    this.listeners.forEach(listener => listener(this.activeRecording));
  }
}

export const recorderService = new RecorderService();

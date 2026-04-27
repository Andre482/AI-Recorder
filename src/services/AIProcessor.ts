import {
  createSTT,
  createStreamingSTT,
  type SttEngine,
  type StreamingSttEngine,
  type SttStream,
} from 'react-native-sherpa-onnx/stt';
import { fileModelPath } from 'react-native-sherpa-onnx';
import type { TranscriptSegment } from '../types';
import { speakerDiarizationService } from './SpeakerDiarizationService';

export type AIProcessorMode = 'streaming' | 'chunked-offline';

export type AIProcessorOptions = {
  modelPath: string;
  recordingId: string;
  sampleRate?: number;
  numThreads?: number;
  onSegment?: (segment: TranscriptSegment) => void;
  onStatus?: (message: string) => void;
  onError?: (error: Error) => void;
};

const DEFAULT_SAMPLE_RATE = 16000;
const OFFLINE_WINDOW_MS = 8000;

class AIProcessor {
  private streamingEngine: StreamingSttEngine | null = null;
  private stream: SttStream | null = null;
  private offlineEngine: SttEngine | null = null;
  private options: AIProcessorOptions | null = null;
  private mode: AIProcessorMode | null = null;
  private active = false;
  private processing = false;
  private offlineBuffer: number[] = [];
  private offlineWindowStartMs = 0;
  private lastPartialText = '';

  async start(options: AIProcessorOptions) {
    if (this.active) {
      await this.stop();
    }

    this.options = {
      ...options,
      sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
      numThreads: options.numThreads ?? 4,
    };

    await speakerDiarizationService.initialize();
    speakerDiarizationService.reset();

    try {
      await this.startStreamingRecognizer();
      this.mode = 'streaming';
      this.active = true;
      this.options.onStatus?.('Live streaming ASR is running');
      return;
    } catch (error) {
      this.options.onStatus?.(
        `Streaming recognizer unavailable for this model, using chunked offline ASR: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    this.offlineEngine = await createSTT({
      modelPath: fileModelPath(this.options.modelPath),
      modelType: 'nemo_transducer',
      preferInt8: true,
      numThreads: this.options.numThreads,
      provider: 'cpu',
      debug: false,
    });
    this.mode = 'chunked-offline';
    this.active = true;
    this.options.onStatus?.('Chunked offline Parakeet ASR is running');
  }

  async stop() {
    this.active = false;
    await this.flush();

    if (this.stream) {
      await this.stream.release();
      this.stream = null;
    }

    if (this.streamingEngine) {
      await this.streamingEngine.destroy();
      this.streamingEngine = null;
    }

    if (this.offlineEngine) {
      await this.offlineEngine.destroy();
      this.offlineEngine = null;
    }

    this.mode = null;
    this.options = null;
    this.processing = false;
    this.offlineBuffer = [];
    this.lastPartialText = '';
  }

  isActive() {
    return this.active;
  }

  getMode() {
    return this.mode;
  }

  async acceptWaveform(
    samples: Float32Array | number[],
    sampleRate = this.options?.sampleRate ?? DEFAULT_SAMPLE_RATE,
    timestampMs = Date.now()
  ) {
    if (!this.active || !this.options) {
      return;
    }

    if (this.mode === 'streaming' && this.stream) {
      await this.processStreamingChunk(samples, sampleRate, timestampMs);
      return;
    }

    this.processOfflineChunk(samples, sampleRate, timestampMs);
  }

  async flush() {
    if (!this.options || this.offlineBuffer.length === 0 || !this.offlineEngine) {
      return;
    }

    const samples = this.offlineBuffer;
    const startMs = this.offlineWindowStartMs;
    this.offlineBuffer = [];
    await this.transcribeOfflineWindow(samples, startMs, true);
  }

  private async startStreamingRecognizer() {
    if (!this.options) {
      throw new Error('AIProcessor options are missing');
    }

    this.streamingEngine = await createStreamingSTT({
      modelPath: fileModelPath(this.options.modelPath),
      modelType: 'auto',
      enableEndpoint: true,
      decodingMethod: 'greedy_search',
      numThreads: this.options.numThreads,
      provider: 'cpu',
      enableInputNormalization: false,
      endpointConfig: {
        rule1: {
          mustContainNonSilence: false,
          minTrailingSilence: 2.4,
          minUtteranceLength: 0,
        },
        rule2: {
          mustContainNonSilence: true,
          minTrailingSilence: 1.2,
          minUtteranceLength: 0,
        },
        rule3: {
          mustContainNonSilence: false,
          minTrailingSilence: 0,
          minUtteranceLength: 20,
        },
      },
    });
    this.stream = await this.streamingEngine.createStream();
  }

  private async processStreamingChunk(
    samples: Float32Array | number[],
    sampleRate: number,
    timestampMs: number
  ) {
    if (!this.stream || !this.options) {
      return;
    }

    try {
      const { result, isEndpoint } = await this.stream.processAudioChunk(
        samples,
        sampleRate
      );
      const text = result.text.trim();

      if (text.length > 0 && text !== this.lastPartialText) {
        this.emitSegment(samples, text, timestampMs, false);
        this.lastPartialText = text;
      }

      if (isEndpoint) {
        if (text.length > 0) {
          this.emitSegment(samples, text, timestampMs, true);
        }
        await this.stream.reset();
        this.lastPartialText = '';
      }
    } catch (error) {
      this.options.onError?.(this.toError(error));
    }
  }

  private processOfflineChunk(
    samples: Float32Array | number[],
    sampleRate: number,
    timestampMs: number
  ) {
    if (!this.options) {
      return;
    }

    if (this.offlineBuffer.length === 0) {
      this.offlineWindowStartMs = timestampMs;
    }

    this.offlineBuffer.push(...Array.from(samples));
    const targetSamples = Math.round((sampleRate * OFFLINE_WINDOW_MS) / 1000);

    if (this.offlineBuffer.length >= targetSamples && !this.processing) {
      const window = this.offlineBuffer.splice(0, targetSamples);
      const startMs = this.offlineWindowStartMs;
      this.offlineWindowStartMs = timestampMs;
      this.transcribeOfflineWindow(window, startMs, true).catch(error => {
        this.options?.onError?.(this.toError(error));
      });
    }
  }

  private async transcribeOfflineWindow(
    samples: number[],
    startMs: number,
    isFinal: boolean
  ) {
    if (!this.offlineEngine || !this.options || samples.length === 0) {
      return;
    }

    this.processing = true;
    try {
      const result = await this.offlineEngine.transcribeSamples(
        samples,
        this.options.sampleRate ?? DEFAULT_SAMPLE_RATE
      );
      const text = result.text.trim();

      if (text.length > 0) {
        this.emitSegment(samples, text, startMs, isFinal);
      }
    } catch (error) {
      this.options.onError?.(this.toError(error));
    } finally {
      this.processing = false;
    }
  }

  private emitSegment(
    samples: Float32Array | number[],
    text: string,
    startMs: number,
    isFinal: boolean
  ) {
    if (!this.options) {
      return;
    }

    const speaker = speakerDiarizationService.assignSpeaker(samples);
    const durationMs = Math.round(
      (samples.length / (this.options.sampleRate ?? DEFAULT_SAMPLE_RATE)) * 1000
    );

    this.options.onSegment?.({
      id: `${this.options.recordingId}-${startMs}-${isFinal ? 'final' : 'partial'}`,
      recordingId: this.options.recordingId,
      speakerId: speaker.speakerId,
      text,
      startMs,
      endMs: startMs + durationMs,
      isFinal,
      createdAt: new Date().toISOString(),
    });
  }

  private toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export const aiProcessor = new AIProcessor();

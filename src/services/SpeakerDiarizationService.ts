import * as RNFS from 'react-native-fs';
import { DIARIZATION_MODEL, MODEL_ROOT_DIR_NAME } from '../constants/models';
import type { SpeakerAssignment } from '../types';

type SpeakerFingerprint = {
  speakerId: string;
  energy: number;
};

class SpeakerDiarizationService {
  private fingerprints: SpeakerFingerprint[] = [];
  private initialized = false;

  async initialize() {
    const modelPath = `${RNFS.DocumentDirectoryPath}/${MODEL_ROOT_DIR_NAME}/${DIARIZATION_MODEL.id}`;
    const hasNativeModel = await RNFS.exists(
      `${modelPath}/${DIARIZATION_MODEL.requiredFiles[0]}`
    );

    // The installed RN sherpa diarization module is a placeholder today. Keep
    // this service boundary so a native diarizer can replace the heuristic here.
    this.initialized = hasNativeModel;
  }

  reset() {
    this.fingerprints = [];
  }

  assignSpeaker(samples: number[] | Float32Array): SpeakerAssignment {
    const energy = this.calculateEnergy(samples);

    if (this.fingerprints.length === 0) {
      return this.addSpeaker(energy);
    }

    const nearest = this.fingerprints.reduce((best, current) => {
      const currentDistance = Math.abs(current.energy - energy);
      const bestDistance = Math.abs(best.energy - energy);
      return currentDistance < bestDistance ? current : best;
    });

    const distance = Math.abs(nearest.energy - energy);
    if (distance > 0.08 && this.fingerprints.length < 6) {
      return this.addSpeaker(energy);
    }

    nearest.energy = nearest.energy * 0.85 + energy * 0.15;

    return {
      speakerId: nearest.speakerId,
      confidence: this.initialized ? 0.65 : Math.max(0.25, 1 - distance),
    };
  }

  private addSpeaker(energy: number): SpeakerAssignment {
    const speakerId = `Speaker ${this.fingerprints.length + 1}`;
    this.fingerprints.push({ speakerId, energy });

    return {
      speakerId,
      confidence: this.initialized ? 0.65 : 0.35,
    };
  }

  private calculateEnergy(samples: number[] | Float32Array) {
    if (samples.length === 0) {
      return 0;
    }

    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] ?? 0;
      sum += sample * sample;
    }

    return Math.sqrt(sum / samples.length);
  }
}

export const speakerDiarizationService = new SpeakerDiarizationService();

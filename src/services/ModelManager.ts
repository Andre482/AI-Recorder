import * as RNFS from 'react-native-fs';
import { extractArchive } from 'react-native-sherpa-onnx/extraction';
import { PARAKEET_MODEL, MODEL_ROOT_DIR_NAME } from '../constants/models';
import type { ModelDownloadProgress, ModelStatus } from '../types';
import { databaseService } from './DatabaseService';

type ProgressListener = (progress: ModelDownloadProgress) => void;

const emptyProgress: ModelDownloadProgress = {
  status: 'missing',
  percent: 0,
  bytesDownloaded: 0,
  totalBytes: 0,
};

class ModelManager {
  private listeners = new Set<ProgressListener>();
  private currentProgress = emptyProgress;

  subscribe(listener: ProgressListener) {
    this.listeners.add(listener);
    listener(this.currentProgress);

    return () => {
      this.listeners.delete(listener);
    };
  }

  async getModelRoot() {
    const root = `${RNFS.DocumentDirectoryPath}/${MODEL_ROOT_DIR_NAME}`;
    await this.ensureDir(root);
    return root;
  }

  async getParakeetModelPath() {
    const root = await this.getModelRoot();
    return `${root}/${PARAKEET_MODEL.id}`;
  }

  async refreshParakeetStatus() {
    databaseService.initialize();
    const modelPath = await this.getParakeetModelPath();
    const ready = await this.isParakeetReady(modelPath);
    const status: ModelStatus = ready ? 'ready' : 'missing';

    this.emit({
      status,
      percent: ready ? 100 : 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      message: ready ? 'Offline model ready' : 'Offline model not downloaded',
    });

    if (ready) {
      databaseService.saveModelStatus(PARAKEET_MODEL.id, modelPath, 'ready');
    }

    return { status, modelPath };
  }

  async downloadParakeetModel() {
    databaseService.initialize();
    const root = await this.getModelRoot();
    const archivePath = `${root}/${PARAKEET_MODEL.archiveFile}`;
    const modelPath = await this.getParakeetModelPath();

    if (await this.isParakeetReady(modelPath)) {
      this.emit({
        status: 'ready',
        percent: 100,
        bytesDownloaded: 0,
        totalBytes: 0,
        message: 'Offline model already installed',
      });
      return modelPath;
    }

    await this.ensureDir(root);
    await this.safeUnlink(archivePath);

    this.emit({
      status: 'downloading',
      percent: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      message: `Downloading ${PARAKEET_MODEL.displayName}`,
    });

    const download = RNFS.downloadFile({
      fromUrl: PARAKEET_MODEL.downloadUrl,
      toFile: archivePath,
      progressInterval: 1000,
      readTimeout: 120000,
      connectionTimeout: 30000,
      progress: event => {
        const totalBytes = Math.max(event.contentLength, 0);
        const percent =
          totalBytes > 0 ? Math.round((event.bytesWritten / totalBytes) * 70) : 0;
        this.emit({
          status: 'downloading',
          percent,
          bytesDownloaded: event.bytesWritten,
          totalBytes,
          message: 'Downloading offline model archive',
        });
      },
    });

    const result = await download.promise;
    if (result.statusCode < 200 || result.statusCode >= 300) {
      this.emitFailure(`Download failed with HTTP ${result.statusCode}`);
      throw new Error(`Model download failed with HTTP ${result.statusCode}`);
    }

    this.emit({
      status: 'extracting',
      percent: 70,
      bytesDownloaded: result.bytesWritten,
      totalBytes: result.bytesWritten,
      message: 'Extracting offline model',
    });

    const extraction = await extractArchive(
      {
        modelId: PARAKEET_MODEL.id,
        archivePath,
        format: PARAKEET_MODEL.archiveFormat,
        fileSize: result.bytesWritten,
      },
      root,
      {
        force: true,
        notificationTitle: 'Preparing offline model',
        notificationText: PARAKEET_MODEL.displayName,
        onProgress: event => {
          const percent = 70 + Math.round((event.percent / 100) * 30);
          this.emit({
            status: 'extracting',
            percent,
            bytesDownloaded: event.bytes,
            totalBytes: event.totalBytes,
            message: 'Extracting offline model',
          });
        },
      }
    );

    if (!extraction.success) {
      this.emitFailure(extraction.reason ?? 'Model extraction failed');
      throw new Error(extraction.reason ?? 'Model extraction failed');
    }

    if (!(await this.isParakeetReady(modelPath))) {
      this.emitFailure('Extracted archive is missing required Parakeet files');
      throw new Error('Extracted archive is missing required Parakeet files');
    }

    await this.safeUnlink(archivePath);
    databaseService.saveModelStatus(PARAKEET_MODEL.id, modelPath, 'ready');
    this.emit({
      status: 'ready',
      percent: 100,
      bytesDownloaded: result.bytesWritten,
      totalBytes: result.bytesWritten,
      message: 'Offline model ready',
    });

    return modelPath;
  }

  async isParakeetReady(modelPath?: string) {
    const path = modelPath ?? (await this.getParakeetModelPath());
    const checks = await Promise.all(
      PARAKEET_MODEL.requiredFiles.map(file => RNFS.exists(`${path}/${file}`))
    );
    return checks.every(Boolean);
  }

  private async ensureDir(path: string) {
    if (!(await RNFS.exists(path))) {
      await RNFS.mkdir(path);
    }
  }

  private async safeUnlink(path: string) {
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
  }

  private emit(progress: ModelDownloadProgress) {
    this.currentProgress = progress;
    this.listeners.forEach(listener => listener(progress));
  }

  private emitFailure(message: string) {
    this.emit({
      status: 'failed',
      percent: this.currentProgress.percent,
      bytesDownloaded: this.currentProgress.bytesDownloaded,
      totalBytes: this.currentProgress.totalBytes,
      message,
    });
  }
}

export const modelManager = new ModelManager();

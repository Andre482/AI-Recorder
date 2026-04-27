export const MODEL_ROOT_DIR_NAME = 'models';

export const PARAKEET_MODEL = {
  id: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  displayName: 'NVIDIA Parakeet TDT 0.6B INT8',
  archiveFile: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
  archiveFormat: 'tar.bz2' as const,
  downloadUrl:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2',
  requiredFiles: [
    'encoder.int8.onnx',
    'decoder.int8.onnx',
    'joiner.int8.onnx',
    'tokens.txt',
  ],
};

export const DIARIZATION_MODEL = {
  id: 'sherpa-onnx-pyannote-segmentation-3-0',
  displayName: 'Sherpa-ONNX Diarization Placeholder',
  requiredFiles: ['segmentation.onnx'],
};

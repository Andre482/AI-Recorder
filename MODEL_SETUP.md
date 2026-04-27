# Offline Model Setup

The app supports two model locations.

## Bundled Android Assets

Small demo models or configs can be packaged in:

```text
android/app/src/main/assets/models/
```

Android includes this folder in the APK/AAB. Sherpa-ONNX can load bundled files with an asset model path, for example `models/my-model`, when the React Native binding supports asset loading.

Bundling the full Parakeet 0.6B archive is not recommended for normal APK installs because it is large. Use Play Asset Delivery if you want Google Play to deliver large model packs at install time.

## In-App Download

The `Offline model` button downloads:

```text
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2
```

The archive is stored temporarily in the app documents folder, extracted into:

```text
DocumentDirectoryPath/models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/
```

`AIProcessor.ts` then loads the extracted directory by absolute filesystem path. Once the model is present, ASR runs offline and no cloud API is used.

Required Parakeet files:

```text
encoder.int8.onnx
decoder.int8.onnx
joiner.int8.onnx
tokens.txt
```

## Diarization Note

The current `react-native-sherpa-onnx` package exposes diarization as a placeholder. The app keeps speaker assignment behind `src/services/SpeakerDiarizationService.ts` so a native sherpa diarization binding can be dropped in later without changing the UI, recorder, or database schema.

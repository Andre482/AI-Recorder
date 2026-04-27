/**
 * react-native-audio-recorder-player 4.x ships generated Kotlin that calls
 * HybridObject.updateNative(...), but react-native-nitro-modules 0.35.x no
 * longer exposes that API. Patch the generated file after install so Android
 * builds can compile on CI.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-audio-recorder-player',
  'nitrogen',
  'generated',
  'android',
  'kotlin',
  'com',
  'margelo',
  'nitro',
  'audiorecorderplayer',
  'HybridAudioRecorderPlayerSpec.kt',
);

if (!fs.existsSync(target)) {
  console.warn(
    'patch-audio-recorder-player-kotlin: skip (generated Kotlin file not found)',
  );
  process.exit(0);
}

const before = `
  init {
    super.updateNative(mHybridData)
  }

  override fun updateNative(hybridData: HybridData) {
    mHybridData = hybridData
    super.updateNative(hybridData)
  }
`;

const after = `
  // react-native-nitro-modules 0.35.x removed HybridObject.updateNative(...).
  // Keeping only the HybridData field preserves the generated wiring.
`;

let content = fs.readFileSync(target, 'utf8');
if (!content.includes('super.updateNative(mHybridData)')) {
  process.exit(0);
}
if (!content.includes(before)) {
  console.warn(
    'patch-audio-recorder-player-kotlin: expected block not found, skipping:',
    target,
  );
  process.exit(0);
}

content = content.replace(before, after);
fs.writeFileSync(target, content, 'utf8');
console.log(
  'patch-audio-recorder-player-kotlin: removed obsolete updateNative override',
);

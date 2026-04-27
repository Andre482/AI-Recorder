/**
 * React Native 0.85's @react-native/gradle-plugin ships foojay-resolver-convention@0.5.0,
 * which references JvmVendorSpec.IBM_SEMERU — removed in Gradle 9, causing
 * "Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field ... IBM_SEMERU".
 * Bump to 1.0.0+ after every npm install. Remove when the bundled plugin is updated.
 * @see https://github.com/gradle/foojay-toolchains/issues/105
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native',
  'gradle-plugin',
  'settings.gradle.kts',
);

if (!fs.existsSync(target)) {
  console.warn('patch-foojay-resolver: skip (gradle-plugin not installed yet)');
  process.exit(0);
}

const before =
  'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0") }';
const after =
  'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0") }';

let content = fs.readFileSync(target, 'utf8');
if (content.includes('version("1.0.0")')) {
  process.exit(0);
}
if (!content.includes(before)) {
  console.warn(
    'patch-foojay-resolver: expected line not found; @react-native/gradle-plugin may have been updated. Check:',
    target,
  );
  process.exit(0);
}

content = content.replace(before, after);
fs.writeFileSync(target, content, 'utf8');
console.log('patch-foojay-resolver: bumped foojay-resolver-convention to 1.0.0');

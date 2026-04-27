import { useEffect } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useRecorderStore } from './src/store/useRecorderStore';
import type { TranscriptSegment } from './src/types';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const {
    initialize,
    startRecording,
    stopRecording,
    toggleLiveTranscription,
    downloadOfflineModel,
    refreshTranscripts,
    isRecording,
    liveTranscription,
    modelProgress,
    transcripts,
    recording,
    error,
  } = useRecorderStore();

  useEffect(() => {
    initialize().catch(caughtError => {
      Alert.alert('Startup error', toMessage(caughtError));
    });
  }, [initialize]);

  useEffect(() => {
    const interval = setInterval(refreshTranscripts, 1000);
    return () => clearInterval(interval);
  }, [refreshTranscripts]);

  const handleRecordPress = async () => {
    try {
      if (isRecording) {
        await stopRecording();
      } else {
        await startRecording();
      }
    } catch (caughtError) {
      Alert.alert('Recorder error', toMessage(caughtError));
    }
  };

  const handleLiveToggle = async (enabled: boolean) => {
    try {
      await toggleLiveTranscription(enabled);
    } catch (caughtError) {
      Alert.alert('Live transcription', toMessage(caughtError));
    }
  };

  const handleModelDownload = async () => {
    try {
      await downloadOfflineModel();
    } catch (caughtError) {
      Alert.alert('Offline model', toMessage(caughtError));
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: safeAreaInsets.top + 16,
          paddingBottom: safeAreaInsets.bottom + 16,
          paddingLeft: safeAreaInsets.left + 20,
          paddingRight: safeAreaInsets.right + 20,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Offline Voice Recorder</Text>
        <Text style={styles.subtitle}>Xiaomi Pad 7 local ASR and recording</Text>
      </View>

      <View style={[styles.content, isWide && styles.contentWide]}>
        <View style={[styles.panel, isWide && styles.controlsPanel]}>
          <Text style={styles.sectionTitle}>Recorder</Text>
          <Pressable
            style={[styles.primaryButton, isRecording && styles.stopButton]}
            onPress={handleRecordPress}
          >
            <Text style={styles.primaryButtonText}>
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </Text>
          </Pressable>

          <View style={styles.row}>
            <View>
              <Text style={styles.label}>Live Transcription</Text>
              <Text style={styles.helpText}>
                AI stops when disabled; recording continues.
              </Text>
            </View>
            <Switch
              value={liveTranscription}
              disabled={!isRecording || modelProgress.status !== 'ready'}
              onValueChange={handleLiveToggle}
            />
          </View>

          <Pressable
            style={[
              styles.secondaryButton,
              modelProgress.status === 'downloading' && styles.disabledButton,
            ]}
            disabled={
              modelProgress.status === 'downloading' ||
              modelProgress.status === 'extracting'
            }
            onPress={handleModelDownload}
          >
            <Text style={styles.secondaryButtonText}>Offline model</Text>
          </Pressable>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(0, modelProgress.percent)}%` },
              ]}
            />
          </View>
          <Text style={styles.statusText}>
            {modelProgress.message ?? modelProgress.status} (
            {modelProgress.percent}%)
          </Text>
          <Text style={styles.helpText}>
            {formatBytes(modelProgress.bytesDownloaded)} /{' '}
            {formatBytes(modelProgress.totalBytes)}
          </Text>

          {recording ? (
            <Text style={styles.fileText}>Saving WAV: {recording.filePath}</Text>
          ) : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={[styles.panel, styles.transcriptPanel]}>
          <Text style={styles.sectionTitle}>Live Transcript</Text>
          <FlatList
            data={transcripts}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.transcriptList}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                Start recording, download the offline model, then enable live
                transcription.
              </Text>
            }
            renderItem={({ item }) => <TranscriptRow segment={item} />}
          />
        </View>
      </View>
    </View>
  );
}

function TranscriptRow({ segment }: { segment: TranscriptSegment }) {
  return (
    <View style={styles.segment}>
      <Text style={styles.speaker}>{segment.speakerId}</Text>
      <Text style={styles.segmentText}>{segment.text}</Text>
      <Text style={styles.timeText}>
        {formatTime(segment.startMs)} - {formatTime(segment.endMs)}
      </Text>
    </View>
  );
}

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101418',
  },
  header: {
    marginBottom: 16,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 16,
    marginTop: 4,
  },
  content: {
    flex: 1,
    gap: 16,
  },
  contentWide: {
    flexDirection: 'row',
  },
  panel: {
    backgroundColor: '#171D24',
    borderColor: '#263241',
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
  },
  controlsPanel: {
    width: 360,
  },
  transcriptPanel: {
    flex: 1,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 18,
    paddingVertical: 18,
  },
  stopButton: {
    backgroundColor: '#DC2626',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
    borderRadius: 16,
    marginTop: 20,
    paddingVertical: 14,
  },
  disabledButton: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    borderBottomColor: '#263241',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingBottom: 20,
  },
  label: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
  },
  helpText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },
  progressTrack: {
    backgroundColor: '#263241',
    borderRadius: 999,
    height: 10,
    marginTop: 20,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: '#22C55E',
    height: '100%',
  },
  statusText: {
    color: '#E5E7EB',
    fontSize: 14,
    marginTop: 10,
  },
  fileText: {
    color: '#93C5FD',
    fontSize: 12,
    marginTop: 18,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    marginTop: 16,
  },
  transcriptList: {
    gap: 12,
    paddingBottom: 16,
  },
  segment: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 16,
  },
  speaker: {
    color: '#60A5FA',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  segmentText: {
    color: '#F8FAFC',
    fontSize: 17,
    lineHeight: 24,
  },
  timeText: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 10,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 16,
    lineHeight: 24,
  },
});

export default App;

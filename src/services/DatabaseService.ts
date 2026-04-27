import { open, type QuickSQLiteConnection } from 'react-native-quick-sqlite';
import type { RecordingMetadata, TranscriptSegment } from '../types';

const DB_NAME = 'offline_voice_recorder.db';

class DatabaseService {
  private db: QuickSQLiteConnection | null = null;

  initialize() {
    if (this.db) {
      return;
    }

    this.db = open({ name: DB_NAME });
    this.db.executeBatch([
      [
        `CREATE TABLE IF NOT EXISTS recordings (
          id TEXT PRIMARY KEY NOT NULL,
          file_path TEXT NOT NULL,
          started_at TEXT NOT NULL,
          stopped_at TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0
        );`,
      ],
      [
        `CREATE TABLE IF NOT EXISTS transcript_segments (
          id TEXT PRIMARY KEY NOT NULL,
          recording_id TEXT NOT NULL,
          speaker_id TEXT NOT NULL,
          text TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          is_final INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(recording_id) REFERENCES recordings(id)
        );`,
      ],
      [
        `CREATE TABLE IF NOT EXISTS model_metadata (
          model_id TEXT PRIMARY KEY NOT NULL,
          local_path TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
      ],
    ]);
  }

  saveRecording(recording: RecordingMetadata) {
    const db = this.getDb();
    db.execute(
      `INSERT OR REPLACE INTO recordings
        (id, file_path, started_at, stopped_at, duration_ms)
       VALUES (?, ?, ?, ?, ?);`,
      [
        recording.id,
        recording.filePath,
        recording.startedAt,
        recording.stoppedAt ?? null,
        recording.durationMs,
      ]
    );
  }

  saveTranscriptSegment(segment: TranscriptSegment) {
    const db = this.getDb();
    db.execute(
      `INSERT OR REPLACE INTO transcript_segments
        (id, recording_id, speaker_id, text, start_ms, end_ms, is_final, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        segment.id,
        segment.recordingId,
        segment.speakerId,
        segment.text,
        segment.startMs,
        segment.endMs,
        segment.isFinal ? 1 : 0,
        segment.createdAt,
      ]
    );
  }

  saveModelStatus(modelId: string, localPath: string, status: string) {
    const db = this.getDb();
    db.execute(
      `INSERT OR REPLACE INTO model_metadata
        (model_id, local_path, status, updated_at)
       VALUES (?, ?, ?, ?);`,
      [modelId, localPath, status, new Date().toISOString()]
    );
  }

  getModel(modelId: string): { localPath: string; status: string } | null {
    const db = this.getDb();
    const result = db.execute(
      'SELECT local_path, status FROM model_metadata WHERE model_id = ? LIMIT 1;',
      [modelId]
    );
    const row = result.rows?.item(0);

    if (!row) {
      return null;
    }

    return {
      localPath: row.local_path,
      status: row.status,
    };
  }

  listRecentSegments(limit = 100): TranscriptSegment[] {
    const db = this.getDb();
    const result = db.execute(
      `SELECT id, recording_id, speaker_id, text, start_ms, end_ms, is_final, created_at
       FROM transcript_segments
       ORDER BY created_at DESC
       LIMIT ?;`,
      [limit]
    );

    return (result.rows?._array ?? []).map(row => ({
      id: row.id,
      recordingId: row.recording_id,
      speakerId: row.speaker_id,
      text: row.text,
      startMs: row.start_ms,
      endMs: row.end_ms,
      isFinal: row.is_final === 1,
      createdAt: row.created_at,
    }));
  }

  private getDb() {
    if (!this.db) {
      this.initialize();
    }

    return this.db as QuickSQLiteConnection;
  }
}

export const databaseService = new DatabaseService();

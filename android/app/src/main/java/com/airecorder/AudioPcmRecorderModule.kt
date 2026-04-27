package com.airecorder

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.max

class AudioPcmRecorderModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private val isRecording = AtomicBoolean(false)
  private var recorder: AudioRecord? = null
  private var worker: Thread? = null
  private var wavFile: RandomAccessFile? = null
  private var outputPath: String? = null
  private var currentSampleRate = 16000
  private var bytesWritten = 0L

  override fun getName(): String = "AudioPcmRecorder"

  @ReactMethod
  fun start(path: String, sampleRate: Int, promise: Promise) {
    if (isRecording.get()) {
      promise.resolve(outputPath)
      return
    }

    if (
      reactContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("E_RECORD_AUDIO_PERMISSION", "RECORD_AUDIO permission is not granted")
      return
    }

    try {
      val channelConfig = AudioFormat.CHANNEL_IN_MONO
      val audioFormat = AudioFormat.ENCODING_PCM_16BIT
      val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
      val bufferSize = max(minBuffer, sampleRate)
      val file = File(path)
      file.parentFile?.mkdirs()

      outputPath = path
      currentSampleRate = sampleRate
      bytesWritten = 0L
      wavFile = RandomAccessFile(file, "rw").apply {
        setLength(0)
        writeWavHeader(this, sampleRate, 1, 16, 0)
      }
      recorder = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        sampleRate,
        channelConfig,
        audioFormat,
        bufferSize
      )

      isRecording.set(true)
      recorder?.startRecording()
      worker = thread(name = "AudioPcmRecorder-${UUID.randomUUID()}") {
        recordLoop(bufferSize, sampleRate)
      }
      promise.resolve(path)
    } catch (error: Exception) {
      cleanup()
      promise.reject("E_AUDIO_RECORD_START", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    if (!isRecording.get()) {
      promise.resolve(outputPath)
      return
    }

    isRecording.set(false)
    worker?.join(1500)
    cleanup()
    promise.resolve(outputPath)
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(isRecording.get())
  }

  private fun recordLoop(bufferSize: Int, sampleRate: Int) {
    val localRecorder = recorder ?: return
    val buffer = ShortArray(bufferSize / 2)

    while (isRecording.get()) {
      val read = localRecorder.read(buffer, 0, buffer.size)
      if (read <= 0) {
        continue
      }

      val pcmBytes = ShortArray(read)
      System.arraycopy(buffer, 0, pcmBytes, 0, read)
      writePcmBytes(pcmBytes)
      emitChunk(pcmBytes, sampleRate)
    }
  }

  private fun writePcmBytes(samples: ShortArray) {
    val bytes = ByteArray(samples.size * 2)
    samples.forEachIndexed { index, sample ->
      bytes[index * 2] = (sample.toInt() and 0xFF).toByte()
      bytes[index * 2 + 1] = ((sample.toInt() shr 8) and 0xFF).toByte()
    }

    wavFile?.write(bytes)
    bytesWritten += bytes.size.toLong()
  }

  private fun emitChunk(samples: ShortArray, sampleRate: Int) {
    val bytes = ByteArray(samples.size * 2)
    samples.forEachIndexed { index, sample ->
      bytes[index * 2] = (sample.toInt() and 0xFF).toByte()
      bytes[index * 2 + 1] = ((sample.toInt() shr 8) and 0xFF).toByte()
    }

    val payload = Arguments.createMap().apply {
      putString("base64Pcm16", Base64.encodeToString(bytes, Base64.NO_WRAP))
      putInt("sampleRate", sampleRate)
      putDouble("timestampMs", System.currentTimeMillis().toDouble())
    }

    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("AudioPcmChunk", payload)
  }

  private fun cleanup() {
    try {
      recorder?.stop()
    } catch (_: Exception) {
    }
    recorder?.release()
    recorder = null
    worker = null

    wavFile?.let { file ->
      try {
        writeWavHeader(file, currentSampleRate, 1, 16, bytesWritten)
      } catch (_: Exception) {
      }
      file.close()
    }
    wavFile = null
  }

  private fun writeWavHeader(
    file: RandomAccessFile,
    sampleRate: Int,
    channels: Int,
    bitsPerSample: Int,
    dataSize: Long
  ) {
    val byteRate = sampleRate * channels * bitsPerSample / 8
    file.seek(0)
    file.writeBytes("RIFF")
    writeIntLE(file, (36 + dataSize).toInt())
    file.writeBytes("WAVE")
    file.writeBytes("fmt ")
    writeIntLE(file, 16)
    writeShortLE(file, 1)
    writeShortLE(file, channels)
    writeIntLE(file, sampleRate)
    writeIntLE(file, byteRate)
    writeShortLE(file, channels * bitsPerSample / 8)
    writeShortLE(file, bitsPerSample)
    file.writeBytes("data")
    writeIntLE(file, dataSize.toInt())
  }

  private fun writeIntLE(file: RandomAccessFile, value: Int) {
    file.write(value and 0xFF)
    file.write((value shr 8) and 0xFF)
    file.write((value shr 16) and 0xFF)
    file.write((value shr 24) and 0xFF)
  }

  private fun writeShortLE(file: RandomAccessFile, value: Int) {
    file.write(value and 0xFF)
    file.write((value shr 8) and 0xFF)
  }
}

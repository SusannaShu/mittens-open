/**
 * CaptureDetailModal -- Full-screen detail view for a pendant capture.
 *
 * Shows the full image (zoomable), plays audio, and displays the brain response.
 * Opened when tapping a capture card in the Pendant Feed.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { PendantCapture } from '../../lib/services/pendant/pendantStore';
import PipelineLogBubble from '../chat/PipelineLogBubble';
import PhaseDebugTrace from './PhaseDebugTrace';

interface Props {
  capture: PendantCapture | null;
  visible: boolean;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CaptureDetailModal({ capture, visible, onClose }: Props) {
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const soundRef = useRef<any>(null);

  // Cleanup audio on close
  useEffect(() => {
    if (!visible && soundRef.current) {
      try {
        soundRef.current.unloadAsync();
      } catch { }
      soundRef.current = null;
      setAudioPlaying(false);
    }
  }, [visible]);

  const playAudio = useCallback(async () => {
    if (!capture?.audioPath) return;

    try {
      const { Audio } = require('expo-av');

      // Stop if already playing
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
        setAudioPlaying(false);
        return;
      }

      // PCM16 16kHz mono needs a WAV header to play via expo-av
      // Create a temporary WAV file from the raw PCM
      const FileSystem = require('expo-file-system/legacy');
      const pcmPath = capture.audioPath.startsWith('file://')
        ? capture.audioPath.replace('file://', '')
        : capture.audioPath;

      const pcmBase64 = await FileSystem.readAsStringAsync(
        pcmPath.startsWith('/') ? pcmPath : `file://${pcmPath}`,
        { encoding: FileSystem.EncodingType.Base64 }
      );

      // Decode base64 to binary string
      const pcmBinaryString = atob(pcmBase64);
      const dataLen = pcmBinaryString.length;

      // Build WAV header (44 bytes)
      const sampleRate = 16000;
      const channels = 1;
      const bitsPerSample = 16;
      const byteRate = sampleRate * channels * (bitsPerSample / 8);
      const blockAlign = channels * (bitsPerSample / 8);
      const fileSize = 36 + dataLen;

      const header = new Uint8Array(44);
      const view = new DataView(header.buffer);

      // RIFF header
      header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
      view.setUint32(4, fileSize, true);
      header.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

      // fmt chunk
      header.set([0x66, 0x6D, 0x74, 0x20], 12); // "fmt "
      view.setUint32(16, 16, true); // chunk size
      view.setUint16(20, 1, true);  // PCM format
      view.setUint16(22, channels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);

      // data chunk
      header.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
      view.setUint32(40, dataLen, true);

      // Create combined binary string
      let combinedBinary = '';
      for (let i = 0; i < header.length; i++) {
        combinedBinary += String.fromCharCode(header[i]);
      }
      combinedBinary += pcmBinaryString;

      // Encode the combined binary to base64
      const wavBase64 = btoa(combinedBinary);
      const wavPath = pcmPath.replace('.pcm', '_play.wav');
      await FileSystem.writeAsStringAsync(
        wavPath.startsWith('/') ? wavPath : `file://${wavPath}`,
        wavBase64,
        { encoding: FileSystem.EncodingType.Base64 }
      );

      // Play the WAV
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: wavPath.startsWith('/') ? `file://${wavPath}` : wavPath },
        { shouldPlay: true }
      );

      soundRef.current = sound;
      setAudioPlaying(true);

      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          setAudioPlaying(false);
          soundRef.current = null;
        }
      });
    } catch (err: any) {
      console.error('[CaptureDetail] Audio playback error:', err?.message);
      setAudioPlaying(false);
    }
  }, [capture?.audioPath]);

  if (!capture) return null;

  const isAudio = capture.type === 'BUTTON_PRESS';
  const hasFrame = !!capture.framePath;
  const hasAudio = !!capture.audioPath;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isAudio ? 'Voice Capture' : 'Vision Capture'}
          </Text>
          <View style={styles.closeBtnPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Timestamp */}
          <Text style={styles.timestamp}>
            {formatTimestamp(capture.timestamp)}
          </Text>

          {/* Full Image */}
          {hasFrame && (
            <View style={styles.imageContainer}>
              {imageLoading && (
                <ActivityIndicator
                  style={styles.imageLoader}
                  size="small"
                  color={colors.textMuted}
                />
              )}
              <Image
                source={{ uri: `file://${capture.framePath}` }}
                style={styles.fullImage}
                resizeMode="contain"
                onLoadEnd={() => setImageLoading(false)}
              />
            </View>
          )}

          {/* Audio Player */}
          {hasAudio && (
            <TouchableOpacity
              style={styles.audioPlayer}
              onPress={playAudio}
              activeOpacity={0.7}
            >
              <View style={styles.playButton}>
                <Feather
                  name={audioPlaying ? 'pause' : 'play'}
                  size={20}
                  color="#FFF"
                />
              </View>
              <View style={styles.audioInfo}>
                <Text style={styles.audioLabel}>
                  {audioPlaying ? 'Playing...' : 'Voice Recording'}
                </Text>
                <Text style={styles.audioDuration}>5s PCM 16kHz mono</Text>
              </View>
              <View style={styles.audioWaveform}>
                {[3, 5, 8, 12, 7, 10, 6, 9, 4, 7, 11, 5, 8, 6].map((h, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      { height: h * 2 },
                      audioPlaying && { backgroundColor: colors.accent },
                    ]}
                  />
                ))}
              </View>
            </TouchableOpacity>
          )}

          {/* Brain Response */}
          {capture.brainResponse ? (
            <View style={styles.responseSection}>
              <Text style={styles.sectionLabel}>Mittens Response</Text>
              <Text style={styles.responseText}>{capture.brainResponse}</Text>
            </View>
          ) : (
            <View style={styles.responseSection}>
              <Text style={styles.sectionLabel}>Status</Text>
              <Text style={styles.pendingText}>
                {capture.processed
                  ? 'No response generated'
                  : 'Waiting for brain processing...'}
              </Text>
            </View>
          )}

          {/* Pipeline Log (Visual Debugging) */}
          {capture.pipelineLog && (
            <View style={{ paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
              <PipelineLogBubble log={capture.pipelineLog} />
            </View>
          )}

          {/* Phase Debug Trace (expandable I/O per phase) */}
          {capture.pipelineLog?.phases?.length > 0 && (
            <PhaseDebugTrace log={capture.pipelineLog} />
          )}

          {/* Metadata */}
          <View style={styles.metaSection}>
            <Text style={styles.sectionLabel}>Details</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Type</Text>
              <Text style={styles.metaValue}>
                {isAudio ? 'Button Press (voice + photo)' : 'Motion (photo only)'}
              </Text>
            </View>
            {hasFrame && (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Frame</Text>
                <Text style={styles.metaValue}>
                  {capture.framePath?.split('/').pop()}
                </Text>
              </View>
            )}
            {hasAudio && (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Audio</Text>
                <Text style={styles.metaValue}>
                  {capture.audioPath?.split('/').pop()}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  closeBtnPlaceholder: {
    width: 30,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  timestamp: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  imageContainer: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#111',
    marginBottom: spacing.md,
  },
  imageLoader: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
    zIndex: 1,
  },
  fullImage: {
    width: SCREEN_WIDTH - spacing.lg * 2,
    height: (SCREEN_WIDTH - spacing.lg * 2) * 0.75, // 4:3
    borderRadius: radius.md,
  },
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: {
    flex: 1,
    gap: 2,
  },
  audioLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  audioDuration: {
    fontSize: 11,
    color: colors.textMuted,
  },
  audioWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 24,
  },
  waveBar: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.textMuted,
  },
  responseSection: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  responseText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  pendingText: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  metaSection: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaKey: {
    fontSize: 12,
    color: colors.textMuted,
  },
  metaValue: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
});

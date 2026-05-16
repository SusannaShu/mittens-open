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
import { IdentifyPersonSheet } from './IdentifyPersonSheet';
import { getAllEmbeddings } from '../../lib/services/faceRecognition/faceRecognitionApi';
import { cosineSimilarity } from '../../lib/services/faceRecognition/faceRecognitionService';

interface DetectedFace {
  id: string;
  embedding: number[];
  confidence: number;
  boundingBox: any;
  cropUri: string;
  name: string | null;
}

interface Props {
  capture: PendantCapture | null;
  visible: boolean;
  onClose: () => void;
  onRetry?: (capture: PendantCapture) => void;
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

export function CaptureDetailModal({ capture, visible, onClose, onRetry }: Props) {
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<DetectedFace[]>([]);
  const [identifyingFace, setIdentifyingFace] = useState<DetectedFace | null>(null);
  const soundRef = useRef<any>(null);

  // Clear detected faces when capture changes or modal closes
  useEffect(() => {
    if (!visible) {
      setDetectedFaces([]);
      setIdentifyingFace(null);
    }
  }, [visible, capture?.id]);

  // Run face detection if brain response indicates a person
  useEffect(() => {
    let isMounted = true;
    async function loadFaces() {
      if (!capture?.framePath) return;
      const br = capture.brainResponse || '';
      if (!br.includes('person') && !br.includes('people') && !br.includes('Recognized')) {
        return; // No faces mentioned
      }

      try {
        const { getFaceRecognitionModule } = require('../../modules/expo-face-recognition/src');
        const mod = getFaceRecognitionModule();
        if (!mod) return;

        const faces = await mod.detectFaces(capture.framePath);
        if (!faces || faces.length === 0) return;

        const { Image } = require('react-native');
        const ImageManipulator = require('expo-image-manipulator');
        const photoUri = `file://${capture.framePath}`;

        const { width: imgW, height: imgH } = await new Promise<{width: number, height: number}>((resolve, reject) => {
          Image.getSize(photoUri, (w: number, h: number) => resolve({ width: w, height: h }), reject);
        });

        const knownEmbeddings = getAllEmbeddings();

        const processed: DetectedFace[] = [];
        for (let i = 0; i < faces.length; i++) {
          const face = faces[i];
          
          let bestName: string | null = null;
          let bestSim = 0;
          for (const ke of knownEmbeddings) {
            const sim = cosineSimilarity(face.embedding, ke.embedding);
            if (sim > bestSim) {
              bestSim = sim;
              if (sim >= 0.80) { // MATCH_THRESHOLD
                bestName = ke.personName;
              }
            }
          }

          const bbox = face.boundingBox;
          const rectX = bbox.x * imgW;
          const rectY = (1.0 - (bbox.y + bbox.height)) * imgH;
          const rectW = bbox.width * imgW;
          const rectH = bbox.height * imgH;

          const margin = Math.max(rectW, rectH) * 0.3;
          const cropX = Math.max(0, rectX - margin);
          const cropY = Math.max(0, rectY - margin);
          const cropW = Math.min(imgW - cropX, rectW + margin * 2);
          const cropH = Math.min(imgH - cropY, rectH + margin * 2);

          const cx = cropX + cropW / 2;
          const cy = cropY + cropH / 2;
          let sqSize = Math.max(cropW, cropH);

          if (cx - sqSize / 2 < 0) sqSize = cx * 2;
          if (cy - sqSize / 2 < 0) sqSize = cy * 2;
          if (cx + sqSize / 2 > imgW) sqSize = (imgW - cx) * 2;
          if (cy + sqSize / 2 > imgH) sqSize = (imgH - cy) * 2;

          const finalX = Math.max(0, cx - sqSize / 2);
          const finalY = Math.max(0, cy - sqSize / 2);

          const manipResult = await ImageManipulator.manipulateAsync(
            photoUri,
            [{ crop: { originX: finalX, originY: finalY, width: sqSize, height: sqSize } }],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 }
          );

          processed.push({
            id: `face_${i}`,
            embedding: face.embedding,
            confidence: face.confidence,
            boundingBox: face.boundingBox,
            cropUri: manipResult.uri,
            name: bestName,
          });
        }

        if (isMounted) {
          setDetectedFaces(processed);
        }
      } catch (e) {
        console.warn('[CaptureDetail] Face crop failed:', e);
      }
    }

    if (visible) {
      loadFaces();
    }

    return () => {
      isMounted = false;
    };
  }, [capture?.framePath, capture?.brainResponse, visible]);

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

      // PCM16 8kHz mono needs a WAV header to play via expo-av
      let playUri = capture.audioPath;
      if (playUri.endsWith('.pcm')) {
        const { convertPcmToWav } = require('../../lib/utils/wavConverter');
        playUri = await convertPcmToWav(playUri);
      } else if (!playUri.startsWith('file://') && !playUri.startsWith('http')) {
        playUri = `file://${playUri}`;
      }

      // Play the audio
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: playUri },
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
                <Text style={styles.audioDuration}>PCM 8kHz mono</Text>
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
              {capture.brainResponse.startsWith('Brain offline:') && onRetry && (
                <TouchableOpacity
                  style={[styles.retryBtn, retrying && styles.retryBtnDisabled]}
                  onPress={() => {
                    if (retrying) return;
                    setRetrying(true);
                    onRetry(capture);
                    setTimeout(() => setRetrying(false), 3000);
                  }}
                  activeOpacity={0.7}
                  disabled={retrying}
                >
                  <Feather
                    name={retrying ? 'loader' : 'refresh-cw'}
                    size={14}
                    color="#D97706"
                  />
                  <Text style={styles.retryBtnText}>
                    {retrying ? 'Retrying...' : 'Try Again'}
                  </Text>
                </TouchableOpacity>
              )}
              
              {detectedFaces.length > 0 && (
                <View style={styles.facesSection}>
                  <Text style={styles.facesLabel}>People in frame</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {detectedFaces.map(face => (
                      <View key={face.id} style={styles.faceCard}>
                        <Image source={{ uri: face.cropUri }} style={styles.faceCropImage} />
                        {face.name ? (
                          <View style={styles.faceIdentified}>
                            <Feather name="check" size={10} color="#10B981" />
                            <Text style={styles.faceNameText} numberOfLines={1}>{face.name}</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={styles.identifyBtn}
                            onPress={() => setIdentifyingFace(face)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.identifyBtnText}>Identify</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
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
      
      {identifyingFace && (
        <IdentifyPersonSheet
          face={identifyingFace}
          onClose={() => setIdentifyingFace(null)}
          onIdentified={(name) => {
            // Update local state to reflect the new name
            setDetectedFaces(prev => prev.map(f => f.id === identifyingFace.id ? { ...f, name } : f));
            setIdentifyingFace(null);
          }}
        />
      )}
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
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#D97706',
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
  },
  retryBtnDisabled: {
    opacity: 0.5,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
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
  facesSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  facesLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  faceCard: {
    alignItems: 'center',
    marginRight: spacing.md,
    width: 64,
  },
  faceCropImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  identifyBtn: {
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  identifyBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  faceIdentified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: radius.sm,
  },
  faceNameText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#10B981',
  },
});

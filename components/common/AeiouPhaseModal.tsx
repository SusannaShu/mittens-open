import React, { useState } from 'react';
import {
  View, Text, Modal, Image, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';

interface AeiouPhaseResult {
  dimension: 'A' | 'E' | 'I' | 'O' | 'U';
  timestamp: number;
  value: string;
  confidence: number;
  framePath?: string;
}

interface Props {
  visible: boolean;
  phase: AeiouPhaseResult | null;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DIMENSION_LABELS: Record<string, string> = {
  A: 'Activity',
  E: 'Environment',
  I: 'Interactions',
  O: 'Objects',
  U: 'Users / Feeling',
};

export default function AeiouPhaseModal({ visible, phase, onClose }: Props) {
  const [imageLoading, setImageLoading] = useState(true);

  if (!phase) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Phase Detection</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.detailRow}>
              <Text style={styles.label}>Dimension</Text>
              <Text style={styles.value}>{DIMENSION_LABELS[phase.dimension] || phase.dimension}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.label}>Detected Value</Text>
              <Text style={styles.valueHighlight}>{phase.value}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.label}>Confidence</Text>
              <Text style={styles.value}>{(phase.confidence * 100).toFixed(1)}%</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.label}>Timestamp</Text>
              <Text style={styles.value}>
                {new Date(phase.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
            </View>

            {phase.framePath && (
              <View style={styles.imageContainer}>
                <Text style={styles.label}>Vision Capture</Text>
                <View style={styles.imageWrap}>
                  {imageLoading && (
                    <ActivityIndicator size="small" color={colors.textMuted} style={styles.loader} />
                  )}
                  <Image
                    source={{ uri: `file://${phase.framePath}` }}
                    style={styles.image}
                    resizeMode="cover"
                    onLoadEnd={() => setImageLoading(false)}
                  />
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  valueHighlight: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.accent,
  },
  imageContainer: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  imageWrap: {
    width: '100%',
    height: (SCREEN_WIDTH - spacing.lg * 2) * 0.75, // 4:3 ratio
    backgroundColor: '#111',
    borderRadius: radius.md,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loader: {
    position: 'absolute',
    zIndex: 1,
  },
});

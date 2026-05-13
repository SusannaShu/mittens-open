import React, { useState } from 'react';
import {
  View, Text, Modal, Image, StyleSheet, TouchableOpacity, Dimensions, ActivityIndicator, ScrollView
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';

interface AeiouPhaseResult {
  dimension: 'A' | 'E' | 'I' | 'O' | 'U' | string;
  timestamp: number;
  value: string;
  confidence: number;
  framePath?: string;
  phaseName?: string;
  before?: string;
  after?: string;
}

interface Props {
  visible: boolean;
  dimension: string;
  timeline: AeiouPhaseResult[];
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DIMENSION_LABELS: Record<string, string> = {
  activity: 'Activity',
  environment: 'Environment',
  interactions: 'Interactions',
  objects: 'Objects',
  users: 'Users / Feeling',
};

export default function AEIOUProcessModal({ visible, dimension, timeline, onClose }: Props) {
  if (!visible || !dimension || !timeline) return null;

  const relevantPhases = timeline
    .filter(p => p.dimension.toLowerCase() === dimension.toLowerCase())
    .sort((a, b) => a.timestamp - b.timestamp);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{(DIMENSION_LABELS[dimension] || dimension).toUpperCase()} TIMELINE</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
            {relevantPhases.length === 0 ? (
              <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
                No automated timeline events found.
              </Text>
            ) : (
              relevantPhases.map((phase, idx) => (
                <View key={idx} style={styles.timelineItem}>
                  <View style={styles.timelineLine} />
                  
                  <View style={styles.timelineHeader}>
                    <Text style={styles.timestamp}>
                      {new Date(phase.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {phase.confidence > 0 && (
                      <Text style={styles.confidence}>
                        (conf: {(phase.confidence * 100).toFixed(0)}%)
                      </Text>
                    )}
                  </View>

                  <View style={styles.timelineCard}>
                    {phase.framePath && (
                      <Image
                        source={{ uri: `file://${phase.framePath}` }}
                        style={styles.thumbnail}
                        resizeMode="cover"
                      />
                    )}
                    <View style={styles.timelineBody}>
                      <Text style={styles.valueHighlight}>
                        {phase.after || phase.value}
                      </Text>
                      {phase.before && phase.after && phase.before !== phase.after && (
                        <Text style={styles.valueTransition}>
                          Changed from: {phase.before}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
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
    maxHeight: '90%',
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
  },
  timelineItem: {
    marginBottom: spacing.xl,
    paddingLeft: spacing.xl,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 8,
    top: 6,
    bottom: -spacing.xl,
    width: 2,
    backgroundColor: colors.border,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  timestamp: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    backgroundColor: colors.bg,
    position: 'absolute',
    left: -spacing.xl - 4, // pull out to cover line
    paddingRight: 8,
  },
  confidence: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 60,
  },
  timelineCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.md,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: '#111',
  },
  timelineBody: {
    flex: 1,
    justifyContent: 'center',
  },
  valueHighlight: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  valueTransition: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
});

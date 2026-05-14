/**
 * LocationTimelineModal -- Full-screen timeline of all pendant observations
 * during a location session.
 *
 * Shows triage decisions, phase detections, frame photos, voice transcripts,
 * and Mittens responses/nudges in chronological order.
 */

import React, { useMemo } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity,
  ScrollView, Image, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { LocationSession } from '../../lib/services/location/locationSessionApi';
import { getTodayCaptures, type PendantCapture } from '../../lib/services/pendant/pendantStore';
import { getDb } from '../../lib/database';

interface Props {
  visible: boolean;
  session: LocationSession | null;
  title: string;
  onClose: () => void;
}

interface TimelineRow {
  timestamp: number;
  timeStr: string;
  type: 'capture' | 'activity' | 'scene';
  classification?: string;
  framePath?: string;
  transcript?: string;
  brainResponse?: string;
  phases?: string[];
  aeiou?: Record<string, string>;
  duration_min?: number;
}

const SCENE_COLORS: Record<string, string> = {
  work: '#4A90D9', social: '#E74C8B', rest: '#8E8E93',
  exercise: '#34C759', eating: '#FF9500', commute: '#AF52DE',
  cooking: '#FF6B35', reading: '#5856D6', meditation: '#30B0C7',
  scrolling: '#FF3B30', unknown: '#C7C7CC',
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

export default function LocationTimelineModal({ visible, session, title, onClose }: Props) {
  const rows = useMemo(() => {
    if (!session) return [];
    return buildTimelineRows(session);
  }, [session]);

  if (!session) return null;

  const startTime = new Date(session.startedAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const endTime = session.endedAt
    ? new Date(session.endedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'now';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{title}</Text>
              <Text style={styles.headerTime}>{startTime} - {endTime}</Text>
            </View>
            <TouchableOpacity onPress={onClose} activeOpacity={0.6}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Timeline */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {rows.length === 0 && (
              <Text style={styles.emptyText}>No observations recorded during this session.</Text>
            )}

            {rows.map((row, idx) => (
              <View key={`${row.timestamp}-${idx}`} style={styles.row}>
                {/* Timeline connector line */}
                <View style={styles.connectorCol}>
                  <View style={[styles.dot, { backgroundColor: SCENE_COLORS[row.classification || ''] || '#C7C7CC' }]} />
                  {idx < rows.length - 1 && <View style={styles.connector} />}
                </View>

                {/* Content */}
                <View style={styles.rowContent}>
                  {/* Time + classification */}
                  <View style={styles.rowHeader}>
                    <Text style={styles.timeText}>{row.timeStr}</Text>
                    {row.classification && (
                      <View style={[styles.badge, { backgroundColor: SCENE_COLORS[row.classification] || '#E5E5EA' }]}>
                        <Text style={styles.badgeText}>{row.classification}</Text>
                      </View>
                    )}
                    {row.duration_min != null && row.duration_min > 0 && (
                      <Text style={styles.durationText}>{row.duration_min}min</Text>
                    )}
                  </View>

                  {/* Frame photo */}
                  {row.framePath && (
                    <Image
                      source={{ uri: row.framePath.startsWith('/') ? `file://${row.framePath}` : row.framePath }}
                      style={styles.frameImage}
                    />
                  )}

                  {/* Voice transcript */}
                  {row.transcript && (
                    <View style={styles.transcriptRow}>
                      <Feather name="mic" size={12} color={colors.textSecondary} />
                      <Text style={styles.transcriptText}>"{row.transcript}"</Text>
                    </View>
                  )}

                  {/* Mittens response / nudge */}
                  {row.brainResponse && (
                    <View style={styles.responseRow}>
                      <Feather name="message-circle" size={12} color={colors.textSecondary} />
                      <Text style={styles.responseText}>{row.brainResponse}</Text>
                    </View>
                  )}

                  {/* Pipeline phases */}
                  {row.phases && row.phases.length > 0 && (
                    <View style={styles.phaseRow}>
                      {row.phases.map((phase) => (
                        <View key={phase} style={styles.phaseChip}>
                          <Text style={styles.phaseChipText}>{phase}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* AEIOU extract */}
                  {row.aeiou && Object.keys(row.aeiou).length > 0 && (
                    <View style={styles.aeiouRow}>
                      {Object.entries(row.aeiou).map(([key, val]) => (
                        val ? (
                          <Text key={key} style={styles.aeiouText}>
                            {key.charAt(0).toUpperCase()}: {val}
                          </Text>
                        ) : null
                      ))}
                    </View>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Build timeline rows from all available data sources.
 */
function buildTimelineRows(session: LocationSession): TimelineRow[] {
  const startMs = new Date(session.startedAt).getTime();
  const endMs = session.endedAt ? new Date(session.endedAt).getTime() : Date.now();
  const rows: TimelineRow[] = [];

  // Source 1: PendantCapture store (in-memory, has photos + voice + brain response)
  try {
    const captures = getTodayCaptures();
    for (const cap of captures) {
      if (cap.timestamp >= startMs && cap.timestamp <= endMs) {
        const phasesRaw = cap.pipelineLog?.phases;
        const phases = Array.isArray(phasesRaw)
          ? phasesRaw.map((p: any) => p.name || p.phase || String(p)).filter(Boolean)
          : [];

        rows.push({
          timestamp: cap.timestamp,
          timeStr: formatTime(cap.timestamp),
          type: 'capture',
          classification: extractClassification(cap.brainResponse),
          framePath: cap.framePath,
          transcript: cap.transcript || undefined,
          brainResponse: extractMittensResponse(cap.brainResponse),
          phases,
        });
      }
    }
  } catch { /* store not available */ }

  // Source 2: activity_logs with source='pendant' in time range
  try {
    const db = getDb();
    const actRows = db.getAllSync(
      `SELECT logged_at, activity_type, duration_min, aeiou, image_uris
       FROM activity_logs
       WHERE source IN ('pendant', 'trail')
         AND logged_at >= ? AND logged_at <= ?
       ORDER BY logged_at ASC`,
      [new Date(startMs).toISOString(), new Date(endMs).toISOString()],
    ) as any[];

    for (const r of actRows) {
      const ts = new Date(r.logged_at).getTime();
      // Skip if we already have a capture row within 2 minutes (avoid duplication)
      const hasCaptureNearby = rows.some(
        (row) => row.type === 'capture' && Math.abs(row.timestamp - ts) < 120000,
      );
      if (hasCaptureNearby) continue;

      rows.push({
        timestamp: ts,
        timeStr: formatTime(ts),
        type: 'activity',
        classification: r.activity_type,
        duration_min: r.duration_min,
        aeiou: r.aeiou ? JSON.parse(r.aeiou) : undefined,
        framePath: r.image_uris ? JSON.parse(r.image_uris)?.[0] : undefined,
      });
    }
  } catch { /* db not available */ }

  // Sort by timestamp
  rows.sort((a, b) => a.timestamp - b.timestamp);
  return rows;
}

/** Extract scene classification from brain response text */
function extractClassification(brainResponse?: string): string | undefined {
  if (!brainResponse) return undefined;
  const lower = brainResponse.toLowerCase();
  const types = ['work', 'social', 'rest', 'exercise', 'eating', 'cooking', 'commute', 'reading', 'scrolling', 'meditation'];
  return types.find((t) => lower.includes(t));
}

/** Extract the Mittens-facing response (nudges, face recognition) */
function extractMittensResponse(brainResponse?: string): string | undefined {
  if (!brainResponse) return undefined;
  // Only show if it looks like a user-facing message (not raw classification)
  if (brainResponse.length > 100) return brainResponse.slice(0, 100) + '...';
  if (brainResponse.includes('recognized') || brainResponse.includes('stretch') || brainResponse.includes('break')) {
    return brainResponse;
  }
  return undefined;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    marginBottom: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary,
  },
  headerTime: {
    fontSize: 12, color: colors.textMuted, marginTop: 2,
  },
  emptyText: {
    fontSize: 14, color: colors.textMuted, textAlign: 'center',
    marginTop: spacing.xl,
  },

  // Timeline rows
  row: {
    flexDirection: 'row', marginBottom: 4,
  },
  connectorCol: {
    width: 24, alignItems: 'center',
  },
  dot: {
    width: 10, height: 10, borderRadius: 5,
    marginTop: 4,
  },
  connector: {
    width: 1.5, flex: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  rowContent: {
    flex: 1, paddingLeft: 10, paddingBottom: 16,
  },
  rowHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  timeText: {
    fontSize: 12, fontWeight: '600', color: colors.textSecondary,
  },
  badge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  badgeText: {
    fontSize: 10, fontWeight: '700', color: '#FFF',
    textTransform: 'capitalize',
  },
  durationText: {
    fontSize: 11, color: colors.textMuted,
  },

  // Frame
  frameImage: {
    width: '100%', height: 120, borderRadius: radius.sm,
    marginTop: 8, backgroundColor: '#111',
  },

  // Transcript
  transcriptRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 6, backgroundColor: '#F5F5F5', borderRadius: radius.sm,
    padding: 8,
  },
  transcriptText: {
    fontSize: 12, color: colors.textPrimary, fontStyle: 'italic',
    flex: 1,
  },

  // Mittens response
  responseRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 4, backgroundColor: '#FAFAF0', borderRadius: radius.sm,
    padding: 8,
  },
  responseText: {
    fontSize: 12, color: colors.textSecondary, flex: 1,
  },

  // Pipeline phases
  phaseRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6,
  },
  phaseChip: {
    backgroundColor: '#F0F0F0', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  phaseChipText: {
    fontSize: 9, fontWeight: '600', color: colors.textSecondary,
  },

  // AEIOU
  aeiouRow: {
    marginTop: 6, gap: 2,
  },
  aeiouText: {
    fontSize: 11, color: colors.textSecondary,
  },
});

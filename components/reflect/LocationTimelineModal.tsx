/**
 * LocationTimelineModal -- Full-screen timeline of all pendant observations
 * during a location session.
 *
 * Every observation is editable:
 *   - Tap classification badge to change activity type (social -> work)
 *   - Tap AEIOU text to edit (chicken -> salmon)
 *   - Life Design weights shown per-row and editable
 *   - Corrections persist to activity_logs via SQLite
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity,
  ScrollView, Image, TextInput, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { timelineStyles as styles } from './locationTimelineStyles';
import type { LocationSession } from '../../lib/services/location/locationSessionApi';
import { getTodayCaptures, type PendantCapture } from '../../lib/services/pendant/pendantStore';
import { getDb } from '../../lib/database';

interface Props {
  visible: boolean;
  session?: LocationSession | null;
  /** Alternative to session: raw time range for any activity block */
  timeRange?: { startedAt: string; endedAt: string | null };
  title: string;
  onClose: () => void;
}

interface TimelineRow {
  /** activity_logs.id -- null for capture-only rows without DB record */
  dbId?: number;
  timestamp: number;
  timeStr: string;
  type: 'capture' | 'activity' | 'scene';
  classification?: string;
  /** Scene title from triage (free-form, e.g. "Indoor screen view") */
  sceneTitle?: string;
  framePath?: string;
  transcript?: string;
  brainResponse?: string;
  phases?: string[];
  aeiou?: Record<string, string>;
  lifeDesign?: Record<string, number>;
  duration_min?: number;
}

const ACTIVITY_TYPES = [
  'work', 'social', 'rest', 'exercise', 'eating', 'cooking',
  'commute', 'reading', 'scrolling', 'meditation', 'walk',
  'run', 'bike', 'workout', 'other',
];

const SCENE_COLORS: Record<string, string> = {
  work: '#4A90D9', social: '#E74C8B', rest: '#8E8E93',
  exercise: '#34C759', eating: '#FF9500', commute: '#AF52DE',
  cooking: '#FF6B35', reading: '#5856D6', meditation: '#30B0C7',
  scrolling: '#FF3B30', walk: '#34C759', run: '#34C759',
  bike: '#34C759', workout: '#34C759', unknown: '#C7C7CC',
  other: '#C7C7CC',
};

const LD_LABELS = ['work', 'health', 'play', 'love'];
const LD_COLORS: Record<string, string> = {
  work: '#4A90D9', health: '#34C759', play: '#FF9500', love: '#E74C8B',
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

export default function LocationTimelineModal({ visible, session, timeRange, title, onClose }: Props) {
  const [rows, setRows] = useState<TimelineRow[]>([]);
  const [editingRowIdx, setEditingRowIdx] = useState<number | null>(null);
  const [typePicker, setTypePicker] = useState<number | null>(null);

  // Resolve the effective time range from either session or explicit timeRange
  const effectiveRange = useMemo(() => {
    if (session) return { startedAt: session.startedAt, endedAt: session.endedAt };
    if (timeRange) return timeRange;
    return null;
  }, [session, timeRange]);

  // Build rows when range changes
  useMemo(() => {
    if (!effectiveRange) { setRows([]); return; }
    setRows(buildTimelineRows(effectiveRange));
    setEditingRowIdx(null);
    setTypePicker(null);
  }, [effectiveRange]);

  if (!effectiveRange) return null;

  const startTime = new Date(effectiveRange.startedAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const endTime = effectiveRange.endedAt
    ? new Date(effectiveRange.endedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : 'now';

  /** Update a row's classification and persist */
  const handleChangeType = useCallback((rowIdx: number, newType: string) => {
    const row = rows[rowIdx];
    const updated = [...rows];
    updated[rowIdx] = { ...row, classification: newType };
    setRows(updated);
    setTypePicker(null);

    // Persist to DB
    if (row.dbId) {
      try {
        const db = getDb();
        db.runSync(
          `UPDATE activity_logs SET activity_type = ? WHERE id = ?`,
          [newType, row.dbId],
        );
      } catch { /* best effort */ }
    }
  }, [rows]);

  /** Update an AEIOU field and persist */
  const handleAeiouChange = useCallback((rowIdx: number, key: string, value: string) => {
    const row = rows[rowIdx];
    const updated = [...rows];
    const newAeiou = { ...(row.aeiou || {}), [key]: value };
    updated[rowIdx] = { ...row, aeiou: newAeiou };
    setRows(updated);

    if (row.dbId) {
      try {
        const db = getDb();
        db.runSync(
          `UPDATE activity_logs SET aeiou = ? WHERE id = ?`,
          [JSON.stringify(newAeiou), row.dbId],
        );
      } catch { /* best effort */ }
    }
  }, [rows]);

  /** Update a life design weight and persist */
  const handleLifeDesignChange = useCallback((rowIdx: number, category: string, delta: number) => {
    const row = rows[rowIdx];
    const updated = [...rows];
    const ld = { ...(row.lifeDesign || { work: 0, health: 0, play: 0, love: 0 }) };
    ld[category] = Math.max(0, Math.min(1, (ld[category] || 0) + delta));
    // Round
    for (const k of Object.keys(ld)) ld[k] = Math.round(ld[k] * 100) / 100;
    updated[rowIdx] = { ...row, lifeDesign: ld };
    setRows(updated);

    if (row.dbId) {
      try {
        const db = getDb();
        db.runSync(
          `UPDATE activity_logs SET life_categories = ? WHERE id = ?`,
          [JSON.stringify(ld), row.dbId],
        );
      } catch { /* best effort */ }
    }
  }, [rows]);

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
                  {/* Time + classification badge (tappable to change) */}
                  <View style={styles.rowHeader}>
                    <Text style={styles.timeText}>{row.timeStr}</Text>
                    <TouchableOpacity
                      onPress={() => setTypePicker(typePicker === idx ? null : idx)}
                      activeOpacity={0.6}
                    >
                      <View style={[styles.badge, { backgroundColor: SCENE_COLORS[row.classification || ''] || '#E5E5EA' }]}>
                        <Text style={styles.badgeText}>
                          {row.classification || row.sceneTitle || 'unknown'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {row.duration_min != null && row.duration_min > 0 && (
                      <Text style={styles.durationText}>{Math.ceil(row.duration_min)}min</Text>
                    )}
                    <TouchableOpacity
                      onPress={() => setEditingRowIdx(editingRowIdx === idx ? null : idx)}
                      activeOpacity={0.6}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Feather
                        name={editingRowIdx === idx ? 'check' : 'edit-2'}
                        size={14}
                        color={editingRowIdx === idx ? '#34C759' : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Type picker (inline dropdown) */}
                  {typePicker === idx && (
                    <View style={styles.typePickerRow}>
                      {ACTIVITY_TYPES.map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.typeChip,
                            t === row.classification && styles.typeChipActive,
                          ]}
                          onPress={() => handleChangeType(idx, t)}
                          activeOpacity={0.6}
                        >
                          <Text style={[
                            styles.typeChipText,
                            t === row.classification && styles.typeChipTextActive,
                          ]}>
                            {t}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

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

                  {/* Scene title + description */}
                  {row.sceneTitle && !row.brainResponse && (
                    <Text style={styles.responseText}>{row.sceneTitle}</Text>
                  )}

                  {/* Mittens response */}
                  {row.brainResponse && (
                    <View style={styles.responseRow}>
                      <Feather name="message-circle" size={12} color={colors.textSecondary} />
                      <Text style={styles.responseText}>{row.brainResponse}</Text>
                    </View>
                  )}

                  {/* Life Design weights (always shown, editable when row is in edit mode) */}
                  {row.lifeDesign && (
                    <View style={styles.ldRow}>
                      {LD_LABELS.map(cat => {
                        const val = row.lifeDesign?.[cat] || 0;
                        return (
                          <View key={cat} style={styles.ldItem}>
                            <Text style={[styles.ldLabel, { color: LD_COLORS[cat] }]}>
                              {cat.charAt(0).toUpperCase()}
                            </Text>
                            {editingRowIdx === idx ? (
                              <View style={styles.ldSteppers}>
                                <TouchableOpacity
                                  onPress={() => handleLifeDesignChange(idx, cat, -0.1)}
                                  style={styles.ldBtn}
                                >
                                  <Text style={styles.ldBtnText}>-</Text>
                                </TouchableOpacity>
                                <Text style={styles.ldValue}>{val.toFixed(1)}</Text>
                                <TouchableOpacity
                                  onPress={() => handleLifeDesignChange(idx, cat, 0.1)}
                                  style={styles.ldBtn}
                                >
                                  <Text style={styles.ldBtnText}>+</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <Text style={styles.ldValue}>{val.toFixed(1)}</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* AEIOU (editable when row is in edit mode) */}
                  {editingRowIdx === idx && row.aeiou && Object.keys(row.aeiou).length > 0 && (
                    <View style={styles.aeiouEditSection}>
                      {Object.entries(row.aeiou).map(([key, val]) => {
                        const displayVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val || '');
                        return (
                          <View key={key} style={styles.aeiouEditRow}>
                            <Text style={styles.aeiouEditLabel}>
                              {key.charAt(0).toUpperCase()}:
                            </Text>
                            <TextInput
                              style={styles.aeiouEditInput}
                              value={displayVal}
                              onChangeText={(text) => handleAeiouChange(idx, key, text)}
                              placeholder={key}
                              placeholderTextColor={colors.textMuted}
                            />
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* AEIOU (read-only when not editing) */}
                  {editingRowIdx !== idx && row.aeiou && Object.keys(row.aeiou).length > 0 && (
                    <View style={styles.aeiouRow}>
                      {Object.entries(row.aeiou).map(([key, val]) => {
                        if (val == null || val === '') return null;
                        const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                        return (
                          <Text key={key} style={styles.aeiouText}>
                            {key.charAt(0).toUpperCase()}: {displayVal}
                          </Text>
                        );
                      })}
                    </View>
                  )}

                  {/* Pipeline phases (read-only context) */}
                  {row.phases && row.phases.length > 0 && (
                    <View style={styles.phaseRow}>
                      {row.phases.map((phase) => (
                        <View key={phase} style={styles.phaseChip}>
                          <Text style={styles.phaseChipText}>{phase}</Text>
                        </View>
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
function buildTimelineRows(range: { startedAt: string; endedAt: string | null }): TimelineRow[] {
  const startMs = new Date(range.startedAt).getTime();
  const endMs = range.endedAt ? new Date(range.endedAt).getTime() : Date.now();
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
          classification: extractClassification(cap.title, cap.brainResponse),
          sceneTitle: cap.title || undefined,
          framePath: cap.framePath,
          transcript: cap.transcript || undefined,
          brainResponse: cap.brainResponse || cap.description || undefined,
          phases,
        });
      }
    }
  } catch { /* store not available */ }

  // Source 2: activity_logs with source='pendant' in time range
  try {
    const db = getDb();
    const actRows = db.getAllSync(
      `SELECT id, logged_at, activity_type, duration_min, aeiou,
              image_uris, life_categories
       FROM activity_logs
       WHERE source IN ('pendant', 'trail')
         AND logged_at >= ? AND logged_at <= ?
       ORDER BY logged_at ASC`,
      [new Date(startMs).toISOString(), new Date(endMs).toISOString()],
    ) as any[];

    for (const r of actRows) {
      const ts = new Date(r.logged_at).getTime();
      // Check if we already have a capture row within 2 minutes
      const captureIdx = rows.findIndex(
        (row) => row.type === 'capture' && Math.abs(row.timestamp - ts) < 120000,
      );

      if (captureIdx >= 0) {
        // Merge DB data into existing capture row (adds dbId, lifeDesign, aeiou)
        const existing = rows[captureIdx];
        rows[captureIdx] = {
          ...existing,
          dbId: r.id,
          classification: existing.classification || r.activity_type,
          duration_min: r.duration_min || existing.duration_min,
          aeiou: r.aeiou ? JSON.parse(r.aeiou) : existing.aeiou,
          lifeDesign: r.life_categories ? JSON.parse(r.life_categories) : undefined,
        };
      } else {
        rows.push({
          dbId: r.id,
          timestamp: ts,
          timeStr: formatTime(ts),
          type: 'activity',
          classification: r.activity_type,
          duration_min: r.duration_min,
          aeiou: r.aeiou ? JSON.parse(r.aeiou) : undefined,
          lifeDesign: r.life_categories ? JSON.parse(r.life_categories) : undefined,
          framePath: r.image_uris ? JSON.parse(r.image_uris)?.[0] : undefined,
        });
      }
    }
  } catch { /* db not available */ }

  // Sort by timestamp (latest to oldest)
  rows.sort((a, b) => b.timestamp - a.timestamp);
  return rows;
}

/** Extract scene classification from triage title or brain response text */
function extractClassification(title?: string, brainResponse?: string): string | undefined {
  const types = ['work', 'social', 'rest', 'exercise', 'eating', 'cooking', 'commute',
    'reading', 'scrolling', 'meditation', 'walk', 'run', 'bike', 'workout'];

  // Check title first (from triage)
  if (title) {
    const lower = title.toLowerCase();
    const match = types.find((t) => lower.includes(t));
    if (match) return match;

    // Map common triage titles to activity types
    if (lower.includes('screen') || lower.includes('desk') || lower.includes('laptop') || lower.includes('computer')) return 'scrolling';
    if (lower.includes('park') || lower.includes('hik') || lower.includes('outdoor')) return 'walk';
    if (lower.includes('gym') || lower.includes('sport')) return 'exercise';
    if (lower.includes('kitchen') || lower.includes('cook')) return 'cooking';
    if (lower.includes('sleep') || lower.includes('bed') || lower.includes('dark')) return 'rest';
  }

  // Fallback: try brainResponse
  if (brainResponse) {
    const lower = brainResponse.toLowerCase();
    return types.find((t) => lower.includes(t));
  }

  return undefined;
}

/**
 * PipelineLogBubble -- Expandable phase log shown on reply messages.
 *
 * Shows a compact summary by default ("3 phases, 4.2s total").
 * Tap to expand and see each phase with timing and result.
 */

import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../lib/theme';
import type { PipelineLog, PhaseLog } from '../../lib/pipelines/logger';
import { formatDuration } from '../../lib/pipelines/logger';

interface Props {
  log: PipelineLog;
}

function statusIcon(status: PhaseLog['status']): string {
  switch (status) {
    case 'complete': return 'OK';
    case 'error': return '!!';
    case 'skipped': return '--';
    case 'running': return '..';
    default: return '?';
  }
}

function statusColor(status: PhaseLog['status']): string {
  switch (status) {
    case 'complete': return '#34C759';
    case 'error': return '#FF3B30';
    case 'skipped': return colors.textMuted;
    case 'running': return '#FF9500';
    default: return colors.textMuted;
  }
}

export default function PipelineLogBubble({ log }: Props) {
  const [expanded, setExpanded] = useState(false);

  const phaseCount = log.phases.length;
  const errorCount = log.phases.filter(p => p.status === 'error').length;
  const totalDuration = log.totalDurationMs || (Date.now() - log.startedAt);

  const summaryText = errorCount > 0
    ? `${phaseCount} phases, ${errorCount} failed -- ${formatDuration(totalDuration)}`
    : `${phaseCount} phases -- ${formatDuration(totalDuration)}`;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        style={styles.header}
        activeOpacity={0.7}
      >
        <Text style={styles.headerIcon}>{expanded ? 'v' : '>'}</Text>
        <Text style={styles.summaryText}>
          {log.brainId ? `[${log.brainId}] ` : ''}{summaryText}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.phaseList}>
          {log.triageSummary && (
            <View style={styles.triageRow}>
              <Text style={styles.triageLabel}>Triage:</Text>
              <Text style={styles.triageValue}>{log.triageSummary}</Text>
            </View>
          )}

          {log.phases.map((phase, idx) => (
            <View key={idx} style={styles.phaseRow}>
              <View style={styles.phaseHeader}>
                <Text style={[styles.statusBadge, { color: statusColor(phase.status) }]}>
                  [{statusIcon(phase.status)}]
                </Text>
                <Text style={styles.phaseName}>
                  {phase.domain}.{phase.phase}
                </Text>
                {phase.durationMs !== undefined && (
                  <Text style={styles.duration}>
                    {formatDuration(phase.durationMs)}
                  </Text>
                )}
              </View>

              {phase.resultSummary && (
                <Text style={styles.resultText} numberOfLines={2}>
                  {phase.resultSummary}
                </Text>
              )}

              {phase.error && (
                <Text style={styles.errorText} numberOfLines={2}>
                  {phase.error}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    borderRadius: radius.sm,
    backgroundColor: '#F8F8F8',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerIcon: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: 'monospace',
    width: 14,
  },
  summaryText: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  phaseList: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E5',
  },
  triageRow: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingBottom: 4,
  },
  triageLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    fontFamily: 'monospace',
    marginRight: 4,
  },
  triageValue: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    flex: 1,
  },
  phaseRow: {
    paddingTop: 4,
    paddingBottom: 2,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    marginRight: 4,
    width: 28,
  },
  phaseName: {
    fontSize: 11,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    flex: 1,
  },
  duration: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: 'monospace',
    marginLeft: 8,
  },
  resultText: {
    fontSize: 10,
    color: colors.textMuted,
    fontFamily: 'monospace',
    marginLeft: 32,
    marginTop: 1,
  },
  errorText: {
    fontSize: 10,
    color: '#FF3B30',
    fontFamily: 'monospace',
    marginLeft: 32,
    marginTop: 1,
  },
});

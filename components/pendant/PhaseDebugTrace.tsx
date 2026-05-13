/**
 * PhaseDebugTrace -- Expandable debug trace for ambient pipeline phases.
 *
 * Shows each phase with timing, status, and expandable brain I/O sections.
 * Triage summary is displayed as a header. Each phase row can be tapped
 * to reveal what was sent to the brain (input) and what came back (output).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { PipelineLog, PhaseLog } from '../../lib/pipelines/logger';

interface Props {
  log: PipelineLog;
}

const STATUS_COLORS: Record<string, string> = {
  complete: '#4CAF50',
  error: '#F44336',
  skipped: '#9E9E9E',
  running: '#FF9800',
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function PhaseRow({ phase }: { phase: PhaseLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasIO = !!(phase.input || phase.output);
  const statusColor = STATUS_COLORS[phase.status] || colors.textMuted;

  return (
    <View style={styles.phaseItem}>
      <TouchableOpacity
        style={styles.phaseHeader}
        onPress={() => hasIO && setExpanded(!expanded)}
        activeOpacity={hasIO ? 0.6 : 1}
      >
        {/* Status dot */}
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />

        {/* Phase name */}
        <Text style={styles.phaseName}>
          {phase.domain}.{phase.phase}
        </Text>

        {/* Timing */}
        {phase.durationMs != null && (
          <Text style={styles.phaseTiming}>{formatMs(phase.durationMs)}</Text>
        )}

        {/* Summary */}
        {phase.resultSummary && (
          <Text style={styles.phaseSummary} numberOfLines={1}>
            {phase.resultSummary}
          </Text>
        )}

        {/* Error indicator */}
        {phase.error && (
          <Text style={styles.phaseError} numberOfLines={1}>
            {phase.error}
          </Text>
        )}

        {/* Expand chevron */}
        {hasIO && (
          <Feather
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={14}
            color={colors.textMuted}
          />
        )}
      </TouchableOpacity>

      {/* Expanded I/O */}
      {expanded && (
        <View style={styles.ioContainer}>
          {phase.input && (
            <View style={styles.ioBlock}>
              <Text style={styles.ioLabel}>Input (to brain)</Text>
              <Text style={styles.ioText}>{phase.input}</Text>
            </View>
          )}
          {phase.output && (
            <View style={styles.ioBlock}>
              <Text style={styles.ioLabel}>Output (from brain)</Text>
              <Text style={styles.ioText}>{phase.output}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function PhaseDebugTrace({ log }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const phaseCount = log.phases?.length || 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.traceHeader}
        onPress={() => setCollapsed(!collapsed)}
        activeOpacity={0.6}
      >
        <Feather name="terminal" size={14} color={colors.textMuted} />
        <Text style={styles.traceTitle}>
          Pipeline Trace ({phaseCount} phase{phaseCount !== 1 ? 's' : ''})
        </Text>
        <Feather
          name={collapsed ? 'chevron-right' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.traceBody}>
          {/* Triage summary */}
          {log.triageSummary && (
            <View style={styles.triageBanner}>
              <Text style={styles.triageLabel}>Triage</Text>
              <Text style={styles.triageValue}>{log.triageSummary}</Text>
            </View>
          )}

          {/* Total time */}
          {log.totalDurationMs != null && (
            <Text style={styles.totalTime}>
              Total: {formatMs(log.totalDurationMs)}
            </Text>
          )}

          {/* Phase rows */}
          {log.phases?.map((phase, i) => (
            <PhaseRow key={`${phase.domain}-${phase.phase}-${i}`} phase={phase} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    overflow: 'hidden',
  },
  traceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  traceTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  traceBody: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
  },
  triageBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: radius.sm,
    padding: spacing.xs,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  triageLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64B5F6',
    textTransform: 'uppercase',
  },
  triageValue: {
    flex: 1,
    fontSize: 11,
    color: '#B0BEC5',
    fontFamily: 'monospace',
  },
  totalTime: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  phaseItem: {
    marginBottom: 2,
  },
  phaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  phaseName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    minWidth: 80,
  },
  phaseTiming: {
    fontSize: 10,
    color: colors.textMuted,
    minWidth: 40,
  },
  phaseSummary: {
    flex: 1,
    fontSize: 10,
    color: colors.textMuted,
  },
  phaseError: {
    flex: 1,
    fontSize: 10,
    color: '#F44336',
  },
  ioContainer: {
    marginLeft: 12,
    marginTop: 4,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#333',
    paddingLeft: spacing.sm,
  },
  ioBlock: {
    marginBottom: spacing.xs,
  },
  ioLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64B5F6',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  ioText: {
    fontSize: 10,
    color: '#B0BEC5',
    fontFamily: 'monospace',
    lineHeight: 14,
  },
});

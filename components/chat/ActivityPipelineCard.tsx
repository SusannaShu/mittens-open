/**
 * ActivityPipelineCard -- Per-phase progress card for the activity pipeline.
 *
 * Shows each AEIOU phase as it completes:
 *   queued -> analyzing -> result/skipped
 *
 * For cloud mode, all phases show "analyzing" simultaneously.
 * For local mode, phases progress one at a time.
 *
 * Uses Feather icons only -- no emojis.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

// ──────────── Types ────────────

export type PhaseStatus = 'queued' | 'running' | 'complete' | 'skipped' | 'error';

export interface ActivityPhaseInfo {
  key: string;
  label: string;
  featherIcon: string;
  status: PhaseStatus;
  result?: string;  // Short summary to display
  error?: string;
}

interface ActivityPipelineCardProps {
  phases: ActivityPhaseInfo[];
  /** Overall pipeline status */
  pipelineStatus: 'running' | 'complete' | 'error';
}

// ──────────── Phase Icons ────────────

const PHASE_META: Record<string, { label: string; featherIcon: string }> = {
  detect:      { label: 'Activity Detection',  featherIcon: 'crosshair' },
  environment: { label: 'Environment',         featherIcon: 'compass' },
  social:      { label: 'Social Context',      featherIcon: 'users' },
  objects:     { label: 'Objects',              featherIcon: 'box' },
  lifeDesign:  { label: 'Life Design',          featherIcon: 'target' },
};

/** Build phase info list from runner state */
export function buildActivityPhases(
  phasesToRun: string[],
  currentPhase?: string,
  results?: Record<string, any>,
  errors?: Record<string, string>,
): ActivityPhaseInfo[] {
  return phasesToRun.map(key => {
    const meta = PHASE_META[key] || { label: key, featherIcon: 'circle' };
    let status: PhaseStatus = 'queued';

    if (errors?.[key]) {
      status = 'error';
    } else if (results?.[key]) {
      status = 'complete';
    } else if (currentPhase === key) {
      status = 'running';
    }

    return {
      key,
      label: meta.label,
      featherIcon: meta.featherIcon,
      status,
      result: results?.[key],
      error: errors?.[key],
    };
  });
}

// ──────────── Status indicator ────────────

function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 18 }} />;
    case 'complete':
      return (
        <View style={[s.statusDot, { backgroundColor: '#E8E8E8' }]}>
          <Feather name="check" size={10} color={colors.textPrimary} />
        </View>
      );
    case 'error':
      return (
        <View style={[s.statusDot, { backgroundColor: '#F0F0F0' }]}>
          <Feather name="alert-circle" size={10} color="#999" />
        </View>
      );
    case 'skipped':
      return (
        <View style={[s.statusDot, { backgroundColor: '#F5F5F5' }]}>
          <Text style={{ fontSize: 8, color: '#999' }}>--</Text>
        </View>
      );
    default: // queued
      return <View style={[s.statusDot, { backgroundColor: '#F0F0F0' }]} />;
  }
}

// ──────────── Phase Row ────────────

function PhaseRow({ phase }: { phase: ActivityPhaseInfo }) {
  return (
    <View style={s.phaseRow}>
      <Feather
        name={phase.featherIcon as any}
        size={14}
        color={phase.status === 'skipped' ? colors.textMuted : colors.textSecondary}
      />
      <View style={s.phaseInfo}>
        <Text style={[
          s.phaseLabel,
          phase.status === 'skipped' && s.phaseLabelSkipped,
        ]} numberOfLines={1}>
          {phase.label}
        </Text>
        {phase.status === 'complete' && phase.result && (
          <Text style={s.phaseResult} numberOfLines={1}>{phase.result}</Text>
        )}
        {phase.status === 'error' && phase.error && (
          <Text style={s.phaseError} numberOfLines={1}>{phase.error}</Text>
        )}
      </View>
      <PhaseStatusBadge status={phase.status} />
    </View>
  );
}

// ──────────── Main Component ────────────

export default function ActivityPipelineCard({ phases, pipelineStatus }: ActivityPipelineCardProps) {
  if (phases.length === 0) return null;

  const completedCount = phases.filter(p => p.status === 'complete').length;
  const allComplete = pipelineStatus === 'complete';
  const hasError = pipelineStatus === 'error';

  const headerText = allComplete
    ? 'Activity logged'
    : hasError
      ? 'Activity detection failed'
      : `Analyzing activity...`;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Feather
          name={allComplete ? 'check-circle' : hasError ? 'alert-triangle' : 'activity'}
          size={13}
          color={hasError ? '#999' : colors.textSecondary}
        />
        <Text style={[s.headerTitle, hasError && { color: '#999' }]}>
          {headerText}
        </Text>
        {!allComplete && !hasError && (
          <Text style={s.headerBadge}>{completedCount}/{phases.length}</Text>
        )}
      </View>

      {/* Phase list */}
      <View style={s.phaseList}>
        {phases.map(phase => (
          <PhaseRow key={phase.key} phase={phase} />
        ))}
      </View>

      {/* Progress bar when running */}
      {!allComplete && !hasError && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${(completedCount / phases.length) * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

// ──────────── Styles ────────────

const s = StyleSheet.create({
  container: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerBadge: {
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: '#ECECEC',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  phaseList: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  phaseInfo: {
    flex: 1,
  },
  phaseLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  phaseLabelSkipped: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  phaseResult: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  phaseError: {
    fontSize: 11,
    color: '#999',
    marginTop: 1,
  },
  statusDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    height: 2,
    backgroundColor: '#ECECEC',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.textPrimary,
  },
});

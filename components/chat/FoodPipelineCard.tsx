/**
 * FoodPipelineCard -- Full food pipeline progress wrapper.
 *
 * Shows all food pipeline phases:
 *   [search]       Identifying foods -> list of foods (wraps existing MealPipelineCard)
 *   [bar-chart-2]  Nutrients -> per-food estimation progress
 *   [thermometer]  Bioavailability -> meal-level analysis
 *   [shield]       Gut Health -> NOVA/fermented classification
 *   [clock]        Eating Context -> pace/stress/distraction assessment
 *
 * The existing MealPipelineCard handles the identify + nutrients detail view.
 * This card wraps it and adds the remaining phases.
 *
 * Uses Feather icons only -- no emojis.
 */

import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

export type FoodPhaseStatus = 'queued' | 'running' | 'complete' | 'skipped' | 'error';

export interface FoodPhaseInfo {
  key: string;
  label: string;
  featherIcon: string;
  status: FoodPhaseStatus;
  result?: string;
}

interface FoodPipelineCardProps {
  /** The child content (typically MealPipelineCard for identify + nutrients) */
  children?: React.ReactNode;
  /** Additional phases beyond identify/nutrients */
  extraPhases: FoodPhaseInfo[];
  /** Overall pipeline status */
  pipelineStatus: 'running' | 'complete' | 'error';
}

const PHASE_META: Record<string, { label: string; featherIcon: string }> = {
  identify:         { label: 'Identifying Foods',   featherIcon: 'search' },
  nutrients:        { label: 'Nutrients',            featherIcon: 'bar-chart-2' },
  bioavailability:  { label: 'Bioavailability',      featherIcon: 'thermometer' },
  validate:         { label: 'Gut Health',           featherIcon: 'shield' },
  eatingContext:    { label: 'Eating Context',       featherIcon: 'clock' },
};

/** Build phase info from pipeline state */
export function buildFoodPhases(
  phasesToRun: string[],
  currentPhase?: string,
  results?: Record<string, any>,
  skipped?: Set<string>,
): FoodPhaseInfo[] {
  return phasesToRun.map(key => {
    const meta = PHASE_META[key] || { label: key, featherIcon: 'circle' };
    let status: FoodPhaseStatus = 'queued';

    if (skipped?.has(key)) {
      status = 'skipped';
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
      result: typeof results?.[key] === 'string' ? results[key] : undefined,
    };
  });
}

// ──────────── Status indicator ────────────

function PhaseStatusBadge({ status }: { status: FoodPhaseStatus }) {
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 18 }} />;
    case 'complete':
      return (
        <View style={[s.statusDot, { backgroundColor: '#E8E8E8' }]}>
          <Feather name="check" size={10} color={colors.textPrimary} />
        </View>
      );
    case 'skipped':
      return (
        <View style={[s.statusDot, { backgroundColor: '#F5F5F5' }]}>
          <Text style={{ fontSize: 8, color: '#999' }}>--</Text>
        </View>
      );
    case 'error':
      return (
        <View style={[s.statusDot, { backgroundColor: '#F0F0F0' }]}>
          <Feather name="alert-circle" size={10} color="#999" />
        </View>
      );
    default:
      return <View style={[s.statusDot, { backgroundColor: '#F0F0F0' }]} />;
  }
}

// ──────────── Extra Phase Row ────────────

function ExtraPhaseRow({ phase }: { phase: FoodPhaseInfo }) {
  return (
    <View style={s.phaseRow}>
      <Feather
        name={phase.featherIcon as any}
        size={14}
        color={phase.status === 'skipped' ? colors.textMuted : colors.textSecondary}
      />
      <Text style={[
        s.phaseLabel,
        phase.status === 'skipped' && s.phaseLabelSkipped,
      ]} numberOfLines={1}>
        {phase.label}
      </Text>
      {phase.status === 'complete' && phase.result && (
        <Text style={s.phaseResult} numberOfLines={1}>{phase.result}</Text>
      )}
      <PhaseStatusBadge status={phase.status} />
    </View>
  );
}

// ──────────── Main Component ────────────

export default function FoodPipelineCard({
  children,
  extraPhases,
  pipelineStatus,
}: FoodPipelineCardProps) {
  const allComplete = pipelineStatus === 'complete';
  const hasError = pipelineStatus === 'error';

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Feather
          name={allComplete ? 'check-circle' : hasError ? 'alert-triangle' : 'eye'}
          size={13}
          color={hasError ? '#999' : colors.textSecondary}
        />
        <Text style={[s.headerTitle, hasError && { color: '#999' }]}>
          {allComplete ? 'Meal analyzed' : hasError ? 'Analysis failed' : 'Analyzing meal...'}
        </Text>
      </View>

      {/* Main content (MealPipelineCard for identify + nutrients) */}
      {children && (
        <View style={s.childContent}>
          {children}
        </View>
      )}

      {/* Extra phases (bio, gut health, eating context) */}
      {extraPhases.length > 0 && (
        <View style={s.extraPhases}>
          {extraPhases.map(phase => (
            <ExtraPhaseRow key={phase.key} phase={phase} />
          ))}
        </View>
      )}

      {/* Progress bar */}
      {!allComplete && !hasError && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, {
            width: `${(extraPhases.filter(p => p.status === 'complete').length / Math.max(extraPhases.length, 1)) * 100}%`
          }]} />
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
  childContent: {
    // MealPipelineCard renders inside here
  },
  extraPhases: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  phaseLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  phaseLabelSkipped: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  phaseResult: {
    fontSize: 10,
    color: colors.textMuted,
    marginRight: 6,
    maxWidth: 120,
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

/**
 * IntentCardsRow -- Horizontal row of pipeline intent cards.
 *
 * Shown immediately after triage identifies intents. Each card
 * represents one pipeline (meal, activity, sleep) and shows its
 * phases with loading spinners.
 *
 * Cards are collapsed by default, showing just the intent type
 * and overall status. Tapping expands to reveal per-phase details.
 *
 * For meal intents, the expanded view embeds MealPipelineCard inline.
 *
 * Uses Feather icons only -- no emojis.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

// ──────────── Types ────────────

export type IntentPhaseStatus = 'queued' | 'running' | 'complete' | 'skipped' | 'error';
export type IntentStatus = 'queued' | 'running' | 'complete' | 'error';

export interface IntentPhase {
  key: string;
  label: string;
  featherIcon: string;
  status: IntentPhaseStatus;
  result?: string;
}

export interface PipelineIntent {
  pipeline: string;
  status: IntentStatus;
  phases: IntentPhase[];
  result?: any;
}

interface IntentCardsRowProps {
  intents: PipelineIntent[];
  /** Render function for expanded meal content (MealPipelineCard) */
  renderMealContent?: () => React.ReactNode;
  /** Called when user taps on a completed intent card */
  onIntentPress?: (pipeline: string) => void;
}

// ──────────── Intent metadata ────────────

const INTENT_META: Record<string, { label: string; featherIcon: string }> = {
  meal:     { label: 'Meal',     featherIcon: 'coffee' },
  activity: { label: 'Activity', featherIcon: 'activity' },
  sleep:    { label: 'Sleep',    featherIcon: 'moon' },
  pantry:   { label: 'Pantry',   featherIcon: 'package' },
  chat:     { label: 'Chat',     featherIcon: 'message-circle' },
  email:    { label: 'Email',    featherIcon: 'mail' },
  watch:    { label: 'Watch',    featherIcon: 'eye' },
};

// ──────────── Status indicator ────────────

function IntentStatusIcon({ status }: { status: IntentStatus }) {
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={colors.textMuted} />;
    case 'complete':
      return <Feather name="check" size={12} color={colors.textPrimary} />;
    case 'error':
      return <Feather name="alert-circle" size={12} color="#999" />;
    default:
      return <View style={s.queuedDot} />;
  }
}

function PhaseStatusBadge({ status }: { status: IntentPhaseStatus }) {
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 16 }} />;
    case 'complete':
      return (
        <View style={[s.phaseStatusDot, { backgroundColor: '#E8E8E8' }]}>
          <Feather name="check" size={8} color={colors.textPrimary} />
        </View>
      );
    case 'error':
      return (
        <View style={[s.phaseStatusDot, { backgroundColor: '#F0F0F0' }]}>
          <Feather name="alert-circle" size={8} color="#999" />
        </View>
      );
    case 'skipped':
      return (
        <View style={[s.phaseStatusDot, { backgroundColor: '#F5F5F5' }]}>
          <Text style={{ fontSize: 7, color: '#CCC' }}>--</Text>
        </View>
      );
    default:
      return <View style={[s.phaseStatusDot, { backgroundColor: '#F0F0F0' }]} />;
  }
}

// ──────────── Phase Row (in expanded view) ────────────

function PhaseRow({ phase }: { phase: IntentPhase }) {
  return (
    <View style={s.phaseRow}>
      <Feather
        name={phase.featherIcon as any}
        size={12}
        color={phase.status === 'skipped' ? '#CCC' : colors.textSecondary}
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

// ──────────── Collapsed Card ────────────

function CollapsedCard({ intent, onPress }: { intent: PipelineIntent; onPress: () => void }) {
  const meta = INTENT_META[intent.pipeline] || { label: intent.pipeline, featherIcon: 'circle' };
  const completedCount = intent.phases.filter(p => p.status === 'complete').length;
  const totalCount = intent.phases.length;

  return (
    <TouchableOpacity style={s.collapsedCard} onPress={onPress} activeOpacity={0.7}>
      <Feather name={meta.featherIcon as any} size={16} color={colors.textPrimary} />
      <Text style={s.collapsedLabel}>{meta.label}</Text>
      <View style={s.collapsedStatus}>
        {intent.status === 'running' && totalCount > 1 && (
          <Text style={s.collapsedBadge}>{completedCount}/{totalCount}</Text>
        )}
        <IntentStatusIcon status={intent.status} />
      </View>
    </TouchableOpacity>
  );
}

// ──────────── Expanded Card ────────────

function ExpandedCard({
  intent,
  onCollapse,
  renderMealContent,
}: {
  intent: PipelineIntent;
  onCollapse: () => void;
  renderMealContent?: () => React.ReactNode;
}) {
  const meta = INTENT_META[intent.pipeline] || { label: intent.pipeline, featherIcon: 'circle' };
  const completedCount = intent.phases.filter(p => p.status === 'complete').length;
  const totalCount = intent.phases.length;

  return (
    <View style={s.expandedCard}>
      {/* Header */}
      <TouchableOpacity style={s.expandedHeader} onPress={onCollapse} activeOpacity={0.7}>
        <Feather name={meta.featherIcon as any} size={14} color={colors.textPrimary} />
        <Text style={s.expandedTitle}>{meta.label}</Text>
        {intent.status === 'running' && totalCount > 0 && (
          <Text style={s.expandedBadge}>{completedCount}/{totalCount}</Text>
        )}
        <IntentStatusIcon status={intent.status} />
        <Feather name="chevron-up" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} />
      </TouchableOpacity>

      {/* Phase list */}
      <View style={s.phaseList}>
        {intent.phases.map(phase => (
          <PhaseRow key={phase.key} phase={phase} />
        ))}
      </View>

      {/* Meal-specific: inline MealPipelineCard content */}
      {intent.pipeline === 'meal' && renderMealContent && (
        <View style={s.mealContent}>
          {renderMealContent()}
        </View>
      )}

      {/* Progress bar */}
      {intent.status === 'running' && totalCount > 0 && (
        <View style={s.progressBar}>
          <View style={[s.progressFill, {
            width: `${(completedCount / totalCount) * 100}%`
          }]} />
        </View>
      )}
    </View>
  );
}

// ──────────── Main Component ────────────

export default function IntentCardsRow({
  intents,
  renderMealContent,
  onIntentPress,
}: IntentCardsRowProps) {
  const [expandedPipeline, setExpandedPipeline] = useState<string | null>(() => {
    if (intents.length === 1) return intents[0].pipeline;
    const running = intents.find(i => i.status === 'running');
    if (running) return running.pipeline;
    return null;
  });

  if (intents.length === 0) return null;

  // If only one intent, show it expanded by default when running
  const singleIntent = intents.length === 1;

  return (
    <View style={s.container}>
      {expandedPipeline ? (
        // Show expanded card full-width
        <>
          {intents.map(intent => {
            if (intent.pipeline === expandedPipeline) {
              return (
                <ExpandedCard
                  key={intent.pipeline}
                  intent={intent}
                  onCollapse={() => setExpandedPipeline(null)}
                  renderMealContent={intent.pipeline === 'meal' ? renderMealContent : undefined}
                />
              );
            }
            // Show other intents as collapsed
            return (
              <CollapsedCard
                key={intent.pipeline}
                intent={intent}
                onPress={() => setExpandedPipeline(intent.pipeline)}
              />
            );
          })}
        </>
      ) : (
        // Show all cards in a row
        <View style={s.row}>
          {intents.map(intent => (
            <CollapsedCard
              key={intent.pipeline}
              intent={intent}
              onPress={() => setExpandedPipeline(intent.pipeline)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ──────────── Styles ────────────

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },

  // Collapsed card
  collapsedCard: {
    flex: 1,
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    gap: 4,
  },
  collapsedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  collapsedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  collapsedBadge: {
    fontSize: 9,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  queuedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0E0E0',
  },

  // Expanded card
  expandedCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 4,
  },
  expandedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  expandedTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  expandedBadge: {
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: '#ECECEC',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },

  // Phase list
  phaseList: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 6,
  },
  phaseLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  phaseLabelSkipped: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  phaseResult: {
    fontSize: 10,
    color: colors.textMuted,
    marginRight: 4,
    maxWidth: 100,
  },
  phaseStatusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Meal content area
  mealContent: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },

  // Progress
  progressBar: {
    height: 2,
    backgroundColor: '#ECECEC',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.textPrimary,
  },
});

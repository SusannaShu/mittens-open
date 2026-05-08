import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius, fonts } from '../lib/theme';
import {
  useSubmitNotesMutation,
  useGetDevTasksQuery,
  useGetQueueStatusQuery,
  useApproveDevTaskMutation,
  useRejectDevTaskMutation,
  useRetryDevTaskMutation,
  useExecuteDevTaskMutation,
  DevTask,
} from '../lib/services/devTaskApi';

const TYPE_LABELS: Record<string, string> = {
  bug: 'BUG',
  feature: 'FEATURE',
  improvement: 'IMPROVE',
  question: 'QUESTION',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  needs_review: 'Review',
  queued_credits: 'Queued',
  approved: 'Approved',
  rejected: 'Rejected',
};

export default function DevNotesScreen() {
  const router = useRouter();
  const [noteText, setNoteText] = useState('');
  const [showTasks, setShowTasks] = useState(false);
  const textInputRef = useRef<TextInput>(null);

  const [submitNotes, { isLoading: isSubmitting, data: submitResult }] = useSubmitNotesMutation();
  const { data: tasks, refetch: refetchTasks, isLoading: loadingTasks } = useGetDevTasksQuery();
  const { data: queueStatus, refetch: refetchStatus } = useGetQueueStatusQuery();
  const [approveTask] = useApproveDevTaskMutation();
  const [rejectTask] = useRejectDevTaskMutation();
  const [retryTask] = useRetryDevTaskMutation();
  const [executeTask] = useExecuteDevTaskMutation();
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!noteText.trim() || isSubmitting) return;

    try {
      const result = await submitNotes({ text: noteText }).unwrap();
      if (result.ok && result.tasks.length > 0) {
        setShowTasks(true);
        setNoteText('');
      }
    } catch (err) {
      console.error('[DevNotes] Submit failed:', err);
    }
  }, [noteText, isSubmitting, submitNotes]);

  const handleRefresh = useCallback(() => {
    refetchTasks();
    refetchStatus();
  }, [refetchTasks, refetchStatus]);

  const renderTaskCard = (task: DevTask) => {
    const isReviewable = task.status === 'needs_review';
    const isRetryable = task.status === 'failed';
    const isExecutable = task.status === 'approved';
    const hasAnalysis = task.analysis && (task.analysis.pros?.length > 0 || task.analysis.cons?.length > 0);
    const isExpanded = expandedAnalysis === (task.documentId || task.id.toString());

    return (
      <View
        key={task.documentId || task.id}
        style={[
          styles.taskCard,
          task.status === 'running' && styles.taskCardRunning,
          task.status === 'failed' && styles.taskCardFailed,
          task.status === 'completed' && styles.taskCardCompleted,
        ]}
      >
        <View style={styles.taskCardHeader}>
          <View style={[styles.typeBadge, task.type === 'bug' && styles.typeBadgeBug]}>
            <Text style={[styles.typeBadgeText, task.type === 'bug' && styles.typeBadgeTextBug]}>
              {TYPE_LABELS[task.type] || task.type}
            </Text>
          </View>
          <Text style={styles.statusText}>{STATUS_LABELS[task.status] || task.status}</Text>
        </View>

        <Text style={styles.taskDescription} numberOfLines={isExpanded ? undefined : 3}>
          {task.description}
        </Text>

        <View style={styles.taskMeta}>
          {task.project ? <Text style={styles.taskProject}>{task.project}</Text> : null}
          {task.model ? <Text style={styles.taskModel}>{task.model}</Text> : null}
          {task.git_commit ? <Text style={styles.taskGit}>#{task.git_commit}</Text> : null}
        </View>

        {/* Analysis Section (Pros/Cons) */}
        {hasAnalysis && (
          <>
            <TouchableOpacity
              style={styles.analysisToggle}
              onPress={() => setExpandedAnalysis(isExpanded ? null : (task.documentId || task.id.toString()))}
            >
              <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
              <Text style={styles.analysisToggleText}>
                {isExpanded ? 'Hide Analysis' : 'View Analysis'}
              </Text>
            </TouchableOpacity>

            {isExpanded && task.analysis && (
              <View style={styles.analysisContainer}>
                {task.analysis.pros?.length > 0 && (
                  <View style={styles.analysisSection}>
                    <Text style={styles.analysisSectionTitle}>Pros</Text>
                    {task.analysis.pros.map((p: string, i: number) => (
                      <Text key={i} style={styles.analysisItem}>+ {p}</Text>
                    ))}
                  </View>
                )}
                {task.analysis.cons?.length > 0 && (
                  <View style={styles.analysisSection}>
                    <Text style={styles.analysisSectionTitle}>Cons</Text>
                    {task.analysis.cons.map((c: string, i: number) => (
                      <Text key={i} style={styles.analysisItemCon}>- {c}</Text>
                    ))}
                  </View>
                )}
                {task.analysis.recommendation ? (
                  <View style={styles.analysisSection}>
                    <Text style={styles.analysisSectionTitle}>Recommendation</Text>
                    <Text style={styles.analysisRec}>{task.analysis.recommendation}</Text>
                  </View>
                ) : null}
                {task.analysis.scope ? (
                  <Text style={styles.analysisScope}>Scope: {task.analysis.scope}</Text>
                ) : null}
              </View>
            )}
          </>
        )}

        {isReviewable && (
          <View style={styles.taskActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn]}
              onPress={() => approveTask(task.documentId)}
            >
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              onPress={() => rejectTask(task.documentId)}
            >
              <Text style={styles.rejectBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        )}

        {isExecutable && (
          <View style={styles.taskActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.executeBtn]}
              onPress={() => executeTask(task.documentId)}
            >
              <Feather name="play" size={12} color={colors.accent} />
              <Text style={styles.executeBtnText}>Execute</Text>
            </TouchableOpacity>
          </View>
        )}

        {isRetryable && (
          <View style={styles.taskActions}>
            <TouchableOpacity
              style={[styles.actionBtn]}
              onPress={() => retryTask(task.documentId)}
            >
              <Text style={styles.actionBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {task.error ? (
          <Text style={styles.taskError}>{task.error}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.headerIcon}
          />
          <Text style={styles.headerTitle}>Dev Notes</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => router.push('/dev-hub')}
          >
            <Feather name="monitor" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerAction}
            onPress={() => setShowTasks(!showTasks)}
          >
            <Feather
              name={showTasks ? 'edit-3' : 'list'}
              size={20}
              color={colors.textPrimary}
            />
            {queueStatus && queueStatus.pending > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{queueStatus.pending}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {!showTasks ? (
        /* Notepad View */
        <>
          <View style={styles.subtitleBar}>
            <Text style={styles.subtitle}>
              Paste notes, bugs, or feature ideas. Each item will be parsed and triaged.
            </Text>
          </View>

          <View style={styles.notepadBody}>
            <TextInput
              ref={textInputRef}
              style={styles.notepadInput}
              multiline
              placeholder="Start writing..."
              placeholderTextColor={colors.textMuted}
              value={noteText}
              onChangeText={setNoteText}
              textAlignVertical="top"
              autoFocus
            />
          </View>

          <View style={styles.footer}>
            {submitResult && submitResult.ok && (
              <Text style={styles.resultText}>
                Parsed {submitResult.parsed} items into {submitResult.tasks.length} tasks
              </Text>
            )}
            <TouchableOpacity
              style={[styles.submitBtn, (!noteText.trim() || isSubmitting) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!noteText.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Parse and Triage</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      ) : (
        /* Task List View */
        <ScrollView
          style={styles.taskList}
          contentContainerStyle={styles.taskListContent}
          refreshControl={
            <RefreshControl refreshing={loadingTasks} onRefresh={handleRefresh} />
          }
        >
          {/* Queue Status Bar */}
          {queueStatus && (
            <View style={styles.queueBar}>
              <Text style={styles.queueStat}>
                {queueStatus.pending} pending
              </Text>
              <Text style={styles.queueStatDot}> -- </Text>
              <Text style={styles.queueStat}>
                {queueStatus.running} running
              </Text>
              <Text style={styles.queueStatDot}> -- </Text>
              <Text style={styles.queueStat}>
                {queueStatus.completed} done
              </Text>
              {queueStatus.needsReview > 0 && (
                <>
                  <Text style={styles.queueStatDot}> -- </Text>
                  <Text style={[styles.queueStat, styles.queueStatReview]}>
                    {queueStatus.needsReview} review
                  </Text>
                </>
              )}
            </View>
          )}

          {tasks && tasks.length > 0 ? (
            tasks.map(renderTaskCard)
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No tasks yet</Text>
              <Text style={styles.emptySubtext}>Submit notes to create tasks</Text>
            </View>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  headerAction: {
    padding: spacing.xs,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    backgroundColor: colors.accent,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: colors.bg,
    fontSize: 10,
    fontWeight: '700',
  },

  // Subtitle
  subtitleBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },

  // Notepad
  notepadBody: {
    flex: 1,
  },
  notepadInput: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    fontSize: 15,
    lineHeight: 30,
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'System' : undefined,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  resultText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  submitBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: radius.md,
    minWidth: 180,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '600',
  },

  // Task List
  taskList: {
    flex: 1,
  },
  taskListContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  queueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  queueStat: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  queueStatDot: {
    fontSize: 12,
    color: colors.border,
  },
  queueStatReview: {
    fontWeight: '600',
    color: colors.textSecondary,
  },

  // Task Card
  taskCard: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  taskCardRunning: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  taskCardFailed: {
    borderLeftWidth: 3,
    borderLeftColor: '#C44',
  },
  taskCardCompleted: {
    opacity: 0.6,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  typeBadge: {
    backgroundColor: colors.bgInput,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  typeBadgeBug: {
    backgroundColor: '#FDE',
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textSecondary,
  },
  typeBadgeTextBug: {
    color: '#C44',
  },
  statusText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  taskDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  taskMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  taskProject: {
    fontSize: 11,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  taskModel: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Actions
  taskActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  approveBtn: {
    borderColor: colors.accent,
  },
  approveBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  rejectBtn: {
    borderColor: '#C44',
  },
  rejectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C44',
  },
  taskError: {
    fontSize: 11,
    color: '#C44',
    marginTop: spacing.sm,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Analysis
  analysisToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.sm,
    paddingVertical: 4,
  },
  analysisToggleText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  analysisContainer: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  analysisSection: {
    gap: 4,
  },
  analysisSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  analysisItem: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    paddingLeft: spacing.sm,
  },
  analysisItemCon: {
    fontSize: 13,
    lineHeight: 18,
    color: '#996',
    paddingLeft: spacing.sm,
  },
  analysisRec: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
    fontStyle: 'italic',
  },
  analysisScope: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Execute button
  executeBtn: {
    borderColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  executeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },

  // Header actions row
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  // Git commit indicator
  taskGit: {
    fontSize: 11,
    color: colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.borderDark,
  },
});

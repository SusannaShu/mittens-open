/**
 * SyncProgressOverlay -- Full-screen overlay shown during local -> cloud data sync.
 *
 * In the open-source version this is a no-op overlay.
 */

import { View, Text, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { SyncProgress } from '../../lib/services/syncEngine';

interface Props {
  visible: boolean;
  progress: SyncProgress | null;
  error?: string | null;
}

export default function SyncProgressOverlay({ visible, progress, error }: Props) {
  if (!visible) return null;

  const pct = progress?.overallPct || 0;
  const isDone = pct >= 100 && !error;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={s.card}>
          <View style={s.header}>
            <Feather
              name={isDone ? 'check-circle' : 'upload-cloud'}
              size={28}
              color={isDone ? '#4CAF50' : colors.textPrimary}
            />
            <Text style={s.title}>
              {isDone ? 'Sync Complete' : 'Syncing to Cloud'}
            </Text>
            {!isDone && (
              <Text style={s.subtitle}>
                Uploading your local data to your account...
              </Text>
            )}
          </View>

          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.min(pct, 100)}%` }]} />
          </View>
          <Text style={s.pctText}>{pct}%</Text>

          {progress && !isDone && (
            <View style={s.statusRow}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={s.statusText}>
                {progress.currentTable} ({progress.currentIndex}/{progress.totalForTable})
              </Text>
            </View>
          )}

          {isDone && (
            <View style={s.doneRow}>
              <Feather name="check" size={14} color="#4CAF50" />
              <Text style={s.doneText}>All data synced. You're on cloud mode now.</Text>
            </View>
          )}

          {error && (
            <View style={s.errorRow}>
              <Feather name="alert-circle" size={14} color="#D32F2F" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          {progress && (
            <View style={s.breakdown}>
              <Text style={s.breakdownTitle}>
                {progress.tablesCompleted}/{progress.totalTables} categories synced
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.textPrimary,
    borderRadius: 4,
  },
  pctText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
  },
  statusText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  doneText: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '500',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  errorText: {
    fontSize: 12,
    color: '#D32F2F',
    flex: 1,
  },
  breakdown: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    width: '100%',
    alignItems: 'center',
  },
  breakdownTitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
});

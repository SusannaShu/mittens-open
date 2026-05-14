/**
 * locationTimelineStyles.ts -- StyleSheet for LocationTimelineModal.
 */

import { StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';

export const timelineStyles = StyleSheet.create({
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

  // Type picker
  typePickerRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
    marginTop: 8, marginBottom: 4,
    padding: 8, backgroundColor: '#F5F5F5', borderRadius: radius.sm,
  },
  typeChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: '#E5E5EA',
  },
  typeChipActive: {
    backgroundColor: colors.textPrimary,
  },
  typeChipText: {
    fontSize: 10, fontWeight: '600', color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  typeChipTextActive: {
    color: '#FFF',
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

  // Life Design per-row
  ldRow: {
    flexDirection: 'row', gap: 8, marginTop: 6,
    paddingVertical: 4, paddingHorizontal: 6,
    backgroundColor: '#FAFAFA', borderRadius: radius.sm,
  },
  ldItem: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  ldLabel: {
    fontSize: 10, fontWeight: '700',
  },
  ldValue: {
    fontSize: 10, color: colors.textSecondary, fontWeight: '600',
    minWidth: 22, textAlign: 'center',
  },
  ldSteppers: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  ldBtn: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center',
  },
  ldBtnText: {
    fontSize: 12, fontWeight: '700', color: colors.textPrimary,
    lineHeight: 14,
  },

  // AEIOU read-only
  aeiouRow: {
    marginTop: 6, gap: 2,
  },
  aeiouText: {
    fontSize: 11, color: colors.textSecondary,
  },

  // AEIOU editable
  aeiouEditSection: {
    marginTop: 8, gap: 4,
    padding: 8, backgroundColor: '#F5F5F5', borderRadius: radius.sm,
  },
  aeiouEditRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  aeiouEditLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textSecondary,
    width: 16,
  },
  aeiouEditInput: {
    flex: 1, fontSize: 12, color: colors.textPrimary,
    paddingVertical: 2, paddingHorizontal: 6,
    backgroundColor: '#FFF', borderRadius: 4,
    borderWidth: 1, borderColor: colors.border,
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
});

/**
 * Styles for ActivityEditModal and its sub-components.
 */

import { StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';

export const activityEditStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '90%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary,
    textTransform: 'capitalize', flex: 1,
  },
  label: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4, marginTop: spacing.md,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, fontSize: 14, color: colors.textPrimary,
  },

  // Date selector rail
  dateSelectorRail: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 8, height: 40,
  },
  dateSelectBtn: {
    padding: spacing.xs,
  },
  dateSelectorText: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary,
  },

  // Time picker
  timePicker: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  dateArrow: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  dateLabel: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary,
    minWidth: 120, textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  timeInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    width: 44, height: 38, textAlign: 'center',
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  timeColon: {
    fontSize: 18, fontWeight: '700', color: colors.textPrimary,
  },
  ampmRow: {
    flexDirection: 'row', marginLeft: 4,
  },
  ampmBtn: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  ampmBtnActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  ampmText: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
  },
  ampmTextActive: {
    color: colors.bg,
  },
  timeApplyBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center', alignItems: 'center',
    marginLeft: 'auto',
  },

  // Time grid
  timeGrid: {
    flexDirection: 'row', gap: 10, marginTop: spacing.md,
  },
  timeGridCol: {
    flex: 1,
  },
  timeGridLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  timeGridButton: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, height: 40, justifyContent: 'center',
  },
  timeGridButtonText: {
    fontSize: 13, color: colors.textPrimary,
  },
  durationInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, fontSize: 14, color: colors.textPrimary, height: 40,
  },

  // Scales (engagement / energy)
  scaleRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 4,
  },
  scaleDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  scaleDotActive: { backgroundColor: colors.textPrimary },
  scaleDotText: { fontSize: 9, fontWeight: '600', color: colors.textMuted },
  scaleDotTextActive: { color: colors.bg },
  scaleLabels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 2,
  },
  scaleLabel: { fontSize: 9, color: colors.textMuted },

  // Life categories
  lifeCatContainer: {
    gap: 8, marginTop: 4,
  },
  lifeCatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  lifeCatLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textPrimary,
    textTransform: 'capitalize', width: 44,
  },
  lifeCatBar: {
    flexDirection: 'row', flex: 1, justifyContent: 'space-between',
  },
  lifeCatDot: {
    width: 28, height: 24, borderRadius: 4,
    backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  lifeCatDotActive: {
    backgroundColor: colors.textPrimary, borderColor: colors.textPrimary,
  },
  lifeCatDotText: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
  },
  lifeCatDotTextActive: {
    color: colors.bg,
  },

  // AEIOU
  aeiouRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8,
  },
  aeiouKey: {
    fontSize: 14, fontWeight: '800', color: colors.textPrimary,
    width: 18, textAlign: 'center', marginTop: 18,
  },
  aeiouInputWrap: {
    flex: 1,
  },
  aeiouLabel: {
    fontSize: 10, color: colors.textMuted, fontWeight: '500',
    marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  aeiouInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 8, fontSize: 13, color: colors.textPrimary,
    minHeight: 36,
  },

  // Sticky footer
  stickyActions: {
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },

  // Buttons
  saveBtn: {
    backgroundColor: colors.textPrimary, borderRadius: radius.md,
    paddingVertical: 12, alignItems: 'center', marginTop: spacing.xs,
  },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: spacing.xs,
  },
  deleteBtnText: { fontSize: 13, color: colors.textMuted },

  // Sun exposure
  sunSection: {
    marginTop: spacing.sm,
    backgroundColor: '#FAFAFA',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coverageRow: {
    flexDirection: 'row', gap: 6, marginTop: 4,
  },
  coverageChip: {
    flex: 1, alignItems: 'center', paddingVertical: 8,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  coverageChipActive: {
    backgroundColor: colors.textPrimary, borderColor: colors.textPrimary,
  },
  coverageChipPct: {
    fontSize: 13, fontWeight: '700', color: colors.textPrimary,
  },
  coverageChipPctActive: { color: '#FFF' },
  coverageChipLabel: {
    fontSize: 9, color: colors.textMuted, marginTop: 1,
  },
  coverageChipLabelActive: { color: '#FFF' },
  sunscreenRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  sunscreenLabel: {
    fontSize: 13, color: colors.textPrimary, fontWeight: '500',
  },
  sunscreenToggle: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  sunscreenToggleActive: {
    backgroundColor: colors.textPrimary, borderColor: colors.textPrimary,
  },
  sunscreenToggleText: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
  },
  sunscreenToggleTextActive: { color: '#FFF' },
  vitDNote: {
    fontSize: 11, color: colors.textSecondary, marginTop: spacing.sm,
    fontStyle: 'italic', lineHeight: 16,
  },

  // Outdoor/Nature/Movement toggle rows
  contextToggleRow: {
    flexDirection: 'row', gap: 8, marginTop: spacing.md, marginBottom: spacing.sm,
  },
});

/**
 * nutrientDetailStyles -- Extracted styles for NutrientDetailSheet.
 */

import { StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';

export const s = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: spacing.md,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  emptySearchWrap: {
    width: '100%',
    marginTop: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  sourceLabel: {
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: 4,
    fontStyle: 'italic',
  },

  scrollBody: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },

  // Macros
  macroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: spacing.md,
  },
  macroCell: {
    width: '31%',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  macroValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  macroLabel: {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
  },

  // Micros
  microSection: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  microHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    marginBottom: 2,
  },
  microHeaderLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  microHeaderVal: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    minWidth: 60,
    textAlign: 'right',
  },
  microRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  flaggedRow: {
    backgroundColor: '#FFF8F0',
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  microLabelCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  microLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  microValueUsda: {
    fontSize: 12,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  microValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
    textAlign: 'right',
  },
  microValueAdjusted: {
    color: '#1a73e8',
  },
  microRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tag: {
    fontSize: 8,
    fontWeight: '600',
    color: colors.textMuted,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  flagTag: {
    fontSize: 7,
    fontWeight: '700',
    color: '#B45309',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  adjTag: {
    fontSize: 7,
    fontWeight: '700',
    color: '#1a73e8',
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },

  // Accordion
  accordion: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    backgroundColor: '#FAFAFA',
  },
  accordionTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  accordionBody: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },

  // USDA ref
  refRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  refRowSelected: {
    backgroundColor: '#F0F7FF',
    marginHorizontal: -4,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  refNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  refNameLink: {
    fontSize: 12,
    color: colors.textMuted,
    flex: 1,
  },
  refNameSelected: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  refName: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },
  refScore: {
    fontSize: 11,
    color: colors.textMuted,
  },
  otherRefsLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 4,
  },
  otherRefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  otherRefName: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
  },
  otherRefNameLink: {
    fontSize: 11,
    color: colors.accent || '#1a73e8',
    textDecorationLine: 'underline',
    flex: 1,
  },
  otherRefScore: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // AI adjustments
  adjRow: { marginBottom: 8 },
  adjHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  adjLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  adjValues: { fontSize: 11, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  adjReason: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  reasoning: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },

  // Retention
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  severityLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'capitalize',
    width: 70,
  },
  severityBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#F0F0F0',
    borderRadius: 2,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  severityFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4A574',
  },
  severityValue: {
    fontSize: 10,
    color: colors.textMuted,
    width: 36,
    textAlign: 'right',
  },
  retentionRow: { marginBottom: 6 },
  retLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  retValues: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
  retPct: { fontSize: 10, color: colors.textMuted },

  // Interactions
  interRow: { marginBottom: 8 },
  interHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  interLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  interType: { fontSize: 9, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  synergy: { backgroundColor: '#E8E8E8', color: '#333' },
  inhibitor: { backgroundColor: '#F0F0F0', color: '#999' },
  interValues: { fontSize: 11, color: colors.textSecondary, marginTop: 1, fontVariant: ['tabular-nums'] },
  interReason: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  interSource: { fontSize: 10, color: colors.textMuted, marginTop: 1, fontWeight: '500' },

  // Education cards
  eduCard: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#F8F6F0',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#D4C9A8',
  },
  eduTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  eduBody: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  eduFoods: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 6,
    fontStyle: 'italic',
  },
  eduTip: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E0D4',
  },

  // AI estimate banner
  aiEstimateBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    backgroundColor: '#F5F3FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E9E5F5',
  },
  aiEstimateTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },
  aiEstimateSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 15,
  },

  // Apply pill button (in USDA reference accordion)
  applyPill: {
    height: 24,
    paddingHorizontal: 10,
    backgroundColor: colors.textPrimary,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  applyPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
});

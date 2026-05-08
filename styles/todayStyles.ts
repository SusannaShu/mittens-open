import { StyleSheet } from 'react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';

export const todayStyles = StyleSheet.create({
  fullContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  greeting: { fontFamily: fonts.heading, fontSize: 26, color: colors.textPrimary },
  date: { fontSize: 13, color: colors.textMuted },
  headAddBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.textPrimary, justifyContent: 'center', alignItems: 'center',
  },
  headAddBtnText: { color: colors.bg, fontSize: 22, fontWeight: '400', marginTop: -2 },

  storyCard: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },

  section: { marginBottom: spacing.xl },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 12, color: colors.textMuted, letterSpacing: 1.5 },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: spacing.md },

  logContainer: { marginBottom: spacing.md },
  logHeader: { flexDirection: 'row', alignItems: 'center' },
  logDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textPrimary, marginRight: spacing.md },
  logName: { fontWeight: '600', fontSize: 15, color: colors.textPrimary },
  logMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  nutrientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  nutrientName: { width: 80, fontSize: 12, color: colors.textSecondary },
  nutrientTrack: { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, marginHorizontal: 8, overflow: 'hidden' },
  nutrientFill: { height: '100%', borderRadius: 3 },
  projectedFill: {
    position: 'absolute', top: 0, bottom: 0, borderRadius: 3,
    flexDirection: 'row', overflow: 'hidden', opacity: 0.4,
  },
  projectedStripe: {
    width: 2, height: '100%', backgroundColor: colors.textPrimary,
    marginRight: 2,
  },
  nutrientPct: { width: 36, fontSize: 12, textAlign: 'right', fontWeight: '600' },
  nutrientDetails: {
    marginLeft: 80 + 8, marginTop: 4, marginBottom: 8, paddingLeft: 10,
    borderLeftWidth: 2, borderLeftColor: colors.border,
  },
  detailsLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  sourceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  sourceName: { fontSize: 12, color: colors.textSecondary, textTransform: 'capitalize', flex: 1, flexShrink: 1, marginRight: 8 },
  sourceVal: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  sourceNone: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },

  recRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  recFood: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize' },
  recHelps: { fontSize: 12, color: colors.textMuted },
  seeMoreBtn: { alignItems: 'center', paddingVertical: spacing.md },
  seeMoreText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },

  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  editText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  // Nutrient detail modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  nutrientModal: {
    backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingBottom: 40, maxHeight: '70%',
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginTop: 12, marginBottom: 16,
  },
  modalTitle: { fontFamily: fonts.heading, fontSize: 20, color: colors.textPrimary, marginBottom: 4 },
  nutrientModalSub: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },
  nutrientModalDivider: { height: 1, backgroundColor: colors.border, marginBottom: 16 },
  nutrientModalHint: { fontSize: 11, color: colors.textMuted, marginBottom: 12 },
  recFoodRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  recFoodName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, textTransform: 'capitalize' },
  recFoodPortion: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  recFoodAmount: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, minWidth: 60, textAlign: 'right' },
  modalCloseBtn: {
    marginTop: 20, paddingVertical: 14, borderRadius: radius.full,
    backgroundColor: colors.textPrimary, alignItems: 'center',
  },
  modalCloseBtnText: { color: '#FFF', fontSize: 15, fontWeight: '600' },

  // Pantry inventory
  pantryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pantryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  pantryName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  pantryQty: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  pantryFreshness: {
    fontSize: 13,
    fontWeight: '600',
  },
  pantryAge: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
});

export const gaugeStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6,
  },
  label: {
    width: 55, fontSize: 13, fontWeight: '500', color: colors.textPrimary, marginLeft: 8,
  },
  track: {
    flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden', marginHorizontal: 8,
  },
  fill: {
    height: '100%', backgroundColor: colors.textPrimary, borderRadius: 4,
  },
  pct: {
    width: 32, fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'right',
  },
  breakdown: {
    marginLeft: 22, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: colors.border,
    marginBottom: 4,
  },
  breakdownRow: {
    paddingVertical: 4,
  },
  breakdownName: {
    fontSize: 12, fontWeight: '600', color: colors.textSecondary,
  },
  breakdownMeta: {
    fontSize: 10, color: colors.textMuted, marginTop: 1,
  },
  breakdownEmpty: {
    fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginLeft: 22, marginBottom: 4,
  },
});

import { StyleSheet } from 'react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';

export const syncStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  dateNav: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.sm,
  },
  todayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  todayBtnText: {
    fontSize: 11, fontWeight: '600', color: colors.textPrimary,
  },
  dateText: { fontFamily: fonts.heading, fontSize: 16, color: colors.textPrimary },
  viewToggle: {
    flexDirection: 'row', backgroundColor: colors.bgCard,
    borderRadius: radius.sm, padding: 2,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 6, alignItems: 'center',
    borderRadius: radius.sm - 2,
  },
  toggleBtnActive: {
    backgroundColor: colors.bg,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 2, elevation: 1,
  },
  toggleText: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  toggleTextActive: { color: colors.textPrimary, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 80 },
  emptyTitle: {
    fontFamily: fonts.heading, fontSize: 18,
    color: colors.textPrimary, marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 19, maxWidth: 280,
  },
  addBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center', alignItems: 'center',
    marginLeft: spacing.sm,
  },
  addBtnText: { color: colors.bg, fontSize: 18, fontWeight: '400', marginTop: -1 },
});

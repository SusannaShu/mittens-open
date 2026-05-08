import { StyleSheet } from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';

export const profileStyles = StyleSheet.create({
  fullContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  greeting: { fontFamily: fonts.heading, fontSize: 24, color: colors.textPrimary, marginBottom: 2 },
  date: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg },

  card: {
    backgroundColor: colors.bgCard, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  cardTitle: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },
  editLink: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  cardBody: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.md },

  profileRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  profileKey: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  profileVal: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },

  editRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  editInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, width: 80, textAlign: 'right', padding: 4, fontSize: 14, color: colors.textPrimary, backgroundColor: '#FFF' },
  choiceBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, width: 30, alignItems: 'center', paddingVertical: 4 },
  choiceBtnActive: { backgroundColor: colors.textPrimary },
  choiceText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  choiceTextActive: { color: colors.bg },

  actBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#FFF' },
  actBtnActive: { backgroundColor: colors.textPrimary },
  actText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'capitalize' },
  actTextActive: { color: colors.bg },

  rulesInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: spacing.md, fontSize: 14, color: colors.textPrimary,
    minHeight: 100, textAlignVertical: 'top', marginBottom: spacing.md,
    backgroundColor: '#F7F7F7',
  },
  saveBtn: { backgroundColor: colors.textPrimary, paddingVertical: 10, borderRadius: radius.full, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: '600', fontSize: 14 },

  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.5 },

  integrationRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  integrationIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center',
  },
  rowLabel: {
    fontSize: 9, fontWeight: '700' as const, color: '#999', letterSpacing: 1.2,
    marginBottom: 6, marginTop: 4,
  },
  configInput: {
    borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6, fontSize: 13,
    color: '#1A1A1A', backgroundColor: '#FAFAFA', marginBottom: 6,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4, marginRight: 6,
  },
  queueBadge: {
    fontSize: 10, fontWeight: '600' as const, color: '#E67E22',
    marginLeft: 8,
  },
});

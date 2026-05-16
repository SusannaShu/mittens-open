/**
 * ActivityTypeEditSheet -- Bottom-sheet modal for editing/creating an activity type.
 * Extracted from ActivityTypeEditor to keep files under 400 lines.
 */

import { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  Modal, KeyboardAvoidingView, Platform,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../lib/theme';
import type { ActivityTypeModel } from '../../lib/pipelines/types';

const LIFE_CATEGORIES = ['work', 'health', 'play', 'love'] as const;
const LIFE_COLORS: Record<string, string> = {
  work: '#3B82F6', health: '#10B981', play: '#F59E0B', love: '#EF4444',
};

const ICON_OPTIONS = [
  'circle', 'activity', 'wind', 'book-open', 'book', 'pen-tool',
  'smartphone', 'monitor', 'sun', 'users', 'moon', 'coffee',
  'map-pin', 'music', 'camera', 'shopping-bag', 'heart', 'star',
  'zap', 'target', 'flag', 'gift', 'headphones', 'film',
];

const MET_PRESETS = [
  { value: 1.0, label: 'Yoga' },
  { value: 2.5, label: 'Dance' },
  { value: 3.5, label: 'Walk' },
  { value: 5.0, label: 'Gym' },
  { value: 8.0, label: 'Run' },
];

const COVERAGE_PRESETS = [
  { value: 10, label: 'Face' },
  { value: 25, label: '+Arms' },
  { value: 50, label: '+Legs' },
  { value: 75, label: 'Swim' },
  { value: 90, label: 'Full' },
];

interface Props {
  type: ActivityTypeModel;
  onSave: (t: ActivityTypeModel) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ActivityTypeEditSheet({ type, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<ActivityTypeModel>({ ...type });
  const [showIcons, setShowIcons] = useState(false);
  const insets = useSafeAreaInsets();

  const updateDraft = (updates: Partial<ActivityTypeModel>) => {
    setDraft(prev => ({ ...prev, ...updates }));
  };

  const toggleSubCategory = (sub: string) => {
    const subs = [...(draft.subCategories || [])];
    if (subs.includes(sub)) {
      updateDraft({ subCategories: subs.filter(s => s !== sub) });
    } else {
      updateDraft({ subCategories: [...subs, sub] });
    }
  };

  const updateLifeCategory = (cat: string, value: number) => {
    const cats = { ...(draft.defaultLifeCategories || {}) };
    if (value <= 0) {
      delete cats[cat];
    } else {
      cats[cat] = Math.min(1, Math.round(value * 10) / 10);
    }
    updateDraft({ defaultLifeCategories: cats });
  };

  const totalWeight = Object.values(draft.defaultLifeCategories || {}).reduce((a, b) => a + (b as number), 0);
  const hasMovement = draft.subCategories?.includes('movement');
  const hasNature = draft.subCategories?.includes('nature');
  const hasBrainHygiene = draft.subCategories?.includes('brain_hygiene');

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />

        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={st.dragHandle} />

          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
              {type.isBuiltIn ? 'Edit Type' : (type.label ? 'Edit Type' : 'New Type')}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces style={{ flex: 1 }}>
            {/* Icon + Label */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: spacing.md }}>
              <TouchableOpacity style={st.iconPicker} onPress={() => setShowIcons(!showIcons)}>
                <Feather name={(draft.icon || 'circle') as any} size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <TextInput
                style={[st.input, { flex: 1 }]}
                value={draft.label}
                onChangeText={(v) => updateDraft({ label: v })}
                placeholder="Activity name"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            {/* Icon picker grid */}
            {showIcons && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md }}>
                {ICON_OPTIONS.map((ic) => (
                  <TouchableOpacity
                    key={ic}
                    style={[st.iconOption, draft.icon === ic && st.iconOptionActive]}
                    onPress={() => { updateDraft({ icon: ic }); setShowIcons(false); }}
                  >
                    <Feather name={ic as any} size={16} color={draft.icon === ic ? '#fff' : colors.textPrimary} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Default METs */}
            <Text style={st.fieldLabel}>Default METs</Text>
            <TextInput
              style={st.input}
              value={String(draft.defaultMets || '')}
              onChangeText={(v) => updateDraft({ defaultMets: parseFloat(v) || 0 })}
              keyboardType="decimal-pad"
              placeholder="1.5"
              placeholderTextColor={colors.textMuted}
            />

            {/* Properties toggles */}
            <Text style={st.fieldLabel}>Properties</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {([
                ['showInTimer', 'In Timer'],
                ['showInManualLog', 'In Manual Log'],
                ['mentionDuringBreak', 'Mention in Break'],
              ] as [keyof ActivityTypeModel, string][]).map(([field, label]) => (
                <TouchableOpacity
                  key={field}
                  style={[st.toggle, draft[field] && st.toggleActive]}
                  onPress={() => updateDraft({ [field]: !draft[field] } as any)}
                >
                  <Text style={[st.toggleText, draft[field] && st.toggleTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Life Categories */}
            <Text style={st.fieldLabel}>Life Balance Weights{totalWeight > 0 ? ` (${totalWeight.toFixed(1)})` : ''}</Text>
            {LIFE_CATEGORIES.map((cat) => {
              const val = (draft.defaultLifeCategories?.[cat] as number) || 0;
              return (
                <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <View style={[st.catDot, { backgroundColor: LIFE_COLORS[cat], width: 10, height: 10 }]} />
                  <Text style={{ fontSize: 13, color: colors.textPrimary, width: 50, textTransform: 'capitalize' }}>{cat}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
                    {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((step) => (
                      <TouchableOpacity
                        key={step}
                        style={[st.weightBtn, Math.abs(val - step) < 0.05 && { backgroundColor: LIFE_COLORS[cat] }]}
                        onPress={() => updateLifeCategory(cat, step)}
                      >
                        <Text style={[st.weightText, Math.abs(val - step) < 0.05 && { color: '#fff' }]}>
                          {step === 0 ? '0' : step.toFixed(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}

            {/* Sub-categories -- single horizontal row */}
            <Text style={[st.fieldLabel, { marginTop: spacing.sm }]}>Sub-categories</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing.sm }}>
              {([
                ['movement', 'activity', 'Movement'],
                ['nature', 'cloud', 'Nature'],
                ['brain_hygiene', 'wind', 'Brain Hygiene'],
              ] as [string, string, string][]).map(([sub, icon, label]) => {
                const active = draft.subCategories?.includes(sub);
                return (
                  <TouchableOpacity
                    key={sub}
                    style={[st.contextToggle, active && st.contextToggleActive]}
                    onPress={() => toggleSubCategory(sub)}
                    activeOpacity={0.6}
                  >
                    <Text style={[st.contextToggleText, active && st.contextToggleTextActive]}>
                      <Feather name={icon as any} size={11} /> {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Movement expanded: MET preset chips */}
            {hasMovement && (
              <View style={st.subPanel}>
                <Text style={st.subPanelLabel}>Metabolic Equivalent (MET)</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  {MET_PRESETS.map(({ value, label }) => {
                    const selected = draft.defaultMets === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        style={[st.metChip, selected && st.metChipActive]}
                        onPress={() => updateDraft({ defaultMets: value })}
                        activeOpacity={0.6}
                      >
                        <Text style={[st.metChipValue, selected && st.metChipValueActive]}>{value}</Text>
                        <Text style={[st.metChipLabel, selected && st.metChipLabelActive]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Nature expanded: exposure extent only (skin color is set in onboarding) */}
            {hasNature && (
              <View style={st.subPanel}>
                <Text style={st.subPanelLabel}>Exposure Extent</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  {COVERAGE_PRESETS.map(({ value, label }) => {
                    const selected = (draft.exposureExtent || 10) === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        style={[st.metChip, selected && st.metChipActive]}
                        onPress={() => updateDraft({ exposureExtent: value })}
                        activeOpacity={0.6}
                      >
                        <Text style={[st.metChipValue, selected && st.metChipValueActive]}>{value}%</Text>
                        <Text style={[st.metChipLabel, selected && st.metChipLabelActive]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Brain Hygiene expanded: impact scale */}
            {hasBrainHygiene && (
              <View style={st.subPanel}>
                <Text style={st.subPanelLabel}>Impact Scale</Text>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                  {([-3, -2, -1, 0, 1, 2, 3]).map((val) => {
                    const current = draft.brainHygieneScale ?? 0;
                    const selected = current === val;
                    let bg = colors.border;
                    if (selected && val < 0) bg = '#EF4444';
                    if (selected && val > 0) bg = '#10B981';
                    if (selected && val === 0) bg = colors.textMuted;
                    return (
                      <TouchableOpacity
                        key={val}
                        style={[st.weightBtn, selected && { backgroundColor: bg }]}
                        onPress={() => updateDraft({ brainHygieneScale: val })}
                      >
                        <Text style={[st.weightText, selected && { color: '#fff' }]}>
                          {val > 0 ? `+${val}` : String(val)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={{ fontSize: 9, color: '#EF4444' }}>harmful</Text>
                  <Text style={{ fontSize: 9, color: '#10B981' }}>restorative</Text>
                </View>
              </View>
            )}

            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Actions */}
          <View style={st.actionBar}>
            {onDelete && (
              <TouchableOpacity style={st.deleteBtn} onPress={onDelete}>
                <Feather name="trash-2" size={14} color="#D32F2F" />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.saveBtn, !draft.label.trim() && { opacity: 0.4 }]}
              onPress={() => draft.label.trim() && onSave(draft)}
              disabled={!draft.label.trim()}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Styles ── */

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '88%', position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD', alignSelf: 'center', marginBottom: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: colors.textPrimary, marginBottom: spacing.sm,
  },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  toggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  toggleActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  toggleText: { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  toggleTextActive: { color: '#fff' },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  weightBtn: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 4, backgroundColor: colors.border },
  weightText: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  iconPicker: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  iconOption: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' },
  iconOptionActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  contextToggle: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  contextToggleActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  contextToggleText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  contextToggleTextActive: { color: '#fff' },
  subPanel: { backgroundColor: '#FAFAFA', borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  subPanelLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  metChip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  metChipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  metChipValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  metChipValueActive: { color: '#fff' },
  metChipLabel: { fontSize: 9, color: colors.textMuted, marginTop: 1 },
  metChipLabelActive: { color: '#fff' },
  actionBar: { flexDirection: 'row', gap: 10, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  saveBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: colors.textPrimary, borderRadius: radius.md },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  deleteBtn: { width: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D32F2F', borderRadius: radius.md },
});

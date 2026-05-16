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

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Backdrop */}
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />

        {/* Sheet container */}
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

          {/* Scrollable content */}
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

            {/* Sub-categories with expansion panels */}
            <Text style={[st.fieldLabel, { marginTop: spacing.sm }]}>Sub-categories</Text>
            {renderSubCategories(draft, updateDraft)}

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

/* ── Sub-category expansion panels ── */

function renderSubCategories(
  draft: ActivityTypeModel,
  updateDraft: (u: Partial<ActivityTypeModel>) => void,
) {
  return (['movement', 'nature', 'brain_hygiene'] as const).map((sub) => {
    const active = draft.subCategories?.includes(sub);
    const label = sub.replace(/_/g, ' ');
    return (
      <View key={sub} style={{ marginBottom: active ? spacing.sm : 0 }}>
        <TouchableOpacity
          style={[st.toggle, active && st.toggleActive, { alignSelf: 'flex-start', marginBottom: active ? 8 : 6 }]}
          onPress={() => {
            const subs = [...(draft.subCategories || [])];
            if (active) {
              updateDraft({ subCategories: subs.filter(s => s !== sub) });
            } else {
              updateDraft({ subCategories: [...subs, sub] });
            }
          }}
        >
          <Text style={[st.toggleText, active && st.toggleTextActive]}>{label}</Text>
        </TouchableOpacity>

        {/* Movement: MET input */}
        {active && sub === 'movement' && (
          <View style={st.subPanel}>
            <Text style={st.subPanelLabel}>Default METs</Text>
            <TextInput
              style={[st.input, { marginBottom: 0, width: 80, textAlign: 'center' }]}
              value={String(draft.defaultMets || '')}
              onChangeText={(v) => updateDraft({ defaultMets: parseFloat(v) || 0 })}
              keyboardType="decimal-pad"
              placeholder="1.5"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        )}

        {/* Nature: skin color + exposure extent */}
        {active && sub === 'nature' && (
          <View style={st.subPanel}>
            <View style={{ marginBottom: 10 }}>
              <Text style={st.subPanelLabel}>Skin Color (Fitzpatrick)</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                {([
                  [1, '#FAE0D0'], [2, '#F5CBA7'], [3, '#E5B280'],
                  [4, '#C68642'], [5, '#8D5524'], [6, '#3C2218'],
                ] as [number, string][]).map(([level, color]) => {
                  const val = `fitzpatrick-${level}`;
                  const selected = draft.skinType === val;
                  return (
                    <TouchableOpacity
                      key={val}
                      onPress={() => updateDraft({ skinType: val })}
                      style={{
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: color,
                        borderWidth: selected ? 2.5 : 1,
                        borderColor: selected ? colors.textPrimary : 'rgba(0,0,0,0.1)',
                      }}
                    />
                  );
                })}
              </View>
            </View>
            <View>
              <Text style={st.subPanelLabel}>Exposure Extent</Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                {([
                  [10, 'Face'], [25, '+Arms'], [50, '+Legs'], [75, 'Swim'], [90, 'Full'],
                ] as [number, string][]).map(([pct, lbl]) => {
                  const selected = (draft.exposureExtent || 10) === pct;
                  return (
                    <TouchableOpacity
                      key={pct}
                      style={[st.weightBtn, selected && { backgroundColor: colors.textPrimary }]}
                      onPress={() => updateDraft({ exposureExtent: pct })}
                    >
                      <Text style={[st.weightText, selected && { color: '#fff' }]}>{lbl}</Text>
                      <Text style={[st.weightText, { fontSize: 8 }, selected && { color: '#fff' }]}>{pct}%</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}

        {/* Brain Hygiene: negative to positive scale */}
        {active && sub === 'brain_hygiene' && (
          <View style={st.subPanel}>
            <Text style={st.subPanelLabel}>Impact Scale</Text>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
              {([-3, -2, -1, 0, 1, 2, 3]).map((val) => {
                const current = draft.brainHygieneScale ?? 0;
                const selected = current === val;
                const isNeg = val < 0;
                const isPos = val > 0;
                let bg = colors.border;
                if (selected && isNeg) bg = '#EF4444';
                if (selected && isPos) bg = '#10B981';
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
      </View>
    );
  });
}

/* ── Styles ── */

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '88%',
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  dragHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD',
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: colors.textPrimary, marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
  },
  toggle: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff',
  },
  toggleActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  toggleText: { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  toggleTextActive: { color: '#fff' },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  weightBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 4,
    borderRadius: 4, backgroundColor: colors.border,
  },
  weightText: { fontSize: 10, fontWeight: '600', color: colors.textMuted },
  iconPicker: {
    width: 48, height: 48, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  iconOption: {
    width: 36, height: 36, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  iconOptionActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  subPanel: {
    backgroundColor: '#F9F9F9', borderRadius: radius.md,
    padding: 10, borderWidth: 1, borderColor: colors.border,
  },
  subPanelLabel: {
    fontSize: 10, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.4, textTransform: 'uppercase',
  },
  actionBar: {
    flexDirection: 'row', gap: 10, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  saveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    backgroundColor: colors.textPrimary, borderRadius: radius.md,
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  deleteBtn: {
    width: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#D32F2F', borderRadius: radius.md,
  },
});

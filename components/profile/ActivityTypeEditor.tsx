/**
 * ActivityTypeEditor -- View, edit, and create custom activity types.
 * Used in the Profile tab. Full CRUD via ActivityTypeService.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, KeyboardAvoidingView, Platform,
  StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../lib/theme';
import { profileStyles as ps } from './profileStyles';
import { ActivityTypeService } from '../../lib/services/activityTypeService';
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
  collapsed: boolean;
  onToggle: () => void;
}

export function ActivityTypeEditor({ collapsed, onToggle }: Props) {
  const [types, setTypes] = useState<ActivityTypeModel[]>([]);
  const [editingType, setEditingType] = useState<ActivityTypeModel | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const loadTypes = useCallback(async () => {
    const all = await ActivityTypeService.getAll();
    setTypes(all);
  }, []);

  useEffect(() => { loadTypes(); }, [loadTypes]);

  const handleSave = async (updated: ActivityTypeModel) => {
    try {
      if (types.find(t => t.key === updated.key)) {
        await ActivityTypeService.update(updated.key, updated);
      } else {
        await ActivityTypeService.create({ ...updated, key: updated.key, label: updated.label });
      }
      setSheetVisible(false);
      setEditingType(null);
      loadTypes();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    }
  };

  const handleDelete = async (key: string) => {
    Alert.alert('Delete Activity Type?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await ActivityTypeService.delete(key);
            loadTypes();
          } catch (e: any) {
            Alert.alert('Error', e.message || 'Cannot delete');
          }
        },
      },
    ]);
  };

  const handleAdd = () => {
    const newKey = `custom_${Date.now()}`;
    setEditingType({
      key: newKey, label: '', icon: 'circle',
      defaultLifeCategories: { work: 1.0 },
      subCategories: [], defaultMets: 1.5,
      isStrength: false, isNature: false,
      defaultIntensity: 'moderate', defaultOutdoors: false,
      showInTimer: true, showInManualLog: true,
      sortOrder: types.length, isBuiltIn: false,
    });
    setSheetVisible(true);
  };

  return (
    <View style={ps.card}>
      <TouchableOpacity style={[ps.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="sliders" size={16} color={colors.textPrimary} />
          <Text style={ps.cardTitle}>ACTIVITY TYPES</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {types.length > 0 && <Text style={{ fontSize: 11, color: colors.textMuted }}>{types.length}</Text>}
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
            Customize which activities show in timer and logs, their life balance weights, and metadata.
          </Text>

          {types.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={st.typeRow}
              onPress={() => { setEditingType({ ...t }); setSheetVisible(true); }}
              activeOpacity={0.6}
            >
              <View style={st.typeIcon}>
                <Feather name={(t.icon || 'circle') as any} size={14} color={colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.typeLabel}>{t.label}</Text>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                  {t.defaultLifeCategories && Object.entries(t.defaultLifeCategories).map(([cat, weight]) => (
                    weight > 0 ? (
                      <View key={cat} style={[st.catDot, { backgroundColor: LIFE_COLORS[cat] || '#999', opacity: weight as number }]} />
                    ) : null
                  ))}
                  {t.isStrength && <Text style={st.badge}>STR</Text>}
                  {t.isNature && <Text style={st.badge}>NAT</Text>}
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{t.defaultMets} MET</Text>
              <Feather name="chevron-right" size={14} color={colors.textMuted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={st.addBtn} onPress={handleAdd} activeOpacity={0.7}>
            <Feather name="plus" size={14} color={colors.textPrimary} />
            <Text style={st.addText}>New Activity Type</Text>
          </TouchableOpacity>

          {/* Edit Sheet */}
          {sheetVisible && editingType && (
            <ActivityTypeEditSheet
              type={editingType}
              onSave={handleSave}
              onDelete={editingType.isBuiltIn ? undefined : () => handleDelete(editingType.key)}
              onClose={() => { setSheetVisible(false); setEditingType(null); }}
            />
          )}
        </>
      )}
    </View>
  );
}

/* ── Edit Sheet (fullscreen modal with ScrollView) ── */

function ActivityTypeEditSheet({
  type, onSave, onDelete, onClose,
}: {
  type: ActivityTypeModel;
  onSave: (t: ActivityTypeModel) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
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
        <TouchableOpacity
          style={st.overlay}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Sheet container */}
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Drag handle */}
          <View style={st.dragHandle} />

          {/* Header -- fixed */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
              {type.isBuiltIn ? 'Edit Type' : (type.label ? 'Edit Type' : 'New Type')}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Scrollable content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={true}
            style={{ flex: 1 }}
          >
            {/* Icon + Label */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: spacing.md }}>
              <TouchableOpacity
                style={st.iconPicker}
                onPress={() => setShowIcons(!showIcons)}
              >
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

            {/* METs */}
            <Text style={st.fieldLabel}>Default METs</Text>
            <TextInput
              style={st.input}
              value={String(draft.defaultMets || '')}
              onChangeText={(v) => updateDraft({ defaultMets: parseFloat(v) || 0 })}
              keyboardType="decimal-pad"
              placeholder="1.5"
              placeholderTextColor={colors.textMuted}
            />

            {/* Toggles */}
            <Text style={st.fieldLabel}>Properties</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {([
                ['isStrength', 'Strength'],
                ['isNature', 'Nature'],
                ['defaultOutdoors', 'Outdoors'],
                ['showInTimer', 'In Timer'],
                ['showInManualLog', 'In Manual Log'],
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
                        style={[
                          st.weightBtn,
                          Math.abs(val - step) < 0.05 && { backgroundColor: LIFE_COLORS[cat] },
                        ]}
                        onPress={() => updateLifeCategory(cat, step)}
                      >
                        <Text style={[
                          st.weightText,
                          Math.abs(val - step) < 0.05 && { color: '#fff' },
                        ]}>
                          {step === 0 ? '0' : step.toFixed(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}

            {/* Sub-categories */}
            <Text style={[st.fieldLabel, { marginTop: spacing.sm }]}>Sub-categories</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {['movement', 'touch_grass', 'brain_hygiene', 'brain_hygiene_neg', 'circadian'].map((sub) => {
                const active = draft.subCategories?.includes(sub);
                return (
                  <TouchableOpacity
                    key={sub}
                    style={[st.toggle, active && st.toggleActive]}
                    onPress={() => {
                      const subs = [...(draft.subCategories || [])];
                      if (active) {
                        updateDraft({ subCategories: subs.filter(s => s !== sub) });
                      } else {
                        updateDraft({ subCategories: [...subs, sub] });
                      }
                    }}
                  >
                    <Text style={[st.toggleText, active && st.toggleTextActive]}>
                      {sub.replace(/_/g, ' ')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Extra bottom space so content clears the buttons */}
            <View style={{ height: 80 }} />
          </ScrollView>

          {/* Actions -- pinned to bottom */}
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
  typeRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  typeIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F5F5',
    justifyContent: 'center', alignItems: 'center', marginRight: 10,
  },
  typeLabel: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  badge: {
    fontSize: 8, fontWeight: '700', color: colors.textMuted,
    backgroundColor: colors.border, paddingHorizontal: 4, paddingVertical: 1,
    borderRadius: 3, overflow: 'hidden', letterSpacing: 0.5,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, borderStyle: 'dashed',
  },
  addText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
  },
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

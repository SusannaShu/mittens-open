/**
 * ActivityTypeEditor -- View, edit, and create custom activity types.
 * Used in the Profile tab. Full CRUD via RTK Query activityTypeApi.
 */

import { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  Alert, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../lib/theme';
import { profileStyles as ps } from './profileStyles';
import {
  useGetActivityTypesQuery,
  useCreateActivityTypeMutation,
  useUpdateActivityTypeMutation,
  useDeleteActivityTypeMutation,
} from '../../lib/services/activityTypeApi';
import { ActivityTypeEditSheet } from './ActivityTypeEditSheet';
import type { ActivityTypeModel } from '../../lib/pipelines/types';

const LIFE_COLORS: Record<string, string> = {
  work: '#3B82F6', health: '#10B981', play: '#F59E0B', love: '#EF4444',
};

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function ActivityTypeEditor({ collapsed, onToggle }: Props) {
  const { data } = useGetActivityTypesQuery();
  const types = data?.types ?? [];
  const [editingType, setEditingType] = useState<ActivityTypeModel | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const [createType] = useCreateActivityTypeMutation();
  const [updateType] = useUpdateActivityTypeMutation();
  const [deleteType] = useDeleteActivityTypeMutation();

  const handleSave = async (updated: ActivityTypeModel) => {
    try {
      if (types.find(t => t.key === updated.key)) {
        await updateType({ key: updated.key, updates: updated }).unwrap();
      } else {
        await createType({ ...updated, key: updated.key, label: updated.label }).unwrap();
      }
      setSheetVisible(false);
      setEditingType(null);
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
            await deleteType(key).unwrap();
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
      showInTimer: true, showInManualLog: true, mentionDuringBreak: false,
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
                  {t.subCategories?.includes('movement') && <Text style={st.badge}>MOVE</Text>}
                  {t.subCategories?.includes('nature') && <Text style={st.badge}>NAT</Text>}
                  {t.subCategories?.includes('brain_hygiene') && <Text style={st.badge}>BRAIN</Text>}
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
});

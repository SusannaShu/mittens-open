/**
 * PeopleSection -- Relationship map in Profile tab.
 * Shows recent people, search, add/edit via PersonService.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../lib/theme';
import { profileStyles as ps } from './profileStyles';
import { PersonService } from '../../lib/services/personService';
import type { Person } from '../../lib/pipelines/types';

const TEAM_ROLES = ['supporter', 'player', 'intimate', 'mentor', 'collaborator'] as const;

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function PeopleSection({ collapsed, onToggle }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const loadPeople = useCallback(async () => {
    if (searchQuery.trim()) {
      const results = await PersonService.search(searchQuery);
      setPeople(results);
    } else {
      const recent = await PersonService.getRecent(30);
      setPeople(recent);
    }
  }, [searchQuery]);

  useEffect(() => { loadPeople(); }, [loadPeople]);

  const handleAdd = () => {
    setEditingPerson({ id: 0, name: '', interactionCount: 0 });
    setSheetVisible(true);
  };

  const handleSave = async (person: Person) => {
    try {
      if (person.id === 0) {
        await PersonService.create({
          name: person.name,
          nickname: person.nickname,
          teamRole: person.teamRole,
          context: person.context,
        });
      }
      setSheetVisible(false);
      setEditingPerson(null);
      loadPeople();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    }
  };

  return (
    <View style={ps.card}>
      <TouchableOpacity style={[ps.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="users" size={16} color={colors.textPrimary} />
          <Text style={ps.cardTitle}>YOUR TEAM</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {people.length > 0 && <Text style={{ fontSize: 11, color: colors.textMuted }}>{people.length}</Text>}
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
            People Mittens detects from your activities. Supporters, players, intimates, and mentors form your life design team.
          </Text>

          {/* Search */}
          <View style={st.searchRow}>
            <Feather name="search" size={14} color={colors.textMuted} />
            <TextInput
              style={st.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search people..."
              placeholderTextColor={colors.textMuted}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Feather name="x" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Empty state */}
          {people.length === 0 && !searchQuery ? (
            <View style={st.emptyState}>
              <Feather name="users" size={20} color={colors.textMuted} />
              <Text style={st.emptyText}>
                No people yet. As you log activities and mention names, they will appear here.
              </Text>
            </View>
          ) : people.length === 0 && searchQuery ? (
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md }}>
              No results for "{searchQuery}"
            </Text>
          ) : null}

          {/* People list */}
          {people.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={st.personRow}
              onPress={() => { setEditingPerson({ ...p }); setSheetVisible(true); }}
              activeOpacity={0.6}
            >
              <View style={st.avatar}>
                <Text style={st.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={st.personName}>{p.name}</Text>
                  {p.nickname ? <Text style={st.nickname}>({p.nickname})</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  {p.teamRole ? <Text style={st.roleBadge}>{p.teamRole}</Text> : null}
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>
                    {p.interactionCount} interaction{p.interactionCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              {p.avgEngagement != null && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>Eng {p.avgEngagement?.toFixed(1)}</Text>
                  <Text style={{ fontSize: 10, color: colors.textMuted }}>Erg {p.avgEnergy?.toFixed(1)}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={st.addBtn} onPress={handleAdd} activeOpacity={0.7}>
            <Feather name="plus" size={14} color={colors.textPrimary} />
            <Text style={st.addText}>Add Person</Text>
          </TouchableOpacity>

          {/* Edit sheet */}
          {sheetVisible && editingPerson && (
            <PersonEditSheet
              person={editingPerson}
              onSave={handleSave}
              onClose={() => { setSheetVisible(false); setEditingPerson(null); }}
            />
          )}
        </>
      )}
    </View>
  );
}

/* ── Edit Sheet ── */

function PersonEditSheet({
  person, onSave, onClose,
}: {
  person: Person;
  onSave: (p: Person) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Person>({ ...person });
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Backdrop */}
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />

        {/* Sheet */}
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={st.dragHandle} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
              {person.id === 0 ? 'Add Person' : 'Edit Person'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={true} style={{ flex: 1 }}>
            <Text style={st.fieldLabel}>Name</Text>
            <TextInput
              style={st.input}
              value={draft.name}
              onChangeText={(v) => setDraft(p => ({ ...p, name: v }))}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              autoFocus={person.id === 0}
            />

            <Text style={st.fieldLabel}>Nickname</Text>
            <TextInput
              style={st.input}
              value={draft.nickname || ''}
              onChangeText={(v) => setDraft(p => ({ ...p, nickname: v }))}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={st.fieldLabel}>Team Role</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {TEAM_ROLES.map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[st.toggle, draft.teamRole === role && st.toggleActive]}
                  onPress={() => setDraft(p => ({ ...p, teamRole: p.teamRole === role ? undefined : role }))}
                >
                  <Text style={[st.toggleText, draft.teamRole === role && st.toggleTextActive]}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={st.fieldLabel}>Context</Text>
            <TextInput
              style={[st.input, { minHeight: 60 }]}
              value={draft.context || ''}
              onChangeText={(v) => setDraft(p => ({ ...p, context: v }))}
              placeholder="How do you know them?"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <View style={{ height: 60 }} />
          </ScrollView>

          {/* Actions -- pinned */}
          <View style={st.actionBar}>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.saveBtn, !draft.name.trim() && { opacity: 0.4 }]}
              onPress={() => draft.name.trim() && onSave(draft)}
              disabled={!draft.name.trim()}
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: '#F5F5F5', borderRadius: radius.md, marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 13, color: colors.textPrimary, padding: 0 },
  emptyState: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 8,
  },
  emptyText: { fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  personRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F0F0',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  personName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  nickname: { fontSize: 12, color: colors.textMuted },
  roleBadge: {
    fontSize: 9, fontWeight: '700', color: colors.textMuted,
    backgroundColor: colors.border, paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 4, overflow: 'hidden', letterSpacing: 0.5, textTransform: 'uppercase',
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, borderStyle: 'dashed',
  },
  addText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '70%',
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
});

/**
 * PeopleSection -- Face recognition roster in Profile tab.
 * Shows people Mittens can recognize, with embedding counts and face gallery access.
 * Separated from Life Design "Team" -- this is about identity, not roles.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert,
  StyleSheet, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../lib/theme';
import { profileStyles as ps } from './profileStyles';
import { PersonService } from '../../lib/services/personService';
import { PersonEditSheet } from './PersonEditSheet';
import { getEmbeddingCount } from '../../lib/services/faceRecognition/faceRecognitionApi';
import type { Person } from '../../lib/pipelines/types';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function PeopleSection({ collapsed, onToggle }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [embeddingCounts, setEmbeddingCounts] = useState<Record<number, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const loadPeople = useCallback(async () => {
    let loaded: Person[];
    if (searchQuery.trim()) {
      loaded = await PersonService.search(searchQuery);
    } else {
      loaded = await PersonService.getRecent(30);
    }
    setPeople(loaded);

    // Load embedding counts for each person
    const counts: Record<number, number> = {};
    for (const p of loaded) {
      if (p.id && p.id > 0) {
        try {
          counts[p.id] = getEmbeddingCount(p.id);
        } catch {
          counts[p.id] = 0;
        }
      }
    }
    setEmbeddingCounts(counts);
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
      } else {
        await PersonService.update(person);
      }
      setSheetVisible(false);
      setEditingPerson(null);
      loadPeople();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    }
  };

  const handleDelete = useCallback(async (personId: number) => {
    setSheetVisible(false);
    setEditingPerson(null);
    await PersonService.delete(personId);
    loadPeople();
  }, [loadPeople]);

  return (
    <View style={ps.card}>
      <TouchableOpacity style={[ps.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="eye" size={16} color={colors.textPrimary} />
          <Text style={ps.cardTitle}>PEOPLE MITTENS KNOWS</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {people.length > 0 && <Text style={{ fontSize: 11, color: colors.textMuted }}>{people.length}</Text>}
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
            People Mittens can recognize by face. Tap to edit or upload photos to teach Mittens.
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
              <Feather name="eye" size={20} color={colors.textMuted} />
              <Text style={st.emptyText}>
                No people yet. Introduce someone to Mittens by saying "this is [name]" while wearing the pendant, or add them manually.
              </Text>
            </View>
          ) : people.length === 0 && searchQuery ? (
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md }}>
              No results for "{searchQuery}"
            </Text>
          ) : null}

          {/* People list */}
          {people.map((p) => {
            const embCount = p.id ? (embeddingCounts[p.id] || 0) : 0;
            return (
              <TouchableOpacity
                key={p.id}
                style={st.personRow}
                onPress={() => { setEditingPerson({ ...p }); setSheetVisible(true); }}
                activeOpacity={0.6}
              >
                <View style={st.avatar}>
                  {p.avatarUri ? (
                    <Image source={{ uri: p.avatarUri }} style={st.avatarImg} />
                  ) : (
                    <Text style={st.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={st.personName}>{p.name}</Text>
                    {p.isMe && <Text style={st.meBadge}>ME</Text>}
                    {p.nickname ? <Text style={st.nickname}>({p.nickname})</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                    {embCount > 0 && (
                      <Text style={st.embBadge}>{embCount} photo{embCount !== 1 ? 's' : ''} learned</Text>
                    )}
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>
                      {p.interactionCount} interaction{p.interactionCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
                {p.teamRole && (
                  <Text style={st.roleBadge}>{p.teamRole}</Text>
                )}
              </TouchableOpacity>
            );
          })}

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
              onDelete={handleDelete}
            />
          )}
        </>
      )}
    </View>
  );
}

/* -- Styles -- */

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
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 36, height: 36 },
  avatarText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  personName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },
  nickname: { fontSize: 12, color: colors.textMuted },
  meBadge: {
    fontSize: 8, fontWeight: '800', color: '#fff',
    backgroundColor: colors.textPrimary, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 3, overflow: 'hidden', letterSpacing: 0.5,
  },
  embBadge: {
    fontSize: 10, fontWeight: '600', color: '#6B7280',
    backgroundColor: '#F3F4F6', paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 4, overflow: 'hidden',
  },
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
});

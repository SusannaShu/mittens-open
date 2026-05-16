/**
 * TeamSection -- Life Design team roster (inside Life Design group).
 * Shows only people with assigned team roles.
 * Compact view: name + role badge + engagement/energy stats.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../lib/theme';
import { profileStyles as ps } from './profileStyles';
import { PersonService } from '../../lib/services/personService';
import type { Person } from '../../lib/pipelines/types';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function TeamSection({ collapsed, onToggle }: Props) {
  const [teamMembers, setTeamMembers] = useState<Person[]>([]);

  const loadTeam = useCallback(async () => {
    const all = await PersonService.getRecent(50);
    // Only show people with a team role assigned
    setTeamMembers(all.filter(p => p.teamRole && p.teamRole !== 'self'));
  }, []);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  return (
    <View style={ps.card}>
      <TouchableOpacity style={[ps.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="users" size={16} color={colors.textPrimary} />
          <Text style={ps.cardTitle}>YOUR TEAM</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {teamMembers.length > 0 && <Text style={{ fontSize: 11, color: colors.textMuted }}>{teamMembers.length}</Text>}
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
            People assigned to your life design team. Assign roles from the People section.
          </Text>

          {teamMembers.length === 0 ? (
            <View style={st.emptyState}>
              <Feather name="users" size={18} color={colors.textMuted} />
              <Text style={st.emptyText}>
                No team members yet. Go to People Mittens Knows and assign a team role to someone.
              </Text>
            </View>
          ) : null}

          {teamMembers.map((p) => (
            <View key={p.id} style={st.memberRow}>
              <View style={st.avatar}>
                {p.avatarUri ? (
                  <Image source={{ uri: p.avatarUri }} style={st.avatarImg} />
                ) : (
                  <Text style={st.avatarText}>{p.name.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.memberName}>{p.name}</Text>
                {p.teamRole && <Text style={st.roleBadge}>{p.teamRole}</Text>}
              </View>
              {(p.avgEngagement != null || p.avgEnergy != null) && (
                <View style={{ alignItems: 'flex-end' }}>
                  {p.avgEngagement != null && (
                    <Text style={st.stat}>Eng {p.avgEngagement.toFixed(1)}</Text>
                  )}
                  {p.avgEnergy != null && (
                    <Text style={st.stat}>Erg {p.avgEnergy.toFixed(1)}</Text>
                  )}
                </View>
              )}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/* -- Styles -- */

const st = StyleSheet.create({
  emptyState: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 8,
  },
  emptyText: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0F0F0',
    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 30, height: 30 },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  memberName: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  roleBadge: {
    fontSize: 9, fontWeight: '700', color: colors.textMuted,
    backgroundColor: colors.border, paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 3, overflow: 'hidden', letterSpacing: 0.5,
    textTransform: 'uppercase', marginTop: 2, alignSelf: 'flex-start',
  },
  stat: { fontSize: 10, color: colors.textMuted },
});

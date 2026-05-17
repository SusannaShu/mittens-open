import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius } from '../../lib/theme';
import { PeopleAutocomplete } from './PeopleAutocomplete';
import type { Person } from '../../lib/pipelines/types';

const AEIOU_LABELS: Record<string, string> = {
  activity: 'Activities',
  environment: 'Environments',
  interactions: 'Interactions',
  objects: 'Objects',
  users: 'Users',
};

const AEIOU_HINTS: Record<string, string> = {
  activity: 'What were you doing? Structured or free-form? What role did you play?',
  environment: 'Where were you? How did the setting make you feel?',
  interactions: 'Who or what did you interact with? Formal or casual?',
  objects: 'What devices, tools, or items were you using?',
  users: 'Who else was there? Did they add to or take from the experience?',
};

const AEIOU_KEYS = Object.keys(AEIOU_LABELS);

interface AeiouEditorProps {
  aeiou: Record<string, string>;
  onChange: (key: string, val: string) => void;
  linkedUsers?: Person[];
  onAddLinkedUser?: (person: Person) => void;
  onRemoveLinkedUser?: (personId: number) => void;
  showUsersEvidence?: boolean;
  onPressUsersEvidence?: () => void;
}

export function AeiouEditor({
  aeiou,
  onChange,
  linkedUsers = [],
  onAddLinkedUser,
  onRemoveLinkedUser,
  showUsersEvidence,
  onPressUsersEvidence
}: AeiouEditorProps) {
  const [usersText, setUsersText] = useState(aeiou['users'] || '');

  const handleUsersTextChange = (text: string) => {
    setUsersText(text);
    onChange('users', text);
  };

  const handleSelectPerson = (person: Person) => {
    if (onAddLinkedUser && !linkedUsers.find(p => p.id === person.id)) {
      onAddLinkedUser(person);
    }
    // clear the token that was just typed from usersText
    const parts = usersText.split(',');
    parts.pop(); // remove the last part that triggered the autocomplete
    const newText = parts.length > 0 ? parts.join(',') + ', ' : '';
    handleUsersTextChange(newText);
  };

  return (
    <View style={styles.container}>
      {AEIOU_KEYS.map((key) => {
        const isUsersField = key === 'users';
        
        return (
          <View key={key} style={styles.aeiouRow}>
            <Text style={styles.aeiouKey}>{key.charAt(0).toUpperCase()}</Text>
            <View style={styles.aeiouInputWrap}>
              <Text style={styles.aeiouLabel}>{AEIOU_LABELS[key]}</Text>
              
              {isUsersField && linkedUsers.length > 0 && (
                <View style={styles.pillsContainer}>
                  {linkedUsers.map(p => (
                    <View key={p.id} style={styles.personPill}>
                      <Text style={styles.personPillText}>{p.name}</Text>
                      {onRemoveLinkedUser && (
                        <TouchableOpacity onPress={() => onRemoveLinkedUser(p.id)} style={{ padding: 2 }}>
                          <Feather name="x" size={12} color={colors.bg} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'flex-start', zIndex: isUsersField ? 10 : 1 }}>
                {isUsersField ? (
                  <View style={{ flex: 1 }}>
                    <PeopleAutocomplete
                      value={usersText}
                      onChange={handleUsersTextChange}
                      onSelectPerson={handleSelectPerson}
                      placeholder={AEIOU_HINTS[key]}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : (
                  <TextInput
                    style={[styles.aeiouInput, { flex: 1, minHeight: 56, textAlignVertical: 'top' }]}
                    value={aeiou[key] || ''}
                    onChangeText={(text) => onChange(key, text)}
                    placeholder={AEIOU_HINTS[key]}
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={3}
                  />
                )}
                
                {isUsersField && showUsersEvidence && (
                  <TouchableOpacity onPress={onPressUsersEvidence} style={{ padding: 8, paddingRight: 0, marginTop: 4 }}>
                    <Feather name="chevron-right" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FAFAFA',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  aeiouRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  aeiouKey: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    opacity: 0.15,
    marginRight: spacing.sm,
    width: 24,
    textAlign: 'center',
    marginTop: 2,
  },
  aeiouInputWrap: {
    flex: 1,
  },
  aeiouLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aeiouInput: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  personPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  personPillText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: '600',
  }
});

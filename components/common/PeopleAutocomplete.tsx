import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { colors, spacing, radius } from '../../lib/theme';
import { PersonService } from '../../lib/services/personService';
import type { Person } from '../../lib/pipelines/types';

interface PeopleAutocompleteProps {
  value: string;
  onChange: (v: string) => void;
  onSelectPerson?: (person: Person) => void;
  placeholder?: string;
  style?: any;
}

export function PeopleAutocomplete({ value, onChange, onSelectPerson, placeholder, style }: PeopleAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Person[]>([]);

  // Get the last name being typed (after last comma)
  const getCurrentToken = useCallback(() => {
    const parts = value.split(',');
    return parts[parts.length - 1].trim();
  }, [value]);

  useEffect(() => {
    const token = getCurrentToken();
    if (token.length >= 1) {
      PersonService.search(token).then(setSuggestions).catch(() => setSuggestions([]));
    } else {
      setSuggestions([]);
    }
  }, [getCurrentToken]);

  const handleSelect = (person: Person) => {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    parts[parts.length - 1] = person.name;
    onChange(parts.join(', ') + ', ');
    setSuggestions([]);
    if (onSelectPerson) {
      onSelectPerson(person);
    }
  };

  return (
    <View style={[{ zIndex: 10 }, style]}>
      <TextInput
        style={[{
          backgroundColor: '#FFF',
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: 12,
          paddingVertical: 12,
          fontSize: 14,
          color: colors.textPrimary,
        }, suggestions.length > 0 && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || "Who was there? e.g. Jake, Mom"}
        placeholderTextColor={colors.textMuted}
        multiline
      />
      {suggestions.length > 0 && (
        <View style={{
          backgroundColor: '#FAFAFA', 
          borderWidth: 1, 
          borderColor: colors.border, 
          borderTopWidth: 0, 
          borderBottomLeftRadius: 8, 
          borderBottomRightRadius: 8, 
          maxHeight: 150,
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 20
        }}>
          {suggestions.slice(0, 4).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
              onPress={() => handleSelect(p)}
            >
              <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: '500' }}>
                {p.name}{p.nickname ? ` (${p.nickname})` : ''}
              </Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                {p.interactionCount} interactions
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

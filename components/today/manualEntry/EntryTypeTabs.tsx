import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import { s } from '../TodayModals';
import { ENTRY_TABS } from './constants';
import { ManualEntryType } from './types';

interface EntryTypeTabsProps {
  value: ManualEntryType;
  onChange: (t: ManualEntryType) => void;
}

export function EntryTypeTabs({ value, onChange }: EntryTypeTabsProps) {
  return (
    <View style={s.entryTabRow}>
      {ENTRY_TABS.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[s.entryTab, value === tab.key && s.entryTabActive]}
          onPress={() => onChange(tab.key)}
          activeOpacity={0.7}
        >
          <Feather name={tab.icon as any} size={14} color={value === tab.key ? colors.bg : colors.textSecondary} />
          <Text style={[s.entryTabText, value === tab.key && s.entryTabTextActive]}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

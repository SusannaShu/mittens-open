import { View, Text, TouchableOpacity } from 'react-native';
import { spacing } from '../../../lib/theme';
import { s } from '../TodayModals';

interface PillRowProps {
  pills: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}

export function PillRow({ pills, value, onChange }: PillRowProps) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: spacing.sm }}>
      {pills.map((p) => (
        <TouchableOpacity
          key={p.key}
          style={[s.typePill, value === p.key && s.typePillActive]}
          onPress={() => onChange(value === p.key ? '' : p.key)}
        >
          <Text style={[s.typePillText, value === p.key && s.typePillTextActive]}>{p.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

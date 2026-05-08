import { View, TouchableOpacity, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { NutrientGap, Meal, PantryItem } from '../../../lib/types';
import { colors } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';
import NutrientRow from '../NutrientRow';

interface Props {
  gaps: NutrientGap[];
  meals: Meal[];
  pantry: PantryItem[];
  storedSources: Record<string, any[]>;
  collapsed: boolean;
  onToggle: () => void;
  onRefetch: () => void;
}

const STATUS_ORDER: Record<string, number> = { low: 0, moderate: 1, excess: 2, high: 3, good: 4 };

export default function NutrientStatusSection({ gaps, meals, pantry, storedSources, collapsed, onToggle, onRefetch }: Props) {
  if (gaps.length === 0) return null;

  const sortedGaps = [...gaps].sort((a, b) => {
    if (a.nutrient === 'water') return -1;
    if (b.nutrient === 'water') return 1;
    return (STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5) || a.pct - b.pct;
  });
  const problemGaps = sortedGaps.filter(g => g.status !== 'good');
  const goodGaps = sortedGaps.filter(g => g.status === 'good');

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>NUTRIENT STATUS</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <>
          {problemGaps.map((gap) => (
            <NutrientRow key={gap.nutrient} gap={gap} meals={meals} pantry={pantry} storedSources={storedSources} onRefetch={onRefetch} />
          ))}
          {problemGaps.length > 0 && goodGaps.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginVertical: 8 }} />
          )}
          {goodGaps.map((gap) => (
            <NutrientRow key={gap.nutrient} gap={gap} meals={meals} pantry={pantry} storedSources={storedSources} onRefetch={onRefetch} />
          ))}
        </>
      )}
    </View>
  );
}

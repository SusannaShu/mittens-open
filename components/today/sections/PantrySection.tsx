import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PantryItem } from '../../../lib/types';
import { colors } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';

interface Props {
  pantry: PantryItem[];
  collapsed: boolean;
  onToggle: () => void;
  onAddItem: (foodName: string) => void;
  onEditItem: (item: { id: number; foodName: string; quantity?: string; freshness: string }) => void;
}

const FRESHNESS_ORDER: Record<string, number> = { questionable: 0, use_soon: 1, good: 2, fresh: 3 };

function freshnessDisplay(freshness: string) {
  const colorMap: Record<string, string> = { fresh: '#34C759', good: '#34C759', use_soon: '#FF9500' };
  const labelMap: Record<string, string> = { fresh: 'Fresh', good: 'Good', use_soon: 'Use Soon' };
  return {
    color: colorMap[freshness] || '#FF3B30',
    label: labelMap[freshness] || 'Check',
  };
}

export default function PantrySection({ pantry, collapsed, onToggle, onAddItem, onEditItem }: Props) {
  if (pantry.length === 0) return null;

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>FOOD YOU HAVE</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            {pantry.length} item{pantry.length !== 1 ? 's' : ''}
          </Text>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              Alert.prompt('Add to Pantry', 'What item do you have?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Add', onPress: (name?: string) => {
                  if (name?.trim()) onAddItem(name.trim());
                }},
              ], 'plain-text', '', 'default');
            }}
            style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textPrimary, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '700', marginTop: -1 }}>+</Text>
          </TouchableOpacity>
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
      {!collapsed && [...pantry]
        .sort((a, b) => (FRESHNESS_ORDER[a.freshness] ?? 3) - (FRESHNESS_ORDER[b.freshness] ?? 3))
        .map((item) => {
          const { color: fColor, label: fLabel } = freshnessDisplay(item.freshness);
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.pantryRow}
              activeOpacity={0.6}
              onPress={() => onEditItem({ id: item.id, foodName: item.foodName, quantity: item.quantity, freshness: item.freshness || 'fresh' })}
            >
              <View style={[styles.pantryDot, { backgroundColor: fColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pantryName}>{item.foodName}</Text>
                {item.quantity ? <Text style={styles.pantryQty}>{item.quantity}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.pantryFreshness, { color: fColor }]}>{fLabel}</Text>
                {item.daysSinceScan != null && item.daysSinceScan > 0 && (
                  <Text style={styles.pantryAge}>{item.daysSinceScan}d ago</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
    </View>
  );
}

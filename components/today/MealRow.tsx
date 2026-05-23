import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Meal } from '../../lib/types';
import { colors, spacing } from '../../lib/theme';
import { todayStyles as styles } from '../../styles/todayStyles';
import ItemNutritionModal from './ItemNutritionModal';
import { useUpdateEntryDirectMutation } from '../../lib/services/nutritionApi';

export default function MealRow({ meal, onEdit }: { meal: Meal; onEdit: (meal: Meal, displayTitle: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [updateEntryDirect] = useUpdateEntryDirectMutation();
  const isActivity = meal.entryType === 'activity';
  const sumGrams = meal.items?.reduce((acc: number, item: any) => item.type === 'activity' ? acc : acc + (Number(item.portion_g) || Number(item.portionG) || 0), 0) || 0;
  
  const ingredientNames = (meal.items || []).map(i => i.name || i.foodName || '').filter(Boolean);
  const displayTitle = ingredientNames.length > 0 ? ingredientNames.join(', ') : meal.logName;

  // Format logged time
  const logTime = meal.loggedAt ? new Date(meal.loggedAt) : null;
  const timeStr = logTime ? logTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase() : '';

  // Activity meta for display
  const meta = meal.activityMeta || {};

  // Activity entry: distinct dashed style with impact details
  if (isActivity) {
    const impact = meta.nutrientImpact || {};
    const produces = Object.entries(impact).filter(([, v]) => (v as number) > 0);
    const depletes = Object.entries(impact).filter(([, v]) => (v as number) < 0);
    const actIcon = meta.activitySubtype === 'sun' ? 'sun'
      : meta.activitySubtype === 'bike' ? 'navigation'
      : meta.activitySubtype === 'run' ? 'zap'
      : meta.activitySubtype === 'workout' ? 'activity'
      : meta.activitySubtype === 'work' ? 'monitor'
      : 'activity';
    const intensityLabel = meta.intensity && meta.intensity !== 'moderate' ? ` (${meta.intensity})` : '';

    // Human-readable nutrient names
    const nNames: Record<string, string> = {
      vitamin_d: 'Vit D', vitamin_b6: 'B6', vitamin_c: 'Vit C', vitamin_a: 'Vit A',
      magnesium: 'Mg', potassium: 'K', sodium: 'Na', zinc: 'Zn', iron: 'Fe',
      calories: 'cal', protein: 'protein',
    };
    const nUnits: Record<string, string> = {
      vitamin_d: 'mcg', vitamin_b6: 'mg', vitamin_c: 'mg', vitamin_a: 'mcg',
      magnesium: 'mg', potassium: 'mg', sodium: 'mg', zinc: 'mg', iron: 'mg',
      calories: 'kcal', protein: 'g',
    };

    return (
      <View style={[styles.logContainer, { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 8, padding: spacing.sm, marginBottom: spacing.sm }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Feather name={actIcon as any} size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.logName}>{displayTitle}</Text>
            <Text style={styles.logMeta}>
              {timeStr ? `${timeStr} -- ` : ''}
              {meta.duration_min ? `${meta.duration_min} min` : 'activity'}
              {intensityLabel}
            </Text>
          </View>
        </View>

        {/* Nutrient impact chips */}
        {(produces.length > 0 || depletes.length > 0) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginLeft: 24 }}>
            {produces.map(([key, val]) => (
              <View key={key} style={{ backgroundColor: '#E8F5E9', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, color: '#2E7D32', fontWeight: '600' }}>
                  +{Math.round(Math.abs(val as number) * 10) / 10}{nUnits[key] || ''} {nNames[key] || key}
                </Text>
              </View>
            ))}
            {depletes.map(([key, val]) => (
              <View key={key} style={{ backgroundColor: '#FFF3E0', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, color: '#E65100', fontWeight: '600' }}>
                  -{Math.round(Math.abs(val as number) * 10) / 10}{nUnits[key] || ''} {nNames[key] || key}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.logContainer}>
      <TouchableOpacity style={styles.logHeader} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.logDot} />
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={styles.logName} numberOfLines={2}>{displayTitle}</Text>
          <Text style={styles.logMeta}>{timeStr ? `${timeStr} -- ` : ''}{meal.mealType} -- {sumGrams}g total</Text>
        </View>
        <TouchableOpacity onPress={() => onEdit(meal, displayTitle)} style={{ padding: 4 }}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </TouchableOpacity>

      {meal.failure_logs && meal.failure_logs.length > 0 && (
        <View style={{ marginTop: 2, marginLeft: 14 + spacing.md, gap: 4 }}>
          {meal.failure_logs.map((f: any) => (
            <View key={f.id} style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#FFF0F0', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#FF5252' }}>
              <Text style={{ fontSize: 11, color: '#D32F2F', fontWeight: '700', marginBottom: 2 }}>
                {f.category === 'screwup' ? 'Screwup' : f.category === 'weakness' ? 'Weakness' : 'Opportunity'}: {f.failure}
              </Text>
              {f.insight && (
                <Text style={{ fontSize: 11, color: '#D32F2F', fontStyle: 'italic' }}>Insight: {f.insight}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {expanded && meal.items && meal.items.length > 0 && (
        <View style={{ marginTop: 8, marginLeft: 14 + spacing.md, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 10 }}>
          {meal.items.map((item: any, idx: number) => (
              <TouchableOpacity
                key={idx}
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, paddingVertical: 3 }}
                onPress={() => setSelectedItem(item)}
                activeOpacity={0.6}
              >
                <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary }} numberOfLines={1}>- {item.name || item.foodName}</Text>
                <Text style={{ fontSize: 13, color: colors.textMuted, flexShrink: 0 }}>
                  {item.type === 'activity' ? (item.household_portion || 'activity') : `${item.household_portion ? `${item.household_portion} / ` : ''}${item.portion_g || item.portionG}g`}
                </Text>
              </TouchableOpacity>
          ))}
        </View>
      )}

      <ItemNutritionModal
        visible={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        onUpdate={(updatedItem) => {
          // Replace the updated item in the meal's items list
          const updatedItems = (meal.items || []).map((it: any) => {
            if (it === selectedItem || (it.name === selectedItem?.name && it.portion_g === selectedItem?.portion_g)) {
              return { ...it, ...updatedItem, _nameChanged: false };
            }
            return it;
          });
          const newLogName = updatedItems.map((i: any) => i.name || i.foodName || '').filter(Boolean).join(', ');
          updateEntryDirect({ id: meal.id, items: updatedItems, logName: newLogName });
          setSelectedItem(null);
        }}
      />
    </View>
  );
}

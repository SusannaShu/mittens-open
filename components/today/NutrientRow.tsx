import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useReestimateItemMutation } from '../../lib/services/nutritionApi';
import { useReflectActivityMutation } from '../../lib/services/activityApi';
import { NutrientGap, Meal, PantryItem } from '../../lib/types';
import { colors } from '../../lib/theme';
import { todayStyles as styles } from '../../styles/todayStyles';

const sourceLabel = (src: string) => {
  switch (src) {
    case 'usda': return 'USDA';
    case 'open_food_facts': return 'OFF';
    case 'database': return 'DB';
    case 'activity': return 'ACT';
    default: return 'EST';
  }
};

const sourceColor = (src: string, verified: boolean) => {
  if (src === 'usda') return { bg: '#E8F5E9', text: '#2E7D32' };
  if (src === 'database' && verified) return { bg: '#E3F2FD', text: '#1565C0' };
  if (src === 'open_food_facts') return { bg: '#FFF3E0', text: '#E65100' };
  if (src === 'activity') return { bg: '#F3E5F5', text: '#6A1B9A' };
  return { bg: '#F5F5F5', text: '#9E9E9E' };
};

// Nutrient safety tiers (IOM/NIH-based, mirrors solver)
const SAFETY_TIER: Record<string, number> = {
  calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
  vitamin_k: 1, vitamin_b12: 1, potassium: 1, magnesium: 1, omega3: 1,
  vitamin_c: 2, vitamin_b6: 2, folate: 2, vitamin_e: 2, calcium: 2, vitamin_d: 2,
  vitamin_a: 3, iron: 3, zinc: 3,
};

export default function NutrientRow({ gap, meals, pantry = [], storedSources = {}, onRefetch }: {
  gap: NutrientGap; meals: Meal[]; pantry?: PantryItem[];
  storedSources?: Record<string, any[]>; onRefetch?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reestimateItem] = useReestimateItemMutation();
  const [reflectActivity] = useReflectActivityMutation();
  const [reestimatingItem, setReestimatingItem] = useState<string | null>(null);

  const pct = Math.min(gap.pct / 100, 1);
  const barColor = gap.status === 'excess' ? '#C62828'
    : gap.status === 'high' ? '#E65100'
    : gap.status === 'good' ? colors.statusGood
    : gap.status === 'moderate' ? colors.statusModerate : colors.statusLow;
  const isExcess = gap.status === 'excess' || gap.status === 'high';

  // Safety annotation for nutrients over 100%
  const tier = SAFETY_TIER[gap.nutrient] ?? 2;
  const showSafety = gap.pct > 100 && tier > 0;
  
  // Natively use the rigorous backend UL calculation if available
  const isUlWarning = (gap as any).ulTotal !== undefined && gap.ul !== null 
    ? (gap as any).ulTotal > gap.ul 
    : (tier === 3);

  const safetyLabel = isUlWarning ? 'caution' : (tier <= 1 ? 'safe' : tier === 2 ? 'ok' : 'safe');
  const safetyColor = safetyLabel === 'safe' ? { bg: '#E8F5E9', text: '#2E7D32' }
    : safetyLabel === 'ok' ? { bg: '#F5F5F5', text: colors.textMuted }
    : { bg: '#FFF3E0', text: '#E65100' };

  const allItems = meals.flatMap(m => m.items || []);
  const todaySources = allItems
    .map(i => ({
      name: i.name || i.foodName,
      value: i.nutrients?.[gap.nutrient] || 0,
      nutrient_source: i.nutrient_source || 'ai_estimate',
      verified: i.verified ?? false,
    }))
    .filter(i => i.value > 0)
    .sort((a, b) => b.value - a.value);

  // For body stores, use stored food sources from past meals
  const storedNutrientSources = (storedSources[gap.nutrient] || []).map((s: any) => ({
    name: s.name,
    value: s.value,
    nutrient_source: s.nutrient_source || 'ai_estimate',
    verified: false,
    days: s.days,
    activityId: s.activityId || null,
  }));

  const sources = gap.period === 'stored' ? storedNutrientSources : todaySources;

  // Split into activity (sun exposure) and food sources
  const activitySources = sources.filter(s => s.nutrient_source === 'activity');
  const foodSources = sources.filter(s => s.nutrient_source !== 'activity');

  const MAX_SOURCES = 3;

  /** Render a single source row (shared between activity and food sections) */
  const renderSourceRow = (s: any, key: string) => {
    const sc = sourceColor(s.nutrient_source, s.verified);
    const label = sourceLabel(s.nutrient_source);
    const isEstimate = s.nutrient_source === 'ai_estimate';
    const isActivity = s.nutrient_source === 'activity';
    const canFlag = isEstimate || (isActivity && s.activityId);
    return (
      <View key={key} style={styles.sourceRow}>
        <Text style={styles.sourceName} numberOfLines={1}>- {s.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Text style={styles.sourceVal}>
            {isEstimate ? '~' : ''}{s.value > 0 ? (s.value < 1 ? '<1' : Math.round(s.value)) : 0}{gap.unit}
          </Text>
          {((s as any).days ?? 0) > 1 && (
            <Text style={{ fontSize: 9, color: colors.textMuted }}>{(s as any).days}d</Text>
          )}
          <View style={{ backgroundColor: sc.bg, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
            <Text style={{ fontSize: 8, fontWeight: '700', color: sc.text, letterSpacing: 0.5 }}>{label}</Text>
          </View>
          {canFlag && (
            <TouchableOpacity
              style={{ padding: 2 }}
              disabled={reestimatingItem === s.name}
              onPress={() => handleFlag(s)}
            >
              {reestimatingItem === s.name
                ? <ActivityIndicator size={10} color={colors.textMuted} />
                : <Feather name="flag" size={10} color={colors.textMuted} />
              }
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  /** Handle flag press: food items use AI re-estimate, activity items recalculate via formula */
  const handleFlag = async (s: any) => {
    setReestimatingItem(s.name);
    try {
      if (s.nutrient_source === 'activity' && s.activityId) {
        // Activity: trigger vitamin D recalculation via reflect endpoint
        const res = await reflectActivity({ id: s.activityId, recalculate: true } as any).unwrap();
        const newVitD = res.activity?.nutrientImpact?.vitamin_d;
        Alert.alert(
          'Recalculated',
          `${s.name}: ${Math.round(s.value)} -> ${newVitD != null ? Math.round(newVitD) : '?'}${gap.unit}\n\nVitamin D recalculated with updated formula.`,
          [{ text: 'OK' }]
        );
        onRefetch?.();
      } else {
        // Food: AI re-estimate
        const res = await reestimateItem({ itemName: s.name, nutrient: gap.nutrient }).unwrap();
        if (res.status === 'updated') {
          Alert.alert(
            'Re-estimated',
            `${s.name}: ${Math.round(s.value)} -> ${Math.round(res.revisedValue)}${gap.unit}\n\n${res.reasoning}`,
            [{ text: 'OK' }]
          );
          onRefetch?.();
        } else {
          Alert.alert('Could not re-estimate', res.reasoning || res.message || 'Unknown error');
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.data?.message || 'Failed to recalculate');
    } finally {
      setReestimatingItem(null);
    }
  };

  return (
    <View style={{ marginBottom: 4 }}>
      {/* Nutrient bar row */}
      <TouchableOpacity style={styles.nutrientRow} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <Text style={styles.nutrientName} numberOfLines={1}>{gap.name}</Text>
        <View style={styles.nutrientTrack}>
          {/* Solid fill: current intake */}
          <View style={[styles.nutrientFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 50, justifyContent: 'flex-end', gap: 3 }}>
          <Text style={[styles.nutrientPct, { color: barColor }]}>{gap.pct}%</Text>
          {gap.period === 'stored' && gap.avgDays && (
            <Text style={{ fontSize: 8, color: colors.textMuted }}>{gap.avgDays}d</Text>
          )}
          {showSafety && (
            <View style={{ backgroundColor: safetyColor.bg, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
              <Text style={{ fontSize: 8, fontWeight: '700', color: safetyColor.text, letterSpacing: 0.3 }}>{safetyLabel}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Expanded: sources today + recommendation link */}
      {expanded && (
        <View style={styles.nutrientDetails}>
          {/* Activity sources (sun exposure etc.) -- shown first */}
          {activitySources.length > 0 && (
            <>
              <Text style={styles.detailsLabel}>Sun exposure:</Text>
              {activitySources.map((s, idx) => renderSourceRow(s, `act-${idx}`))}
            </>
          )}

          {/* Food sources */}
          {foodSources.length > 0 && (
            <>
              <Text style={[styles.detailsLabel, activitySources.length > 0 && { marginTop: 8 }]}>
                {gap.period === 'stored' ? 'Stored from food:' : 'Food sources today:'}
              </Text>
              {(expanded ? foodSources : foodSources.slice(0, MAX_SOURCES)).map((s, idx) => renderSourceRow(s, `food-${idx}`))}
            </>
          )}

          {/* Activity impact -- show + or - from activities */}
          {gap.activityDelta != null && gap.activityDelta !== 0 && (
            <View style={styles.sourceRow}>
              <Text style={styles.sourceName} numberOfLines={1}>
                {gap.activityDelta > 0 ? '+ Activity' : '- Activity'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Text style={[styles.sourceVal, { color: gap.activityDelta > 0 ? '#2E7D32' : '#C62828' }]}>
                  {gap.activityDelta > 0 ? '+' : ''}{Math.round(gap.activityDelta * 10) / 10}{gap.unit}
                </Text>
                <View style={{ backgroundColor: '#F3E5F5', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: '#6A1B9A', letterSpacing: 0.5 }}>ACT</Text>
                </View>
              </View>
            </View>
          )}

          {/* Absorption modifier -- show when activities affect nutrient absorption */}
          {gap.absorptionMultiplier != null && gap.absorptionMultiplier !== 1.0 && gap.period === 'daily' && (
            <View style={styles.sourceRow}>
              <Text style={styles.sourceName} numberOfLines={1}>
                * Absorption
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Text style={[styles.sourceVal, { color: gap.absorptionMultiplier > 1.0 ? '#2E7D32' : '#C62828' }]}>
                  x{gap.absorptionMultiplier.toFixed(2)}
                </Text>
                <View style={{ backgroundColor: '#E8EAF6', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                  <Text style={{ fontSize: 8, fontWeight: '700', color: '#283593', letterSpacing: 0.5 }}>MOD</Text>
                </View>
              </View>
            </View>
          )}

          {/* Excess / upper limit warning */}
          {isExcess && gap.excessWarning && (
            <View style={{ backgroundColor: '#FFEBEE', borderRadius: 6, padding: 8, marginTop: 6 }}>
              <Text style={{ fontSize: 12, color: '#C62828', fontWeight: '600' }}>
                {gap.excessWarning}
              </Text>
            </View>
          )}
          {isExcess && !gap.excessWarning && gap.ul && (
            <View style={{ backgroundColor: '#FFF3E0', borderRadius: 6, padding: 8, marginTop: 6 }}>
              <Text style={{ fontSize: 12, color: '#E65100', fontWeight: '600' }}>
                Approaching upper limit ({gap.ul}{gap.unit}). Monitor intake.
              </Text>
            </View>
          )}

        </View>
      )}
    </View>
  );
}

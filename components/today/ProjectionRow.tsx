import { useState } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

// Source-aware safety explanations per nutrient
const SAFETY_EXPLANATIONS: Record<string, string> = {
  vitamin_k: 'Vitamin K from food has no established upper limit. Your body safely regulates excess from whole food sources.',
  vitamin_b12: 'B12 from food has no upper limit. Excess is safely excreted in urine. Only supplemental forms can be problematic.',
  potassium: 'Dietary potassium from food is self-limiting — excess is excreted by kidneys. No UL for food sources.',
  magnesium: 'Magnesium from food is harmless — the UL only applies to supplements and fortified products, not whole foods.',
  omega3: 'Omega-3 from whole fish and plant sources has no established upper limit. Excess is safely metabolized.',
  vitamin_c: 'Vitamin C is water-soluble — excess is excreted in urine. The UL (2000mg) is rarely reached from food alone.',
  vitamin_b6: 'B6 from food (max ~3mg/day) is well below the 100mg UL. Toxicity is only seen with supplements.',
  folate: 'Natural food folate has no upper limit. The UL applies only to synthetic folic acid (supplements/fortified foods).',
  vitamin_e: 'Vitamin E from food has no upper limit. The UL applies only to supplemental α-tocopherol.',
  calcium: 'High calcium from food is generally safe, but consistently exceeding the UL (2500mg) may affect kidney function.',
  vitamin_d: 'Vitamin D from food is safe at normal levels. The UL (4000 IU) is hard to reach from diet alone.',
  vitamin_a: 'Plant-source vitamin A (β-carotene) is harmless — your body converts only what it needs. The UL applies only to preformed retinol (animal/supplement sources).',
  iron: 'Non-heme iron from plants has very low absorption (~2-20%), making excess virtually impossible. The UL mainly concerns heme iron from meat and supplements.',
  zinc: 'Zinc from food can approach the UL (40mg). High zinc may interfere with copper absorption over time.',
  calories: 'Calorie targets are guidelines. Needs vary by activity level, metabolism, and goals.',
  protein: 'Protein from whole foods is generally safe above RDA. Active individuals often need 1.5-2x the RDA.',
  carbs: 'Carbohydrate needs depend on activity level. Whole food carbs include beneficial fiber.',
  fat: 'Fat from whole foods (nuts, avocado, fish) is nutrient-dense. Focus on quality over percentage.',
  fiber: 'High fiber from food is beneficial for gut health. Increase gradually if not accustomed.',
};

export default function ProjectionRow({ name, nutrientKey, currentPct, projectedPct, barColor, safetyLabel, safetyColor, unit, rda, planAdds, mealContributions, mealIcons }: {
  name: string; nutrientKey?: string; currentPct: number; projectedPct: number; barColor: string; safetyLabel: string | null; safetyColor: string;
  unit: string; rda: number; planAdds: number; mealContributions: { meal: string; amount: number; unit: string }[]; mealIcons: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showSafetyTip, setShowSafetyTip] = useState(false);
  const barMax = Math.max(projectedPct, 100);
  const currentWidth = Math.min(currentPct / barMax, 1) * 100;
  const addedWidth = Math.min((projectedPct - currentPct) / barMax, 1 - currentWidth / 100) * 100;

  const safetyExplanation = nutrientKey ? SAFETY_EXPLANATIONS[nutrientKey] : null;

  return (
    <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.7} style={{ paddingVertical: 6, borderBottomWidth: expanded ? 0 : 0.5, borderBottomColor: colors.border }}>
      {/* Main row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 12, color: colors.textSecondary, width: 80, fontWeight: '500' }} numberOfLines={1}>{name}</Text>
        <View style={{ flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' }}>
          {/* Current intake (solid) */}
          <View style={{ width: `${currentWidth}%`, height: '100%', backgroundColor: colors.textMuted, borderRadius: 3 }} />
          {/* Plan addition (lighter shade of barColor) */}
          <View style={{ width: `${Math.max(addedWidth, 0)}%`, height: '100%', backgroundColor: barColor, opacity: 0.5 }} />
        </View>
        <Text style={{ fontSize: 11, fontWeight: '600', color: barColor, width: 44, textAlign: 'right' }} numberOfLines={1}>{Math.min(projectedPct, 999)}%</Text>
        {safetyLabel ? (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation?.();
              setShowSafetyTip(t => !t);
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{ width: 40, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 9, fontWeight: '700', color: safetyColor }}>{safetyLabel}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
      </View>

      {/* Safety tip tooltip */}
      {showSafetyTip && safetyExplanation && (
        <View style={{
          marginTop: 6,
          marginHorizontal: 4,
          backgroundColor: safetyLabel === 'caution' ? '#FFF3E0' : '#E8F5E9',
          borderRadius: 8,
          padding: 10,
          borderLeftWidth: 3,
          borderLeftColor: safetyColor,
        }}>
          <Text style={{ fontSize: 11, color: '#37474F', lineHeight: 16 }}>
            {safetyExplanation}
          </Text>
        </View>
      )}

      {/* Expanded: per-meal breakdown */}
      {expanded && (
        <View style={{ marginTop: 8, marginLeft: 4, gap: 4, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
          {/* Current intake */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
            <Feather name="check-circle" size={11} color={colors.textMuted} />
            <Text style={{ fontSize: 11, color: colors.textMuted, flex: 1 }}>Already eaten</Text>
            <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>{currentPct}%</Text>
          </View>

          {/* Per-meal contributions */}
          {mealContributions.map((mc, i) => {
            const pctAdd = rda > 0 ? Math.round((mc.amount / rda) * 100) : 0;
            const iconName = mealIcons[mc.meal.toLowerCase()] || 'circle';
            return (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                <Feather name={iconName as any} size={11} color={barColor} />
                <Text style={{ fontSize: 11, color: colors.textSecondary, flex: 1 }}>{mc.meal}</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary }}>+{mc.amount}{mc.unit}</Text>
                <Text style={{ fontSize: 10, color: barColor, fontWeight: '600', width: 44, textAlign: 'right' }} numberOfLines={1}>+{Math.min(pctAdd, 999)}%</Text>
              </View>
            );
          })}

          {/* Total */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, marginTop: 2, borderTopWidth: 0.5, borderTopColor: colors.border }}>
            <Feather name="arrow-right" size={11} color={barColor} />
            <Text style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600', flex: 1 }}>Plan adds</Text>
            <Text style={{ fontSize: 11, color: colors.textPrimary, fontWeight: '600' }}>+{planAdds}{unit}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

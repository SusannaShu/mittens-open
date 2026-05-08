import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

export default function ProjectionRow({ name, currentPct, projectedPct, barColor, safetyLabel, safetyColor, unit, rda, planAdds, mealContributions, mealIcons }: {
  name: string; currentPct: number; projectedPct: number; barColor: string; safetyLabel: string | null; safetyColor: string;
  unit: string; rda: number; planAdds: number; mealContributions: { meal: string; amount: number; unit: string }[]; mealIcons: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const barMax = Math.max(projectedPct, 100);
  const currentWidth = Math.min(currentPct / barMax, 1) * 100;
  const addedWidth = Math.min((projectedPct - currentPct) / barMax, 1 - currentWidth / 100) * 100;

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
        <Text style={{ fontSize: 11, fontWeight: '600', color: barColor, width: 38, textAlign: 'right' }}>{projectedPct}%</Text>
        {safetyLabel ? (
          <Text style={{ fontSize: 9, fontWeight: '700', color: safetyColor, width: 40, textAlign: 'center' }}>{safetyLabel}</Text>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
      </View>

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
                <Text style={{ fontSize: 10, color: barColor, fontWeight: '600', width: 36, textAlign: 'right' }}>+{pctAdd}%</Text>
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

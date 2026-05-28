import { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';
import { recommendSunExposure } from '../../../lib/services/vitaminDSynthesis';

interface Props {
  vitaminDRec: {
    minutesNeeded: number;
    feasible: boolean;
    note: string;
    uvIndex?: number;
  } | null;
  skinType?: number | string;
  vitaminDPct?: number;
  weatherUv?: number;
  vitaminDRdaMcg?: number;
  /** Weekly nature minutes logged (from healthPillars touch_grass) */
  weeklyNatureMin?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}

const NATURE_WEEKLY_GOAL = 120; // White et al. 2019

const SAFE_MAX: Record<number, number> = {
  1: 10, 2: 15, 3: 20, 4: 30, 5: 45, 6: 60,
};

/** Parse 'fitzpatrick-4' or 4 → numeric skin type */
function parseSkinType(raw?: number | string): 1 | 2 | 3 | 4 | 5 | 6 {
  if (typeof raw === 'number') return Math.min(6, Math.max(1, raw)) as any;
  const n = parseInt(String(raw).replace(/\D/g, ''), 10);
  return (n >= 1 && n <= 6 ? n : 4) as any;
}

export default function OutdoorCard({
  vitaminDRec, skinType, vitaminDPct, weatherUv, vitaminDRdaMcg = 15,
  weeklyNatureMin = 0, collapsed = false, onToggle,
}: Props) {
  const [expandedRow, setExpandedRow] = useState<'sun' | 'nature' | null>(null);
  const type = parseSkinType(skinType);

  const sunRec = useMemo(() => {
    if (vitaminDRec) return vitaminDRec;
    const uv = weatherUv ?? 0;
    if (uv < 1) return null;
    const currentPct = vitaminDPct ?? 0;
    const deficitMcg = Math.max(0, vitaminDRdaMcg * (1 - currentPct / 100));
    if (deficitMcg < 0.5) return null;
    const result = recommendSunExposure({ deficitMcg, uvIndex: uv, skinType: type });
    return { ...result, uvIndex: uv };
  }, [vitaminDRec, weatherUv, type, vitaminDPct, vitaminDRdaMcg]);

  const uvIndex = sunRec?.uvIndex ?? weatherUv ?? 0;
  const isFeasible = sunRec ? sunRec.feasible && sunRec.minutesNeeded < Infinity : false;
  const safeMax = SAFE_MAX[type] || 30;
  const natureRemaining = Math.max(0, NATURE_WEEKLY_GOAL - weeklyNatureMin);
  const natureGoalMet = natureRemaining === 0;

  // Nothing to show if no sun data and no nature deficit
  const hasSun = sunRec !== null;
  const hasNature = true; // Always show nature progress
  if (!hasSun && !hasNature) return null;

  return (
    <View style={styles.section}>
      {/* Section header */}
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.sectionTitle}>OUTDOOR</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {!collapsed && (
        <View style={{ gap: 0 }}>
          {/* Sun exposure row */}
          {hasSun && (
            <TouchableOpacity
              onPress={() => setExpandedRow(expandedRow === 'sun' ? null : 'sun')}
              activeOpacity={0.7}
              style={{ paddingVertical: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Feather name="sun" size={14} color={colors.textMuted} />
                  {isFeasible ? (
                    <Text style={{ fontSize: 14, color: colors.textPrimary }}>
                      <Text style={{ fontWeight: '700' }}>{sunRec!.minutesNeeded} min</Text>
                      {'  sun exposure'}
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                      UV too low for vitamin D
                    </Text>
                  )}
                </View>
                {uvIndex > 0 && (
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '500' }}>
                    UV {uvIndex}
                  </Text>
                )}
              </View>

              {expandedRow === 'sun' && sunRec && (
                <View style={{ marginTop: 8, paddingLeft: 22 }}>
                  <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 19 }}>
                    {sunRec.note}
                  </Text>
                  <View style={{ flexDirection: 'row', marginTop: 8, gap: 24 }}>
                    <View>
                      <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>SAFE LIMIT</Text>
                      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{safeMax} min</Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>SKIN TYPE</Text>
                      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{type}</Text>
                    </View>
                    {vitaminDPct !== undefined && (
                      <View>
                        <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>CURRENT</Text>
                        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{vitaminDPct}% of daily D</Text>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Nature time row */}
          <TouchableOpacity
            onPress={() => setExpandedRow(expandedRow === 'nature' ? null : 'nature')}
            activeOpacity={0.7}
            style={{ paddingVertical: 10 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Feather name="wind" size={14} color={colors.textMuted} />
                {natureGoalMet ? (
                  <Text style={{ fontSize: 14, color: colors.textSecondary }}>
                    120 min nature goal met
                  </Text>
                ) : (
                  <Text style={{ fontSize: 14, color: colors.textPrimary }}>
                    <Text style={{ fontWeight: '700' }}>{natureRemaining} min</Text>
                    {'  more nature this week'}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '500' }}>
                {Math.round(weeklyNatureMin)}/{NATURE_WEEKLY_GOAL}
              </Text>
            </View>

            {expandedRow === 'nature' && (
              <View style={{ marginTop: 8, paddingLeft: 22 }}>
                <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 19 }}>
                  120 min/week in nature significantly improves wellbeing, reduces cortisol,
                  and supports immune function. Any outdoor activity counts — walks, parks,
                  gardening, or just sitting outside.
                </Text>
                <View style={{ flexDirection: 'row', marginTop: 8, gap: 24 }}>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>THIS WEEK</Text>
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{Math.round(weeklyNatureMin)} min</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>GOAL</Text>
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{NATURE_WEEKLY_GOAL} min/week</Text>
                  </View>
                  <View>
                    <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 }}>SOURCE</Text>
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>White et al. 2019</Text>
                  </View>
                </View>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

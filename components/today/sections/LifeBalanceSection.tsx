import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import { todayStyles as styles, gaugeStyles } from '../../../styles/todayStyles';
import { HealthPillarsExpandable } from '../HealthPillars';
import { ActivityEntry } from '../../../lib/services/activityApi';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  dashboardGauges: Record<string, number> | null;
  dashboardBreakdown: Record<string, any[]> | null;
  healthPillars?: any;
  pillarContributors?: any;
  expandedGauge: string | null;
  onExpandGauge: (cat: string | null) => void;
  todayActivities: ActivityEntry[];
  onEditActivity: (act: ActivityEntry) => void;
  onAskMittens: (prompt: string) => Promise<string>;
}

const ICONS: Record<string, string> = { work: 'monitor', health: 'heart', play: 'star', love: 'users' };

export default function LifeBalanceSection({
  collapsed, onToggle, dashboardGauges, dashboardBreakdown,
  healthPillars, pillarContributors, expandedGauge, onExpandGauge,
  todayActivities, onEditActivity, onAskMittens,
}: Props) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Feather name="compass" size={14} color={colors.textPrimary} />
          <Text style={styles.sectionTitle}>LIFE BALANCE</Text>
        </View>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <>
          {/* Life category gauges */}
          {(['work', 'health', 'play', 'love'] as const).map((cat) => {
            const val = dashboardGauges?.[cat] || 0;
            const isExpanded = expandedGauge === cat;
            const breakdown = dashboardBreakdown?.[cat] || [];
            return (
              <View key={cat}>
                <TouchableOpacity
                  style={gaugeStyles.row}
                  onPress={() => onExpandGauge(isExpanded ? null : cat)}
                  activeOpacity={0.6}
                >
                  <Feather name={ICONS[cat] as any} size={14} color={val > 0 ? colors.textPrimary : colors.textMuted} />
                  <Text style={[gaugeStyles.label, val === 0 && { color: colors.textMuted }]}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</Text>
                  <View style={gaugeStyles.track}>
                    <View style={[gaugeStyles.fill, { width: `${Math.min(val, 100)}%` }]} />
                  </View>
                  <Text style={gaugeStyles.pct}>{val > 0 ? `${val}%` : '--'}</Text>
                </TouchableOpacity>
                {isExpanded && cat === 'health' && healthPillars && (
                  <HealthPillarsExpandable
                    pillars={healthPillars}
                    pillarContributors={pillarContributors}
                    onAskMittens={onAskMittens}
                  />
                )}
                {isExpanded && cat !== 'health' && breakdown.length > 0 && (
                  <View style={gaugeStyles.breakdown}>
                    {breakdown.map((act: any) => {
                      const d = new Date(act.loggedAt);
                      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
                      return (
                        <TouchableOpacity
                          key={act.id}
                          style={gaugeStyles.breakdownRow}
                          onPress={() => {
                            const fullAct = todayActivities.find(a => a.id === act.id);
                            if (fullAct) onEditActivity(fullAct);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={gaugeStyles.breakdownName} numberOfLines={1}>{act.logName}</Text>
                          <Text style={gaugeStyles.breakdownMeta}>
                            {act.weighted_min}min{act.weight < 1 ? ` (${Math.round(act.weight * 100)}%)` : ''} -- {dayLabel}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {isExpanded && cat !== 'health' && breakdown.length === 0 && (
                  <Text style={gaugeStyles.breakdownEmpty}>No activities logged for {cat} this week</Text>
                )}
              </View>
            );
          })}
          {!dashboardGauges && (
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' }}>
              Log activities with Mittens to populate your life balance.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

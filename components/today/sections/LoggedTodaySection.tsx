import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Meal } from '../../../lib/types';
import { colors, spacing } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';
import { ActivityEntry } from '../../../lib/services/activityApi';
import MealRow from '../MealRow';

const ACT_ICONS: Record<string, string> = {
  work: 'monitor', workout: 'zap', bike: 'navigation', run: 'trending-up',
  walk: 'map-pin', sun: 'sun', social: 'users', rest: 'moon',
  stress: 'alert-circle', soul: 'heart', commute: 'truck', cooking: 'coffee', other: 'circle',
};

function ActivityTimelineRow({ act, onEdit }: { act: ActivityEntry; onEdit: () => void }) {
  const iconName = ACT_ICONS[act.activityType] || 'circle';
  const timeStr = new Date(act.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const datePrefix = (() => {
    const logDate = new Date(act.loggedAt);
    const now = new Date();
    if (logDate.toDateString() === now.toDateString()) return '';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (logDate.toDateString() === yesterday.toDateString()) return 'Yesterday ';
    return `${logDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} `;
  })();

  return (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 }}
      onPress={onEdit}
      activeOpacity={0.7}
    >
      <Feather name={iconName as any} size={16} color={colors.textPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{act.logName}</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          {datePrefix}{timeStr}{act.duration_min ? ` -- ${act.duration_min} min` : ''}{act.location ? ` -- ${act.location}` : ''}
        </Text>
        {act.nutrientImpact && Object.keys(act.nutrientImpact).length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
            {Object.entries(act.nutrientImpact).map(([nutrient, amount]) => (
              <View key={nutrient} style={{ backgroundColor: '#F0F0F0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, color: colors.textSecondary, fontWeight: '600' }}>
                  {(amount as number) > 0 ? '+' : ''}{typeof amount === 'number' ? Math.round(amount * 10) / 10 : amount} {nutrient}
                </Text>
              </View>
            ))}
          </View>
        )}
        {act.failure_logs && act.failure_logs.length > 0 && (
          <View style={{ marginTop: 6, gap: 4 }}>
            {act.failure_logs.map((f: any) => (
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
      </View>
      {act.engagement != null && (
        <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>E:{act.engagement}</Text>
      )}
      {act.energy != null && (
        <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>N:{act.energy > 0 ? '+' : ''}{act.energy}</Text>
      )}
      <Text style={{ fontSize: 13, color: colors.textMuted }}>Edit</Text>
    </TouchableOpacity>
  );
}

interface Props {
  meals: Meal[];
  todayActivities: ActivityEntry[];
  collapsed: boolean;
  onToggle: () => void;
  onEditMeal: (meal: Meal, title: string) => void;
  onEditActivity: (act: ActivityEntry) => void;
}

const MAX_DEFAULT = 3;

export default function LoggedTodaySection({ meals, todayActivities, collapsed, onToggle, onEditMeal, onEditActivity }: Props) {
  const router = useRouter();

  if (meals.length === 0 && todayActivities.length === 0) return null;

  type TimelineItem = { type: 'meal'; data: Meal; time: Date } | { type: 'activity'; data: ActivityEntry; time: Date };
  const foodMeals = meals.filter((m: Meal) => m.entryType !== 'activity');
  const items: TimelineItem[] = [
    ...foodMeals.map((m: Meal) => ({ type: 'meal' as const, data: m, time: new Date(m.loggedAt || 0) })),
    ...todayActivities.map((a: ActivityEntry) => ({ type: 'activity' as const, data: a, time: new Date(a.loggedAt) })),
  ].sort((a, b) => b.time.getTime() - a.time.getTime());

  const visible = items.slice(0, MAX_DEFAULT);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}
        onPress={onToggle}
        activeOpacity={0.6}
      >
        <Text style={styles.sectionTitle}>LOGGED TODAY</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {!collapsed && (
        <>
          {visible.map((item, i) => {
            if (item.type === 'meal') {
              return (
                <MealRow
                  key={`meal-${i}`}
                  meal={item.data}
                  onEdit={onEditMeal}
                />
              );
            }
            return (
              <ActivityTimelineRow
                key={`act-${item.data.id}`}
                act={item.data}
                onEdit={() => onEditActivity(item.data)}
              />
            );
          })}
          {items.length > MAX_DEFAULT && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: 4 }}
              onPress={() => router.push('/(tabs)/sync')}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '500' }}>
                See all {items.length} in Reflect
              </Text>
              <Feather name="chevron-right" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

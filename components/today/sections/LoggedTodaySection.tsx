/**
 * LoggedTodaySection -- Shows location blocks + manual meals/activities.
 *
 * Location blocks get smart titles derived from dominant activities.
 * "See all" expands inline instead of jumping to the Reflect calendar.
 * Each entry is tappable to open ActivityEditModal.
 */

import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Meal } from '../../../lib/types';
import { colors, spacing } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';
import { ActivityEntry } from '../../../lib/services/activityApi';
import MealRow from '../MealRow';
import { useGetLocationSessionsQuery, LocationSession } from '../../../lib/services/location/locationSessionApi';
import { generateLocationBlockTitle, getChildActivitiesForSession } from '../../../lib/services/location/locationBlockTitle';

import { getLocalDateString } from '../../../lib/dateUtils';

const ACT_ICONS: Record<string, string> = {
  work: 'monitor', workout: 'zap', bike: 'navigation', run: 'trending-up',
  walk: 'map-pin', sun: 'sun', social: 'users', rest: 'moon',
  stress: 'alert-circle', soul: 'heart', commute: 'truck', cooking: 'coffee', other: 'circle',
};

const MOTION_ICONS: Record<string, string> = {
  stationary: 'map-pin', walking: 'navigation', cycling: 'navigation',
  driving: 'truck', unknown: 'map-pin',
};

interface Props {
  meals: Meal[];
  todayActivities: ActivityEntry[];
  collapsed: boolean;
  onToggle: () => void;
  onEditMeal: (meal: Meal, title: string) => void;
  onEditActivity: (act: ActivityEntry) => void;
}

const MAX_DEFAULT = 4;

export default function LoggedTodaySection({ meals, todayActivities, collapsed, onToggle, onEditMeal, onEditActivity }: Props) {
  const [expanded, setExpanded] = useState(false);

  const todayDate = getLocalDateString();
  const { data: locationSessions = [] } = useGetLocationSessionsQuery(todayDate);

  // Build unified timeline: location blocks + manual meals + manual activities
  type TimelineItem =
    | { type: 'meal'; data: Meal; time: Date }
    | { type: 'activity'; data: ActivityEntry; time: Date }
    | { type: 'location'; data: LocationSession; time: Date; title: string };

  const items: TimelineItem[] = useMemo(() => {
    const result: TimelineItem[] = [];

    // Location blocks with smart titles (skip those already converted/logged, skip stationary points)
    for (const session of locationSessions) {
      if (session.motionType === 'stationary') continue;

      const isLinked = todayActivities.some(
        (a) => a.meta?.locationSession?.id === session.id || a.originSessionId === session.id || a.id === session.id
      );
      if (isLinked) continue;

      const childActs = getChildActivitiesForSession(session);
      const smartTitle = generateLocationBlockTitle(session, childActs);
      result.push({
        type: 'location',
        data: session,
        time: new Date(session.startedAt),
        title: smartTitle,
      });
    }

    // Manual meals only (not pendant-detected eating)
    const foodMeals = meals.filter((m: Meal) => m.entryType !== 'activity' && (m as any).source !== 'pendant');
    for (const m of foodMeals) {
      result.push({ type: 'meal', data: m, time: new Date(m.loggedAt || 0) });
    }

    // Manual activities only (not pendant-detected)
    const manualActs = todayActivities.filter(
      (a: ActivityEntry) => a.source !== 'pendant' && a.source !== 'trail',
    );
    for (const a of manualActs) {
      result.push({ type: 'activity', data: a, time: new Date(a.loggedAt) });
    }

    // Sort newest first
    result.sort((a, b) => b.time.getTime() - a.time.getTime());
    return result;
  }, [locationSessions, meals, todayActivities]);

  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, MAX_DEFAULT);
  const hasMore = items.length > MAX_DEFAULT;

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

            if (item.type === 'location') {
              return (
                <LocationRow
                  key={`loc-${i}`}
                  session={item.data}
                  title={item.title}
                  onEdit={() => onEditLocationAsActivity(item.data, item.title, onEditActivity)}
                />
              );
            }

            return (
              <ManualActivityRow
                key={`act-${item.data.id}`}
                act={item.data}
                onEdit={() => onEditActivity(item.data)}
              />
            );
          })}

          {/* Inline expand/collapse -- no router.push */}
          {hasMore && (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: 4 }}
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 13, color: colors.textMuted, fontWeight: '500' }}>
                {expanded ? 'Show less' : `See all ${items.length} items`}
              </Text>
              <Feather
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

/** Row for a location block */
function LocationRow({ session, title, onEdit }: {
  session: LocationSession;
  title: string;
  onEdit: () => void;
}) {
  const iconName = MOTION_ICONS[session.motionType] || 'map-pin';
  const timeStr = new Date(session.startedAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  return (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 }}
      onPress={onEdit}
      activeOpacity={0.7}
    >
      <Feather name={iconName as any} size={16} color={colors.textPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{title}</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          {timeStr}{session.duration_min ? ` -- ${Math.ceil(session.duration_min)} min` : ''}
        </Text>
      </View>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>Edit</Text>
    </TouchableOpacity>
  );
}

/** Row for a manual activity entry */
function ManualActivityRow({ act, onEdit }: { act: ActivityEntry; onEdit: () => void }) {
  const iconName = ACT_ICONS[act.activityType] || 'circle';
  const timeStr = new Date(act.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

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
          {timeStr}{act.duration_min ? ` -- ${Math.ceil(act.duration_min)} min` : ''}{act.location ? ` -- ${act.location}` : ''}
        </Text>
      </View>
      {act.engagement != null && (
        <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>E:{act.engagement}</Text>
      )}
      <Text style={{ fontSize: 13, color: colors.textMuted }}>Edit</Text>
    </TouchableOpacity>
  );
}

/**
 * Create a synthetic ActivityEntry from a LocationSession to open the
 * ActivityEditModal with locationSession metadata attached.
 */
function onEditLocationAsActivity(
  session: LocationSession,
  title: string,
  onEditActivity: (act: ActivityEntry) => void,
): void {
  const syntheticActivity: ActivityEntry = {
    id: -1,
    loggedAt: session.startedAt,
    endedAt: session.endedAt,
    activityType: session.motionType === 'stationary' ? 'other' : 'commute',
    logName: title,
    duration_min: session.duration_min || 0,
    location: session.placeName || undefined,
    source: 'location',
    meta: { locationSession: session },
  };
  onEditActivity(syntheticActivity);
}

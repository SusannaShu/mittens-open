/**
 * CalendarWeekView -- 7-column week view with all event types.
 * Now accepts CalendarEvent[] and renders activities, meals, calendar events, and sleep.
 * Overlapping events are laid out side-by-side within each day column.
 */

import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { CalendarEvent } from './CalendarDayView';

const HOUR_HEIGHT = 40;
const START_HOUR = 7;
const END_HOUR = 23;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const GUTTER = 28;

interface Props {
  events: CalendarEvent[];
  startDate: string; // YYYY-MM-DD (Monday)
  onEdit: (event: CalendarEvent) => void;
  onDayTap: (date: string) => void;
}

/** Compute side-by-side column layout for overlapping events */
function computeLayout(events: CalendarEvent[]): Map<string, { column: number; totalColumns: number }> {
  const layoutMap = new Map<string, { column: number; totalColumns: number }>();
  if (events.length === 0) return layoutMap;

  const timed = events.map((evt) => {
    const d = new Date(evt.loggedAt);
    const startMin = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
    const duration = evt.duration_min || 30;
    const endMin = startMin + duration;
    return { evt, startMin, endMin, key: `${evt.type}-${evt.id}` };
  });

  timed.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  const clusters: typeof timed[] = [];
  let currentCluster: typeof timed = [];
  let clusterEnd = -1;

  for (const item of timed) {
    if (item.startMin < 0) continue;
    if (currentCluster.length === 0 || item.startMin < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.endMin;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  for (const cluster of clusters) {
    const columns: typeof timed[] = [];
    for (const item of cluster) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (item.startMin >= lastInCol.endMin) {
          columns[c].push(item);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([item]);
    }
    const totalCols = columns.length;
    for (let c = 0; c < columns.length; c++) {
      for (const item of columns[c]) {
        layoutMap.set(item.key, { column: c, totalColumns: totalCols });
      }
    }
  }

  return layoutMap;
}

const TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  activity: { bg: '#F0F0F0', border: colors.textPrimary },
  scheduled: { bg: '#FAFAFA', border: '#A0AEC0' },
  meal: { bg: '#F8F8F8', border: colors.borderDark || '#999' },
  calendar: { bg: '#F0F7FF', border: '#2196F3' },
  sleep: { bg: '#F5F3FF', border: '#7B61FF' },
};

export default function CalendarWeekView({ events, startDate, onEdit, onDayTap }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const colWidth = (screenWidth - GUTTER - spacing.md) / 7;
  const hourHeight = HOUR_HEIGHT;

  // Generate 7 dates from startDate
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate + 'T12:00:00');
    d.setDate(d.getDate() + i);
    dates.push(d.toLocaleDateString('en-CA'));
  }

  const today = new Date().toLocaleDateString('en-CA');

  // Group events by date
  const eventsByDate: Record<string, CalendarEvent[]> = {};
  for (const dateStr of dates) eventsByDate[dateStr] = [];

  for (const evt of events) {
    const d = new Date(evt.loggedAt);
    const dateStr = d.toLocaleDateString('en-CA');
    if (eventsByDate[dateStr]) eventsByDate[dateStr].push(evt);
  }

  // Pre-compute layouts per day
  const layoutsByDate: Record<string, Map<string, { column: number; totalColumns: number }>> = {};
  for (const dateStr of dates) {
    layoutsByDate[dateStr] = computeLayout(eventsByDate[dateStr]);
  }

  return (
    <View style={s.container}>
      {/* Day headers */}
      <View style={s.headerRow}>
        <View style={{ width: GUTTER }} />
        {dates.map((dateStr) => {
          const d = new Date(dateStr + 'T12:00:00');
          const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
          const dayNum = d.getDate();
          const isToday = dateStr === today;
          return (
            <TouchableOpacity
              key={dateStr}
              style={[s.headerCell, { width: colWidth }]}
              onPress={() => onDayTap(dateStr)}
              activeOpacity={0.6}
            >
              <Text style={s.headerDay}>{dayName}</Text>
              <View style={[s.headerNumWrap, isToday && s.headerNumToday]}>
                <Text style={[s.headerNum, isToday && s.headerNumTextToday]}>{dayNum}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Grid */}
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ height: TOTAL_HOURS * hourHeight, flexDirection: 'row' }}>
          {/* Hour labels */}
          <View style={{ width: GUTTER }}>
            {Array.from({ length: TOTAL_HOURS }, (_, i) => {
              const hour = START_HOUR + i;
              const label = hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
              return (
                <View key={hour} style={[s.hourLabelWrap, { top: i * hourHeight }]}>
                  <Text style={s.hourLabel}>{label}</Text>
                </View>
              );
            })}
          </View>

          {/* Day columns */}
          {dates.map((dateStr) => {
            const dayEvents = eventsByDate[dateStr] || [];
            const layoutMap = layoutsByDate[dateStr];

            return (
              <View key={dateStr} style={[s.dayCol, { width: colWidth }]}>
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <View key={i} style={[s.gridLine, { top: i * hourHeight }]} />
                ))}

                {/* Event blocks */}
                {dayEvents.map((evt) => {
                  const d = new Date(evt.loggedAt);
                  const startMin = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
                  const duration = evt.duration_min || 30;
                  const top = (startMin / 60) * hourHeight;
                  const height = Math.max((duration / 60) * hourHeight, 18);

                  if (top < 0) return null;

                  const key = `${evt.type}-${evt.id}`;
                  const layout = layoutMap.get(key) || { column: 0, totalColumns: 1 };
                  const evtColWidth = (colWidth - 2) / layout.totalColumns;
                  const left = 1 + layout.column * evtColWidth;

                  const isScheduled = evt.type === 'activity' && evt.sourceData?.meta?.scheduled;
                  const typeKey = isScheduled ? 'scheduled' : evt.type;
                  const typeColor = TYPE_COLORS[typeKey] || TYPE_COLORS.activity;
                  const isFuture = new Date(evt.loggedAt).getTime() > Date.now();

                  // Reflected check
                  const src = evt.sourceData;
                  const isReflected = !isFuture && src && (
                    (evt.type === 'activity' && (src.engagement != null || src.energy != null)) ||
                    (evt.type === 'sleep' && (src.quality != null || src.energy != null)) ||
                    (evt.type === 'meal' && src.energy != null)
                  );

                  return (
                    <TouchableOpacity
                      key={key}
                      style={[
                        s.block,
                        {
                          top,
                          height: Math.min(height, TOTAL_HOURS * hourHeight - top),
                          left,
                          width: evtColWidth - 1,
                          backgroundColor: typeColor.bg,
                          borderColor: typeColor.border,
                          borderStyle: isReflected ? 'solid' : 'dashed',
                        },
                        isFuture && { opacity: 0.5 },
                      ]}
                      onPress={() => onEdit(evt)}
                      activeOpacity={0.7}
                    >
                      <Feather name={evt.icon as any} size={8} color={typeColor.border} />
                      {height >= 24 && (
                        <Text style={[s.blockText, { color: typeColor.border }]} numberOfLines={1}>
                          {evt.title.length > 8 ? evt.title.slice(0, 7) + '..' : evt.title}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 2,
  },
  headerCell: {
    alignItems: 'center',
  },
  headerDay: {
    fontSize: 10, color: colors.textMuted, fontWeight: '600',
  },
  headerNumWrap: {
    width: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 2,
  },
  headerNumToday: {
    backgroundColor: colors.textPrimary,
  },
  headerNum: {
    fontSize: 12, fontWeight: '700', color: colors.textPrimary,
  },
  headerNumTextToday: {
    color: colors.bg,
  },
  hourLabelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  hourLabel: {
    fontSize: 8, color: colors.textMuted,
    textAlign: 'right', paddingRight: 4,
    marginTop: -5,
  },
  dayCol: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0, right: 0,
    height: 1,
    backgroundColor: colors.border,
  },
  block: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 2,
    paddingVertical: 1,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  blockText: {
    fontSize: 7,
    fontWeight: '600',
    textAlign: 'center',
  },
});

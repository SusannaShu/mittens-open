/**
 * CalendarDayView -- Google Calendar-style day timeline.
 * Shows hourly slots with activity & meal blocks positioned by time.
 * Supports drag-to-reschedule via PanResponder.
 * Zoom via +/- buttons (adjusts hour height).
 * Overlapping events are laid out side-by-side in columns.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, PanResponder, Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';
import { LinearGradient } from 'expo-linear-gradient';

const DEFAULT_HOUR_HEIGHT = 60;
const ZOOM_STEPS = [30, 45, 60, 80, 100, 120, 150];
const START_HOUR = 0;
const END_HOUR = 24;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const LEFT_GUTTER = 48;
const COLUMN_GAP = 2;

const OngoingDot = ({ color }: { color: string }) => {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.2, duration: 800, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [op]);
  return <Animated.View style={{ opacity: op, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
};

const screenWidth = Dimensions.get('window').width;
const TOTAL_BLOCK_WIDTH = screenWidth - LEFT_GUTTER - spacing.lg - 8;
const LOCATION_RAIL_TOUCH_WIDTH = 44;

/** Unified event type for both activities and meals */
export interface CalendarEvent {
  id: number;
  loggedAt: string;
  title: string;
  duration_min: number;
  icon: string;
  location?: string | null;
  type: 'activity' | 'meal' | 'calendar' | 'sleep' | 'planned' | 'location';
  /** Original data for editing */
  sourceData: any;
}

interface LayoutInfo {
  column: number;
  totalColumns: number;
}

interface Props {
  events: CalendarEvent[];
  date: string;
  onEdit: (event: CalendarEvent) => void;
  onTimeChange?: (event: CalendarEvent, newTime: Date) => void;
  onEmptySlotTap?: (time: Date) => void;
}

/**
 * Compute side-by-side column layout for overlapping events.
 * Groups events into overlap clusters, then assigns each event
 * a column index and tracks the total columns in its cluster.
 */
function computeEventLayout(events: CalendarEvent[]): Map<string, LayoutInfo> {
  const layoutMap = new Map<string, LayoutInfo>();
  if (events.length === 0) return layoutMap;

  // Get start/end minutes for each event
  const timed = events.map((evt) => {
    const d = new Date(evt.loggedAt);
    const startMin = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
    const duration = evt.duration_min || 30;
    const endMin = startMin + duration;
    return { evt, startMin, endMin, key: `${evt.type}-${evt.id}` };
  });

  // Sort by start time, then by duration descending (longer events first)
  timed.sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  // Track columns: array of "end time" per column
  const columns: number[] = [];
  const assignments: { key: string; column: number; startMin: number; endMin: number }[] = [];

  for (const item of timed) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      if (item.startMin >= columns[col]) {
        columns[col] = item.endMin;
        assignments.push({ key: item.key, column: col, startMin: item.startMin, endMin: item.endMin });
        placed = true;
        break;
      }
    }
    if (!placed) {
      assignments.push({ key: item.key, column: columns.length, startMin: item.startMin, endMin: item.endMin });
      columns.push(item.endMin);
    }
  }

  // Group into connected overlap clusters
  const n = assignments.length;
  const clusterIds = new Array(n).fill(-1);
  let nextCluster = 0;

  for (let i = 0; i < n; i++) {
    if (clusterIds[i] === -1) {
      clusterIds[i] = nextCluster;
      let clusterEnd = assignments[i].endMin;
      const queue = [i];
      let qi = 0;
      while (qi < queue.length) {
        const ci = queue[qi++];
        clusterEnd = Math.max(clusterEnd, assignments[ci].endMin);
        for (let j = 0; j < n; j++) {
          if (clusterIds[j] === -1 && assignments[j].startMin < clusterEnd && assignments[j].endMin > assignments[ci].startMin) {
            clusterIds[j] = nextCluster;
            queue.push(j);
          }
        }
      }
      nextCluster++;
    }
  }

  // For each cluster, compute max column used
  const clusterMaxCol = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const cid = clusterIds[i];
    const prev = clusterMaxCol.get(cid) ?? 0;
    clusterMaxCol.set(cid, Math.max(prev, assignments[i].column + 1));
  }

  // Build final layout map
  for (let i = 0; i < n; i++) {
    const cid = clusterIds[i];
    layoutMap.set(assignments[i].key, {
      column: assignments[i].column,
      totalColumns: clusterMaxCol.get(cid)!,
    });
  }

  return layoutMap;
}

/** Types of events that should not be draggable */
const NON_DRAGGABLE_TYPES = new Set(['planned', 'calendar', 'sleep', 'location']);
/** Sunrise/Sunset IDs are purely decorative */
const SOLAR_IDS = new Set([400001, 400002]);

export default function CalendarDayView({ events, date, onEdit, onTimeChange, onEmptySlotTap }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [dragEvent, setDragEvent] = useState<CalendarEvent | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragStartTop = useRef(0);
  const [hourHeight, setHourHeight] = useState(DEFAULT_HOUR_HEIGHT);
  const scrollYRef = useRef(0);

  const handleZoom = useCallback((direction: 1 | -1) => {
    const currentIdx = ZOOM_STEPS.indexOf(hourHeight);
    const idx = currentIdx >= 0 ? currentIdx : ZOOM_STEPS.findIndex(s => s >= hourHeight);
    const newIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + direction));
    const newHeight = ZOOM_STEPS[newIdx];
    if (newHeight !== hourHeight) {
      // Maintain scroll center position
      const ratio = newHeight / hourHeight;
      const newScrollY = scrollYRef.current * ratio;
      setHourHeight(newHeight);
      setTimeout(() => scrollRef.current?.scrollTo({ y: newScrollY, animated: false }), 0);
    }
  }, [hourHeight]);

  // Compute overlap layout (exclude location events -- they render in a separate side-rail)
  const layoutMap = useMemo(() => computeEventLayout(events.filter(e => e.type !== 'location')), [events]);

  useEffect(() => {
    const isToday = date === new Date().toLocaleDateString('en-CA');
    const scrollHour = isToday
      ? Math.max(new Date().getHours() - 1, START_HOUR)
      : events.length > 0
        ? Math.max(new Date(events[0].loggedAt).getHours() - 1, START_HOUR)
        : 8;
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: (scrollHour - START_HOUR) * hourHeight, animated: false });
    }, 100);
  }, [date, events]);

  const now = new Date();
  const isToday = date === now.toLocaleDateString('en-CA');
  const currentMinuteOffset = isToday
    ? (now.getHours() - START_HOUR) * hourHeight + (now.getMinutes() / 60) * hourHeight
    : -1;

  const getBlockPosition = (evt: CalendarEvent) => {
    const d = new Date(evt.loggedAt);
    const startMin = (d.getHours() - START_HOUR) * 60 + d.getMinutes();
    const duration = evt.duration_min || 30;
    const top = (startMin / 60) * hourHeight;
    const height = Math.max((duration / 60) * hourHeight, 24);
    return { top, height };
  };

  /** Get column-aware left + width for an event */
  const getColumnStyle = (evt: CalendarEvent) => {
    const key = `${evt.type}-${evt.id}`;
    const layout = layoutMap.get(key);
    if (!layout || layout.totalColumns <= 1) {
      return { left: LEFT_GUTTER + 4, width: TOTAL_BLOCK_WIDTH };
    }
    const colWidth = (TOTAL_BLOCK_WIDTH - (layout.totalColumns - 1) * COLUMN_GAP) / layout.totalColumns;
    const left = LEFT_GUTTER + 4 + layout.column * (colWidth + COLUMN_GAP);
    return { left, width: colWidth };
  };

  // Snap dragged position to nearest 15 min
  const snapToTime = useCallback((yPos: number): Date => {
    const totalMinutes = (yPos / hourHeight) * 60 + START_HOUR * 60;
    const snapped = Math.round(totalMinutes / 15) * 15;
    const hours = Math.floor(snapped / 60);
    const mins = snapped % 60;
    const d = new Date(date + 'T12:00:00');
    d.setHours(hours, mins, 0, 0);
    return d;
  }, [date, hourHeight]);

  // Pan responder for drag
  const createPanResponder = useCallback((evt: CalendarEvent, topOffset: number) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setDragEvent(evt);
        dragStartTop.current = topOffset;
        dragY.setValue(topOffset);
      },
      onPanResponderMove: (_, gesture) => {
        const newY = Math.max(0, Math.min(dragStartTop.current + gesture.dy, TOTAL_HOURS * hourHeight - 20));
        dragY.setValue(newY);
      },
      onPanResponderRelease: (_, gesture) => {
        const finalY = Math.max(0, dragStartTop.current + gesture.dy);
        const newTime = snapToTime(finalY);
        if (onTimeChange && Math.abs(gesture.dy) > 10) {
          onTimeChange(evt, newTime);
        }
        setDragEvent(null);
      },
      onPanResponderTerminate: () => setDragEvent(null),
    });
  }, [dragY, snapToTime, onTimeChange, hourHeight]);

  return (
    <View style={s.container}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 36, paddingTop: 24 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!dragEvent}
        onScroll={(e) => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        <View style={[s.grid, { height: TOTAL_HOURS * hourHeight }]}>
        {/* Tappable empty hour slots (behind events) */}
        {onEmptySlotTap && Array.from({ length: TOTAL_HOURS }, (_, i) => {
          const hour = START_HOUR + i;
          return (
            <TouchableOpacity
              key={`slot-${hour}`}
              style={[s.hourSlot, { top: i * hourHeight, height: hourHeight }]}
              onPress={() => {
                const d = new Date(date + 'T12:00:00');
                d.setHours(hour, 0, 0, 0);
                onEmptySlotTap(d);
              }}
              activeOpacity={0.7}
            />
          );
        })}

        {/* Hour lines */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
          const hour = START_HOUR + i;
          const label = hour === 0 || hour === 24 ? '12 AM'
            : hour < 12 ? `${hour} AM`
            : hour === 12 ? '12 PM'
            : `${hour - 12} PM`;
          return (
            <View key={hour} style={[s.hourRow, { top: i * hourHeight }]} pointerEvents="none">
              <Text style={s.hourLabel}>{label}</Text>
              <View style={s.hourLine} />
            </View>
          );
        })}

        {/* Current time indicator */}
        {currentMinuteOffset >= 0 && (
          <View style={[s.nowLine, { top: currentMinuteOffset }]}>
            <View style={s.nowDot} />
            <View style={s.nowBar} />
          </View>
        )}
        {/* Location side-rail */}
        {(() => {
          const locationEvts = events.filter(e => e.type === 'location');
          const RAIL_COLORS: Record<string, string> = {
            stationary: '#000000', walking: '#757575', running: '#757575',
            cycling: '#757575', driving: '#757575', unknown: '#757575',
          };
          // Differentiate motion types by line style, not color
          const RAIL_LINE: Record<string, { style: 'solid' | 'dashed' | 'dotted'; width: number }> = {
            stationary: { style: 'solid', width: 2 },
            walking:    { style: 'solid', width: 2 },
            running:    { style: 'solid', width: 3 },
            cycling:    { style: 'dashed', width: 2 },
            driving:    { style: 'dotted', width: 2 },
            unknown:    { style: 'solid', width: 1 },
          };
          return locationEvts.map((evt) => {
            const { top, height } = getBlockPosition(evt);
            const mt = evt.sourceData?.motionType || 'unknown';
            const color = RAIL_COLORS[mt] || '#757575';
            const line = RAIL_LINE[mt] || { style: 'solid' as const, width: 2 };
            const isOngoing = evt.sourceData?.endedAt === null;
            return (
                <TouchableOpacity
                  key={`loc-${evt.id}`}
                  style={[s.locationRail, { top, height: Math.max(height, 8) }]}
                  onPress={() => onEdit(evt)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Open location details for ${evt.title}`}
                >
                  <View style={[
                    s.locationRailLine,
                    { borderColor: color, borderStyle: line.style, borderLeftWidth: line.width }
                  ]} />
                  {mt === 'stationary' && (
                    <View style={[s.locationRailDot, { top: 0 }]}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                    </View>
                  )}
                  {mt === 'stationary' && !isOngoing && (
                    <View style={[s.locationRailDot, { bottom: 0 }]}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
                    </View>
                  )}
                  {isOngoing && (
                    <View style={[s.locationRailDot, { bottom: -4 }]}>
                      <OngoingDot color={color} />
                    </View>
                  )}
                </TouchableOpacity>
            );
          });
        })()}

        {/* Event blocks */}
        {events.filter(e => e.type !== 'location').map((evt) => {
          const { top, height } = getBlockPosition(evt);
          const { left, width } = getColumnStyle(evt);
          const icon = evt.icon;
          const isMeal = evt.type === 'meal';
          const isCalendar = evt.type === 'calendar';
          const isSleep = evt.type === 'sleep';
          const isPlanned = evt.type === 'planned';
          const isSolar = SOLAR_IDS.has(evt.id);
          const isDraggable = !NON_DRAGGABLE_TYPES.has(evt.type) && !isSolar
            && !(evt.type === 'activity' && evt.sourceData?.meta?.scheduled);
          const isDragging = isDraggable && dragEvent?.id === evt.id && dragEvent?.type === evt.type;

          // Determine reflected vs unreflected vs future
          const eventTime = new Date(evt.loggedAt).getTime();
          const isFuture = eventTime > Date.now();
          const isReflected = (() => {
            if (isFuture) return false;
            const src = evt.sourceData;
            if (!src) return false;
            if (evt.type === 'activity') return src.engagement != null || src.energy != null;
            if (evt.type === 'sleep') return src.quality != null || src.energy != null;
            if (evt.type === 'meal') return src.energy != null;
            return false;
          })();

          const time = new Date(evt.loggedAt).toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          });
          const endTime = evt.duration_min
            ? new Date(new Date(evt.loggedAt).getTime() + evt.duration_min * 60000)
                .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : null;

          // Solar events (sunrise/sunset) are purely decorative
          if (isSolar) {
            return (
              <View
                key={`${evt.type}-${evt.id}`}
                style={[
                  s.block, s.solarBlock,
                  { top, height: Math.max(height, 24), left, width },
                ]}
                pointerEvents="none"
              >
                <View style={s.blockInner}>
                  <Feather name={icon as any} size={12} color="#F59E0B" />
                  <Text style={[s.blockTitle, { color: '#F59E0B' }]} numberOfLines={1}>
                    {evt.title}
                  </Text>
                </View>
              </View>
            );
          }

          if (evt.type === 'location') {
            const mType = evt.sourceData?.motionType || 'unknown';
            const isSt = mType === 'stationary';
            const isOngoing = evt.sourceData?.endedAt === null;
            const BLOCK_ICONS: Record<string, string> = {
              stationary: 'map-pin', walking: 'navigation', running: 'trending-up',
              cycling: 'navigation', driving: 'truck', unknown: 'map-pin',
            };
            const iconName = BLOCK_ICONS[mType] || 'map-pin';
            
            return (
              <TouchableOpacity
                key={`${evt.type}-${evt.id}`}
                style={[
                  s.block,
                  { 
                    top, height: Math.max(height, 28), left: 0, width: TOTAL_BLOCK_WIDTH, 
                    backgroundColor: isSt ? 'rgba(102, 187, 106, 0.12)' : 'rgba(67, 160, 71, 0.08)',
                    borderColor: isSt ? '#81C784' : '#66BB6A',
                    borderStyle: isSt ? 'solid' as const : 'dashed' as const,
                    zIndex: 5,
                  }
                ]}
                onPress={() => onEdit(evt)}
                activeOpacity={0.8}
              >
                <View style={[s.blockInner, { backgroundColor: 'transparent' }]}>
                  <Feather name={iconName as any} size={12} color={isSt ? '#4CAF50' : '#388E3C'} />
                  <Text style={[s.blockTitle, { color: isSt ? '#388E3C' : '#2E7D32' }]} numberOfLines={1}>
                    {evt.title}
                  </Text>
                  {isOngoing && <OngoingDot color="#4CAF50" />}
                </View>
              </TouchableOpacity>
            );
          }

          // Build drag handlers only for draggable events
          const panHandlers = isDraggable ? createPanResponder(evt, top) : null;

          const isScheduled = evt.type === 'activity' && evt.sourceData?.meta?.scheduled;
          const currentTop = isDragging ? dragY : top;
          
          return (
            <Animated.View
              key={`${evt.type}-${evt.id}`}
              style={[
                s.block,
                isMeal && s.mealBlock,
                isCalendar && s.calendarBlock,
                isSleep && s.sleepBlock,
                isPlanned && s.plannedBlock,
                isScheduled && s.scheduledBlock,
                isFuture && s.futureBlock,
                isDragging && s.dragging,
                { top: currentTop, height: Math.max(height, 24), left, width, zIndex: isDragging ? 50 : 10 },
              ]}
            >
              <TouchableOpacity
                onPress={() => onEdit(evt)}
                activeOpacity={0.7}
                style={{ flex: 1, paddingRight: isDraggable ? 24 : 0 }}
              >
                <View style={s.blockInner}>
                  <Feather name={icon as any} size={12} color={isPlanned ? '#8B9DC3' : isSleep ? '#7B61FF' : isCalendar ? '#2196F3' : isMeal ? colors.textSecondary : colors.textPrimary} />
                  <Text style={[s.blockTitle, isMeal && s.mealTitle]} numberOfLines={1}>
                    {evt.title}
                  </Text>
                </View>
                {height >= 38 && (
                  <Text style={s.blockTime}>
                    {time}{endTime ? ` - ${endTime}` : ''}
                  </Text>
                )}
                {height >= 52 && evt.location && (
                  <Text style={s.blockLocation} numberOfLines={1}>{evt.location}</Text>
                )}
              </TouchableOpacity>

              {isDraggable && panHandlers && (
                <View
                  style={s.dragHandle}
                  {...panHandlers.panHandlers}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="menu" size={14} color="#CBD5E1" />
                </View>
              )}
            </Animated.View>
          );
        })}
      </View>
      </ScrollView>

      {/* Floating zoom controls */}
      <View style={s.zoomControls}>
        <TouchableOpacity
          style={s.zoomBtn}
          onPress={() => handleZoom(1)}
          activeOpacity={0.6}
        >
          <Feather name="plus" size={16} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.zoomBtn}
          onPress={() => handleZoom(-1)}
          activeOpacity={0.6}
        >
          <Feather name="minus" size={16} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  grid: { position: 'relative', marginLeft: 0 },
  hourSlot: {
    position: 'absolute',
    left: LEFT_GUTTER,
    right: 0,
    zIndex: 1,
  },
  hourRow: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-start',
  },
  hourLabel: {
    width: LEFT_GUTTER - 8, fontSize: 10, color: colors.textMuted,
    textAlign: 'right', paddingRight: 8, marginTop: -6,
  },
  hourLine: { flex: 1, height: 1, backgroundColor: colors.border },
  nowLine: {
    position: 'absolute', left: LEFT_GUTTER - 6, right: 0,
    flexDirection: 'row', alignItems: 'center', zIndex: 20,
  },
  nowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E53E3E' },
  nowBar: { flex: 1, height: 2, backgroundColor: '#E53E3E' },
  block: {
    position: 'absolute',
    backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.textPrimary,
    borderRadius: 4,
    paddingHorizontal: 8, paddingVertical: 2,
    zIndex: 10, overflow: 'hidden',
    justifyContent: 'center',
  },
  mealBlock: {
    backgroundColor: '#F8F8F8',
    borderColor: colors.borderDark,
    borderStyle: 'dashed',
  },
  calendarBlock: {
    backgroundColor: '#F0F7FF',
    borderColor: '#2196F3',
    borderStyle: 'dashed',
  },
  sleepBlock: {
    backgroundColor: '#F5F3FF',
    borderColor: '#7B61FF',
    borderStyle: 'dashed',
  },
  scheduledBlock: {
    backgroundColor: '#FAFAFA',
    borderColor: '#A0AEC0',
    borderStyle: 'dashed',
  },
  plannedBlock: {
    backgroundColor: '#F0F4FA',
    borderColor: '#8B9DC3',
    borderStyle: 'dotted',
    opacity: 0.7,
  },
  reflectedBlock: {
    borderStyle: 'solid',
  },
  futureBlock: {
    opacity: 0.6,
    borderStyle: 'dotted',
  },
  solarBlock: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderStyle: 'dotted',
    opacity: 0.6,
  },
  dragging: {
    zIndex: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    opacity: 0.9,
  },
  blockInner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 18,
  },
  blockTitle: {
    fontSize: 12, fontWeight: '600', color: colors.textPrimary, flex: 1,
  },
  mealTitle: {
    color: colors.textSecondary,
  },
  blockTime: {
    fontSize: 10, color: colors.textMuted, marginTop: 1, marginLeft: 18,
  },
  blockLocation: {
    fontSize: 9, color: colors.textMuted, marginTop: 1, marginLeft: 18,
  },
  zoomControls: {
    position: 'absolute',
    bottom: 16,
    right: 12,
    flexDirection: 'row',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragHandle: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  locationRail: {
    position: 'absolute',
    right: 0,
    width: LOCATION_RAIL_TOUCH_WIDTH,
    zIndex: 30,
  },
  locationRailLine: {
    position: 'absolute',
    right: 5,
    width: 0,
    top: 0,
    bottom: 0,
    borderLeftWidth: 2,
  },
  locationRailIconBox: {
    position: 'absolute',
    right: 2,
    top: 0,
    backgroundColor: colors.bg,
    borderRadius: 6,
    padding: 2,
  },
  locationRailDot: {
    position: 'absolute',
    right: 3,
  },
});

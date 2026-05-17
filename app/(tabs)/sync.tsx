import React, { useState, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, PanResponder, Animated, Dimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { getDb } from '../../lib/database';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';
import ActivityEditModal from '../../components/common/ActivityEditModal';
import LocationLogModal from '../../components/places/LocationLogModal';
import SleepEditModal from '../../components/common/SleepEditModal';
import { EditModal } from '../../components/today/TodayModals';
import { ManualEntryModal } from '../../components/today/ManualEntryModal';
import CalendarDayView from '../../components/reflect/CalendarDayView';
import CalendarWeekView from '../../components/reflect/CalendarWeekView';
import CalendarMonthView from '../../components/reflect/CalendarMonthView';
import OngoingBanner from '../../components/reflect/OngoingBanner';
import { ViewMode, useSyncData } from '../../hooks/useSyncData';
import { useSyncHandlers } from '../../hooks/useSyncHandlers';
import { syncStyles as s } from '../../styles/syncStyles';
import { LocationSession } from '../../lib/services/location/locationSessionApi';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.25;

export default function ReflectScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const db = getDb();

  const {
    weekStart,
    isFetching,
    refetch,
    calendarEvents,
    weekCalendarEvents,
    monthActivityCounts,
  } = useSyncData(selectedDate, viewMode);

  const h = useSyncHandlers(selectedDate, refetch);

  // Location log modal state
  const [locationSession, setLocationSession] = React.useState<LocationSession | null>(null);
  const [locationModalVisible, setLocationModalVisible] = React.useState(false);

  // Wrap handleEdit to route:
  //   - 'location' type events (rail taps) -> LocationLogModal (map)
  //   - 'activity' type events with source='location' -> ActivityEditModal (normal flow)
  //   - everything else -> normal handleEdit
  const handleEdit = (evt: any) => {
    if (evt.type === 'location') {
      // Location rail tap -> open map modal
      setLocationSession(evt.sourceData);
      setLocationModalVisible(true);
    } else {
      h.handleEdit(evt);
    }
  };

  const changeDate = (offset: number) => {
    const d = new Date(selectedDate + 'T12:00:00');
    if (viewMode === 'week') d.setDate(d.getDate() + offset * 7);
    else if (viewMode === 'month') d.setMonth(d.getMonth() + offset);
    else d.setDate(d.getDate() + offset);
    setSelectedDate(d.toLocaleDateString('en-CA'));
  };

  // Stable ref so PanResponder always calls the latest changeDate
  const changeDateRef = useRef(changeDate);
  changeDateRef.current = changeDate;

  // Animated slide transition for swipe navigation
  const slideX = useRef(new Animated.Value(0)).current;
  const isSwiping = useRef(false);

  const swipePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderGrant: () => {
      isSwiping.current = true;
    },
    onPanResponderMove: (_, gesture) => {
      // Follow the finger with slight resistance
      slideX.setValue(gesture.dx * 0.8);
    },
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) > SWIPE_THRESHOLD || Math.abs(gesture.vx) > 0.5) {
        const direction = gesture.dx < 0 ? 1 : -1; // left swipe = next, right = prev
        // Slide fully off-screen
        Animated.timing(slideX, {
          toValue: -direction * SCREEN_WIDTH,
          duration: 150,
          useNativeDriver: true,
        }).start(() => {
          // Change date while off-screen
          changeDateRef.current(direction);
          // Instantly position on the opposite side, then slide in
          slideX.setValue(direction * SCREEN_WIDTH * 0.3);
          Animated.spring(slideX, {
            toValue: 0,
            tension: 80,
            friction: 12,
            useNativeDriver: true,
          }).start(() => { isSwiping.current = false; });
        });
      } else {
        // Snap back to center
        Animated.spring(slideX, {
          toValue: 0,
          tension: 120,
          friction: 14,
          useNativeDriver: true,
        }).start(() => { isSwiping.current = false; });
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(slideX, {
        toValue: 0,
        tension: 120,
        friction: 14,
        useNativeDriver: true,
      }).start(() => { isSwiping.current = false; });
    },
  }), []);

  // Animated date change for chevron buttons (same slide effect)
  const animatedChangeDate = (direction: number) => {
    Animated.timing(slideX, {
      toValue: -direction * SCREEN_WIDTH,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      changeDateRef.current(direction);
      slideX.setValue(direction * SCREEN_WIDTH * 0.3);
      Animated.spring(slideX, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }).start();
    });
  };

  // Tap empty time slot -> open ManualEntryModal with pre-filled time
  const handleEmptySlotTap = (time: Date) => {
    h.setManualLoggedAt(time);
    h.setManualModalVisible(true);
  };

  const isToday = selectedDate === new Date().toLocaleDateString('en-CA');
  const displayDate = new Date(selectedDate + 'T12:00:00');

  const getDateDisplay = () => {
    if (viewMode === 'day') {
      return isToday ? 'Today' : displayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    if (viewMode === 'week') {
      const endDate = new Date(weekStart + 'T12:00:00');
      endDate.setDate(endDate.getDate() + 6);
      const start = new Date(weekStart + 'T12:00:00');
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    return displayDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const canGoForward = true;

  return (
    <View style={s.container}>
      <Tabs.Screen
        options={{
          headerLeft: () => !isToday ? (
            <TouchableOpacity
              style={[s.todayBtn, { marginLeft: spacing.lg }]}
              onPress={() => setSelectedDate(new Date().toLocaleDateString('en-CA'))}
              activeOpacity={0.6}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Feather name="rotate-ccw" size={12} color={colors.textPrimary} />
              <Text style={s.todayBtnText}>Today</Text>
            </TouchableOpacity>
          ) : null,
          headerRight: () => (
            <TouchableOpacity
              style={[s.addBtn, { marginRight: spacing.lg }]}
              onPress={() => h.setManualModalVisible(true)}
              activeOpacity={0.6}
            >
              <Text style={s.addBtnText}>+</Text>
            </TouchableOpacity>
          ),
        }}
      />
      
      <View style={s.header}>
        <View style={s.dateNav}>
          <TouchableOpacity onPress={() => animatedChangeDate(-1)} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="chevron-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => !isToday && setSelectedDate(new Date().toLocaleDateString('en-CA'))}
            activeOpacity={0.6}
          >
            <Text style={s.dateText}>{getDateDisplay()}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => canGoForward && animatedChangeDate(1)}
            activeOpacity={canGoForward ? 0.6 : 0.3}
            disabled={!canGoForward}
          >
            <Feather name="chevron-right" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={s.viewToggle}>
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[s.toggleBtn, viewMode === mode && s.toggleBtnActive]}
              onPress={() => setViewMode(mode)}
              activeOpacity={0.6}
            >
              <Text style={[s.toggleText, viewMode === mode && s.toggleTextActive]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {viewMode === 'day' && (
        <Animated.View
          style={{ flex: 1, transform: [{ translateX: slideX }] }}
          {...swipePan.panHandlers}
        >
          {calendarEvents.length > 0 ? (
            <CalendarDayView
              events={calendarEvents}
              date={selectedDate}
              onEdit={handleEdit}
              onTimeChange={h.handleTimeChange}
              onEmptySlotTap={handleEmptySlotTap}
            />
          ) : (
            <View style={s.emptyState}>
              <Feather name="calendar" size={32} color={colors.textMuted} />
              <Text style={s.emptyTitle}>No events</Text>
              <Text style={s.emptySubtitle}>
                Tell Mittens what you're up to and events will appear here.
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {viewMode === 'week' && (
        <Animated.View
          style={{ flex: 1, transform: [{ translateX: slideX }] }}
          {...swipePan.panHandlers}
        >
          <CalendarWeekView
            events={weekCalendarEvents}
            startDate={weekStart}
            onEdit={h.handleEdit}
            onDayTap={(date) => { setSelectedDate(date); setViewMode('day'); }}
          />
        </Animated.View>
      )}

      {viewMode === 'month' && (
        <Animated.View
          style={{ flex: 1, transform: [{ translateX: slideX }] }}
          {...swipePan.panHandlers}
        >
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <CalendarMonthView
              monthDate={selectedDate}
              activityCounts={monthActivityCounts}
              selectedDate={selectedDate}
              onDayTap={(date) => { setSelectedDate(date); setViewMode('day'); }}
            />
          </ScrollView>
        </Animated.View>
      )}

      <ActivityEditModal
        visible={h.activityEditVisible}
        activity={h.editingActivity}
        onClose={() => { h.setActivityEditVisible(false); h.setEditingActivity(null); h.setIsNewCalendarActivity(false); }}
        onSave={async (id, data) => {
          if (h.isNewCalendarActivity || id === -1) {
            const googleEventId = h.editingActivity?.meta?.googleEventId || null;
            await h.logActivity({ ...data, source: 'calendar', googleEventId } as any).unwrap();
          } else if (id < 0 && h.editingActivity?.source === 'location') {
            const meta = h.editingActivity.meta as any;
            if (meta?.trailSessions) {
              await h.logActivity({
                activityType: data.activityType || 'commute',
                logName: data.logName || 'Transit',
                duration_min: data.duration_min,
                loggedAt: data.loggedAt || meta.trailSessions[0].startedAt,
                location: data.location,
                aeiou: data.aeiou,
                engagement: data.engagement,
                energy: data.energy,
                source: 'location',
                meta: { trailSessions: meta.trailSessions.map((t: any) => t.id) }
              }).unwrap();
              if (data.location) {
                const lastTs = meta.trailSessions[meta.trailSessions.length - 1];
                await db.runAsync('UPDATE location_sessions SET place_name = ? WHERE id = ?', [data.location, lastTs.id]);
              }
            } else if (meta?.locationSession) {
              await h.logActivity({
                activityType: data.activityType || 'other',
                logName: data.logName || meta.locationSession.placeName || 'Activity',
                duration_min: data.duration_min,
                loggedAt: data.loggedAt || meta.locationSession.startedAt,
                location: data.location,
                aeiou: data.aeiou,
                engagement: data.engagement,
                energy: data.energy,
                source: 'location',
                meta: { locationSessionId: meta.locationSession.id }
              }).unwrap();
              if (data.location) {
                await db.runAsync('UPDATE location_sessions SET place_name = ? WHERE id = ?', [data.location, meta.locationSession.id]);
              }
            }
          } else {
            await h.reflectActivity({ id, ...data }).unwrap();
          }
          h.setIsNewCalendarActivity(false);
          refetch();
        }}
        onDelete={async (id) => {
          if (id === -1 && h.editingActivity?.meta?.syncedCalendarEventId) {
            await h.deleteCalendarEvent(h.editingActivity.meta.syncedCalendarEventId).unwrap();
          } else if (id < 0 && h.editingActivity?.source === 'location') {
            const meta = h.editingActivity.meta as any;
            if (meta?.trailSessions) {
              for (const ts of meta.trailSessions) {
                await db.runAsync('DELETE FROM location_sessions WHERE id = ?', [ts.id]);
              }
            } else if (meta?.locationSession) {
              await db.runAsync('DELETE FROM location_sessions WHERE id = ?', [meta.locationSession.id]);
            }
          } else if (id > 0) {
            await h.deleteActivity(id).unwrap();
          }
          h.setActivityEditVisible(false);
          refetch();
        }}
      />

      <LocationLogModal
        visible={locationModalVisible}
        session={locationSession}
        existingActivity={
          locationSession 
            ? calendarEvents.find(e => 
                e.type === 'activity' && 
                Math.abs(new Date(e.loggedAt).getTime() - new Date(locationSession.startedAt).getTime()) < 5 * 60000
              )?.sourceData as any
            : undefined
        }
        onViewActivity={(act) => {
          h.setEditingActivity(act as any);
          h.setIsNewCalendarActivity(false);
          h.setActivityEditVisible(true);
        }}
        onClose={() => { setLocationModalVisible(false); setLocationSession(null); }}
        onConvertActivity={(draft) => {
           h.setEditingActivity(draft as any);
           h.setIsNewCalendarActivity(true);
           h.setActivityEditVisible(true);
        }}
      />

      <EditModal
        visible={h.editModalVisible}
        onClose={() => h.setEditModalVisible(false)}
        imageUrl={h.editImageUrl}
        imageUrls={h.editImageUrls}
        mealType={h.editMealType}
        items={h.editItems}
        itemText={h.editItemText}
        savingEdit={h.savingEdit}
        displayTitle={h.editDisplayTitle}
        itemId={h.editItemId}
        loggedAt={h.editLoggedAt}
        onLoggedAtChange={h.setEditLoggedAt}
        onMealTypeChange={h.setEditMealType}
        onItemChange={h.handleEditItem}
        onRemoveItem={h.handleRemoveEditItem}
        onItemTextChange={h.setEditItemText}
        onDirectSave={h.handleDirectSave}
        onAIUpdate={h.handleEditSubmit}
        onDelete={() => {
          if (h.editItemId) h.handleDeleteMealEntry(h.editItemId, h.editDisplayTitle);
        }}
      />

      <SleepEditModal
        visible={h.sleepEditVisible}
        sleep={h.editingSleep}
        onClose={() => { h.setSleepEditVisible(false); h.setEditingSleep(null); }}
        onSave={async (id, data) => {
          if (id === -1) {
            await h.logSleep(data as any).unwrap();
          } else {
            await h.updateSleepLog({ id, ...data } as any).unwrap();
          }
          refetch();
        }}
        onDelete={async (id) => {
          if (id > 0) {
            await h.deleteSleepLog(id).unwrap();
          }
          refetch();
        }}
      />

      <ManualEntryModal
        visible={h.manualModalVisible}
        onClose={() => { h.setManualModalVisible(false); h.setManualPhotos([]); }}
        initialDate={selectedDate}
        loggedAt={h.manualLoggedAt}
        onLoggedAtChange={h.setManualLoggedAt}
        text={h.manualText}
        onTextChange={h.setManualText}
        usdaFoods={h.manualUsdaFoods}
        onUsdaFoodsChange={h.setManualUsdaFoods}
        photos={h.manualPhotos}
        onPhotosChange={h.setManualPhotos}
        mealType={h.manualMealType}
        onMealTypeChange={h.setManualMealType}
        analyzing={h.analyzingManual}
        onSubmit={h.handleMealSubmit}
        onActivitySubmit={async (data) => {
          await h.logActivity({ ...data, loggedAt: data.loggedAt || new Date().toISOString() } as any).unwrap();
          h.setManualModalVisible(false);
          refetch();
        }}
        onSleepSubmit={async (data) => {
          await h.logSleep(data).unwrap();
          h.setManualModalVisible(false);
          refetch();
        }}
      />
    </View>
  );
}

/**
 * PastLogsModal -- Browse meal logs from previous days.
 * Shows last 7 days with expandable daily sections.
 */

import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Modal,
  TouchableOpacity, ActivityIndicator, Pressable, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { getApiBase, getAuthToken } from '../../lib/api';

interface PastLogsModalProps {
  visible: boolean;
  onClose: () => void;
  onEditMeal?: (meal: { id: number; logName: string; mealType: string; items: any[]; imageUrl?: string; imageUrls: string[] }) => void;
}

interface PastMeal {
  id: number;
  loggedAt: string;
  mealType: string;
  logName: string;
  items: any[];
  imageUrl?: string;
  imageUrls: string[];
}

interface DayLog {
  date: string;
  label: string;
  meals: PastMeal[];
  loading: boolean;
  loaded: boolean;
  expanded: boolean;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

export default function PastLogsModal({ visible, onClose, onEditMeal }: PastLogsModalProps) {
  const [days, setDays] = useState<DayLog[]>([]);
  const tz = new Date().getTimezoneOffset();

  // Generate last 7 days on open
  useEffect(() => {
    if (!visible) return;
    const dates: DayLog[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
      dates.push({
        date: dateStr,
        label: formatDateLabel(dateStr),
        meals: [],
        loading: false,
        loaded: false,
        expanded: i === 1, // yesterday expanded by default
      });
    }
    setDays(dates);
    // Auto-load yesterday
    loadDay(dates[0].date, dates);
  }, [visible]);

  const loadDay = async (dateStr: string, initial?: DayLog[]) => {
    if (initial) {
      const idx = initial.findIndex(d => d.date === dateStr);
      if (idx === -1 || initial[idx].loaded || initial[idx].loading) return;
      const updated = [...initial];
      updated[idx] = { ...updated[idx], loading: true };
      setDays(updated);
    } else {
      setDays(prev => prev.map(d =>
        d.date === dateStr ? { ...d, loading: true } : d
      ));
    }

    try {
      const token = getAuthToken();
      const res = await fetch(
        `${getApiBase()}/nutrition-log/daily?date=${dateStr}&tz=${tz}`,
        { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
      );
      const data = await res.json();
      const meals: PastMeal[] = (data.meals || []).map((m: any) => ({
        id: m.id,
        loggedAt: m.loggedAt,
        mealType: m.mealType || 'snack',
        logName: m.logName || 'Meal',
        items: m.items || [],
        imageUrl: m.imageUrl || undefined,
        imageUrls: m.imageUrls || (m.imageUrl ? [m.imageUrl] : []),
      }));

      setDays(prev => prev.map(d =>
        d.date === dateStr ? { ...d, meals, loading: false, loaded: true } : d
      ));
    } catch {
      setDays(prev => prev.map(d =>
        d.date === dateStr ? { ...d, loading: false, loaded: true } : d
      ));
    }
  };

  const toggleDay = (dateStr: string) => {
    setDays(prev => {
      const updated = prev.map(d =>
        d.date === dateStr ? { ...d, expanded: !d.expanded } : d
      );
      const day = updated.find(d => d.date === dateStr);
      if (day && day.expanded && !day.loaded && !day.loading) {
        loadDay(dateStr, updated);
      }
      return updated;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Past Logs</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
          {days.map((day) => (
            <View key={day.date} style={styles.daySection}>
              <TouchableOpacity
                style={styles.dayHeader}
                onPress={() => toggleDay(day.date)}
                activeOpacity={0.7}
              >
                <Text style={styles.dayLabel}>{day.label}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {day.loaded && (
                    <Text style={styles.dayCount}>
                      {day.meals.length} log{day.meals.length !== 1 ? 's' : ''}
                    </Text>
                  )}
                  <Feather
                    name={day.expanded ? 'chevron-down' : 'chevron-right'}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
              </TouchableOpacity>

              {day.expanded && (
                <View style={styles.dayContent}>
                  {day.loading && (
                    <ActivityIndicator size="small" color={colors.textMuted} style={{ paddingVertical: 12 }} />
                  )}
                  {day.loaded && day.meals.length === 0 && (
                    <Text style={styles.emptyText}>No meals logged</Text>
                  )}
                  {day.meals.map((meal) => (
                    <TouchableOpacity
                      key={meal.id}
                      style={styles.mealRow}
                      activeOpacity={0.7}
                      onPress={() => onEditMeal?.(meal)}
                    >
                      {meal.imageUrl ? (
                        <Image source={{ uri: meal.imageUrl }} style={styles.mealThumb} />
                      ) : (
                        <View style={[styles.mealThumb, styles.mealThumbPlaceholder]}>
                          <Feather name="coffee" size={14} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealName} numberOfLines={1}>{meal.logName}</Text>
                        <Text style={styles.mealMeta}>
                          {formatTime(meal.loggedAt)} -- {meal.mealType} -- {meal.items.length} item{meal.items.length !== 1 ? 's' : ''}
                        </Text>
                      </View>
                      <Feather name="edit-2" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.textPrimary,
  },
  daySection: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dayLabel: {
    fontFamily: fonts.heading,
    fontSize: 14,
    color: colors.textPrimary,
  },
  dayCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  dayContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 10,
  },
  mealThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
  },
  mealThumbPlaceholder: {
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mealName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  mealMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
});

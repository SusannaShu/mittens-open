/**
 * DateRangePicker -- Modal for selecting a custom date range.
 *
 * Provides a simple calendar-style day picker. The user taps a start date
 * and then an end date, then confirms. Used by the Pendant Feed screen
 * for the "Custom" time filter.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (start: Date, end: Date) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function inRange(day: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  return day.getTime() >= start.getTime() && day.getTime() <= end.getTime();
}

export function DateRangePicker({ visible, onClose, onSelect }: Props) {
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const monthLabel = useMemo(() => {
    return viewMonth.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }, [viewMonth]);

  // Generate calendar grid for the current viewMonth
  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days: (Date | null)[] = [];

    // Padding for first week
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null);
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(new Date(year, month, d));
    }

    return days;
  }, [viewMonth]);

  const prevMonth = useCallback(() => {
    setViewMonth((m) => {
      const d = new Date(m);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  }, []);

  const nextMonth = useCallback(() => {
    const now = new Date();
    setViewMonth((m) => {
      const d = new Date(m);
      d.setMonth(d.getMonth() + 1);
      // Don't go past current month
      if (d.getFullYear() > now.getFullYear() ||
        (d.getFullYear() === now.getFullYear() && d.getMonth() > now.getMonth())) {
        return m;
      }
      return d;
    });
  }, []);

  const handleDayPress = useCallback((day: Date) => {
    // Don't allow future dates
    if (day.getTime() > Date.now()) return;

    if (!startDate || (startDate && endDate)) {
      // Starting a new selection
      setStartDate(day);
      setEndDate(null);
    } else {
      // Setting end date
      if (day.getTime() < startDate.getTime()) {
        // Swap if end is before start
        setEndDate(startDate);
        setStartDate(day);
      } else {
        setEndDate(day);
      }
    }
  }, [startDate, endDate]);

  const handleConfirm = useCallback(() => {
    if (startDate) {
      onSelect(startDate, endDate || startDate);
    }
  }, [startDate, endDate, onSelect]);

  const handleReset = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
  }, []);

  const today = new Date();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Select Date Range</Text>
          <TouchableOpacity onPress={handleReset} style={styles.resetBtn}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        {/* Month navigation */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.navBtn}>
            <Feather name="chevron-left" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.navBtn}>
            <Feather name="chevron-right" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Day names header */}
        <View style={styles.dayNamesRow}>
          {DAY_NAMES.map((d) => (
            <Text key={d} style={styles.dayName}>{d}</Text>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.calendarGrid}>
          {calendarDays.map((day, i) => {
            if (!day) {
              return <View key={`empty-${i}`} style={styles.dayCell} />;
            }

            const isFuture = day.getTime() > Date.now();
            const isStart = startDate && sameDay(day, startDate);
            const isEnd = endDate && sameDay(day, endDate);
            const isInRange = inRange(day, startDate, endDate);
            const isToday = sameDay(day, today);

            return (
              <TouchableOpacity
                key={day.toISOString()}
                style={[
                  styles.dayCell,
                  isInRange && !isStart && !isEnd && styles.dayCellInRange,
                ]}
                onPress={() => handleDayPress(day)}
                disabled={isFuture}
                activeOpacity={0.6}
              >
                <View
                  style={[
                    styles.dayCircle,
                    (isStart || isEnd) && styles.dayCircleSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isFuture && styles.dayTextDisabled,
                      isToday && styles.dayTextToday,
                      (isStart || isEnd) && styles.dayTextSelected,
                      isInRange && !isStart && !isEnd && styles.dayTextInRange,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Selection summary + confirm */}
        <View style={styles.footer}>
          <Text style={styles.selectionSummary}>
            {!startDate
              ? 'Tap a start date'
              : !endDate
              ? `From: ${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} -- tap an end date`
              : `${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          </Text>
          <TouchableOpacity
            style={[styles.confirmBtn, !startDate && styles.confirmBtnDisabled]}
            onPress={handleConfirm}
            disabled={!startDate}
            activeOpacity={0.7}
          >
            <Text style={[styles.confirmText, !startDate && styles.confirmTextDisabled]}>
              Apply
            </Text>
          </TouchableOpacity>
        </View>
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  headerTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
  },
  resetBtn: {
    padding: spacing.xs,
  },
  resetText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  navBtn: {
    padding: spacing.xs,
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dayNamesRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  dayName: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
  },
  dayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    // no longer used -- selected state is on the inner circle
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: colors.textPrimary,
  },
  dayCellInRange: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  dayText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  dayTextDisabled: {
    color: colors.border,
  },
  dayTextToday: {
    fontWeight: '700',
  },
  dayTextSelected: {
    color: '#FFF',
    fontWeight: '700',
  },
  dayTextInRange: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  selectionSummary: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  confirmBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    backgroundColor: colors.border,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
  },
  confirmTextDisabled: {
    color: colors.textMuted,
  },
});

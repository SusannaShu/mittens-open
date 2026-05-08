/**
 * CalendarMonthView -- Month grid with activity dots/counts.
 * Tap a day to switch to day view.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, spacing } from '../../lib/theme';

interface Props {
  /** The month to display, as YYYY-MM-DD (any day in that month) */
  monthDate: string;
  /** Activity counts per date: { "2026-04-10": 5, ... } */
  activityCounts: Record<string, number>;
  /** Currently selected date */
  selectedDate: string;
  /** Called when user taps a day */
  onDayTap: (date: string) => void;
}

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function CalendarMonthView({ monthDate, activityCounts, selectedDate, onDayTap }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const cellSize = (screenWidth - spacing.lg * 2) / 7;

  const d = new Date(monthDate + 'T12:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();

  // First day of month (0=Sun, adjust to Mon=0)
  const firstDay = new Date(year, month, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0

  // Days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date().toLocaleDateString('en-CA');
  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Build grid rows
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <View style={s.container}>
      <Text style={s.monthTitle}>{monthLabel}</Text>

      {/* Day headers */}
      <View style={s.headerRow}>
        {DAYS.map((day, i) => (
          <View key={i} style={[s.cell, { width: cellSize, height: 24 }]}>
            <Text style={s.headerText}>{day}</Text>
          </View>
        ))}
      </View>

      {/* Date cells */}
      {rows.map((row, ri) => (
        <View key={ri} style={s.row}>
          {row.map((dayNum, ci) => {
            if (dayNum === null) {
              return <View key={ci} style={[s.cell, { width: cellSize, height: cellSize * 0.85 }]} />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
            const count = activityCounts[dateStr] || 0;
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;

            return (
              <TouchableOpacity
                key={ci}
                style={[s.cell, { width: cellSize, height: cellSize * 0.85 }]}
                onPress={() => onDayTap(dateStr)}
                activeOpacity={0.6}
              >
                <View style={[s.dayCircle, isToday && s.dayCircleToday, isSelected && !isToday && s.dayCircleSelected]}>
                  <Text style={[s.dayNum, isToday && s.dayNumToday, isSelected && !isToday && s.dayNumSelected]}>
                    {dayNum}
                  </Text>
                </View>
                {/* Activity dots */}
                {count > 0 && (
                  <View style={s.dotRow}>
                    {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                      <View key={i} style={s.dot} />
                    ))}
                    {count > 4 && <Text style={s.dotExtra}>+</Text>}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingBottom: spacing.md,
  },
  monthTitle: {
    fontFamily: fonts.heading,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  headerText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  dayCircle: {
    width: 28, height: 28, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  dayCircleToday: {
    backgroundColor: colors.textPrimary,
  },
  dayCircleSelected: {
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
  },
  dayNum: {
    fontSize: 13, fontWeight: '500', color: colors.textPrimary,
  },
  dayNumToday: {
    color: colors.bg, fontWeight: '700',
  },
  dayNumSelected: {
    fontWeight: '700',
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 1,
    height: 6,
  },
  dot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: colors.textPrimary,
  },
  dotExtra: {
    fontSize: 6, color: colors.textMuted, fontWeight: '700',
  },
});

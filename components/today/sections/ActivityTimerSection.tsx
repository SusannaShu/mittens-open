/**
 * ActivityTimerSection -- Prominent activity timer with category dropdown.
 * Renders inside Life Balance section. Start/stop logs activity automatically.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../../lib/theme';
import { TimerCategory } from '../../../hooks/useFocusTimer';
import { todayStyles as gs } from '../../../styles/todayStyles';

const FOCUS_PRESETS = [15, 25, 30, 45, 60, 90];

interface Props {
  collapsed?: boolean;
  onToggle?: () => void;
  isRunning: boolean;
  timeLeft: number | null;
  category: TimerCategory;
  activityName: string;
  startedAt: string | null;
  getElapsed: () => number;
  breakIntervalMins: number;
  onStart: (cat?: TimerCategory, name?: string) => void;
  onStop: () => void;
  onCategoryChange: (cat: TimerCategory) => void;
  onNameChange: (name: string) => void;
  onBreakIntervalChange?: (mins: number) => void;
  dynamicCategories?: { key: string; label: string; icon: string }[];
}

export default function ActivityTimerSection({
  collapsed, onToggle,
  isRunning, timeLeft, category, activityName, startedAt,
  getElapsed, breakIntervalMins, onStart, onStop, onCategoryChange, onNameChange,
  onBreakIntervalChange, dynamicCategories = [],
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [showFocusTime, setShowFocusTime] = useState(false);
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    if (!isRunning) { setElapsed(0); return; }
    const interval = setInterval(() => setElapsed(getElapsed()), 1000);
    return () => clearInterval(interval);
  }, [isRunning, getElapsed]);

  const allCategories = dynamicCategories.length > 0
    ? [...dynamicCategories, { key: 'other', label: 'Other', icon: 'plus-circle' }]
    : [{ key: 'other', label: 'Other', icon: 'plus-circle' }];
  const currentCat = allCategories.find(c => c.key === category);
  const isOther = category === 'other';
  const icon = currentCat?.icon || 'circle';

  const formatElapsed = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatBreak = (secs: number | null) => {
    if (secs == null || secs <= 0) return 'Break!';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };



  return (
    <View style={gs.section}>
      <TouchableOpacity style={gs.sectionHeader} onPress={onToggle} activeOpacity={0.7} disabled={!onToggle}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Feather name="clock" size={14} color={colors.textPrimary} />
          <Text style={gs.sectionTitle}>FOCUS TIMER</Text>
        </View>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>

      {!collapsed && (
        <View style={styles.container}>
          {/* Timer display */}
      <View style={styles.timerRow}>
        <View style={[styles.iconCircle, isRunning && styles.iconCircleActive]}>
          <Feather name={icon as any} size={20} color={isRunning ? '#FFF' : colors.textPrimary} />
        </View>

        <View style={{ flex: 1 }}>
          {isRunning ? (
            <>
              <Text style={styles.elapsedTime}>{formatElapsed(elapsed)}</Text>
              <Text style={styles.categoryLabel}>{activityName || category}</Text>
              {timeLeft != null && (
                <Text style={styles.breakLabel}>
                  Break in {formatBreak(timeLeft)}
                </Text>
              )}
            </>
          ) : (
            <Text style={styles.readyLabel}>Start an activity</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.actionBtn, isRunning && styles.stopBtn]}
          onPress={() => {
            if (isRunning) {
              onStop();
            } else {
              const name = isOther ? (customName || 'Other') : (currentCat?.label || category);
              onStart(category, name);
            }
          }}
          activeOpacity={0.7}
        >
          <Feather
            name={isRunning ? 'square' : 'play'}
            size={16}
            color={isRunning ? '#E53E3E' : '#FFF'}
          />
          <Text style={[styles.actionText, isRunning && styles.stopText]}>
            {isRunning ? 'Stop' : 'Start'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Category picker + focus time (only when not running) */}
      {!isRunning && (
        <>
          {/* Category selector row */}
          <TouchableOpacity
            style={styles.pickerToggle}
            onPress={() => { setShowPicker(!showPicker); setShowFocusTime(false); }}
            activeOpacity={0.7}
          >
            <Feather name={(currentCat?.icon || icon) as any} size={12} color={colors.textSecondary} />
            <Text style={styles.pickerLabel}>{isOther ? (customName || 'Other') : (currentCat?.label || category)}</Text>
            <Feather name={showPicker ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </TouchableOpacity>

          {showPicker && (
            <View style={styles.categoryGrid}>
              {allCategories.map((cat) => {
                const isSelected = category === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                    onPress={() => {
                      onCategoryChange(cat.key as TimerCategory);
                      if (cat.key !== 'other') {
                        onNameChange(cat.label);
                        setShowPicker(false);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Feather name={cat.icon as any} size={10} color={isSelected ? '#FFF' : colors.textSecondary} />
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Custom name input -- ONLY for "Other" */}
          {isOther && (
            <TextInput
              style={styles.nameInput}
              value={customName}
              onChangeText={(t) => { setCustomName(t); onNameChange(t); }}
              placeholder="What are you doing?"
              placeholderTextColor={colors.textMuted}
            />
          )}

          {/* Focus time selector */}
          <TouchableOpacity
            style={styles.focusTimeToggle}
            onPress={() => { setShowFocusTime(!showFocusTime); setShowPicker(false); }}
            activeOpacity={0.7}
          >
            <Feather name="clock" size={12} color={colors.textSecondary} />
            <Text style={styles.focusTimeLabel}>Break reminder: {breakIntervalMins}min</Text>
            <Feather name={showFocusTime ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          </TouchableOpacity>

          {showFocusTime && (
            <View style={styles.focusGrid}>
              {FOCUS_PRESETS.map((mins) => {
                const isSelected = breakIntervalMins === mins;
                return (
                  <TouchableOpacity
                    key={mins}
                    style={[styles.focusChip, isSelected && styles.focusChipActive]}
                    onPress={() => {
                      onBreakIntervalChange?.(mins);
                      setShowFocusTime(false);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.focusChipText, isSelected && styles.focusChipTextActive]}>
                      {mins}min
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </>
      )}
        </View>
      )}
    </View>
  );
}

const styles = {
  container: {
    marginTop: 8,
    padding: spacing.sm,
    backgroundColor: '#FAFAFA',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  } as const,
  timerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  iconCircleActive: {
    backgroundColor: colors.textPrimary,
  },
  elapsedTime: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums' as const],
  },
  categoryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600' as const,
  },
  breakLabel: {
    fontSize: 10,
    color: '#E53E3E',
    fontWeight: '500' as const,
    marginTop: 1,
  },
  readyLabel: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500' as const,
  },
  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  stopBtn: {
    backgroundColor: '#FFF0F0',
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  stopText: {
    color: '#E53E3E',
  },
  pickerToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 8,
    paddingVertical: 4,
  },
  pickerLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600' as const,
    flex: 1,
  },
  categoryGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 6,
  },
  categoryChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFF',
  },
  categoryChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: '#FFF',
  },
  nameInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: '#FFF',
  },
  focusTimeToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 6,
    paddingVertical: 4,
  },
  focusTimeLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500' as const,
    flex: 1,
  },
  focusGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 4,
  },
  focusChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFF',
  },
  focusChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  focusChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  focusChipTextActive: {
    color: '#FFF',
  },
};

import { useState, useEffect } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Pressable, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { colors, spacing } from '../../../lib/theme';
import ActivityTimeInputs from '../../common/ActivityTimeInputs';
import { s } from '../TodayModals';
import { EntryTypeTabs } from './EntryTypeTabs';
import { MealForm } from './MealForm';
import { ActivityForm } from './ActivityForm';
import { SleepForm } from './SleepForm';
import { ManualEntryType } from './types';

interface ManualEntryModalProps {
  visible: boolean;
  onClose: () => void;
  // Shared
  loggedAt: Date;
  onLoggedAtChange: (d: Date) => void;
  // Optional initial date (for Reflect tab -- sets date to viewed date)
  initialDate?: string; // YYYY-MM-DD
  initialTab?: ManualEntryType;
  // Meal fields
  text: string;
  onTextChange: (t: string) => void;
  // USDA deterministic foods added manually
  usdaFoods?: any[];
  onUsdaFoodsChange?: (foods: any[]) => void;
  photos: string[];
  onPhotosChange: (p: string[]) => void;
  mealType: string;
  onMealTypeChange: (t: string) => void;
  analyzing: boolean;
  onSubmit: () => void;
  // Activity fields
  onActivitySubmit: (data: {
    logName: string; activityType: string; duration_min?: number; loggedAt?: string;
    location?: string; intensity?: string; outdoors?: boolean;
    photos?: string[]; engagement?: number; energy?: number;
    aeiou?: Record<string, string>;
  }) => void;
  // Sleep fields
  onSleepSubmit: (data: { sleepStart?: string; sleepEnd?: string; totalMinutes?: number; quality?: string; notes?: string; energy?: number; environment?: string }) => void;
}

export function ManualEntryModal({
  visible, onClose, loggedAt, onLoggedAtChange,
  initialDate, initialTab,
  text, onTextChange, usdaFoods, onUsdaFoodsChange, photos, onPhotosChange,
  mealType, onMealTypeChange, analyzing, onSubmit,
  onActivitySubmit, onSleepSubmit,
}: ManualEntryModalProps) {
  const [entryType, setEntryType] = useState<ManualEntryType>(initialTab || 'meal');

  useEffect(() => {
    if (visible && initialTab) {
      setEntryType(initialTab);
    }
  }, [visible, initialTab]);

  // Time picker state (auto-applied, no checkmark)
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editHour, setEditHour] = useState('');
  const [editMinute, setEditMinute] = useState('');
  const [editAmPm, setEditAmPm] = useState<'AM' | 'PM'>('AM');

  // Activity duration (managed here for ActivityTimeInputs)
  const [actDuration, setActDuration] = useState('');

  // Auto-apply time when fields change
  const autoApplyTime = (hour: string, minute: string, ampm: 'AM' | 'PM') => {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || h < 1 || h > 12 || isNaN(m) || m < 0 || m > 59) return;
    const newDate = new Date(loggedAt);
    let hour24 = h === 12 ? 0 : h;
    if (ampm === 'PM') hour24 += 12;
    newDate.setHours(hour24, m, 0, 0);
    onLoggedAtChange(newDate);
  };

  const handleHourChange = (v: string) => { setEditHour(v); autoApplyTime(v, editMinute, editAmPm); };
  const handleMinuteChange = (v: string) => { setEditMinute(v); autoApplyTime(editHour, v, editAmPm); };
  const handleAmPmChange = (v: 'AM' | 'PM') => { setEditAmPm(v); autoApplyTime(editHour, editMinute, v); };

  // Date navigation
  const changeDate = (offset: number) => {
    const d = new Date(loggedAt);
    d.setDate(d.getDate() + offset);
    onLoggedAtChange(d);
  };

  // Init on open
  useEffect(() => {
    if (visible) {
      let baseDate: Date;
      if (initialDate) {
        // Use initialDate from Reflect tab
        baseDate = new Date(initialDate + 'T' + new Date().toTimeString().slice(0, 5) + ':00');
      } else {
        baseDate = new Date();
      }
      onLoggedAtChange(baseDate);

      const h = baseDate.getHours();
      setEditHour(String(h === 0 ? 12 : h > 12 ? h - 12 : h));
      setEditMinute(String(baseDate.getMinutes()).padStart(2, '0'));
      setEditAmPm(h >= 12 ? 'PM' : 'AM');
      setShowTimePicker(false);

      if (h < 5) onMealTypeChange('snack');
      else if (h < 11) onMealTypeChange('breakfast');
      else if (h < 15) onMealTypeChange('lunch');
      else if (h < 21) onMealTypeChange('dinner');
      else onMealTypeChange('snack');

      // Sleep: default to yesterday if before 2 PM (logging last night)
      // This only applies when no initialDate is set
      if (!initialDate && entryType === 'sleep' && h < 14) {
        const yesterday = new Date(baseDate);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(23, 0, 0, 0);
        onLoggedAtChange(yesterday);
        setEditHour('11');
        setEditMinute('00');
        setEditAmPm('PM');
      }
    }
  }, [visible]);

  // When switching to sleep tab, adjust date if needed
  useEffect(() => {
    if (visible && entryType === 'sleep' && !initialDate) {
      const now = new Date();
      if (now.getHours() < 14) {
        const yesterday = new Date(loggedAt);
        yesterday.setDate(now.getDate() - 1);
        yesterday.setHours(23, 0, 0, 0);
        onLoggedAtChange(yesterday);
        setEditHour('11');
        setEditMinute('00');
        setEditAmPm('PM');
      }
    }
  }, [entryType]);

  const timeStr = loggedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = (() => {
    const now = new Date();
    const isToday = loggedAt.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = loggedAt.toDateString() === yesterday.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = loggedAt.toDateString() === tomorrow.toDateString();
    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    if (isTomorrow) return 'Tomorrow';
    return loggedAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  })();

  // Is this a future entry?
  const isFuture = loggedAt.getTime() > Date.now();

  // Reset all state on close
  const handleClose = () => {
    setActDuration('');
    setShowTimePicker(false);
    onClose();
  };

  /* ── Shared date + time picker row ── */
  const renderDateTimePicker = () => (
    <View style={{ marginBottom: spacing.md }}>
      {/* Date navigation row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: spacing.sm }}>
        <TouchableOpacity onPress={() => changeDate(-1)} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{dateStr}</Text>
        <TouchableOpacity onPress={() => changeDate(1)} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-right" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Time row */}
      <TouchableOpacity
        style={s.timePickerBtn}
        onPress={() => setShowTimePicker(!showTimePicker)}
        activeOpacity={0.6}
      >
        <Feather name="clock" size={14} color={colors.textPrimary} />
        <Text style={s.timePickerLabel}>
          {entryType === 'sleep' ? 'Bedtime' : 'Time'}
        </Text>
        <Text style={s.timePickerValue}>{timeStr}</Text>
        <Feather name={showTimePicker ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      </TouchableOpacity>

      {showTimePicker && (
        <View style={s.timePickerInline}>
          <View style={s.timePickerRow}>
            <TextInput
              style={s.timePickerInput}
              value={editHour}
              onChangeText={handleHourChange}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="12"
              placeholderTextColor={colors.textMuted}
              selectTextOnFocus
            />
            <Text style={s.timePickerColon}>:</Text>
            <TextInput
              style={s.timePickerInput}
              value={editMinute}
              onChangeText={handleMinuteChange}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="00"
              placeholderTextColor={colors.textMuted}
              selectTextOnFocus
            />
            <View style={s.ampmRow}>
              <TouchableOpacity
                style={[s.ampmBtn, editAmPm === 'AM' && s.ampmBtnActive]}
                onPress={() => handleAmPmChange('AM')}
                activeOpacity={0.6}
              >
                <Text style={[s.ampmText, editAmPm === 'AM' && s.ampmTextActive]}>AM</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.ampmBtn, editAmPm === 'PM' && s.ampmBtnActive]}
                onPress={() => handleAmPmChange('PM')}
                activeOpacity={0.6}
              >
                <Text style={[s.ampmText, editAmPm === 'PM' && s.ampmTextActive]}>PM</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.modalOverlay} onPress={handleClose}>
          <ScrollView style={{ maxHeight: '100%' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View onStartShouldSetResponder={() => true} onResponderRelease={() => Keyboard.dismiss()}>
              <View style={s.modalContent}>
                <Text style={s.modalTitle}>Manual Entry</Text>

          {/* Entry type tabs */}
          <EntryTypeTabs value={entryType} onChange={setEntryType} />

          {/* Shared date + time picker */}
          {entryType === 'activity' ? (
             <ActivityTimeInputs loggedAt={loggedAt} setLoggedAt={onLoggedAtChange} durationMin={actDuration} setDurationMin={setActDuration} />
          ) : (
             renderDateTimePicker()
          )}

          {/* Future indicator */}
          {isFuture && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#F5F5F5', borderRadius: 8 }}>
              <Feather name="calendar" size={12} color={colors.textMuted} />
              <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '500' }}>Planning -- reflection fields will be available after this time passes</Text>
            </View>
          )}

          {/* ─── Meal Form ─── */}
          {entryType === 'meal' && (
            <MealForm
              text={text}
              onTextChange={onTextChange}
              usdaFoods={usdaFoods}
              onUsdaFoodsChange={onUsdaFoodsChange}
              photos={photos}
              onPhotosChange={onPhotosChange}
              mealType={mealType}
              onMealTypeChange={onMealTypeChange}
              analyzing={analyzing}
              onSubmit={onSubmit}
              onClose={handleClose}
              isFuture={isFuture}
            />
          )}

          {/* ─── Activity Form ─── */}
          {entryType === 'activity' && (
            <ActivityForm
              onActivitySubmit={onActivitySubmit}
              loggedAt={loggedAt}
              onClose={handleClose}
              isFuture={isFuture}
            />
          )}

          {/* ─── Sleep Form ─── */}
          {entryType === 'sleep' && (
            <SleepForm
              loggedAt={loggedAt}
              onSleepSubmit={onSleepSubmit}
              onClose={handleClose}
              isFuture={isFuture}
            />
          )}
        </View>
        </View>
        </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

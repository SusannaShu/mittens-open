/**
 * SleepEditModal -- Edit/reflect on a sleep log entry.
 * Editable: bedtime, wake time, duration, quality,
 *           energy on waking, environment (structured pills + text).
 *
 * Science-based environment factors:
 *   - Room temperature (Harvard/NIH: 65-68F optimal)
 *   - Light exposure (NIH/CDC: darkness promotes melatonin)
 *   - Noise level (Sleep Foundation: quiet prevents fragmentation)
 *   - Screen before bed (UC Davis: blue light inhibits melatonin)
 *   - Caffeine timing (Harvard: 6hr half-life)
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity,
  TextInput, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { SleepEntry } from '../../lib/services/schedule/sleepApi';

interface Props {
  visible: boolean;
  sleep: SleepEntry | null;
  onClose: () => void;
  onSave: (id: number, data: Partial<SleepEntry>) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

const QUALITY_PILLS: { key: string; label: string }[] = [
  { key: 'poor', label: 'Poor' },
  { key: 'fair', label: 'Fair' },
  { key: 'good', label: 'Good' },
  { key: 'great', label: 'Great' },
];

const TEMP_PILLS = [
  { key: 'too_hot', label: 'Too hot' },
  { key: 'comfortable', label: 'Comfortable' },
  { key: 'too_cold', label: 'Too cold' },
];

const LIGHT_PILLS = [
  { key: 'dark', label: 'Dark' },
  { key: 'some_light', label: 'Some light' },
  { key: 'bright', label: 'Bright' },
];

const NOISE_PILLS = [
  { key: 'quiet', label: 'Quiet' },
  { key: 'some_noise', label: 'Some noise' },
  { key: 'loud', label: 'Loud' },
];

const SCREEN_PILLS = [
  { key: 'none', label: 'None' },
  { key: 'under_30', label: '<30min' },
  { key: 'over_30', label: '30min+' },
];

const CAFFEINE_PILLS = [
  { key: 'none', label: 'None' },
  { key: 'before_2pm', label: 'Before 2pm' },
  { key: 'after_2pm', label: 'After 2pm' },
];

/** Parse environment JSON or text into structured data */
function parseEnvironment(env: string | null): Record<string, string> {
  if (!env) return {};
  try {
    const parsed = JSON.parse(env);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON, treat as notes */ }
  return { notes: env };
}

function serializeEnvironment(data: Record<string, string>): string {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v) cleaned[k] = v;
  }
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : '';
}

export default function SleepEditModal({ visible, sleep, onClose, onSave, onDelete }: Props) {
  const [bedHour, setBedHour] = useState('');
  const [bedMinute, setBedMinute] = useState('');
  const [bedAmPm, setBedAmPm] = useState<'AM' | 'PM'>('PM');
  const [wakeHour, setWakeHour] = useState('');
  const [wakeMinute, setWakeMinute] = useState('');
  const [wakeAmPm, setWakeAmPm] = useState<'AM' | 'PM'>('AM');
  const [durationHrs, setDurationHrs] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [quality, setQuality] = useState('');
  const [energy, setEnergy] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Structured environment pills
  const [temperature, setTemperature] = useState('');
  const [light, setLight] = useState('');
  const [noise, setNoise] = useState('');
  const [screen, setScreen] = useState('');
  const [caffeine, setCaffeine] = useState('');
  const [envNotes, setEnvNotes] = useState('');

  useEffect(() => {
    if (sleep) {
      // Bedtime
      if (sleep.sleepStart) {
        const d = new Date(sleep.sleepStart);
        const h = d.getHours();
        setBedHour(String(h === 0 ? 12 : h > 12 ? h - 12 : h));
        setBedMinute(String(d.getMinutes()).padStart(2, '0'));
        setBedAmPm(h >= 12 ? 'PM' : 'AM');
      }
      // Wake time
      if (sleep.sleepEnd) {
        const d = new Date(sleep.sleepEnd);
        const h = d.getHours();
        setWakeHour(String(h === 0 ? 12 : h > 12 ? h - 12 : h));
        setWakeMinute(String(d.getMinutes()).padStart(2, '0'));
        setWakeAmPm(h >= 12 ? 'PM' : 'AM');
      }
      // Duration
      const totalMin = sleep.totalMinutes || 0;
      setDurationHrs(String(Math.floor(totalMin / 60)));
      setDurationMin(String(totalMin % 60));

      setQuality(sleep.quality || '');
      setEnergy(sleep.energy ?? null);
      setNotes(sleep.notes || '');

      // Parse environment
      const envData = parseEnvironment(sleep.environment);
      setTemperature(envData.temperature || '');
      setLight(envData.light || '');
      setNoise(envData.noise || '');
      setScreen(envData.screen || '');
      setCaffeine(envData.caffeine || '');
      setEnvNotes(envData.notes || '');
    }
  }, [sleep]);

  if (!sleep) return null;

  const bedDate = sleep.sleepStart ? new Date(sleep.sleepStart) : new Date();
  const now = new Date();
  const isToday = bedDate.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = bedDate.toDateString() === yesterday.toDateString();
  const dateLabel = isToday ? 'Today' : isYesterday ? 'Yesterday' : bedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  /** Build bed/wake datetimes from input fields */
  const buildDatetime = (baseDate: Date, hour: string, minute: string, ampm: 'AM' | 'PM'): Date => {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (isNaN(h) || isNaN(m)) return baseDate;
    const d = new Date(baseDate);
    let hour24 = h === 12 ? 0 : h;
    if (ampm === 'PM') hour24 += 12;
    d.setHours(hour24, m, 0, 0);
    return d;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const bedBase = sleep.sleepStart ? new Date(sleep.sleepStart) : new Date();
      const bedTime = buildDatetime(bedBase, bedHour, bedMinute, bedAmPm);
      let wakeBase = sleep.sleepEnd ? new Date(sleep.sleepEnd) : new Date(bedBase);
      let wakeTime = buildDatetime(wakeBase, wakeHour, wakeMinute, wakeAmPm);

      // If wake is before bed, assume next day
      if (wakeTime <= bedTime) {
        wakeTime = new Date(wakeTime.getTime() + 24 * 60 * 60 * 1000);
      }

      const totalMinutes = Math.round((wakeTime.getTime() - bedTime.getTime()) / 60000);

      // Serialize environment
      const envStr = serializeEnvironment({
        temperature,
        light,
        noise,
        screen,
        caffeine,
        notes: envNotes,
      });

      await onSave(sleep.id, {
        sleepStart: bedTime.toISOString(),
        sleepEnd: wakeTime.toISOString(),
        totalMinutes,
        quality: quality || undefined,
        energy,
        environment: envStr || undefined,
        notes: notes.trim() || undefined,
      } as any);
      onClose();
    } catch {
      // handled upstream
    }
    setSaving(false);
  };

  const handleDelete = () => {
    Alert.alert('Delete Sleep Log', 'Remove this sleep entry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (onDelete) {
          await onDelete(sleep.id);
          onClose();
        }
      }},
    ]);
  };

  const renderPillRow = (
    label: string,
    pills: { key: string; label: string }[],
    value: string,
    onChange: (v: string) => void,
    hint?: string,
  ) => (
    <View style={s.pillSection}>
      <Text style={s.pillLabel}>{label}</Text>
      {hint && <Text style={s.pillHint}>{hint}</Text>}
      <View style={s.pillRow}>
        {pills.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[s.pill, value === p.key && s.pillActive]}
            onPress={() => onChange(value === p.key ? '' : p.key)}
            activeOpacity={0.6}
          >
            <Text style={[s.pillText, value === p.key && s.pillTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderTimeRow = (
    label: string,
    hour: string, setHr: (v: string) => void,
    minute: string, setMin: (v: string) => void,
    ampm: 'AM' | 'PM', setAmpm: (v: 'AM' | 'PM') => void,
  ) => (
    <View style={s.timeSection}>
      <Text style={s.label}>{label}</Text>
      <View style={s.timeRow}>
        <TextInput style={s.timeInput} value={hour} onChangeText={setHr}
          keyboardType="number-pad" maxLength={2} placeholder="12"
          placeholderTextColor={colors.textMuted} selectTextOnFocus />
        <Text style={s.timeColon}>:</Text>
        <TextInput style={s.timeInput} value={minute} onChangeText={setMin}
          keyboardType="number-pad" maxLength={2} placeholder="00"
          placeholderTextColor={colors.textMuted} selectTextOnFocus />
        <View style={s.ampmRow}>
          <TouchableOpacity style={[s.ampmBtn, ampm === 'AM' && s.ampmBtnActive]}
            onPress={() => setAmpm('AM')} activeOpacity={0.6}>
            <Text style={[s.ampmText, ampm === 'AM' && s.ampmTextActive]}>AM</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.ampmBtn, ampm === 'PM' && s.ampmBtnActive]}
            onPress={() => setAmpm('PM')} activeOpacity={0.6}>
            <Text style={[s.ampmText, ampm === 'PM' && s.ampmTextActive]}>PM</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {/* Header */}
            <View style={s.header}>
              <Feather name="moon" size={18} color="#7B61FF" />
              <Text style={s.headerTitle}>Sleep</Text>
              <Text style={s.headerDate}>{dateLabel}</Text>
              <TouchableOpacity onPress={onClose} activeOpacity={0.6}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Bedtime & Wake time */}
            {renderTimeRow('Bedtime', bedHour, setBedHour, bedMinute, setBedMinute, bedAmPm, setBedAmPm)}
            {renderTimeRow('Wake time', wakeHour, setWakeHour, wakeMinute, setWakeMinute, wakeAmPm, setWakeAmPm)}

            {/* Duration */}
            <Text style={s.label}>Duration</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
              <TextInput style={s.durationInput} value={durationHrs} onChangeText={setDurationHrs}
                keyboardType="numeric" maxLength={2} placeholder="0" placeholderTextColor={colors.textMuted} selectTextOnFocus />
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>hrs</Text>
              <TextInput style={s.durationInput} value={durationMin} onChangeText={setDurationMin}
                keyboardType="numeric" maxLength={2} placeholder="0" placeholderTextColor={colors.textMuted} selectTextOnFocus />
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>min</Text>
            </View>

            {/* Quality */}
            {renderPillRow('Quality', QUALITY_PILLS, quality, setQuality)}

            {/* Energy on waking */}
            <Text style={s.label}>Energy on waking (-5 to +5)</Text>
            <View style={s.scaleRow}>
              {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[s.scaleDot, energy === v && s.scaleDotActive]}
                  onPress={() => setEnergy(energy === v ? null : v)}
                  activeOpacity={0.6}
                >
                  <Text style={[s.scaleDotText, energy === v && s.scaleDotTextActive]}>
                    {v > 0 ? `+${v}` : v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.scaleLabels}>
              <Text style={s.scaleLabel}>Drained</Text>
              <Text style={s.scaleLabel}>0</Text>
              <Text style={s.scaleLabel}>Energized</Text>
            </View>

            {/* Environment -- structured pills */}
            <Text style={[s.label, { marginTop: spacing.lg }]}>Sleep Environment</Text>

            {renderPillRow('Temperature', TEMP_PILLS, temperature, setTemperature, '65-68F (18-20C) is optimal')}
            {renderPillRow('Light', LIGHT_PILLS, light, setLight, 'Darkness promotes melatonin')}
            {renderPillRow('Noise', NOISE_PILLS, noise, setNoise)}
            {renderPillRow('Screen before bed', SCREEN_PILLS, screen, setScreen, 'Blue light inhibits melatonin')}
            {renderPillRow('Caffeine', CAFFEINE_PILLS, caffeine, setCaffeine, '6hr half-life affects sleep')}

            {/* Environment notes */}
            <TextInput
              style={[s.input, { minHeight: 44, marginTop: spacing.sm }]}
              value={envNotes}
              onChangeText={setEnvNotes}
              placeholder="Other environment notes..."
              placeholderTextColor={colors.textMuted}
              multiline
            />

            {/* Notes */}
            <Text style={s.label}>Notes</Text>
            <TextInput
              style={[s.input, { minHeight: 44 }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes..."
              placeholderTextColor={colors.textMuted}
              multiline
            />

          </ScrollView>

          {/* Sticky Actions */}
          <View style={s.stickyActions}>
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>

            {onDelete && (
              <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} activeOpacity={0.6}>
                <Feather name="trash-2" size={14} color={colors.textMuted} />
                <Text style={s.deleteBtnText}>Delete Sleep Log</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.lg, maxHeight: '92%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary,
    flex: 1,
  },
  headerDate: {
    fontSize: 12, color: colors.textMuted, fontWeight: '600',
    marginRight: 8,
  },
  label: {
    fontSize: 11, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4, marginTop: spacing.md,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, fontSize: 14, color: colors.textPrimary,
  },
  timeSection: { marginBottom: spacing.sm },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  timeInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    width: 44, height: 38, textAlign: 'center',
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  timeColon: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  ampmRow: { flexDirection: 'row', marginLeft: 4 },
  ampmBtn: {
    paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  ampmBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  ampmText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  ampmTextActive: { color: colors.bg },
  durationInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    width: 44, height: 38, textAlign: 'center',
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
  },
  scaleRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 4,
  },
  scaleDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center',
  },
  scaleDotActive: { backgroundColor: colors.textPrimary },
  scaleDotText: { fontSize: 9, fontWeight: '600', color: colors.textMuted },
  scaleDotTextActive: { color: colors.bg },
  scaleLabels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 2,
  },
  scaleLabel: { fontSize: 9, color: colors.textMuted },

  // Pills
  pillSection: { marginBottom: spacing.sm },
  pillLabel: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 2,
  },
  pillHint: {
    fontSize: 9, color: colors.textMuted, fontStyle: 'italic', marginBottom: 4,
  },
  pillRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.bg,
  },
  pillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  pillText: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  pillTextActive: { color: colors.bg },

  stickyActions: {
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  saveBtn: {
    backgroundColor: colors.textPrimary, borderRadius: radius.md,
    paddingVertical: 12, alignItems: 'center', marginTop: spacing.xs,
  },
  saveBtnText: { color: colors.bg, fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: spacing.xs,
  },
  deleteBtnText: { fontSize: 13, color: colors.textMuted },
});
